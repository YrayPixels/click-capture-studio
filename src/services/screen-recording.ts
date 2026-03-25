// Add type definitions for the File System Access API
interface FileSystemWritableFileStream {
  write(data: BlobPart): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
}

interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file';
  createWritable(): Promise<FileSystemWritableFileStream>;
}

// Extend the Window interface to include File System Access API
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle>;
  }
}

export interface RecordingOptions {
  audio: boolean;
  video: boolean;
  camera: boolean;
}

export interface MousePosition {
  x: number;
  y: number;
  timestamp: number;
}

export interface ClickEvent {
  /**
   * Seconds since recording start.
   * Used to map clicks onto the editor timeline.
   */
  t: number;
  /**
   * Click position normalized to the viewport at the time of capture.
   */
  xNorm: number;
  yNorm: number;
}

export class ScreenRecordingService {
  private mediaRecorder: MediaRecorder | null = null;
  private cameraStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private recordedBlob: Blob | null = null;
  private currentRecordingPath: string | null = null;
  private mousePositions: MousePosition[] = [];
  private clickEvents: ClickEvent[] = [];
  private recordingVideoUrl: string | null = null;
  private recordingStartPerfNow: number | null = null;
  private viewportAtStart: { w: number; h: number } | null = null;
  private cleanupRecordingListeners: (() => void) | null = null;

  getCurrentRecordingPath() {
    return this.currentRecordingPath;
  }

  getMousePositions() {
    return this.mousePositions;
  }

  getClickEvents() {
    return this.clickEvents;
  }
  
  getRecordingVideoUrl() {
    return this.recordingVideoUrl;
  }

  private trackMousePosition = () => {
    const handleMouseMove = (e: MouseEvent) => {
      this.mousePositions.push({
        x: e.clientX,
        y: e.clientY,
        timestamp: Date.now()
      });
    };

    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }

  private trackClickEvents = () => {
    const handlePointerDown = (e: PointerEvent) => {
      if (this.recordingStartPerfNow == null || !this.viewportAtStart) return;

      const vw = this.viewportAtStart.w || 1;
      const vh = this.viewportAtStart.h || 1;

      const xNorm = Math.min(1, Math.max(0, e.clientX / vw));
      const yNorm = Math.min(1, Math.max(0, e.clientY / vh));
      const t = (performance.now() - this.recordingStartPerfNow) / 1000;

      // Ignore events that happen before the recorder start (shouldn't happen, but safe).
      if (t < 0) return;

      this.clickEvents.push({ t, xNorm, yNorm });
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  };

  async startCameraRecording() {
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      return this.cameraStream;
    } catch (error) {
      console.error('Error accessing camera:', error);
      throw error;
    }
  }

  async startRecording(stream: MediaStream, options?: RecordingOptions) {
    try {
      this.recordedChunks = [];
      this.recordedBlob = null;
      this.recordingVideoUrl = null;
      this.mousePositions = [];
      this.clickEvents = [];
      this.recordingStartPerfNow = performance.now();
      this.viewportAtStart = {
        w: window.innerWidth,
        h: window.innerHeight,
      };

      let finalStream = stream;

      // If camera is enabled, combine screen and camera streams
      if (options?.camera && this.cameraStream) {
        const tracks = [...stream.getTracks(), ...this.cameraStream.getTracks()];
        finalStream = new MediaStream(tracks);
      }

      this.mediaRecorder = new MediaRecorder(finalStream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 8000000 // 8 Mbps for high quality
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      // Store cleanup handler; stopRecording() will run after MediaRecorder.stop()
      // and owns the final onstop logic.
      this.cleanupRecordingListeners = this.trackClickEvents();

      this.mediaRecorder.start();
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }

  private generateFileName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `recording-${timestamp}.webm`;
  }

  stopRecording(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No recording in progress'));
        return;
      }

      this.mediaRecorder.onstop = async () => {
        try {
          // Always cleanup click listeners first.
          this.cleanupRecordingListeners?.();
          this.cleanupRecordingListeners = null;

          // Stop camera stream if it exists
          if (this.cameraStream) {
            this.cameraStream.getTracks().forEach(track => track.stop());
            this.cameraStream = null;
          }

          this.recordedBlob = new Blob(this.recordedChunks, { type: 'video/webm' });
          const fileName = this.generateFileName();
          
          // Create a URL for the blob that will be accessible in the editor
          this.recordingVideoUrl = URL.createObjectURL(this.recordedBlob);
          
          // Use the File System Access API to save the file if available
          if (window.showSaveFilePicker) {
            try {
              const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                  description: 'Video Files',
                  accept: { 'video/webm': ['.webm'] }
                }]
              });
              
              const writable = await handle.createWritable();
              await writable.write(this.recordedBlob);
              await writable.close();
              
              // Store the file path
              this.currentRecordingPath = fileName;
              resolve(fileName);
            } catch (error) {
              console.error('Error using File System Access API:', error);
              // Fall back to downloading if the user cancels or an error occurs
              this.downloadFile(this.recordedBlob, fileName);
              this.currentRecordingPath = fileName;
              resolve(fileName);
            }
          } else {
            // Fallback to downloading if File System Access API is not supported
            this.downloadFile(this.recordedBlob, fileName);
            this.currentRecordingPath = fileName;
            resolve(fileName);
          }
        } catch (error) {
          reject(error);
        }
      };

      this.mediaRecorder.stop();
    });
  }

  private downloadFile(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}

export const screenRecordingService = new ScreenRecordingService();

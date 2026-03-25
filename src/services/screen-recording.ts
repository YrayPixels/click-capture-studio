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
  private cameraRecorder: MediaRecorder | null = null;
  private cameraStream: MediaStream | null = null;
  private recordedChunks: Blob[] = [];
  private recordedBlob: Blob | null = null;
  private recordedCameraChunks: Blob[] = [];
  private recordedCameraBlob: Blob | null = null;
  private currentRecordingPath: string | null = null;
  private mousePositions: MousePosition[] = [];
  private clickEvents: ClickEvent[] = [];
  private recordingVideoUrl: string | null = null;
  private recordingCameraVideoUrl: string | null = null;
  private recordingStartPerfNow: number | null = null;
  private viewportAtStart: { w: number; h: number } | null = null;
  private cleanupRecordingListeners: (() => void) | null = null;
  private usingGlobalClickCapture = false;
  private recordedMimeType: string | null = null;

  private describeError(e: unknown) {
    const anyE = e as { name?: string; message?: string; stack?: string; code?: unknown };
    return {
      name: anyE?.name,
      message: anyE?.message,
      code: anyE?.code,
      stack: anyE?.stack,
      raw: e,
    };
  }

  private listSupportedMimeTypes() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    if (typeof MediaRecorder === "undefined") return [];
    return candidates.map((t) => ({ type: t, supported: MediaRecorder.isTypeSupported(t) }));
  }

  private pickSupportedMimeType(): string | undefined {
    // Cross-browser support varies widely.
    // - Electron/Chromium: typically WebM (VP8/VP9)
    // - Safari: MediaRecorder may prefer MP4 (H.264/AAC) or have limited support
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
    ];

    if (typeof MediaRecorder === "undefined") return undefined;
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return undefined;
  }

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

  getRecordingCameraVideoUrl() {
    return this.recordingCameraVideoUrl;
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

  async startCameraRecording(options?: {
    audio?: boolean;
    video?: boolean;
    audioDeviceId?: string;
    videoDeviceId?: string;
  }) {
    try {
      const wantVideo = options?.video ?? true;
      const wantAudio = options?.audio ?? true;
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: wantVideo
          ? options?.videoDeviceId
            ? ({ deviceId: { exact: options.videoDeviceId } } as MediaTrackConstraints)
            : true
          : false,
        audio: wantAudio
          ? options?.audioDeviceId
            ? ({ deviceId: { exact: options.audioDeviceId } } as MediaTrackConstraints)
            : true
          : false,
      });
      return this.cameraStream;
    } catch (error) {
      console.error('Error accessing camera:', error);
      throw error;
    }
  }

  async startRecording(stream: MediaStream, options?: RecordingOptions) {
    try {
      if (typeof window === "undefined" || typeof document === "undefined") {
        throw new Error("Recording can only start in a browser environment.");
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("MediaRecorder is not supported in this browser.");
      }

      this.recordedChunks = [];
      this.recordedBlob = null;
      this.recordingVideoUrl = null;
      this.recordedCameraChunks = [];
      this.recordedCameraBlob = null;
      this.recordingCameraVideoUrl = null;
      this.mousePositions = [];
      this.clickEvents = [];
      this.recordingStartPerfNow = performance.now();
      this.viewportAtStart = {
        w: window.innerWidth,
        h: window.innerHeight,
      };
      this.recordedMimeType = null;

      let finalStream = stream;

      // If camera is enabled, combine screen and camera streams
      if (options?.camera && this.cameraStream) {
        const tracks = [...stream.getTracks(), ...this.cameraStream.getTracks()];
        finalStream = new MediaStream(tracks);
      }

      const mimeType = this.pickSupportedMimeType();
      const recorderOptions: MediaRecorderOptions = {
        // Keep quality reasonable; some platforms ignore this.
        videoBitsPerSecond: 8_000_000,
        // Avoid ultra-low bitrate defaults that can cause crunchy audio.
        audioBitsPerSecond: 192_000,
      };
      if (mimeType) recorderOptions.mimeType = mimeType;

      console.info("[recording] MediaRecorder init", {
        chosenMimeType: mimeType ?? "(none)",
        supportedMimeTypes: this.listSupportedMimeTypes(),
        tracks: finalStream.getTracks().map((t) => ({
          kind: t.kind,
          label: t.label,
          enabled: t.enabled,
          readyState: t.readyState,
          muted: (t as unknown as { muted?: boolean }).muted,
        })),
      });

      try {
        this.mediaRecorder = new MediaRecorder(finalStream, recorderOptions);
        this.recordedMimeType = this.mediaRecorder.mimeType || mimeType || null;
      } catch (e) {
        console.error("[recording] MediaRecorder constructor failed", {
          error: this.describeError(e),
          chosenMimeType: mimeType ?? "(none)",
          recorderOptions,
          supportedMimeTypes: this.listSupportedMimeTypes(),
        });
        throw e;
      }

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      // In Electron, prefer system-wide clicks captured by the main process.
      // In the browser, fall back to document-level pointer capture.
      this.usingGlobalClickCapture = Boolean(window.clickStudio?.startGlobalClickCapture);
      if (this.usingGlobalClickCapture) {
        try {
          const res = await window.clickStudio!.startGlobalClickCapture();
          if (res && typeof res === "object" && "ok" in res && res.ok === false) {
            throw new Error(res.error?.message || "Global click capture not allowed");
          }
          this.cleanupRecordingListeners = null;
        } catch (e) {
          console.warn("Failed to start global click capture, falling back to in-page clicks", e);
          this.usingGlobalClickCapture = false;
          this.cleanupRecordingListeners = this.trackClickEvents();
        }
      } else {
        // Store cleanup handler; stopRecording() will run after MediaRecorder.stop()
        // and owns the final onstop logic.
        this.cleanupRecordingListeners = this.trackClickEvents();
      }

      try {
        this.mediaRecorder.start();
      } catch (e) {
        console.error("[recording] MediaRecorder.start() failed", {
          error: this.describeError(e),
          state: this.mediaRecorder.state,
        });
        throw e;
      }
    } catch (error) {
      console.error("[recording] Error starting recording (service)", this.describeError(error));
      throw error;
    }
  }

  /**
   * Record the camera as a separate sidecar video so the editor can
   * non-destructively apply shape/size/position changes.
   */
  async startSidecarCameraRecording(stream: MediaStream) {
    // Reset sidecar buffers
    this.recordedCameraChunks = [];
    this.recordedCameraBlob = null;
    this.recordingCameraVideoUrl = null;

    const mimeType = this.pickSupportedMimeType();
    const recorderOptions: MediaRecorderOptions = {
      videoBitsPerSecond: 6_000_000,
    };
    if (mimeType) recorderOptions.mimeType = mimeType;

    try {
      this.cameraRecorder = new MediaRecorder(stream, recorderOptions);
    } catch (e) {
      console.error("[recording] camera sidecar recorder init failed", {
        error: this.describeError(e),
        recorderOptions,
        supportedMimeTypes: this.listSupportedMimeTypes(),
      });
      this.cameraRecorder = null;
      throw e;
    }

    this.cameraRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.recordedCameraChunks.push(event.data);
      }
    };

    try {
      this.cameraRecorder.start();
    } catch (e) {
      console.error("[recording] camera sidecar recorder start failed", {
        error: this.describeError(e),
      });
      this.cameraRecorder = null;
      throw e;
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

      const stopCameraSidecar = () => {
        return new Promise<void>((res) => {
          if (!this.cameraRecorder) {
            res();
            return;
          }

          const recorder = this.cameraRecorder;
          recorder.onstop = () => {
            try {
              if (this.recordedCameraChunks.length) {
                this.recordedCameraBlob = new Blob(this.recordedCameraChunks, {
                  type: "video/webm",
                });
                this.recordingCameraVideoUrl = URL.createObjectURL(
                  this.recordedCameraBlob
                );
              }
            } catch (e) {
              console.warn("[recording] camera sidecar finalize failed", e);
            } finally {
              this.cameraRecorder = null;
              res();
            }
          };

          try {
            recorder.stop();
          } catch (e) {
            console.warn("[recording] camera sidecar stop failed", e);
            this.cameraRecorder = null;
            res();
          }
        });
      };

      this.mediaRecorder.onstop = async () => {
        try {
          // Stop sidecar camera first (if any) so URLs are ready for the editor.
          await stopCameraSidecar();

          // Stop click capture first.
          if (this.usingGlobalClickCapture && window.clickStudio?.stopGlobalClickCapture) {
            try {
              const events = await window.clickStudio.stopGlobalClickCapture();
              this.clickEvents = events;
            } catch (e) {
              console.warn("Failed to stop global click capture", e);
            }
            this.usingGlobalClickCapture = false;
          } else {
            this.cleanupRecordingListeners?.();
            this.cleanupRecordingListeners = null;
          }

          // Stop camera stream if it exists
          if (this.cameraStream) {
            this.cameraStream.getTracks().forEach(track => track.stop());
            this.cameraStream = null;
          }

          const mimeType = this.recordedMimeType || "video/webm";
          const ext = mimeType.includes("mp4") ? "mp4" : "webm";
          this.recordedBlob = new Blob(this.recordedChunks, { type: mimeType });
          const fileName = this.generateFileName().replace(/\.webm$/i, `.${ext}`);
          
          // Create a URL for the blob that will be accessible in the editor
          this.recordingVideoUrl = URL.createObjectURL(this.recordedBlob);

          // In Electron, save via main process so we always get a real file on disk.
          if (window.clickStudio?.saveRecording) {
            try {
              const buf = new Uint8Array(await this.recordedBlob.arrayBuffer());
              const res = await window.clickStudio.saveRecording(fileName, buf);
              if (res.ok) {
                this.currentRecordingPath = res.path;
                resolve(res.path);
              } else {
                // Electron autosave should not silently fail.
                const msg = res.error?.message || "Failed to save recording";
                throw new Error(msg);
              }
            } catch (e) {
              console.error("[recording] Electron saveRecording failed", e);
              reject(e);
            }
          } else if (window.showSaveFilePicker) {
            // Browser File System Access API.
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

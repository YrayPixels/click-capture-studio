import * as React from "react";
import { useNavigate } from "react-router-dom";
import { CountdownOverlay } from "@/components/countdown-overlay";
import { RecordingControls } from "@/components/recording-controls";
import { screenRecordingService } from "@/services/screen-recording";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Mic, Monitor, Pause, Video } from "lucide-react";

type RecordingMode = "screen" | "camera" | "both";
type RecordingPrefs = {
  mode: RecordingMode;
  systemAudio: boolean;
  micAudio: boolean;
  countdownSeconds: number;
  frameRate: number;
  cameraDeviceId?: string;
  micDeviceId?: string;
};

const PREFS_KEY = "click-studio-recording-prefs";
const SELECTED_SOURCE_KEY = "click-studio-selected-desktop-source";

function consumeSelectedDesktopSourceId(): string | null {
  try {
    const id = sessionStorage.getItem(SELECTED_SOURCE_KEY);
    if (id) sessionStorage.removeItem(SELECTED_SOURCE_KEY);
    return id;
  } catch {
    return null;
  }
}

function readPrefs(): RecordingPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) throw new Error("missing");
    const p = JSON.parse(raw) as Partial<RecordingPrefs>;
    return {
      mode: (p.mode ?? "screen") as RecordingMode,
      systemAudio: p.systemAudio ?? true,
      micAudio: p.micAudio ?? true,
      countdownSeconds: p.countdownSeconds ?? 3,
      frameRate: p.frameRate ?? 60,
      cameraDeviceId: p.cameraDeviceId,
      micDeviceId: p.micDeviceId,
    };
  } catch {
    return {
      mode: "screen",
      systemAudio: true,
      micAudio: true,
      countdownSeconds: 3,
      frameRate: 60,
      cameraDeviceId: undefined,
      micDeviceId: undefined,
    };
  }
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

async function mixAudioToSingleTrack(streams: Array<MediaStream | null>): Promise<MediaStream | null> {
  const audioStreams = streams.filter(Boolean).filter((s) => (s as MediaStream).getAudioTracks().length > 0) as MediaStream[];
  if (!audioStreams.length) return null;

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  const ctx = new AudioCtx();
  const dest = ctx.createMediaStreamDestination();

  for (const s of audioStreams) {
    try {
      const src = ctx.createMediaStreamSource(s);
      src.connect(dest);
    } catch (e) {
      console.warn("[recording] failed to attach audio stream to mixer", e);
    }
  }

  // Ensure the context is running (some browsers start suspended).
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      // ignore
    }
  }

  // Return a stream containing exactly one mixed audio track.
  return dest.stream;
}

export default function Recording() {
  const navigate = useNavigate();
  const prefs = React.useMemo(() => readPrefs(), []);
  const isElectronRuntime =
    typeof navigator !== "undefined" && navigator.userAgent?.includes("Electron");
  const [isCountingDown, setIsCountingDown] = React.useState(prefs.countdownSeconds > 0);
  const [isPaused, setIsPaused] = React.useState(false);
  const [duration, setDuration] = React.useState(0);
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = React.useState<MediaStream | null>(null);
  const [micStream, setMicStream] = React.useState<MediaStream | null>(null);
  const [recordingState, setRecordingState] = React.useState<
    "idle" | "starting" | "recording" | "stopping"
  >("idle");
  const intervalRef = React.useRef<number | null>(null);
  const [clickCount, setClickCount] = React.useState(0);
  const unsubscribeClicksRef = React.useRef<null | (() => void)>(null);
  const cameraVideoRef = React.useRef<HTMLVideoElement>(null);
  const previewVideoRef = React.useRef<HTMLVideoElement>(null);
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (cameraStream && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  React.useEffect(() => {
    if (!previewVideoRef.current) return;
    if (!stream) return;
    previewVideoRef.current.srcObject = stream;
    previewVideoRef.current.play().catch(() => {
      // ignore
    });
  }, [stream]);

  React.useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      unsubscribeClicksRef.current?.();
      unsubscribeClicksRef.current = null;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream, micStream, stream]);

  const startTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    intervalRef.current = window.setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);
  };

  const handleCountdownComplete = async () => {
    try {
      if (startedRef.current) return;
      startedRef.current = true;
      setRecordingState("starting");
      let displayStream: MediaStream | null = null;
      let camStream: MediaStream | null = null;
      let microphoneStream: MediaStream | null = null;
      setClickCount(0);

      if (prefs.mode === "screen" || prefs.mode === "both") {
        if (!navigator.mediaDevices?.getDisplayMedia && !navigator.mediaDevices?.getUserMedia) {
          throw new Error("Screen capture is not supported in this browser.");
        }

        // Electron: do not use getDisplayMedia (it won't show the browser picker).
        // We require the in-app picker (DesktopSourcePicker) to provide a chromeMediaSourceId.
        if (isElectronRuntime) {
          const selectedId = consumeSelectedDesktopSourceId();
          if (!selectedId) {
            throw new Error("No window/screen selected. Go back and choose what to record.");
          }
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("Screen capture (getUserMedia) is not available in this environment.");
          }
          displayStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: selectedId,
              },
            } as unknown as MediaTrackConstraints,
          });
        } else {
          // Browser fallback: native picker.
          if (!navigator.mediaDevices?.getDisplayMedia) {
            throw new Error("Screen capture (getDisplayMedia) is not available in this browser.");
          }

          // Keep constraints conservative for cross-browser compatibility (Safari/Firefox can reject
          // extra fields like displaySurface/logicalSurface).
          const displayMediaOptions: DisplayMediaStreamOptions = {
            video: {
              frameRate: { ideal: prefs.frameRate },
            },
            audio: prefs.systemAudio,
          };
          console.info("[recording] requesting display media", displayMediaOptions);
          displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        }
      }

      if (prefs.mode === "camera" || prefs.mode === "both") {
        camStream = await screenRecordingService.startCameraRecording({
          video: true,
          audio: prefs.micAudio,
          videoDeviceId: prefs.cameraDeviceId,
          audioDeviceId: prefs.micDeviceId,
        });
        setCameraStream(camStream);
      }

      if (prefs.micAudio && (prefs.mode === "screen")) {
        try {
          microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: prefs.micDeviceId
              ? ({ deviceId: { exact: prefs.micDeviceId } } as MediaTrackConstraints)
              : true,
            video: false,
          });
          setMicStream(microphoneStream);
        } catch (e) {
          console.warn("[recording] microphone capture failed", e);
        }
      }

      // Main recorder stream:
      // - screen mode: displayStream (+ optional mic track)
      // - camera mode: camStream (+ optional mic already included)
      // - both mode: record SCREEN as the main track; record camera separately as a sidecar
      const baseStream =
        prefs.mode === "both" ? displayStream : (displayStream || camStream);
      if (!baseStream) throw new Error("No capture stream available");

      const tracks = [...baseStream.getTracks()];
      // MediaRecorder in Electron can behave badly with multiple audio tracks.
      // Mix system + mic into a single track when both are present.
      const mixedAudio = await mixAudioToSingleTrack([baseStream, microphoneStream]);
      // Remove any existing audio tracks from baseStream (system audio), we'll re-add mixed track.
      for (let i = tracks.length - 1; i >= 0; i--) {
        if (tracks[i]?.kind === "audio") tracks.splice(i, 1);
      }
      if (mixedAudio) {
        const mixedTrack = mixedAudio.getAudioTracks()[0];
        if (mixedTrack) tracks.push(mixedTrack);
      }

      const finalStream = new MediaStream(tracks);

      setStream(finalStream);
      await screenRecordingService.startRecording(finalStream, {
        video: true,
        audio: prefs.systemAudio || prefs.micAudio,
        camera: false,
      });

      if (prefs.mode === "both" && camStream) {
        try {
          await screenRecordingService.startSidecarCameraRecording(camStream);
        } catch (e) {
          console.warn("[recording] sidecar camera recording failed", e);
        }
      }

      unsubscribeClicksRef.current?.();
      unsubscribeClicksRef.current = null;
      if (window.clickStudio?.onGlobalClick) {
        unsubscribeClicksRef.current = window.clickStudio.onGlobalClick(() => {
          setClickCount((c) => c + 1);
        });
      }

      // If global click capture is blocked (macOS permissions), tell the user immediately.
      if (window.clickStudio?.getGlobalClickStatus) {
        try {
          const status = await window.clickStudio.getGlobalClickStatus();
          if (status.lastError) {
            toast.error(
              `Global click tracking is disabled. Enable Accessibility / Input Monitoring for Click Studio, then restart the app. (${status.lastError})`
            );
            // Best-effort: open the relevant macOS panels.
            await window.clickStudio.openAccessibilityPreferences?.();
            await window.clickStudio.openInputMonitoringPreferences?.();
          }
        } catch {
          // ignore
        }
      }
      
      setIsCountingDown(false);
      startTimer();
      setRecordingState("recording");
    } catch (error) {
      startedRef.current = false;
      setRecordingState("idle");
      const err = error as { name?: string; message?: string };
      console.error("Error starting recording:", error);
      toast.error(
        err?.name || err?.message
          ? `Failed to start recording (${err?.name ?? "Error"}${err?.message ? `: ${err.message}` : ""})`
          : "Failed to start recording"
      );
      navigate('/');
    }
  };

  // If countdown is off, start recording immediately on mount.
  React.useEffect(() => {
    if (prefs.countdownSeconds > 0) return;
    if (startedRef.current) return;
    void handleCountdownComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.countdownSeconds]);

  const handlePauseToggle = () => {
    setIsPaused((prev) => !prev);
    
    if (isPaused) {
      startTimer();
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  };

  const handleStop = async () => {
    if (recordingState !== "recording") {
      toast.error("Recording hasn't started yet.");
      return;
    }
    setRecordingState("stopping");
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
    }

    try {
      const fileName = await screenRecordingService.stopRecording();
      toast.success(`Recording saved: ${fileName}`);
      // Create a draft so incomplete edits are recoverable from Home.
      const draftId = `d_${Date.now()}`;
      if (window.clickStudio?.saveDraft) {
        try {
          const videoPath = screenRecordingService.getCurrentRecordingPath();
          await window.clickStudio.saveDraft({
            id: draftId,
            title: "Untitled draft",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            data: {
              videoPath,
              videoUrl: screenRecordingService.getRecordingVideoUrl(),
              cameraVideoPath: null,
              cameraVideoUrl: screenRecordingService.getRecordingCameraVideoUrl(),
              clickEventsSource: screenRecordingService.getClickEvents(),
              segments: [],
              selectedBackground: 0,
              padding: 100,
              zoomMode: "medium",
              zoomDuration: 1.0,
              showMenu: true,
              cameraOverlayEnabled: true,
              cameraOverlayShape: "rect",
              cameraOverlaySizePct: 22,
            },
          });
        } catch (e) {
          console.warn("[draft] initial save failed", e);
        }
      }

      navigate(`/editor/draft_${draftId}`);
    } catch (error) {
      const err = error as { name?: string; message?: string };
      console.error("Error saving recording:", error);
      toast.error(
        err?.name || err?.message
          ? `Failed to save recording (${err?.name ?? "Error"}${err?.message ? `: ${err.message}` : ""})`
          : "Failed to save recording"
      );
      navigate('/');
    }

    unsubscribeClicksRef.current?.();
    unsubscribeClicksRef.current = null;
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(76,201,240,0.25), transparent 45%), radial-gradient(circle at 80% 70%, rgba(247,37,133,0.22), transparent 50%)",
        }}
      />
      <div className="relative min-h-screen">
        {!isCountingDown && stream ? (
          <div className="absolute inset-0">
            <video
              ref={previewVideoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-contain bg-black"
            />
            <div className="absolute inset-0 bg-black/30" />
          </div>
        ) : null}

        <div className="absolute top-6 left-6 z-40 flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${isCountingDown ? "bg-white/40" : isPaused ? "bg-amber-400" : "bg-red-500 animate-pulse"}`} />
          <Badge variant="secondary" className="bg-black/40 text-white border-white/10">
            {isCountingDown
              ? "Starting…"
              : recordingState === "starting"
                ? "Starting…"
                : recordingState === "stopping"
                  ? "Saving…"
                  : isPaused
                    ? "Paused"
                    : "Recording"}
          </Badge>
          {!isCountingDown ? (
            <Badge variant="outline" className="bg-black/30 text-white border-white/15 font-mono">
              {formatTime(duration)}
            </Badge>
          ) : null}
        </div>

        <div className="absolute top-6 right-6 z-40 flex items-center gap-2">
          <Badge variant="outline" className="bg-black/30 text-white border-white/15">
            <Monitor className="h-3.5 w-3.5 mr-2" />
            {prefs.mode === "camera" ? "Camera" : prefs.mode === "both" ? "Screen + Camera" : "Screen"}
          </Badge>
          <Badge variant="outline" className="bg-black/30 text-white border-white/15">
            <Mic className="h-3.5 w-3.5 mr-2" />
            {prefs.micAudio ? "Mic on" : "Mic off"}
          </Badge>
          <Badge variant="outline" className="bg-black/30 text-white border-white/15">
            <Video className="h-3.5 w-3.5 mr-2" />
            {prefs.frameRate} FPS
          </Badge>
        </div>

      {isCountingDown ? (
        <CountdownOverlay
          count={prefs.countdownSeconds > 0 ? prefs.countdownSeconds : 1}
          onComplete={handleCountdownComplete}
        />
      ) : (
          <>
            {prefs.mode === "both" && cameraStream ? (
              <div className="absolute right-6 bottom-24 z-40">
                <div className="rounded-2xl border border-white/15 bg-black/40 backdrop-blur-md p-1 shadow-2xl">
                  <div className="rounded-xl overflow-hidden bg-black w-[220px] aspect-video">
                    <video
                      ref={cameraVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <RecordingControls
              isPaused={isPaused}
              duration={duration}
              clickCount={clickCount}
              onPauseToggle={handlePauseToggle}
              onStop={handleStop}
            />
          </>
      )}
      </div>
    </div>
  );
}

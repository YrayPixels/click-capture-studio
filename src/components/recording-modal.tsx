import * as React from "react";
import { Camera, Monitor, Mic, Speaker, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DesktopSourcePicker, type DesktopSourcePick } from "@/components/desktop-source-picker";

interface RecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartRecording: () => void;
}

type RecordingMode = "screen" | "camera" | "both";

type RecordingPrefs = {
  mode: RecordingMode;
  systemAudio: boolean;
  micAudio: boolean;
  countdownSeconds: 0 | 3 | 5;
  frameRate: 30 | 60;
  cameraDeviceId?: string;
  micDeviceId?: string;
};

const PREFS_KEY = "click-studio-recording-prefs";
const SELECTED_SOURCE_KEY = "click-studio-selected-desktop-source";
const LAST_SOURCE_PICK_KEY = "click-studio-last-desktop-source-pick";

function readLastDesktopPick(): DesktopSourcePick | null {
  try {
    const raw = localStorage.getItem(LAST_SOURCE_PICK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DesktopSourcePick>;
    if (!parsed?.id || !parsed?.name) return null;
    return {
      id: String(parsed.id),
      name: String(parsed.name),
      thumbnailDataUrl: String(parsed.thumbnailDataUrl ?? ""),
    };
  } catch {
    return null;
  }
}

function writeLastDesktopPick(pick: DesktopSourcePick) {
  try {
    localStorage.setItem(LAST_SOURCE_PICK_KEY, JSON.stringify(pick));
  } catch {
    // ignore
  }
}

export function RecordingModal({
  isOpen,
  onClose,
  onStartRecording
}: RecordingModalProps) {
  const cameraPreviewRef = React.useRef<HTMLVideoElement>(null);
  const [cameraPreviewStream, setCameraPreviewStream] = React.useState<MediaStream | null>(
    null
  );
  const [cameraPreviewError, setCameraPreviewError] = React.useState<string | null>(
    null
  );
  const [isPickingSource, setIsPickingSource] = React.useState(false);
  const [selectedDesktopSource, setSelectedDesktopSource] =
    React.useState<DesktopSourcePick | null>(() => readLastDesktopPick());
  const isElectronRuntime =
    typeof navigator !== "undefined" && navigator.userAgent?.includes("Electron");

  const [prefs, setPrefs] = React.useState<RecordingPrefs>(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) {
        return {
          mode: "screen",
          systemAudio: true,
          micAudio: true,
          countdownSeconds: 3,
          frameRate: 60,
        };
      }
      const parsed = JSON.parse(raw) as Partial<RecordingPrefs>;
      return {
        mode: parsed.mode ?? "screen",
        systemAudio: parsed.systemAudio ?? true,
        micAudio: parsed.micAudio ?? true,
        countdownSeconds: parsed.countdownSeconds ?? 3,
        frameRate: parsed.frameRate ?? 60,
        cameraDeviceId: parsed.cameraDeviceId,
        micDeviceId: parsed.micDeviceId,
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
  });

  const needsDesktopSource = prefs.mode === "screen" || prefs.mode === "both";
  const canPickDesktopSource = Boolean(window.clickStudio?.getDesktopSources);
  const mustPickInApp = isElectronRuntime && needsDesktopSource;
  const startDisabled = mustPickInApp && !canPickDesktopSource;

  React.useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }, [prefs]);

  React.useEffect(() => {
    const wantsCameraPreview = prefs.mode === "camera" || prefs.mode === "both";
    if (!isOpen || !wantsCameraPreview) {
      setCameraPreviewError(null);
      if (cameraPreviewStream) {
        cameraPreviewStream.getTracks().forEach((t) => t.stop());
        setCameraPreviewStream(null);
      }
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setCameraPreviewError(null);
        // Keep preview lightweight (no audio) and avoid locking mic permissions.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: prefs.cameraDeviceId
            ? ({ deviceId: { exact: prefs.cameraDeviceId } } as MediaTrackConstraints)
            : true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setCameraPreviewStream(stream);
      } catch (e) {
        const err = e as { name?: string; message?: string };
        if (cancelled) return;
        setCameraPreviewError(err?.message || err?.name || "Camera preview unavailable");
        setCameraPreviewStream(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, prefs.mode, prefs.cameraDeviceId]);

  React.useEffect(() => {
    if (!cameraPreviewRef.current) return;
    if (!cameraPreviewStream) return;
    cameraPreviewRef.current.srcObject = cameraPreviewStream;
    // Some browsers/electron builds require an explicit play() even with autoplay.
    cameraPreviewRef.current.play().catch(() => {
      // ignore
    });
  }, [cameraPreviewStream]);

  // Clear any stale desktop selection when switching away from screen capture modes.
  React.useEffect(() => {
    if (prefs.mode === "screen" || prefs.mode === "both") return;
    setSelectedDesktopSource(null);
  }, [prefs.mode]);

  const startRecording = async () => {
    const canPick = canPickDesktopSource;

    if (mustPickInApp && !canPick) {
      // Preload isn't available; avoid starting a capture that will auto-select or fail.
      return;
    }

    if (needsDesktopSource && canPick && !selectedDesktopSource) {
      setIsPickingSource(true);
      return;
    }

    // If we already have a selected source, store it for the Recording page to consume.
    if (needsDesktopSource && canPick && selectedDesktopSource) {
      try {
        sessionStorage.setItem(SELECTED_SOURCE_KEY, selectedDesktopSource.id);
      } catch {
        // ignore
      }
    }

    // Browser fallback: rely on getDisplayMedia native picker.
    onClose();
    onStartRecording();
  };

  const handlePickSource = (s: DesktopSourcePick) => {
    try {
      sessionStorage.setItem(SELECTED_SOURCE_KEY, s.id);
    } catch {
      // ignore
    }
    setSelectedDesktopSource(s);
    writeLastDesktopPick(s);
    setIsPickingSource(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[760px] p-0 overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-5">
          <div className="sm:col-span-2 p-6">
            <DialogHeader>
              <DialogTitle className="text-xl">New recording</DialogTitle>
            </DialogHeader>

            <div className="mt-4 space-y-5">
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Capture</Label>
                  <Badge variant="secondary" className="font-normal">
                    {prefs.frameRate} FPS
                  </Badge>
                </div>
                <Tabs
                  value={prefs.mode}
                  className="mt-2 w-full"
                  onValueChange={(v) =>
                    setPrefs((p) => ({ ...p, mode: v as RecordingMode }))
                  }
                >
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="screen" className="gap-2">
                      <Monitor className="h-4 w-4" />
                      Screen
                    </TabsTrigger>
                    <TabsTrigger value="camera" className="gap-2">
                      <Camera className="h-4 w-4" />
                      Camera
                    </TabsTrigger>
                    <TabsTrigger value="both" className="gap-2">
                      <Monitor className="h-4 w-4" />
                      <span className="text-muted-foreground">+</span>
                      <Camera className="h-4 w-4" />
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {prefs.mode === "screen" || prefs.mode === "both" ? (
                <div className="rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="text-xs text-muted-foreground">What to record</div>
                      <div className="text-sm font-medium truncate">
                        {selectedDesktopSource ? selectedDesktopSource.name : "Not selected"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {!window.clickStudio?.getDesktopSources
                          ? isElectronRuntime
                            ? "Electron is running, but the desktop capture API isn’t available in this window (preload not loaded). You’ll use the system picker after clicking Start."
                            : "You’re running the web app (not the desktop build), so we can’t list windows/screens here. You’ll use the system picker after clicking Start."
                          : selectedDesktopSource
                            ? selectedDesktopSource.id.startsWith("screen:")
                              ? "Entire screen"
                              : "Window"
                            : "Pick a window or an entire screen before starting."}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsPickingSource(true)}
                        disabled={!window.clickStudio?.getDesktopSources}
                      >
                        {selectedDesktopSource ? "Change" : "Choose"}
                      </Button>
                      {selectedDesktopSource ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedDesktopSource(null);
                            try {
                              localStorage.removeItem(LAST_SOURCE_PICK_KEY);
                            } catch {
                              // ignore
                            }
                          }}
                        >
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {window.clickStudio?.getDesktopSources && selectedDesktopSource?.thumbnailDataUrl ? (
                    <div className="mt-3">
                      <img
                        src={selectedDesktopSource.thumbnailDataUrl}
                        alt=""
                        className="w-full rounded-lg border"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <Separator />

              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Speaker className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="system-audio">System audio</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Captures app sound (if available on your OS).
                    </p>
                  </div>
                  <Switch
                    id="system-audio"
                    checked={prefs.systemAudio}
                    onCheckedChange={(checked) =>
                      setPrefs((p) => ({ ...p, systemAudio: checked }))
                    }
                  />
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Mic className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="mic-audio">Microphone</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Records your voice (recommended).
                    </p>
                  </div>
                  <Switch
                    id="mic-audio"
                    checked={prefs.micAudio}
                    onCheckedChange={(checked) =>
                      setPrefs((p) => ({ ...p, micAudio: checked }))
                    }
                  />
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Timer className="h-4 w-4 text-muted-foreground" />
                      <Label>Countdown</Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Gives you time to switch windows before capture starts.
                    </p>
                  </div>
                  <Select
                    value={String(prefs.countdownSeconds)}
                    onValueChange={(v) =>
                      setPrefs((p) => ({ ...p, countdownSeconds: Number(v) as 0 | 3 | 5 }))
                    }
                  >
                    <SelectTrigger className="w-[110px]">
                      <SelectValue placeholder="Countdown" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Off</SelectItem>
                      <SelectItem value="3">3 sec</SelectItem>
                      <SelectItem value="5">5 sec</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label>Frame rate</Label>
                    <p className="text-xs text-muted-foreground">
                      Higher FPS is smoother but uses more CPU.
                    </p>
                  </div>
                  <Select
                    value={String(prefs.frameRate)}
                    onValueChange={(v) =>
                      setPrefs((p) => ({ ...p, frameRate: Number(v) as 30 | 60 }))
                    }
                  >
                    <SelectTrigger className="w-[110px]">
                      <SelectValue placeholder="FPS" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 FPS</SelectItem>
                      <SelectItem value="60">60 FPS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={startRecording}
                  disabled={startDisabled}
                >
                  Start recording
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  {prefs.mode === "screen" || prefs.mode === "both"
                    ? canPickDesktopSource
                      ? selectedDesktopSource
                        ? "Source selected — the countdown starts when you click Start."
                        : "Choose a window or screen above, then click Start."
                      : mustPickInApp
                        ? "Desktop capture API unavailable (preload not loaded). Source picking won’t work until that’s fixed."
                        : "You’ll pick the window/screen in the next step."
                    : "You’ll pick the window/screen in the next step."}
                </p>
              </div>
            </div>
          </div>

          <div className="sm:col-span-3 border-t sm:border-t-0 sm:border-l bg-muted/30 p-6">
            <div className="rounded-xl border bg-background overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-sm font-medium">Ready to capture</span>
                </div>
                <Badge variant="outline" className="font-normal">
                  {prefs.mode === "screen"
                    ? "Screen"
                    : prefs.mode === "camera"
                      ? "Camera"
                      : "Screen + Camera"}
                </Badge>
              </div>

              <div className="p-5">
                <div className="rounded-lg bg-black/90 border border-white/10 h-[230px] overflow-hidden relative">
                  {prefs.mode === "screen" ? (
                    <div className="h-full w-full flex items-center justify-center text-white/70">
                      <div className="text-center space-y-2 px-6">
                        <div className="flex items-center justify-center gap-2 text-white">
                          <Monitor className="h-5 w-5" />
                          <span className="font-semibold">Capture preview</span>
                        </div>
                        <p className="text-sm text-white/60 max-w-sm">
                          Choose a window or entire screen to record.
                        </p>
                        {window.clickStudio?.getDesktopSources ? (
                          <div className="pt-2 space-y-2">
                            {selectedDesktopSource?.thumbnailDataUrl ? (
                              <div className="mx-auto max-w-[360px]">
                                <img
                                  src={selectedDesktopSource.thumbnailDataUrl}
                                  alt=""
                                  className="w-full rounded-md border border-white/10"
                                />
                              </div>
                            ) : null}
                            {selectedDesktopSource ? (
                              <div className="text-xs text-white/70">
                                Selected:{" "}
                                <span className="text-white/90 font-medium">
                                  {selectedDesktopSource.name}
                                </span>{" "}
                                <span className="text-white/50">
                                  ({selectedDesktopSource.id.startsWith("screen:") ? "Entire screen" : "Window"})
                                </span>
                              </div>
                            ) : (
                              <div className="text-xs text-white/60">No source selected yet.</div>
                            )}
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setIsPickingSource(true)}
                              >
                                {selectedDesktopSource ? "Change source" : "Choose window/screen"}
                              </Button>
                              {selectedDesktopSource ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="text-white/80 hover:text-white"
                                  onClick={() => {
                                    setSelectedDesktopSource(null);
                                    try {
                                      localStorage.removeItem(LAST_SOURCE_PICK_KEY);
                                    } catch {
                                      // ignore
                                    }
                                  }}
                                >
                                  Clear
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : cameraPreviewStream ? (
                    <video
                      ref={cameraPreviewRef}
                      autoPlay
                      muted
                      playsInline
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-white/70">
                      <div className="text-center space-y-2 px-6">
                        <div className="flex items-center justify-center gap-2 text-white">
                          <Camera className="h-5 w-5" />
                          <span className="font-semibold">Camera preview</span>
                        </div>
                        <p className="text-sm text-white/60 max-w-sm">
                          {cameraPreviewError ?? "Waiting for camera permission…"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <div className="font-medium text-foreground">Audio</div>
                    <div className="mt-1">
                      {prefs.systemAudio ? "System" : "No system"}
                      {prefs.micAudio ? " + Mic" : ""}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <div className="font-medium text-foreground">Countdown</div>
                    <div className="mt-1">
                      {prefs.countdownSeconds === 0 ? "Off" : `${prefs.countdownSeconds}s`}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <div className="font-medium text-foreground">Quality</div>
                    <div className="mt-1">{prefs.frameRate} FPS</div>
                  </div>
                </div>

                {window.clickStudio?.getDesktopSources &&
                (prefs.mode === "screen" || prefs.mode === "both") ? (
                  <div className="mt-3 text-xs text-muted-foreground">
                    {selectedDesktopSource
                      ? "You’ve selected what to capture. Click “Start recording” to begin."
                      : "Select a window or screen here, then click “Start recording” to begin."}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>

      <DesktopSourcePicker
        open={isPickingSource}
        onOpenChange={(open) => setIsPickingSource(open)}
        onPick={handlePickSource}
      />
    </Dialog>
  );
}

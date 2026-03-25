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
};

const PREFS_KEY = "click-studio-recording-prefs";
const SELECTED_SOURCE_KEY = "click-studio-selected-desktop-source";

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
      };
    } catch {
      return {
        mode: "screen",
        systemAudio: true,
        micAudio: true,
        countdownSeconds: 3,
        frameRate: 60,
      };
    }
  });

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
          video: true,
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
  }, [isOpen, prefs.mode]);

  React.useEffect(() => {
    if (!cameraPreviewRef.current) return;
    if (!cameraPreviewStream) return;
    cameraPreviewRef.current.srcObject = cameraPreviewStream;
    // Some browsers/electron builds require an explicit play() even with autoplay.
    cameraPreviewRef.current.play().catch(() => {
      // ignore
    });
  }, [cameraPreviewStream]);

  const startRecording = async () => {
    const needsDesktopSource = prefs.mode === "screen" || prefs.mode === "both";
    const canPick = Boolean(window.clickStudio?.getDesktopSources);

    if (needsDesktopSource && canPick) {
      setIsPickingSource(true);
      return;
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
    setIsPickingSource(false);
    onClose();
    onStartRecording();
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
                <Button className="w-full" size="lg" onClick={startRecording}>
                  Start recording
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  {window.clickStudio?.getDesktopSources &&
                  (prefs.mode === "screen" || prefs.mode === "both")
                    ? "Choose a window or screen, then the countdown starts."
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
                          Screen preview appears after you choose a screen/window.
                          Click “Start recording” to select what to capture.
                        </p>
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

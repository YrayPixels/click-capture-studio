
import * as React from "react";
import { MainNav } from "@/components/main-nav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

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

function savePrefs(next: RecordingPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
}

export default function Settings() {
  const [prefs, setPrefs] = React.useState<RecordingPrefs>(() => readPrefs());
  const [cameras, setCameras] = React.useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = React.useState<MediaDeviceInfo[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = React.useState(false);

  const refreshDevices = React.useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      toast.error("Your environment doesn’t support device enumeration.");
      return;
    }

    setIsLoadingDevices(true);
    try {
      // Labels are often empty until the user grants permission at least once.
      // We request permission briefly, then immediately stop tracks.
      let permStream: MediaStream | null = null;
      try {
        permStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch {
        // Permission denied or unavailable: still enumerate, but labels may be blank.
      } finally {
        permStream?.getTracks().forEach((t) => t.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((d) => d.kind === "videoinput"));
      setMics(devices.filter((d) => d.kind === "audioinput"));
    } catch (e) {
      const err = e as { message?: string; name?: string };
      toast.error(err?.message || err?.name || "Failed to load devices.");
    } finally {
      setIsLoadingDevices(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const updatePrefs = (patch: Partial<RecordingPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        savePrefs(next);
      } catch {
        // ignore
      }
      return next;
    });
  };

  const resetRecordingDefaults = () => {
    const next: RecordingPrefs = {
      mode: "screen",
      systemAudio: true,
      micAudio: true,
      countdownSeconds: 3,
      frameRate: 60,
      cameraDeviceId: undefined,
      micDeviceId: undefined,
    };
    setPrefs(next);
    try {
      savePrefs(next);
      toast.success("Recording settings reset.");
    } catch {
      toast.error("Failed to reset settings.");
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <MainNav />
      
      <main className="flex-1 px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Settings</h1>
          
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="grid grid-cols-4 w-full max-w-md mb-8">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="recording">Recording</TabsTrigger>
              <TabsTrigger value="editor">Editor</TabsTrigger>
              <TabsTrigger value="export">Export</TabsTrigger>
            </TabsList>
            
            <TabsContent value="general" className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Appearance</h2>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <Label>Theme</Label>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-muted-foreground">Switch between dark and light mode</span>
                      <ThemeToggle />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select defaultValue="en">
                      <SelectTrigger>
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="es">Español</SelectItem>
                        <SelectItem value="fr">Français</SelectItem>
                        <SelectItem value="de">Deutsch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Notifications</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="export-notifications">Export Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Receive notifications when exports are complete
                      </p>
                    </div>
                    <Switch id="export-notifications" defaultChecked />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="update-notifications">Update Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Notify me about new features and updates
                      </p>
                    </div>
                    <Switch id="update-notifications" defaultChecked />
                  </div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="recording" className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Recording Settings</h2>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <Label>Default Camera</Label>
                    <Select
                      value={prefs.cameraDeviceId ?? "default"}
                      onValueChange={(v) =>
                        updatePrefs({ cameraDeviceId: v === "default" ? undefined : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select camera" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">System Default</SelectItem>
                        {cameras.map((d, idx) => (
                          <SelectItem key={d.deviceId} value={d.deviceId}>
                            {d.label?.trim() ? d.label : `Camera ${idx + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {cameras.length ? `${cameras.length} camera(s) found` : "No cameras found"}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isLoadingDevices}
                        onClick={() => void refreshDevices()}
                      >
                        Refresh
                      </Button>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Default Microphone</Label>
                    <Select
                      value={prefs.micDeviceId ?? "default"}
                      onValueChange={(v) =>
                        updatePrefs({ micDeviceId: v === "default" ? undefined : v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select microphone" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">System Default</SelectItem>
                        {mics.map((d, idx) => (
                          <SelectItem key={d.deviceId} value={d.deviceId}>
                            {d.label?.trim() ? d.label : `Microphone ${idx + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {mics.length ? `${mics.length} microphone(s) found` : "No microphones found"}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isLoadingDevices}
                        onClick={() => void refreshDevices()}
                      >
                        Refresh
                      </Button>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="system-audio">Record System Audio</Label>
                    <Switch
                      id="system-audio"
                      checked={prefs.systemAudio}
                      onCheckedChange={(v) => updatePrefs({ systemAudio: v })}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label htmlFor="mic-audio">Record Microphone</Label>
                    <Switch
                      id="mic-audio"
                      checked={prefs.micAudio}
                      onCheckedChange={(v) => updatePrefs({ micAudio: v })}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <Label htmlFor="countdown">Show Countdown</Label>
                    <Switch
                      id="countdown"
                      checked={prefs.countdownSeconds > 0}
                      onCheckedChange={(v) =>
                        updatePrefs({ countdownSeconds: v ? 3 : 0 })
                      }
                    />
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Video Quality</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Frame Rate</Label>
                      <span className="text-sm font-medium">60 FPS</span>
                    </div>
                    <Slider defaultValue={[60]} max={60} step={30} />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>30 FPS</span>
                      <span>60 FPS</span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Resolution</Label>
                    <Select defaultValue="1080p">
                      <SelectTrigger>
                        <SelectValue placeholder="Select resolution" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="720p">720p</SelectItem>
                        <SelectItem value="1080p">1080p (Full HD)</SelectItem>
                        <SelectItem value="2160p">2160p (4K)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="editor" className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Editor Preferences</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="auto-save">Auto-save Projects</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically save projects while editing
                      </p>
                    </div>
                    <Switch id="auto-save" defaultChecked />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="show-click">Auto-detect Click Effects</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically detect mouse clicks for zoom effects
                      </p>
                    </div>
                    <Switch id="show-click" defaultChecked />
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Default Zoom Settings</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Zoom Intensity</Label>
                    <span className="text-sm font-medium">Medium</span>
                  </div>
                  <Slider defaultValue={[50]} max={100} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Low</span>
                    <span>Medium</span>
                    <span>High</span>
                  </div>
                  
                  <div className="flex items-center justify-between mt-4">
                    <Label>Zoom Duration</Label>
                    <span className="text-sm font-medium">0.5s</span>
                  </div>
                  <Slider defaultValue={[50]} max={100} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0.2s</span>
                    <span>0.5s</span>
                    <span>1.0s</span>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="export" className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Default Export Settings</h2>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <Label>Default Format</Label>
                    <Select defaultValue="mp4">
                      <SelectTrigger>
                        <SelectValue placeholder="Select format" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mp4">MP4</SelectItem>
                        <SelectItem value="webm">WebM</SelectItem>
                        <SelectItem value="gif">GIF</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Default Quality</Label>
                    <Select defaultValue="1080p">
                      <SelectTrigger>
                        <SelectValue placeholder="Select quality" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="720p">720p</SelectItem>
                        <SelectItem value="1080p">1080p (Full HD)</SelectItem>
                        <SelectItem value="2160p">2160p (4K)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Default Aspect Ratio</Label>
                    <Select defaultValue="16:9">
                      <SelectTrigger>
                        <SelectValue placeholder="Select aspect ratio" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                        <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                        <SelectItem value="1:1">1:1 (Square)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Frame Rate</Label>
                    <Select defaultValue="30">
                      <SelectTrigger>
                        <SelectValue placeholder="Select frame rate" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24">24 FPS</SelectItem>
                        <SelectItem value="30">30 FPS</SelectItem>
                        <SelectItem value="60">60 FPS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="flex items-center justify-between mt-4">
                  <div>
                    <Label htmlFor="hardware-acceleration">Use Hardware Acceleration</Label>
                    <p className="text-sm text-muted-foreground">
                      Use GPU for faster exports (recommended)
                    </p>
                  </div>
                  <Switch id="hardware-acceleration" defaultChecked />
                </div>
              </div>
            </TabsContent>
          </Tabs>
          
          <div className="flex justify-end mt-8 space-x-4">
            <Button variant="outline" type="button" onClick={resetRecordingDefaults}>
              Reset to Defaults
            </Button>
            <Button
              type="button"
              className="bg-studio-blue hover:bg-studio-blue/90"
              onClick={() => toast.success("Saved.")}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

import * as React from "react";
import { Camera, Clock, Mic, Monitor, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MainNav } from "@/components/main-nav";
import { RecordingModal } from "@/components/recording-modal";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function Index() {
  const [isRecordingModalOpen, setRecordingModalOpen] = React.useState(false);

  const handleStartRecording = () => {
    setRecordingModalOpen(false);
    // In a real app, this would start the recording and navigate to the recording page
    window.location.href = "/recording";
  };

  return (
    <div className="flex flex-col min-h-screen">
      <MainNav />
      <main className="flex-1 px-6 py-10">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-normal">
                    Screen recorder
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    Editor included
                  </Badge>
                </div>
                <h1 className="text-4xl font-bold tracking-tight">
                  Record your screen with clean, click-focused edits.
                </h1>
                <p className="text-lg text-muted-foreground max-w-xl">
                  Capture screen, camera, and audio. Then jump straight into the editor with
                  click markers and zoom effects.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button size="lg" onClick={() => setRecordingModalOpen(true)}>
                  <Camera className="h-4 w-4 mr-2" />
                  New recording
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a href="/settings">
                    <Sparkles className="h-4 w-4 mr-2" />
                    Settings
                  </a>
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Monitor className="h-4 w-4" />
                    <span>Capture</span>
                  </div>
                  <div className="mt-2 font-semibold">Screen / Camera / Both</div>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mic className="h-4 w-4" />
                    <span>Audio</span>
                  </div>
                  <div className="mt-2 font-semibold">System + microphone</div>
                </div>
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Workflow</span>
                  </div>
                  <div className="mt-2 font-semibold">Record → Edit → Export</div>
                </div>
              </div>
            </div>

            <div className="animate-scale-in">
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="px-6 py-5 border-b bg-muted/30">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="text-sm text-muted-foreground">Quick start</div>
                        <div className="text-xl font-semibold">Start a new capture</div>
                      </div>
                      <Badge variant="outline" className="font-normal">
                        Recommended
                      </Badge>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="rounded-xl border bg-black/90 border-white/10 h-[210px] overflow-hidden relative">
                      <div
                        className="absolute inset-0 opacity-40"
                        style={{
                          backgroundImage:
                            "radial-gradient(circle at 20% 30%, rgba(76,201,240,0.35), transparent 45%), radial-gradient(circle at 80% 70%, rgba(247,37,133,0.3), transparent 50%)",
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center text-white/80">
                        <div className="text-center space-y-2 px-6">
                          <div className="flex items-center justify-center gap-2 text-white">
                            <div className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                            <span className="font-semibold">Ready when you are</span>
                          </div>
                          <p className="text-sm text-white/60">
                            Hit “New recording”, pick a screen, and Click Studio will keep a clean
                            control bar on top while you record.
                          </p>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="font-medium">Tip</div>
                        <div className="text-sm text-muted-foreground">
                          Keep Click Studio visible so you can pause/stop quickly.
                        </div>
                      </div>
                      <Button variant="outline" onClick={() => setRecordingModalOpen(true)}>
                        Open recorder
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>

      <RecordingModal
        isOpen={isRecordingModalOpen}
        onClose={() => setRecordingModalOpen(false)}
        onStartRecording={handleStartRecording}
      />
    </div>
  );
}

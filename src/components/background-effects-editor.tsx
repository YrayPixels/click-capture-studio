
import * as React from "react";
import { ChevronsLeft, ChevronsRight, Scissors, Plus, Minus, MousePointer, ZoomIn, Camera } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExportPanel } from "./export-panel";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type ZoomMode = "off" | "low" | "medium" | "high";

export type SelectedZoomPoint = {
  id: string;
  tOut: number;
  xNorm: number;
  yNorm: number;
  enabled: boolean;
  zoomModeOverride?: ZoomMode;
  zoomDurationOverride?: number;
  sourceIndex: number;
};

interface BackgroundEffectProp {
  duration: number;
  currentTime: number;
  onTimeChange: (time: number) => void;
  backgrounds: string[];
  setSelectedBackground: (index: number) => void;
  selectedBackground: number;
  setPadding: (padding: number) => void;
  padding: number;
  zoomMode: ZoomMode;
  setZoomMode: (mode: ZoomMode) => void;
  zoomDuration: number;
  setZoomDuration: (duration: number) => void;
  handleExport: (format: string, quality: string, ratio: string) => void;
  isExporting: boolean;
  exportProgress: number;
  showMenu: boolean;
  setShowMenu: (showMenu: boolean) => void;

  cameraOverlayAvailable?: boolean;
  cameraOverlayEnabled?: boolean;
  setCameraOverlayEnabled?: (v: boolean) => void;
  cameraOverlayShape?: "rect" | "circle";
  setCameraOverlayShape?: (v: "rect" | "circle") => void;
  cameraOverlaySizePct?: number;
  setCameraOverlaySizePct?: (v: number) => void;

  selectedZoomPoint?: SelectedZoomPoint | null;
  onUpdateSelectedZoomPoint?: (patch: Partial<{
    t: number;
    xNorm: number;
    yNorm: number;
    enabled: boolean;
    zoomModeOverride: ZoomMode | undefined;
    zoomDurationOverride: number | undefined;
  }>) => void;
  onDeleteSelectedZoomPoint?: () => void;
}

export function BackgroundEffectEditor({
  handleExport,
  isExporting,
  exportProgress,
  backgrounds,
  setSelectedBackground,
  selectedBackground,
  setPadding,
  padding,
  zoomMode,
  setZoomMode,
  zoomDuration,
  setZoomDuration,
  showMenu,
  setShowMenu,
  cameraOverlayAvailable,
  cameraOverlayEnabled,
  setCameraOverlayEnabled,
  cameraOverlayShape,
  setCameraOverlayShape,
  cameraOverlaySizePct,
  setCameraOverlaySizePct,
  selectedZoomPoint,
  onUpdateSelectedZoomPoint,
  onDeleteSelectedZoomPoint,
}: BackgroundEffectProp) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-card rounded-lg border shadow-sm p-4 w-4/12">
      <Tabs defaultValue="background" className="w-full">
        <TabsList className="grid grid-cols-3 mb-4 max-w-xs">
          <TabsTrigger value="background">Background</TabsTrigger>
          <TabsTrigger value="effects">Effects</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="background" className="mt-0">
          <div className="flex flex-row flex-wrap justify-start p-2 gap-2">
            {backgrounds.map((bg, index) => (
              <button
                key={index}
                className={`rounded-lg h-[80px] min-w-[80px] cursor-pointer ${bg} ${selectedBackground === index ? 'ring-2 ring-primary' : ''
                  }`}
                onClick={() => setSelectedBackground(index)}
              />
            ))}
          </div>

          <div className="mb-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Scale</span>
              <span>{padding}%</span>
            </div>
            <Slider
              value={[padding]}
              min={10}
              max={100}
              step={4}
              onValueChange={([value]) => setPadding(value)}
            />
          </div>
        </TabsContent>

        <TabsContent value="export" className="mt-0">
          <div className="mt-4">
            <ExportPanel
              onExport={handleExport}
              isExporting={isExporting}
              progress={exportProgress}
            />
          </div>
        </TabsContent>

        <TabsContent value="effects" className="mt-0">
          <div className="space-y-4">
            {selectedZoomPoint ? (
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <div className="text-sm font-medium">Selected zoom point</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {formatTime(selectedZoomPoint.tOut)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Enabled</Label>
                    <Switch
                      checked={Boolean(selectedZoomPoint.enabled)}
                      onCheckedChange={(v) => onUpdateSelectedZoomPoint?.({ enabled: v })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Intensity</Label>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant={selectedZoomPoint.zoomModeOverride == null ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => onUpdateSelectedZoomPoint?.({ zoomModeOverride: undefined })}
                    >
                      Default
                    </Button>
                    <Button
                      variant={selectedZoomPoint.zoomModeOverride === "low" ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => onUpdateSelectedZoomPoint?.({ zoomModeOverride: "low" })}
                    >
                      Low
                    </Button>
                    <Button
                      variant={selectedZoomPoint.zoomModeOverride === "medium" ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => onUpdateSelectedZoomPoint?.({ zoomModeOverride: "medium" })}
                    >
                      Med
                    </Button>
                    <Button
                      variant={selectedZoomPoint.zoomModeOverride === "high" ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => onUpdateSelectedZoomPoint?.({ zoomModeOverride: "high" })}
                    >
                      High
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Duration override</span>
                    <span>
                      {typeof selectedZoomPoint.zoomDurationOverride === "number"
                        ? `${selectedZoomPoint.zoomDurationOverride.toFixed(1)}s`
                        : "Default"}
                    </span>
                  </div>
                  <Slider
                    value={[typeof selectedZoomPoint.zoomDurationOverride === "number" ? selectedZoomPoint.zoomDurationOverride : zoomDuration]}
                    min={0.1}
                    max={2}
                    step={0.1}
                    onValueChange={([v]) => onUpdateSelectedZoomPoint?.({ zoomDurationOverride: v })}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => onUpdateSelectedZoomPoint?.({ zoomDurationOverride: undefined })}
                  >
                    Clear duration override
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>X</span>
                      <span className="font-mono text-xs">{selectedZoomPoint.xNorm.toFixed(3)}</span>
                    </div>
                    <Slider
                      value={[selectedZoomPoint.xNorm]}
                      min={0}
                      max={1}
                      step={0.001}
                      onValueChange={([v]) => onUpdateSelectedZoomPoint?.({ xNorm: v })}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Y</span>
                      <span className="font-mono text-xs">{selectedZoomPoint.yNorm.toFixed(3)}</span>
                    </div>
                    <Slider
                      value={[selectedZoomPoint.yNorm]}
                      min={0}
                      max={1}
                      step={0.001}
                      onValueChange={([v]) => onUpdateSelectedZoomPoint?.({ yNorm: v })}
                    />
                  </div>
                </div>

                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => onDeleteSelectedZoomPoint?.()}
                >
                  Delete zoom point
                </Button>
              </div>
            ) : null}

            {cameraOverlayAvailable ? (
              <div className="flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Camera Overlay
                  </h3>
                  {setCameraOverlayEnabled ? (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Show</Label>
                      <Switch
                        checked={Boolean(cameraOverlayEnabled)}
                        onCheckedChange={(v) => setCameraOverlayEnabled(v)}
                      />
                    </div>
                  ) : null}
                </div>

                {cameraOverlayEnabled ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant={cameraOverlayShape === "rect" ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        onClick={() => setCameraOverlayShape?.("rect")}
                      >
                        Rectangle
                      </Button>
                      <Button
                        variant={cameraOverlayShape === "circle" ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        onClick={() => setCameraOverlayShape?.("circle")}
                      >
                        Circle
                      </Button>
                    </div>

                    {typeof cameraOverlaySizePct === "number" && setCameraOverlaySizePct ? (
                      <div className="flex flex-col space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Size</span>
                          <span>{cameraOverlaySizePct}%</span>
                        </div>
                        <Slider
                          value={[cameraOverlaySizePct]}
                          min={12}
                          max={40}
                          step={1}
                          onValueChange={([v]) => setCameraOverlaySizePct(v)}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col space-y-2">
              <h3 className="text-sm font-medium">Zoom on Click</h3>
              <div className="flex items-center space-x-4">
                <Button
                  variant={zoomMode === "off" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setZoomMode("off")}
                >
                  Off
                </Button>
                <Button
                  variant={zoomMode === "low" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setZoomMode("low")}
                >
                  Low
                </Button>
                <Button
                  variant={zoomMode === "medium" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setZoomMode("medium")}
                >
                  Medium
                </Button>
                <Button
                  variant={zoomMode === "high" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setZoomMode("high")}
                >
                  High
                </Button>
              </div>

              <div className="flex flex-col space-y-2 pt-2">
                <div className="flex justify-between text-sm">
                  <span>Zoom Duration</span>
                  <span>{zoomDuration.toFixed(1)}s</span>
                </div>
                <Slider
                  value={[zoomDuration]}
                  min={0.1}
                  max={2}
                  step={0.1}
                  onValueChange={([value]) => setZoomDuration(value)}
                />
              </div>
            </div>

            <div className="flex flex-col space-y-2">
              <h3 className="text-sm font-medium">Menu </h3>
              <div className="flex items-center space-x-4">
                <Button onClick={() => setShowMenu(!showMenu)} variant="outline" size="sm" className="flex-1">{showMenu ? 'Off' : 'On'}</Button>
              </div>
            </div>

            <div className="flex flex-col space-y-2">
              <h3 className="text-sm font-medium">Cursor Effects</h3>
              <div className="flex items-center space-x-4">
                <Button variant="outline" size="sm" className="flex-1">
                  <MousePointer className="h-4 w-4 mr-2" />
                  Normal
                </Button>
                <Button variant="outline" size="sm" className="flex-1">
                  <div className="relative">
                    <MousePointer className="h-4 w-4 mr-2" />
                    <div className="absolute inset-0 animate-pulse opacity-70"></div>
                  </div>
                  Highlight
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}


import * as React from "react";
import { Download, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

interface ExportPanelProps {
  onExport: (format: string, quality: string, ratio: string) => void;
  onCancelExport?: () => void;
  isExporting: boolean;
  progress: number;
  statusText?: string;
}

export function ExportPanel({ 
  onExport, 
  onCancelExport,
  isExporting, 
  progress,
  statusText,
}: ExportPanelProps) {
  const [format, setFormat] = React.useState("mp4");
  const [quality, setQuality] = React.useState("1080p");
  const [ratio, setRatio] = React.useState("16:9");

  return (
    <div className="bg-card rounded-lg border shadow-sm p-4 w-full">
      <div className="flex items-center space-x-2 mb-4">
        <Film className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Export Project</h2>
      </div>
      
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid grid-cols-2 mb-4">
          <TabsTrigger value="basic">Basic Settings</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>
        
        <TabsContent value="basic" className="mt-0 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Format</label>
              <Select value={format} onValueChange={setFormat}>
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
              <label className="text-sm font-medium">Quality</label>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger>
                  <SelectValue placeholder="Select quality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="1080p">1080p (HD)</SelectItem>
                  <SelectItem value="2160p">2160p (4K)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Aspect Ratio</label>
              <Select value={ratio} onValueChange={setRatio}>
                <SelectTrigger>
                  <SelectValue placeholder="Select ratio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 (Landscape)</SelectItem>
                  <SelectItem value="9:16">9:16 (Portrait)</SelectItem>
                  <SelectItem value="1:1">1:1 (Square)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {isExporting ? (
            <div className="space-y-2 pt-4">
              <div className="flex justify-between text-sm mb-1">
                <span>{statusText ?? "Exporting video..."}</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                This may take a few minutes depending on the length and quality of your video.
              </p>
              {onCancelExport ? (
                <Button
                  variant="outline"
                  className="w-full mt-2"
                  onClick={onCancelExport}
                >
                  Cancel Export
                </Button>
              ) : null}
            </div>
          ) : (
            <Button 
              className="w-full mt-4 bg-studio-blue hover:bg-studio-blue/90"
              onClick={() => onExport(format, quality, ratio)}
            >
              <Download className="h-4 w-4 mr-2" />
              Export Video
            </Button>
          )}
        </TabsContent>
        
        <TabsContent value="advanced" className="mt-0 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Frame Rate</label>
              <Select defaultValue="30">
                <SelectTrigger>
                  <SelectValue placeholder="Select FPS" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 FPS</SelectItem>
                  <SelectItem value="30">30 FPS</SelectItem>
                  <SelectItem value="60">60 FPS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Audio Quality</label>
              <Select defaultValue="high">
                <SelectTrigger>
                  <SelectValue placeholder="Select quality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low (128kbps)</SelectItem>
                  <SelectItem value="medium">Medium (192kbps)</SelectItem>
                  <SelectItem value="high">High (256kbps)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Encoding Speed</label>
            <Select defaultValue="balanced">
              <SelectTrigger>
                <SelectValue placeholder="Select speed" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast (Lower Quality)</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="slow">Slow (Higher Quality)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {isExporting ? (
            <div className="space-y-2 pt-4">
              <div className="flex justify-between text-sm mb-1">
                <span>{statusText ?? "Exporting video..."}</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                This may take a few minutes depending on the length and quality of your video.
              </p>
              {onCancelExport ? (
                <Button
                  variant="outline"
                  className="w-full mt-2"
                  onClick={onCancelExport}
                >
                  Cancel Export
                </Button>
              ) : null}
            </div>
          ) : (
            <Button 
              className="w-full mt-4 bg-studio-blue hover:bg-studio-blue/90"
              onClick={() => onExport(format, quality, ratio)}
            >
              <Download className="h-4 w-4 mr-2" />
              Export with Advanced Settings
            </Button>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

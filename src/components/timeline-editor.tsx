
import * as React from "react";
import { ChevronsLeft, ChevronsRight, Scissors, Play, Pause, SkipBack, SkipForward, Trash } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { formatTimeDisplay } from "@/utils/videoExport";

interface TimelineEditorProps {
  duration: number;
  currentTime: number;
  onTimeChange: (time: number) => void;
  onSplitVideo: () => void;
  splitPoints: number[];
  deletedRanges?: Array<{ start: number; end: number }>;
  isPlaying: boolean;
  onPlayPause: () => void;
  onDeleteSplit?: (index: number) => void;
}

export function TimelineEditor({
  duration,
  currentTime,
  onTimeChange,
  onSplitVideo,
  splitPoints,
  deletedRanges = [],
  isPlaying,
  onPlayPause,
  onDeleteSplit
}: TimelineEditorProps) {
  const handleSeekBack = () => {
    const newTime = Math.max(0, currentTime - 5);
    onTimeChange(newTime);
  };

  const handleSeekForward = () => {
    const newTime = Math.min(duration, currentTime + 5);
    onTimeChange(newTime);
  };

  // Find the nearest split point to jump to
  const jumpToPreviousSplit = () => {
    const previousSplits = splitPoints.filter(point => point < currentTime);
    if (previousSplits.length > 0) {
      const nearestSplit = Math.max(...previousSplits);
      onTimeChange(nearestSplit);
    } else {
      onTimeChange(0); // Jump to beginning if no previous splits
    }
  };

  const jumpToNextSplit = () => {
    const nextSplits = splitPoints.filter(point => point > currentTime);
    if (nextSplits.length > 0) {
      const nearestSplit = Math.min(...nextSplits);
      onTimeChange(nearestSplit);
    } else if (duration) {
      onTimeChange(duration); // Jump to end if no next splits
    }
  };

  const handleDeleteSplit = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDeleteSplit) {
      onDeleteSplit(index);
    }
  };

  return (
    <div className="bg-card rounded-lg border shadow-sm p-4 w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleSeekBack}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <span className="font-mono text-sm">{formatTimeDisplay(currentTime)}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleSeekForward}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onSplitVideo}
            disabled={isPlaying}
          >
            <Scissors className="h-4 w-4 mr-1" />
            Split
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onPlayPause}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="py-2">
        <Slider
          value={[currentTime || 0]}
          max={duration || 100}
          step={0.01}
          onValueChange={([value]) => onTimeChange(value)}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>{formatTimeDisplay(currentTime)}</span>
          <span>{formatTimeDisplay(10)}</span>
        </div>
      </div>

      <div className="space-y-4">
        {/* Timeline tracks */}
        <div className="flex items-center space-x-2">
          <span className="text-xs font-medium w-24">Screen</span>
          <div className="timeline-track flex-1 relative bg-secondary h-12 rounded-md">
            <div className="timeline-clip absolute top-0 left-0 bottom-0 right-0 bg-primary/20 border border-primary rounded">
              <div className="px-2 h-full flex items-center text-xs">Main Screen</div>
            </div>

            {/* Deleted ranges (CapCut-like preview skip). */}
            {deletedRanges.map((r, index) => {
              const safeDuration = duration || 1;
              const leftPct = (r.start / safeDuration) * 100;
              const widthPct = ((r.end - r.start) / safeDuration) * 100;
              if (widthPct <= 0) return null;

              return (
                <div
                  key={`${r.start}-${r.end}-${index}`}
                  className="absolute top-0 bottom-0 bg-destructive/25 border border-destructive/40 rounded-md"
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                  }}
                  title={`Deleted: ${formatTimeDisplay(r.start)} - ${formatTimeDisplay(r.end)}`}
                />
              );
            })}

            {splitPoints.map((point, index) => (
              <div
                key={index}
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 cursor-pointer"
                style={{ left: `${(point / (duration || 1)) * 100}%` }}
                title={`Split at ${formatTimeDisplay(point)}`}
                onClick={() => onTimeChange(point)}
              >
                <div className="absolute top-[-8px] left-[-8px] bg-red-500 w-4 h-4 rounded-full flex items-center justify-center group">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute h-6 w-6 opacity-0 group-hover:opacity-100 bg-red-600 rounded-full -right-6 -top-1"
                    onClick={(e) => handleDeleteSplit(index, e)}
                  >
                    <Trash className="h-3 w-3 text-white" />
                  </Button>
                </div>
              </div>
            ))}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white z-20"
              style={{ left: `${((currentTime || 0) / (duration || 1)) * 100}%` }}
            >
              <div className="absolute top-[-10px] left-[-10px] bg-white w-5 h-5 rounded-full shadow-md"></div>
            </div>
          </div>
          <div className="flex space-x-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={jumpToPreviousSplit}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={jumpToNextSplit}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}

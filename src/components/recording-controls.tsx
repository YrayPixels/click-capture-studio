
import * as React from "react";
import { Pause, Square, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RecordingControlsProps {
  isPaused: boolean;
  duration: number;
  onPauseToggle: () => void;
  onStop: () => void;
  clickCount?: number;
  className?: string;
}

export function RecordingControls({
  isPaused,
  duration,
  onPauseToggle,
  onStop,
  clickCount,
  className,
}: RecordingControlsProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={cn(
        "absolute bottom-8 left-1/2 -translate-x-1/2 z-50",
        className
      )}
    >
      <div className="bg-black/55 text-white border border-white/10 backdrop-blur-md rounded-full px-3.5 py-2 shadow-2xl flex items-center gap-3">
        <div className="flex items-center gap-2 pr-1">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isPaused ? "bg-amber-400" : "bg-red-500 animate-pulse"
            }`}
          />
          <span className="text-sm font-semibold tabular-nums">
            {formatTime(duration)}
          </span>
          {isPaused ? (
            <Badge
              variant="secondary"
              className="bg-white/10 text-white border-white/10 font-normal"
            >
              Paused
            </Badge>
          ) : null}
        </div>

        {typeof clickCount === "number" ? (
          <div className="hidden sm:flex items-center text-xs text-white/70">
            Clicks
            <span className="ml-2 rounded-md bg-white/10 px-2 py-0.5 text-white font-medium tabular-nums">
              {clickCount}
            </span>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 pl-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-white hover:bg-white/10 hover:text-white"
            onClick={onPauseToggle}
          >
            {isPaused ? (
              <CircleDot className="h-4 w-4 text-red-400" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-red-200 hover:text-red-100 hover:bg-red-500/15"
            onClick={onStop}
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

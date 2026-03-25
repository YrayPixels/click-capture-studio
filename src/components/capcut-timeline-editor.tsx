import * as React from "react";
import { Scissors, Play, Pause, Trash } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { formatTimeDisplay } from "@/utils/videoExport";

export type CapcutSegment = {
  id: string;
  srcStart: number; // seconds in source video
  srcEnd: number; // seconds in source video
};

interface CapcutTimelineEditorProps {
  outputDuration: number;
  outputTime: number;
  onOutputTimeChange: (t: number) => void;
  segments: CapcutSegment[]; // in output order
  isPlaying: boolean;
  onPlayPause: () => void;
  onSplitAt: (tOut: number) => void;
  onDeleteSegment: (segmentId: string) => void;
  onReorderSegment: (dragSegmentId: string, insertIndex: number) => void;
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}

export function CapcutTimelineEditor({
  outputDuration,
  outputTime,
  onOutputTimeChange,
  segments,
  isPlaying,
  onPlayPause,
  onSplitAt,
  onDeleteSegment,
  onReorderSegment,
}: CapcutTimelineEditorProps) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragSegmentId, setDragSegmentId] = React.useState<string | null>(null);

  const safeOutputDuration = outputDuration || 0.0001;

  const outOffsets = React.useMemo(() => {
    const offsets: number[] = [];
    let cum = 0;
    for (const s of segments) {
      offsets.push(cum);
      cum += s.srcEnd - s.srcStart;
    }
    return offsets;
  }, [segments]);

  const getInsertIndexFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return segments.length;
    const rect = el.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const tOut = (x / rect.width) * safeOutputDuration;

    // Insert before the first segment whose start is after tOut.
    for (let i = 0; i < segments.length; i++) {
      if (tOut <= outOffsets[i] + 1e-6) return i;
    }
    return segments.length;
  };

  return (
    <div className="bg-card rounded-lg border shadow-sm p-4 w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <span className="font-mono text-sm">{formatTimeDisplay(outputTime)}</span>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSplitAt(outputTime)}
            disabled={isPlaying || !segments.length}
          >
            <Scissors className="h-4 w-4 mr-1" />
            Split
          </Button>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={onPlayPause}
            disabled={!segments.length}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="py-2">
        <Slider
          value={[outputTime || 0]}
          max={outputDuration || 0}
          step={0.01}
          onValueChange={([value]) => onOutputTimeChange(value)}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>{formatTimeDisplay(outputTime)}</span>
          <span>{formatTimeDisplay(outputDuration)}</span>
        </div>
      </div>

      <div
        ref={trackRef}
        className="timeline-track mt-4 relative bg-secondary h-12 rounded-md"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("application/x-segment-id");
          if (!id) return;
          const insertIndex = getInsertIndexFromClientX(e.clientX);
          onReorderSegment(id, insertIndex);
          setDragSegmentId(null);
        }}
      >
        {/* Deleted/kept segments are modeled as kept clips only.
            Dragging reorders clips in output time. */}

        {/* Segment clips */}
        {segments.map((seg, index) => {
          const outStart = outOffsets[index] ?? 0;
          const outDur = Math.max(0, seg.srcEnd - seg.srcStart);

          const leftPct = (outStart / safeOutputDuration) * 100;
          const widthPct = (outDur / safeOutputDuration) * 100;

          if (widthPct <= 0) return null;

          return (
            <div
              key={seg.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-segment-id", seg.id);
                e.dataTransfer.effectAllowed = "move";
                setDragSegmentId(seg.id);
              }}
              onDragEnd={() => setDragSegmentId(null)}
              className="absolute top-0 bottom-0 border border-primary/40 bg-primary/20 rounded-md cursor-grab"
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                opacity: dragSegmentId && dragSegmentId === seg.id ? 0.6 : 1,
              }}
              title={`Segment ${formatTimeDisplay(seg.srcStart)} - ${formatTimeDisplay(
                seg.srcEnd
              )}`}
              onClick={() => {
                onOutputTimeChange(outStart);
              }}
            >
              <div className="absolute left-0 top-0 h-full w-full flex items-center">
                <div className="px-2 text-xs truncate">
                  {formatTimeDisplay(seg.srcStart)} - {formatTimeDisplay(seg.srcEnd)}
                </div>

                <div
                  className="absolute top-1 right-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSegment(seg.id);
                  }}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 bg-destructive/10 hover:bg-destructive/20"
                  >
                    <Trash className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white z-20"
          style={{ left: `${((outputTime || 0) / (safeOutputDuration || 1)) * 100}%` }}
        >
          <div className="absolute top-[-10px] left-[-10px] bg-white w-5 h-5 rounded-full shadow-md" />
        </div>
      </div>
    </div>
  );
}


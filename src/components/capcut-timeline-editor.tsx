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

export type TimelineClickMarker = {
  id: string;
  tOut: number; // seconds on stitched/output timeline
};

export type AudioClip = {
  id: string;
  tOutStart: number;
  duration: number;
};

export type AudioTrack = {
  id: string;
  name: string;
  muted: boolean;
  solo: boolean;
  volume: number; // 0..1
  clips: AudioClip[];
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
  onTrimSegment?: (segmentId: string, patch: Partial<Pick<CapcutSegment, "srcStart" | "srcEnd">>) => void;
  clickMarkers?: TimelineClickMarker[];
  selectedClickMarkerId?: string | null;
  onSelectClickMarker?: (id: string | null) => void;
  onMoveClickMarker?: (id: string, nextTOut: number) => void;

  audioTracks?: AudioTrack[];
  onUpdateAudioTrack?: (trackId: string, patch: Partial<Omit<AudioTrack, "id" | "clips">>) => void;

  // Timeline viewport
  pxPerSecond: number;
  scrollSec: number;
  onScrollSecChange: (t: number) => void;
  onPxPerSecondChange: (pxPerSecond: number) => void;
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}

function pickRulerStepSec(pxPerSecond: number) {
  // Choose a step such that tick labels aren't too dense.
  // Target: >= ~80px between major ticks.
  const candidates = [
    0.1, 0.2, 0.5,
    1, 2, 5,
    10, 15, 20, 30,
    60, 120, 300, 600,
  ];
  const targetPx = 80;
  for (const s of candidates) {
    if (s * pxPerSecond >= targetPx) return s;
  }
  return candidates[candidates.length - 1]!;
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
  onTrimSegment,
  clickMarkers,
  selectedClickMarkerId,
  onSelectClickMarker,
  onMoveClickMarker,
  audioTracks,
  onUpdateAudioTrack,
  pxPerSecond,
  scrollSec,
  onScrollSecChange,
  onPxPerSecondChange,
}: CapcutTimelineEditorProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [dragSegmentId, setDragSegmentId] = React.useState<string | null>(null);

  const safeOutputDuration = outputDuration || 0.0001;
  const safePxPerSecond = clamp(pxPerSecond || 80, 20, 600);

  const [dragMarkerId, setDragMarkerId] = React.useState<string | null>(null);
  const dragMarkerStartRef = React.useRef<{ clientX: number; tOut: number } | null>(null);

  const [trimDrag, setTrimDrag] = React.useState<null | {
    segmentId: string;
    edge: "start" | "end";
  }>(null);
  const trimDragStartRef = React.useRef<null | {
    clientX: number;
    srcStart: number;
    srcEnd: number;
    outStart: number;
  }>(null);

  const outOffsets = React.useMemo(() => {
    const offsets: number[] = [];
    let cum = 0;
    for (const s of segments) {
      offsets.push(cum);
      cum += s.srcEnd - s.srcStart;
    }
    return offsets;
  }, [segments]);

  const contentWidth = Math.max(1, safeOutputDuration * safePxPerSecond);
  const rulerStepSec = pickRulerStepSec(safePxPerSecond);

  // Keep DOM scroll in sync with time-based scroll.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const desired = clamp(scrollSec, 0, safeOutputDuration) * safePxPerSecond;
    if (Math.abs(el.scrollLeft - desired) > 1) {
      el.scrollLeft = desired;
    }
  }, [safeOutputDuration, safePxPerSecond, scrollSec]);

  const getInsertIndexFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return segments.length;
    const rect = el.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const tOut = clamp(scrollSec + x / safePxPerSecond, 0, safeOutputDuration);

    // Insert before the first segment whose start is after tOut.
    for (let i = 0; i < segments.length; i++) {
      if (tOut <= outOffsets[i] + 1e-6) return i;
    }
    return segments.length;
  };

  const audioRows = audioTracks ?? [];

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

      <div className="mt-4 grid grid-cols-[160px_1fr] gap-2">
        {/* Track headers */}
        <div className="space-y-2">
          <div className="h-7" />
          <div className="h-12 rounded-md border border-white/10 bg-white/5 px-2 flex items-center">
            <div className="text-xs font-medium text-white/80">Video</div>
          </div>
          {audioRows.map((t) => {
            return (
              <div
                key={t.id}
                className="h-10 rounded-md border border-white/10 bg-white/5 px-2 flex items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate text-white/80">{t.name}</div>
                </div>
                <Button
                  variant={t.muted ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => onUpdateAudioTrack?.(t.id, { muted: !t.muted })}
                >
                  M
                </Button>
                <Button
                  variant={t.solo ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => onUpdateAudioTrack?.(t.id, { solo: !t.solo })}
                >
                  S
                </Button>
              </div>
            );
          })}
        </div>

        {/* Scrollable timeline surface */}
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-hidden rounded-md border border-white/10 bg-secondary/40"
          onScroll={(e) => {
            const el = e.currentTarget;
            onScrollSecChange(clamp(el.scrollLeft / safePxPerSecond, 0, safeOutputDuration));
          }}
          onWheel={(e) => {
            // Wheel: scroll horizontally. Ctrl/Cmd+wheel: zoom around pointer.
            const el = scrollRef.current;
            if (!el) return;

            const isZoom = e.ctrlKey || e.metaKey;
            if (!isZoom) {
              // Trackpads often send horizontal delta in deltaX; fall back to deltaY.
              const deltaPx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
              el.scrollLeft += deltaPx;
              e.preventDefault();
              return;
            }

            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const pointerX = clamp(e.clientX - rect.left, 0, rect.width);
            const timeUnderPointer = clamp(scrollSec + pointerX / safePxPerSecond, 0, safeOutputDuration);

            const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            const next = clamp(safePxPerSecond * zoomFactor, 20, 600);
            onPxPerSecondChange(next);

            // Preserve the time under pointer after zoom change.
            const nextScrollLeft = clamp((timeUnderPointer - pointerX / next) * next, 0, safeOutputDuration * next);
            // Update both DOM and state (DOM immediately for responsiveness).
            el.scrollLeft = nextScrollLeft;
            onScrollSecChange(clamp(nextScrollLeft / next, 0, safeOutputDuration));
          }}
        >
          <div style={{ width: `${contentWidth}px` }}>
            {/* Time ruler */}
            <div className="relative h-7 border-b border-white/10 select-none">
              {(() => {
                const ticks: React.ReactNode[] = [];
                const count = Math.ceil(safeOutputDuration / rulerStepSec);
                for (let i = 0; i <= count; i++) {
                  const t = i * rulerStepSec;
                  const x = t * safePxPerSecond;
                  ticks.push(
                    <div
                      key={`tick_${i}`}
                      className="absolute top-0 bottom-0"
                      style={{ left: `${x}px` }}
                    >
                      <div className="absolute top-0 h-3 w-px bg-white/35" />
                      <div className="absolute top-3 -translate-x-1/2 text-[10px] text-white/70 font-mono whitespace-nowrap">
                        {formatTimeDisplay(t)}
                      </div>
                    </div>
                  );
                }
                return ticks;
              })()}
            </div>

            {/* Video lane */}
            <div
              ref={trackRef}
              className="timeline-track relative h-12 rounded-md"
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
              {/* Click markers */}
              {(clickMarkers ?? []).map((m) => {
                const leftPx = clamp(m.tOut, 0, safeOutputDuration) * safePxPerSecond;
                const isSelected = selectedClickMarkerId != null && selectedClickMarkerId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`absolute top-1 bottom-1 w-[3px] rounded-full z-10 ${
                      isSelected ? "bg-white" : "bg-white/70 hover:bg-white/90"
                    }`}
                    style={{ left: `${leftPx}px` }}
                    title={`Click @ ${formatTimeDisplay(m.tOut)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectClickMarker?.(m.id);
                      onOutputTimeChange(m.tOut);
                    }}
                    onPointerDown={(e) => {
                      if ((e as unknown as { button?: number }).button === 2) return;
                      e.stopPropagation();
                      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                      setDragMarkerId(m.id);
                      dragMarkerStartRef.current = { clientX: e.clientX, tOut: m.tOut };
                      onSelectClickMarker?.(m.id);
                    }}
                    onPointerMove={(e) => {
                      if (!dragMarkerId || dragMarkerId !== m.id) return;
                      const start = dragMarkerStartRef.current;
                      if (!start) return;
                      e.stopPropagation();
                      const dx = e.clientX - start.clientX;
                      const next = clamp(start.tOut + dx / safePxPerSecond, 0, safeOutputDuration);
                      onMoveClickMarker?.(m.id, next);
                    }}
                    onPointerUp={(e) => {
                      if (!dragMarkerId || dragMarkerId !== m.id) return;
                      e.stopPropagation();
                      setDragMarkerId(null);
                      dragMarkerStartRef.current = null;
                    }}
                  />
                );
              })}

              {/* Segment clips */}
              {segments.map((seg, index) => {
                const outStart = outOffsets[index] ?? 0;
                const outDur = Math.max(0, seg.srcEnd - seg.srcStart);

                const leftPx = clamp(outStart, 0, safeOutputDuration) * safePxPerSecond;
                const widthPx = clamp(outDur, 0, safeOutputDuration) * safePxPerSecond;

                if (widthPx <= 1) return null;

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
                      left: `${leftPx}px`,
                      width: `${widthPx}px`,
                      opacity: dragSegmentId && dragSegmentId === seg.id ? 0.6 : 1,
                    }}
                    title={`Segment ${formatTimeDisplay(seg.srcStart)} - ${formatTimeDisplay(seg.srcEnd)}`}
                    onClick={() => {
                      onOutputTimeChange(outStart);
                    }}
                  >
                    {/* Trim handles */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/10"
                      title="Trim start"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                        setTrimDrag({ segmentId: seg.id, edge: "start" });
                        trimDragStartRef.current = {
                          clientX: e.clientX,
                          srcStart: seg.srcStart,
                          srcEnd: seg.srcEnd,
                          outStart,
                        };
                      }}
                      onPointerMove={(e) => {
                        if (!trimDrag || trimDrag.segmentId !== seg.id || trimDrag.edge !== "start") return;
                        const start = trimDragStartRef.current;
                        if (!start) return;
                        e.stopPropagation();
                        const dx = e.clientX - start.clientX;
                        const deltaSec = dx / safePxPerSecond;
                        // Trim start changes srcStart (clip start stays fixed in output time).
                        const minDur = 0.05;
                        const nextSrcStart = clamp(start.srcStart + deltaSec, 0, start.srcEnd - minDur);
                        onTrimSegment?.(seg.id, { srcStart: nextSrcStart });
                      }}
                      onPointerUp={(e) => {
                        if (!trimDrag || trimDrag.segmentId !== seg.id) return;
                        e.stopPropagation();
                        setTrimDrag(null);
                        trimDragStartRef.current = null;
                      }}
                    />
                    <div
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/10"
                      title="Trim end"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                        setTrimDrag({ segmentId: seg.id, edge: "end" });
                        trimDragStartRef.current = {
                          clientX: e.clientX,
                          srcStart: seg.srcStart,
                          srcEnd: seg.srcEnd,
                          outStart,
                        };
                      }}
                      onPointerMove={(e) => {
                        if (!trimDrag || trimDrag.segmentId !== seg.id || trimDrag.edge !== "end") return;
                        const start = trimDragStartRef.current;
                        if (!start) return;
                        e.stopPropagation();
                        const dx = e.clientX - start.clientX;
                        const deltaSec = dx / safePxPerSecond;
                        const minDur = 0.05;
                        const rawSrcEnd = start.srcEnd + deltaSec;
                        const nextSrcEnd = Math.max(start.srcStart + minDur, rawSrcEnd);

                        // Snapping in output time for the *end* boundary.
                        const rawOutEnd = start.outStart + (nextSrcEnd - start.srcStart);
                        const snapPx = 10;
                        const snapSec = snapPx / safePxPerSecond;
                        const candidates: number[] = [
                          clamp(outputTime, 0, safeOutputDuration),
                          ...(clickMarkers ?? []).map((m) => clamp(m.tOut, 0, safeOutputDuration)),
                          ...outOffsets.map((t) => clamp(t, 0, safeOutputDuration)),
                          ...outOffsets.map((t, idx2) => clamp(t + Math.max(0, segments[idx2]!.srcEnd - segments[idx2]!.srcStart), 0, safeOutputDuration)),
                        ];

                        let snappedOutEnd = rawOutEnd;
                        for (const c of candidates) {
                          if (Math.abs(c - rawOutEnd) <= snapSec) {
                            snappedOutEnd = c;
                            break;
                          }
                        }

                        const snappedDur = Math.max(minDur, snappedOutEnd - start.outStart);
                        onTrimSegment?.(seg.id, { srcEnd: start.srcStart + snappedDur });
                      }}
                      onPointerUp={(e) => {
                        if (!trimDrag || trimDrag.segmentId !== seg.id) return;
                        e.stopPropagation();
                        setTrimDrag(null);
                        trimDragStartRef.current = null;
                      }}
                    />

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
                style={{ left: `${clamp(outputTime, 0, safeOutputDuration) * safePxPerSecond}px` }}
              >
                <div className="absolute top-[-10px] left-[-10px] bg-white w-5 h-5 rounded-full shadow-md" />
              </div>
            </div>

            {/* Audio lanes */}
            {audioRows.map((t) => {
              const isAudible = t.solo || !audioRows.some((x) => x.solo) ? !t.muted : false;
              return (
                <div key={t.id} className="relative h-10 border-t border-white/10">
                  {t.clips.map((c) => {
                    const leftPx = clamp(c.tOutStart, 0, safeOutputDuration) * safePxPerSecond;
                    const widthPx = clamp(c.duration, 0, safeOutputDuration) * safePxPerSecond;
                    if (widthPx <= 1) return null;
                    return (
                      <div
                        key={c.id}
                        className={`absolute top-1 bottom-1 rounded-md border ${
                          isAudible ? "border-emerald-400/40 bg-emerald-500/15" : "border-white/15 bg-white/5"
                        } overflow-hidden`}
                        style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                        title={`${t.name} (${Math.round(t.volume * 100)}%)`}
                      >
                        <div
                          className="absolute inset-0 opacity-70"
                          style={{
                            backgroundImage:
                              "linear-gradient(to right, rgba(255,255,255,0.10) 0, rgba(255,255,255,0.10) 1px, transparent 1px, transparent 6px)",
                            backgroundSize: "6px 100%",
                          }}
                        />
                        <div className="relative h-full px-2 flex items-center text-[10px] text-white/70 font-mono truncate">
                          {t.name}
                        </div>
                      </div>
                    );
                  })}

                  {/* Playhead continuation */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/60 z-20"
                    style={{ left: `${clamp(outputTime, 0, safeOutputDuration) * safePxPerSecond}px` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


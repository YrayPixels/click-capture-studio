import * as React from "react";
import { useParams } from "react-router-dom";
import { ChevronLeft, Play, Save, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MainNav } from "@/components/main-nav";
import { BackgroundEffectEditor } from "@/components/background-effects-editor";
import { CapcutTimelineEditor, type CapcutSegment } from "@/components/capcut-timeline-editor";
import { toast } from "sonner";
import { screenRecordingService, type ClickEvent } from "@/services/screen-recording";
import { backgrounds } from "@/services/color";
import { exportVideo, formatTimeDisplay } from "@/utils/videoExport";

type ZoomMode = "off" | "low" | "medium" | "high";

function makeId() {
  return `seg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n));
}

type ClickEventStitched = {
  id: string;
  // Time on the stitched/exported timeline
  tOut: number;
  // Normalized click position within the video surface
  xNorm: number;
  yNorm: number;
  // Index into clickEventsSource (used for deletion)
  sourceIndex: number;
};

export default function CapcutEditor() {
  const { id } = useParams<{ id: string }>();

  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [videoDuration, setVideoDuration] = React.useState(0); // source duration (seconds)

  const [outputTime, setOutputTime] = React.useState(0); // stitched timeline time (seconds)
  const outputTimeRef = React.useRef(outputTime);
  const pendingOutputTimeRef = React.useRef<number | null>(null);
  const outputTimeRafRef = React.useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);

  const [segments, setSegments] = React.useState<CapcutSegment[]>([]);
  const outputDuration = React.useMemo(() => {
    return segments.reduce((acc, s) => acc + Math.max(0, s.srcEnd - s.srcStart), 0);
  }, [segments]);

  const outOffsets = React.useMemo(() => {
    const offsets: number[] = [];
    let cum = 0;
    for (const s of segments) {
      offsets.push(cum);
      cum += Math.max(0, s.srcEnd - s.srcStart);
    }
    return offsets;
  }, [segments]);

  const [clickEventsSource, setClickEventsSource] = React.useState<ClickEvent[]>([]);
  const [clickEventsStitched, setClickEventsStitched] = React.useState<
    ClickEventStitched[]
  >([]);

  const [selectedBackground, setSelectedBackground] = React.useState(0);
  const [padding, setPadding] = React.useState(100);

  const [zoomMode, setZoomMode] = React.useState<ZoomMode>("medium");
  const [zoomDuration, setZoomDuration] = React.useState<number>(0.5); // seconds

  const [showMenu, setShowMenu] = React.useState(true);

  const [isExporting, setIsExporting] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState(0);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const videoContainerRef = React.useRef<HTMLDivElement>(null);
  const zoomFrameRef = React.useRef<HTMLDivElement>(null);

  const isSeekingRef = React.useRef(false);

  const [projectTitle, setProjectTitle] = React.useState(
    id === "new" ? "Untitled Project" : "Project Demo"
  );

  React.useEffect(() => {
    outputTimeRef.current = outputTime;
  }, [outputTime]);

  React.useEffect(() => {
    return () => {
      if (outputTimeRafRef.current != null) {
        cancelAnimationFrame(outputTimeRafRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (id === "new") {
      const recordingVideoUrl = screenRecordingService.getRecordingVideoUrl();
      if (recordingVideoUrl) {
        setVideoUrl(recordingVideoUrl);
        setClickEventsSource(screenRecordingService.getClickEvents());
      } else {
        toast.error("No recording found. Please record a video first.");
      }
      return;
    }

    if (id) {
      setVideoUrl(`/videos/${id}`);
    }
  }, [id]);

  React.useEffect(() => {
    if (!videoUrl) return;

    const el = videoRef.current;
    if (!el) return;

    const onLoadedMetadata = () => {
      setVideoDuration(el.duration || 0);
    };

    el.addEventListener("loadedmetadata", onLoadedMetadata);

    // Ensure metadata loads.
    try {
      el.load();
    } catch {
      // ignore
    }

    return () => {
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [videoUrl]);

  // Initialize first segment from full source video.
  React.useEffect(() => {
    if (!videoDuration || videoDuration <= 0) return;
    setSegments((prev) => {
      if (prev.length) return prev;
      return [
        {
          id: makeId(),
          srcStart: 0,
          srcEnd: videoDuration,
        },
      ];
    });
    setOutputTime(0);
  }, [videoDuration]);

  // Remap recorded click events onto the stitched timeline order.
  React.useEffect(() => {
    const EPS = 0.0005;
    const remapped: ClickEventStitched[] = [];

    let cumOut = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segDur = Math.max(0, seg.srcEnd - seg.srcStart);
      if (segDur <= 0) continue;

      for (let sourceIndex = 0; sourceIndex < clickEventsSource.length; sourceIndex++) {
        const c = clickEventsSource[sourceIndex];
        const tSrc = c.t; // seconds in source video
        const inThisSegment =
          tSrc >= seg.srcStart - EPS &&
          (tSrc < seg.srcEnd - EPS || (i === segments.length - 1 && tSrc <= seg.srcEnd + EPS));

        if (!inThisSegment) continue;
        remapped.push({
          id: `click_${sourceIndex}`,
          sourceIndex,
          tOut: cumOut + (tSrc - seg.srcStart),
          xNorm: c.xNorm,
          yNorm: c.yNorm,
        });
      }

      cumOut += segDur;
    }

    remapped.sort((a, b) => a.tOut - b.tOut);
    setClickEventsStitched(remapped);
  }, [segments, clickEventsSource]);

  const getSourceTimeFromOutputTime = React.useCallback(
    (tOut: number) => {
      if (!segments.length) return 0;
      const safeOut = clamp(tOut, 0, outputDuration);

      let cumOut = 0;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segDur = Math.max(0, seg.srcEnd - seg.srcStart);
        const isLast = i === segments.length - 1;

        if (safeOut < cumOut + segDur || isLast) {
          return seg.srcStart + (safeOut - cumOut);
        }
        cumOut += segDur;
      }

      return segments[segments.length - 1].srcEnd;
    },
    [segments, outputDuration]
  );

  const getOutputTimeFromSourceTime = React.useCallback(
    (tSrc: number) => {
      if (!segments.length) return 0;
      let cumOut = 0;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const isLast = i === segments.length - 1;

        if (tSrc >= seg.srcStart && tSrc < seg.srcEnd) {
          return cumOut + (tSrc - seg.srcStart);
        }

        if (isLast && tSrc >= seg.srcEnd) {
          return outputDuration;
        }

        cumOut += Math.max(0, seg.srcEnd - seg.srcStart);
      }

      return 0;
    },
    [segments, outputDuration]
  );

  const getSegmentIndexFromSourceTime = React.useCallback(
    (tSrc: number) => {
      if (!segments.length) return -1;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const isLast = i === segments.length - 1;
        if (tSrc >= seg.srcStart && (tSrc < seg.srcEnd || (isLast && tSrc <= seg.srcEnd))) return i;
      }
      return -1;
    },
    [segments]
  );

  const getSegmentIndexFromOutputTime = React.useCallback(
    (tOut: number) => {
      if (!segments.length) return -1;
      const safeOut = clamp(tOut, 0, outputDuration);
      for (let i = 0; i < segments.length; i++) {
        const startOut = outOffsets[i] ?? 0;
        const segDur = Math.max(0, segments[i].srcEnd - segments[i].srcStart);
        const isLast = i === segments.length - 1;
        if (safeOut < startOut + segDur || isLast) return i;
      }
      return -1;
    },
    [outOffsets, outputDuration, segments]
  );

  const playbackSegIndexRef = React.useRef<number>(0);

  // Keep playback index aligned to the visible output playhead when segments change/reorder.
  React.useEffect(() => {
    const idx = getSegmentIndexFromOutputTime(outputTimeRef.current);
    if (idx >= 0) playbackSegIndexRef.current = idx;
  }, [getSegmentIndexFromOutputTime, segments]);

  // Whenever segments/order change, keep the current outputTime and seek the video.
  React.useEffect(() => {
    if (!videoRef.current) return;
    if (!segments.length) return;

    const nextOut = clamp(outputTime, 0, outputDuration);
    if (Math.abs(nextOut - outputTime) > 0.001) {
      setOutputTime(nextOut);
    }

    const src = getSourceTimeFromOutputTime(nextOut);

    isSeekingRef.current = true;
    videoRef.current.currentTime = src;
    requestAnimationFrame(() => {
      isSeekingRef.current = false;
    });
  }, [segments, outputDuration, outputTime, getSourceTimeFromOutputTime]);

  const activeZoomClick = React.useMemo(() => {
    if (zoomMode === "off" || zoomDuration <= 0) return null;
    if (!clickEventsStitched.length) return null;

    // Scan from the end to implement "last click wins".
    for (let i = clickEventsStitched.length - 1; i >= 0; i--) {
      const e = clickEventsStitched[i];
      if (outputTime >= e.tOut && outputTime <= e.tOut + zoomDuration) {
        return e;
      }
    }
    return null;
  }, [clickEventsStitched, outputTime, zoomMode, zoomDuration]);

  const { totalScale, translateX, translateY } = React.useMemo(() => {
    const baseScale = padding / 100;
    let totalScale = baseScale;
    let translateX = 0;
    let translateY = 0;

    if (
      zoomMode === "off" ||
      !activeZoomClick ||
      zoomDuration <= 0
    ) {
      return { totalScale, translateX, translateY };
    }

    const maxScaleByMode: Record<Exclude<ZoomMode, "off">, number> = {
      low: 1.25,
      medium: 1.5,
      high: 2.0,
    };

    const progress = clamp(
      (outputTime - activeZoomClick.tOut) / zoomDuration,
      0,
      1
    );

    // EaseInOutCubic
    const eased =
      progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

    const zoomMultiplier =
      1 +
      (maxScaleByMode[zoomMode as Exclude<ZoomMode, "off">] - 1) * eased;

    totalScale = baseScale * zoomMultiplier;

    // Use container dimensions (stable) instead of zoomFrame boundingClientRect
    // to avoid feedback/jitter while transforming.
    const w = videoContainerRef.current?.clientWidth ?? 0;
    const h = videoContainerRef.current?.clientHeight ?? 0;
    if (w > 0 && h > 0) {
      translateX = (0.5 - totalScale * activeZoomClick.xNorm) * w;
      translateY = (0.5 - totalScale * activeZoomClick.yNorm) * h;
    }

    return { totalScale, translateX, translateY };
  }, [padding, zoomMode, activeZoomClick, outputTime, zoomDuration]);

  const handleDeleteActiveZoomClick = () => {
    if (!activeZoomClick) return;
    const sourceIndex = activeZoomClick.sourceIndex;
    setClickEventsSource((prev) =>
      prev.filter((_, idx) => idx !== sourceIndex)
    );
    toast.success("Deleted click zoom section");
  };

  React.useEffect(() => {
    if (!videoRef.current) return;
    const v = videoRef.current;

    v.ontimeupdate = () => {
      if (!segments.length) return;
      if (isSeekingRef.current) return;

      const tSrc = v.currentTime;
      let idx = playbackSegIndexRef.current;
      if (idx < 0 || idx >= segments.length) {
        idx = getSegmentIndexFromOutputTime(outputTimeRef.current);
        if (idx < 0) idx = getSegmentIndexFromSourceTime(tSrc);
        playbackSegIndexRef.current = Math.max(0, idx);
      }

      let seg = segments[idx];
      const eps = 0.03;

      // Snap across segment boundaries while playing (so output time is continuous).
      if (tSrc >= seg.srcEnd - eps) {
        if (idx < segments.length - 1) {
          const nextIdx = idx + 1;
          playbackSegIndexRef.current = nextIdx;
          isSeekingRef.current = true;
          v.currentTime = segments[nextIdx].srcStart + 0.001;
          requestAnimationFrame(() => {
            isSeekingRef.current = false;
          });
          return;
        }

        // Last segment reached.
        setIsPlaying(false);
        v.pause();
        return;
      }

      // If a late timeupdate lands us in the wrong source region (common right after split/reorder),
      // stick to the expected output-order segment rather than searching by source time.
      if (tSrc < seg.srcStart - eps) {
        const resyncIdx = getSegmentIndexFromSourceTime(tSrc);
        if (resyncIdx >= 0) {
          playbackSegIndexRef.current = resyncIdx;
          idx = resyncIdx;
          seg = segments[idx];
        }
      }

      const startOut = outOffsets[idx] ?? 0;
      const outT = startOut + (tSrc - seg.srcStart);
      // Throttle UI updates: video time can tick ~30-60fps which causes
      // heavy re-render work during zoom. We update state at most once per RAF.
      pendingOutputTimeRef.current = outT;

      const currentOut = outputTimeRef.current;
      const shouldUpdate =
        Math.abs(outT - currentOut) > 0.02 ||
        outT <= 0.001 ||
        outT >= outputDuration - 0.001;

      if (shouldUpdate && outputTimeRafRef.current == null) {
        outputTimeRafRef.current = window.requestAnimationFrame(() => {
          outputTimeRafRef.current = null;
          const next = pendingOutputTimeRef.current;
          pendingOutputTimeRef.current = null;
          if (typeof next === "number") {
            setOutputTime(next);
          }
        });
      }
    };

    v.onended = () => {
      // If the active segment ends at the end of the *source* video, the browser can fire `ended`
      // before our boundary-snap logic runs. In stitched mode, only stop if we're on the last
      // segment in the *output order*; otherwise jump to the next segment and keep playing.
      if (!segments.length) {
        setIsPlaying(false);
        return;
      }

      const idx = playbackSegIndexRef.current;
      if (idx >= 0 && idx < segments.length - 1) {
        const nextIdx = idx + 1;
        playbackSegIndexRef.current = nextIdx;
        isSeekingRef.current = true;
        v.currentTime = segments[nextIdx].srcStart + 0.001;
        requestAnimationFrame(() => {
          isSeekingRef.current = false;
        });

        // Keep playing seamlessly.
        void v.play();
        setIsPlaying(true);
        return;
      }

      setIsPlaying(false);
    };

    return () => {
      v.ontimeupdate = null;
      v.onended = null;
    };
  }, [
    segments,
    outOffsets,
    getOutputTimeFromSourceTime,
    getSegmentIndexFromSourceTime,
    getSegmentIndexFromOutputTime,
    outputDuration,
  ]);

  const handleOutputTimeChange = (tOut: number) => {
    if (!segments.length) return;
    const nextOut = clamp(tOut, 0, outputDuration);
    setOutputTime(nextOut);

    if (!videoRef.current) return;

    isSeekingRef.current = true;
    videoRef.current.currentTime = getSourceTimeFromOutputTime(nextOut);
    requestAnimationFrame(() => {
      isSeekingRef.current = false;
    });
  };

  const handleSplitAt = (tOut: number) => {
    if (isPlaying) return;
    if (!segments.length) return;

    const tSrc = getSourceTimeFromOutputTime(tOut);
    const idx = getSegmentIndexFromSourceTime(tSrc);
    if (idx < 0) return;

    const seg = segments[idx];
    const segDur = seg.srcEnd - seg.srcStart;
    if (segDur <= 0.08) return;

    const boundary = clamp(tSrc, seg.srcStart + 0.02, seg.srcEnd - 0.02);
    if (boundary <= seg.srcStart + 0.01 || boundary >= seg.srcEnd - 0.01) return;

    const left: CapcutSegment = { id: makeId(), srcStart: seg.srcStart, srcEnd: boundary };
    const right: CapcutSegment = { id: makeId(), srcStart: boundary, srcEnd: seg.srcEnd };

    setSegments((prev) => {
      const next = prev.slice();
      next.splice(idx, 1, left, right);
      return next;
    });

    toast.success(`Split at ${formatTimeDisplay(tOut)}`);
  };

  const handleDeleteSegment = (segmentId: string) => {
    if (segments.length <= 1) return;
    setSegments((prev) => prev.filter((s) => s.id !== segmentId));
    toast.success("Segment deleted");
  };

  const handleReorderSegment = (dragSegmentId: string, insertIndex: number) => {
    setSegments((prev) => {
      const fromIndex = prev.findIndex((s) => s.id === dragSegmentId);
      if (fromIndex < 0) return prev;

      const next = prev.slice();
      const [seg] = next.splice(fromIndex, 1);
      const safeInsertIndex = clamp(insertIndex, 0, next.length);
      next.splice(safeInsertIndex, 0, seg);
      return next;
    });
  };

  const handleExport = async (format: string, quality: string, ratio: string) => {
    try {
      if (!videoRef.current || !videoContainerRef.current) {
        toast.error("Video not ready for export");
        return;
      }

      setIsExporting(true);
      setExportProgress(0);

      await exportVideo(
        videoRef.current,
        videoContainerRef.current,
        format,
        quality,
        (progress) => setExportProgress(progress)
      );

      setIsExporting(false);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Failed to export video");
      setIsExporting(false);
    }
  };

  const togglePlayPause = React.useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      // Ensure playback always follows the current stitched segment order.
      // Without this, play() can begin from a stale source time right after reorders/splits.
      const idx = getSegmentIndexFromOutputTime(outputTimeRef.current);
      if (idx >= 0) playbackSegIndexRef.current = idx;

      const desiredSrc = getSourceTimeFromOutputTime(outputTimeRef.current);
      if (Math.abs(videoRef.current.currentTime - desiredSrc) > 0.02) {
        isSeekingRef.current = true;
        videoRef.current.currentTime = desiredSrc;
        requestAnimationFrame(() => {
          isSeekingRef.current = false;
        });
      }

      videoRef.current.play();
      setIsPlaying(true);
    }
  }, [getSegmentIndexFromOutputTime, getSourceTimeFromOutputTime, isPlaying]);

  React.useEffect(() => {
    const isEditableTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (e.repeat) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      togglePlayPause();
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlayPause]);

  return (
    <div className="flex flex-col min-h-screen">
      <MainNav />

      <main className="flex-1 px-6 py-4 flex flex-col">
        <div className="max-w-7xl w-full mx-auto flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <Button variant="ghost" className="mr-2">
                <a href="/">
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </a>
              </Button>
              <h1 className="text-2xl font-semibold">{projectTitle}</h1>
            </div>

            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
              <Button variant="outline" size="sm" onClick={togglePlayPause}>
                {isPlaying ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                {isPlaying ? "Pause" : "Play"}
              </Button>
            </div>
          </div>

          <div className="flex flex-row gap-4">
            <div
              style={{
                aspectRatio: 3 / 2,
              }}
              className="relative w-full h-full border flex justify-center items-center rounded-lg shadow-lg overflow-hidden mb-4"
            >
              <div
                ref={videoContainerRef}
                style={{
                  aspectRatio: 3 / 2,
                }}
                id="video-container"
                className={`h-full w-full flex flex-row justify-center items-center shadow-xl ${backgrounds[selectedBackground]} backdrop-blur-sm`}
              >
                <div
                  ref={zoomFrameRef}
                  className={`absolute aspect-auto ${videoRef.current?.videoWidth > 300 ? "rounded-2xl" : "rounded-xl"} border-gray-600 border-2 overflow-hidden bg-black shadow-lg shadow-black transition-transform duration-75 ease-out will-change-transform`}
                  style={{
                    width: `${videoRef.current?.videoWidth > 500 ? "90%" : "300px"}`,
                    transformOrigin: "0 0",
                    transform: `translate(${translateX}px, ${translateY}px) scale(${totalScale})`,
                  }}
                >
                  <div className="pb-2 bg-gray-800">
                    {showMenu && (
                      <div className="bg-blue w-full flex gap-x-1 bg-gray-800 p-2">
                        <div className="h-2 w-2 bg-red-500 rounded-full shadow"></div>
                        <div className="h-2 w-2 bg-yellow-200 rounded-full shadow"></div>
                        <div className="h-2 w-2 bg-green-500 rounded-full shadow"></div>
                      </div>
                    )}

                    {videoUrl ? (
                      <video
                        ref={videoRef}
                        src={videoUrl}
                        className="w-full h-full object-contain transition-transform duration-300"
                        controls={false}
                      />
                    ) : (
                      <div className="flex w-full items-center justify-center">
                        <Play className="h-16 w-16 text-white/50" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Visual indicators for click-triggered zoom. */}
                <div className="absolute inset-0 pointer-events-none">
                  {activeZoomClick ? (
                    <>
                      {/* Center dot: during zoom we pan+scale to the click point, so it lands center. */}
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-studio-accent shadow" />

                      <div className="absolute top-3 left-3 pointer-events-auto">
                        <div className="glass-card px-3 py-2 rounded-lg text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono">
                              Zoom @ {formatTimeDisplay(activeZoomClick.tOut)}
                            </span>
                            <button
                              type="button"
                              className="ml-2 rounded-md bg-destructive/15 hover:bg-destructive/25 text-destructive px-2 py-1"
                              onClick={handleDeleteActiveZoomClick}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <BackgroundEffectEditor
              duration={videoDuration}
              currentTime={outputTime}
              onTimeChange={() => {
                // BackgroundEffectEditor owns its own UI time changes; timeline drives preview.
              }}
              backgrounds={backgrounds}
              selectedBackground={selectedBackground}
              setSelectedBackground={setSelectedBackground}
              padding={padding}
              setPadding={setPadding}
              zoomMode={zoomMode}
              setZoomMode={setZoomMode}
              zoomDuration={zoomDuration}
              setZoomDuration={setZoomDuration}
              handleExport={handleExport}
              isExporting={isExporting}
              exportProgress={exportProgress}
              showMenu={showMenu}
              setShowMenu={setShowMenu}
            />
          </div>

          <div className="py-3">
            <CapcutTimelineEditor
              outputDuration={outputDuration}
              outputTime={outputTime}
              onOutputTimeChange={handleOutputTimeChange}
              segments={segments}
              isPlaying={isPlaying}
              onPlayPause={togglePlayPause}
              onSplitAt={handleSplitAt}
              onDeleteSegment={handleDeleteSegment}
              onReorderSegment={handleReorderSegment}
            />
          </div>
        </div>
      </main>
    </div>
  );
}


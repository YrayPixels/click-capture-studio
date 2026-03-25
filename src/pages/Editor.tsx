import * as React from "react";
import { useParams } from "react-router-dom";
import { ChevronLeft, Download, Play, Save, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MainNav } from "@/components/main-nav";
import { TimelineEditor } from "@/components/timeline-editor";
import { ExportPanel } from "@/components/export-panel";
import { screenRecordingService, type ClickEvent } from "@/services/screen-recording";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { BackgroundEffectEditor } from "@/components/background-effects-editor";
import { exportVideo, formatTimeDisplay } from "@/utils/videoExport";
import { backgrounds } from "@/services/color";

function toClickstudioUrl(absPath: string) {
  const encoded = encodeURI(absPath);
  const url = `clickstudio://${encoded}`;
  return url.replace(/^clickstudio:\/{2,}/, "clickstudio:///");
}

function toFileUrl(absPath: string) {
  const encoded = encodeURI(absPath);
  return `file://${encoded}`;
}

export default function Editor() {
  const { id } = useParams<{ id: string }>();
  const [currentTime, setCurrentTime] = React.useState(0);
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState(0);
  const [showExportPanel, setShowExportPanel] = React.useState(false);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [videoLoadError, setVideoLoadError] = React.useState<string | null>(null);
  const [isPickingVideo, setIsPickingVideo] = React.useState(false);
  const [selectedBackground, setSelectedBackground] = React.useState<number>(0);
  const [padding, setPadding] = React.useState(100);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const zoomFrameRef = React.useRef<HTMLDivElement>(null);
  const [showInput, setShowInput] = React.useState(false);
  const [projectTitle, setProjectTitle] = React.useState(id === "new" ? "Untitled Project" : "Project Demo");
  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [splitPoints, setSplitPoints] = React.useState<number[]>([]);
  const [deletedRanges, setDeletedRanges] = React.useState<
    Array<{ start: number; end: number }>
  >([]);
  const deletedRangesRef = React.useRef(deletedRanges);
  const isSeekingRef = React.useRef(false);
  const videoContainerRef = React.useRef<HTMLDivElement>(null);
  const [videoDuration, setVideoDuration] = React.useState(0);
  const [previewAspectRatio, setPreviewAspectRatio] = React.useState<number>(3 / 2);
  const [isPortraitVideo, setIsPortraitVideo] = React.useState(false);
  const [showMenu, setShowMenu] = React.useState(true);
  const [clickEvents, setClickEvents] = React.useState<ClickEvent[]>([]);
  const [zoomMode, setZoomMode] = React.useState<"off" | "low" | "medium" | "high">("medium");
  const [zoomDuration, setZoomDuration] = React.useState<number>(1.0);

  React.useEffect(() => {
    if (id === "new") {
      const recordingVideoUrl = screenRecordingService.getRecordingVideoUrl();
      console.log("Recording video URL:", recordingVideoUrl);
      if (recordingVideoUrl) {
        setVideoUrl(recordingVideoUrl);
        setVideoLoadError(null);
        setClickEvents(screenRecordingService.getClickEvents());
      } else {
        toast.error("No recording found. Please record a video first.");
      }
    } else if (id) {
      // Older flow expected a server route (/videos/:id). Prefer explicit file pick instead.
      setVideoUrl(null);
      setVideoLoadError("No video linked. Pick a local file to edit.");
    }
  }, [id]);

  const handlePickVideo = React.useCallback(async () => {
    if (!window.clickStudio?.pickVideoFile) {
      toast.error("File picker not available");
      return;
    }
    setIsPickingVideo(true);
    try {
      const res = await window.clickStudio.pickVideoFile();
      if (!res || res.canceled) return;
      setVideoUrl(toFileUrl(res.path));
      setVideoLoadError(null);
    } catch (e) {
      console.error("[video] pick failed", e);
      toast.error("Failed to pick video");
    } finally {
      setIsPickingVideo(false);
    }
  }, []);

  React.useEffect(() => {
    deletedRangesRef.current = deletedRanges;
  }, [deletedRanges]);

  React.useEffect(() => {
    const handleLoadedMetadata = () => {
      if (videoRef.current) {
        setVideoDuration(videoRef.current.duration);
        const w = videoRef.current.videoWidth || 0;
        const h = videoRef.current.videoHeight || 0;
        if (w > 0 && h > 0) {
          setPreviewAspectRatio(w / h);
          setIsPortraitVideo(h > w);
        }
      }
    };

    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);

      videoElement.load();

      if (videoElement.readyState >= 1) {
        setVideoDuration(videoElement.duration);
      }
    }

    return () => {
      if (videoElement) {
        videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      }
    };
  }, [videoRef.current, videoUrl]);

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
      setShowExportPanel(false);
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export video');
      setIsExporting(false);
    }
  };

  const handleSplitVideo = () => {
    if (!videoRef.current) return;
    if (videoDuration <= 0) return;
    // Allow split at 0, but don't allow a split at (or extremely near) the end.
    if (currentTime < 0 || currentTime >= videoDuration - 0.02) return;

      setSplitPoints((prev) => {
        const existingPoint = prev.find(point => Math.abs(point - currentTime) < 0.1);
        if (!existingPoint) {
          return [...prev, currentTime].sort((a, b) => a - b);
        }
        return prev;
      });
      toast.success(`Split added at ${formatTimeDisplay(currentTime)}`);
  };

  const mergeRanges = (ranges: Array<{ start: number; end: number }>) => {
    const EPS = 0.03;
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];

    for (const r of sorted) {
      const start = Math.max(0, Math.min(videoDuration, r.start));
      const end = Math.max(0, Math.min(videoDuration, r.end));
      if (end - start <= 0.01) continue;

      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({ start, end });
        continue;
      }

      if (r.start <= last.end + EPS) {
        last.end = Math.max(last.end, end);
      } else {
        merged.push({ start, end });
      }
    }

    return merged;
  };

  const adjustTimeForDeletedRanges = (t: number) => {
    const EPS = 0.005;
    const ranges = deletedRangesRef.current;
    let time = Math.max(0, Math.min(videoDuration, t));

    // If the playhead lands inside a deleted range, jump to its end.
    while (true) {
      const r = ranges.find((x) => time >= x.start - EPS && time < x.end - EPS);
      if (!r) return time;
      time = Math.min(videoDuration, r.end + EPS);
      if (time >= videoDuration - EPS) return videoDuration;
    }
  };

  const handleDeleteSplit = (index: number) => {
    if (videoDuration <= 0) return;
    const start = splitPoints[index];
    if (start == null) return;

    const end =
      index < splitPoints.length - 1 ? splitPoints[index + 1] : videoDuration;

    if (end - start <= 0.02) return;

    setDeletedRanges((prev) => mergeRanges([...prev, { start, end }]));
    toast.success(
      `Deleted segment ${formatTimeDisplay(start)} - ${formatTimeDisplay(end)}`
    );
  };

  const handleTimeChange = (time: number) => {
    if (isNaN(time) || !isFinite(time)) {
      time = 0;
    }
    const adjusted = adjustTimeForDeletedRanges(time);
    setCurrentTime(adjusted);
    if (videoRef.current) {
      videoRef.current.currentTime = adjusted;
    }
  };

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  React.useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    el.onended = () => setIsPlaying(false);
    return () => {
      el.onended = null;
    };
  }, [videoUrl]);

  React.useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const tick = () => {
      const t = el.currentTime;
      const adjusted = adjustTimeForDeletedRanges(t);

      // If playback time lands in a deleted range, nudge the video forward once.
      if (Math.abs(adjusted - t) > 0.01 && !isSeekingRef.current) {
        isSeekingRef.current = true;
        el.currentTime = adjusted;
        setCurrentTime(adjusted);
        requestAnimationFrame(() => {
          isSeekingRef.current = false;
        });
      } else {
        setCurrentTime(adjusted);
      }

    };

    // Prefer requestVideoFrameCallback for smoother, frame-accurate updates.
    const anyEl = el as unknown as {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    let rvfcId: number | null = null;
    let rafId: number | null = null;

    const start = () => {
      if (!isPlaying) return;
      if (anyEl.requestVideoFrameCallback) {
        if (rvfcId != null) return;
        const onFrame = () => {
          rvfcId = null;
          if (el.paused || el.ended) return;
          tick();
          rvfcId = anyEl.requestVideoFrameCallback!(onFrame);
        };
        rvfcId = anyEl.requestVideoFrameCallback(onFrame);
      } else {
        if (rafId != null) return;
        const loop = () => {
          if (!isPlaying) {
            rafId = null;
            return;
          }
          tick();
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      }
    };

    const stop = () => {
      if (rvfcId != null) {
        anyEl.cancelVideoFrameCallback?.(rvfcId);
        rvfcId = null;
      }
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    stop();
    start();

    return () => {
      stop();
    };
  }, [isPlaying, videoUrl, videoDuration, deletedRanges]);

  // If the user deletes a section that currently contains the playhead,
  // immediately jump to the next kept time.
  React.useEffect(() => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    const adjusted = adjustTimeForDeletedRanges(t);
    if (Math.abs(adjusted - t) > 0.01) {
      isSeekingRef.current = true;
      videoRef.current.currentTime = adjusted;
      setCurrentTime(adjusted);
      requestAnimationFrame(() => {
        isSeekingRef.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletedRanges]);

  const computeZoomTransform = () => {
    const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const baseScale = padding / 100;

    // Default: just base scale (driven by the existing "Scale" slider).
    let totalScale = baseScale;
    let translateX = 0;
    let translateY = 0;

    if (zoomMode === "off" || !clickEvents.length || zoomDuration <= 0) {
      return { totalScale, translateX, translateY };
    }

    const maxScaleByMode: Record<"low" | "medium" | "high", number> = {
      low: 1.25,
      medium: 1.5,
      high: 2.0,
    };

    // Find the most recent click that is active for the configured zoom window.
    const activeClick = [...clickEvents]
      .reverse()
      .find((e) => currentTime >= e.t && currentTime <= e.t + zoomDuration);

    if (!activeClick) {
      return { totalScale, translateX, translateY };
    }

    const progress = Math.min(
      1,
      Math.max(0, (currentTime - activeClick.t) / zoomDuration)
    );

    // Instead of immediately centering the click at scale=1 (which "jumps"),
    // animate pan separately: pan in → zoom in/out → pan back.
    const panLead = 0.18;
    const panTail = 0.18;
    const zoomWindow = Math.max(0.001, 1 - panLead - panTail);

    const panIn = easeInOutCubic(clamp(progress / panLead, 0, 1));
    const panOut = easeInOutCubic(clamp((1 - progress) / panTail, 0, 1));
    const panFactor = progress < panLead ? panIn : progress > 1 - panTail ? panOut : 1;

    const zoomT = clamp((progress - panLead) / zoomWindow, 0, 1);
    const zoomPhase = zoomT <= 0.5 ? zoomT * 2 : (1 - zoomT) * 2; // 0→1→0
    const zoomEased = easeInOutCubic(zoomPhase);

    const zoomMultiplier =
      1 +
      (maxScaleByMode[zoomMode] - 1) * zoomEased;

    totalScale = baseScale * zoomMultiplier;

    const rect = zoomFrameRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 0;
    const h = rect?.height ?? 0;

    if (w > 0 && h > 0) {
      // Keep the clicked point at the center of the video frame while zooming.
      const targetX = (0.5 - totalScale * activeClick.xNorm) * w;
      const targetY = (0.5 - totalScale * activeClick.yNorm) * h;
      translateX = targetX * panFactor;
      translateY = targetY * panFactor;
    }

    return { totalScale, translateX, translateY };
  };

  const { totalScale, translateX, translateY } = computeZoomTransform();

  let timeOut: NodeJS.Timeout;

  return (
    <div className="flex flex-col min-h-screen">
      <MainNav
        centerContent={
          showInput ? (
            <input
              ref={titleInputRef}
              type="text"
              value={projectTitle}
              className="w-[min(520px,60vw)] bg-transparent text-center font-semibold text-base text-white/90 outline-none border border-white/10 rounded-md px-3 py-1.5 focus:border-white/25"
              onBlur={() => setShowInput(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setShowInput(false);
                if (e.key === "Escape") setShowInput(false);
              }}
              onChange={(e) => {
                clearTimeout(timeOut);
                setProjectTitle(e.target.value);
                timeOut = setTimeout(() => {
                  setShowInput(false);
                }, 4000);
              }}
            />
          ) : (
            <button
              type="button"
              className="max-w-[min(520px,60vw)] truncate text-base font-semibold text-white/90 hover:text-white"
              onDoubleClick={() => {
                setShowInput(true);
                window.setTimeout(() => {
                  titleInputRef.current?.focus();
                  titleInputRef.current?.select();
                }, 0);
              }}
            >
              {projectTitle}
            </button>
          )
        }
        rightContent={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={togglePlayPause}>
              <Play className="h-4 w-4 mr-2" />
              {isPlaying ? "Pause" : "Play"}
            </Button>
          </div>
        }
        hideDefaultRight
      />

      <main className="flex-1 px-6 py-4 flex flex-col">
        <div className="w-full flex-1 flex flex-col">
          <div className="flex flex-row gap-4">
            <div
              style={{
                aspectRatio: previewAspectRatio
              }}
              className="relative w-full h-full border flex justify-center items-center rounded-lg shadow-lg overflow-hidden mb-4"
            >
              <div
                ref={videoContainerRef}
                style={{
                  aspectRatio: previewAspectRatio,
                }}
                id="video-container"
                className={`h-full w-full flex flex-row justify-center items-center shadow-xl ${backgrounds[selectedBackground]} backdrop-blur-sm`}
              >
                <div
                  ref={zoomFrameRef}
                  className={`absolute aspect-auto ${videoRef.current?.videoWidth > 300 ? "rounded-2xl" : "rounded-xl"} border-gray-600 border-2 overflow-hidden bg-black shadow-lg shadow-black will-change-transform`}
                  style={{
                    width: isPortraitVideo ? "auto" : `${videoRef.current?.videoWidth > 500 ? "90%" : "300px"}`,
                    height: isPortraitVideo ? "90%" : "auto",
                    transformOrigin: "0 0",
                    transform: `translate(${translateX}px, ${translateY}px) scale(${totalScale})`,
                  }}
                >
                  <div className="pb-2  bg-gray-800">
                    {showMenu &&
                      <div className="bg-blue w-full flex gap-x-1 bg-gray-800 p-2">
                        <div className="h-2 w-2 bg-red-500 rounded-full shadow"></div>
                        <div className="h-2 w-2 bg-yellow-200 rounded-full shadow"></div>
                        <div className="h-2 w-2 bg-green-500 rounded-full shadow"></div>
                      </div>
                    }

                    {videoUrl ? (
                      <video
                        ref={videoRef}
                        src={videoUrl}
                        onError={() => {
                          if (videoUrl?.startsWith("file://")) {
                            const absPath = decodeURIComponent(videoUrl.replace(/^file:\/\//, ""));
                            setVideoUrl(toClickstudioUrl(absPath));
                            return;
                          }
                          setVideoLoadError("Failed to load video");
                        }}
                        className="w-full h-full object-contain transition-transform duration-300"
                        controls={false}
                      />
                    ) : (
                      <div className="flex w-full items-center justify-center">
                        <Play className="h-16 w-16 text-white/50" />
                      </div>
                    )}
                    {videoLoadError ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="glass-card rounded-lg px-4 py-3 text-xs text-white/80 border border-white/15 max-w-[520px]">
                          {videoLoadError}
                          {window.clickStudio?.pickVideoFile ? (
                            <div className="mt-3 flex justify-end">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={isPickingVideo}
                                onClick={handlePickVideo}
                              >
                                {isPickingVideo ? "Opening…" : "Pick video file…"}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <BackgroundEffectEditor
              duration={videoDuration}
              currentTime={currentTime}
              onTimeChange={handleTimeChange}
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
            <TimelineEditor
              duration={videoDuration}
              currentTime={currentTime}
              onTimeChange={handleTimeChange}
              onSplitVideo={handleSplitVideo}
              splitPoints={splitPoints}
              deletedRanges={deletedRanges}
              isPlaying={isPlaying}
              onPlayPause={togglePlayPause}
              onDeleteSplit={handleDeleteSplit}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

import * as React from "react";
import { useParams } from "react-router-dom";
import { ChevronLeft, Play, Save, Pause, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MainNav } from "@/components/main-nav";
import { BackgroundEffectEditor } from "@/components/background-effects-editor";
import {
  CapcutTimelineEditor,
  type CapcutSegment,
  type AudioTrack,
  type TimelineClickMarker,
} from "@/components/capcut-timeline-editor";
import { toast } from "sonner";
import { screenRecordingService, type ClickEvent } from "@/services/screen-recording";
import { backgrounds } from "@/services/color";
import { formatTimeDisplay } from "@/utils/videoExport";
import { createExportTask } from "@/services/export-task";
import {
  clamp,
  deleteSegmentById,
  reorderSegment,
  sourceTimeFromOutputTime,
  splitSegmentAtOutputTime,
  trimSegment,
} from "@/features/editor/timeline-state";

type ZoomMode = "off" | "low" | "medium" | "high";

type ClickEventWithZoom = ClickEvent & {
  enabled?: boolean;
  zoomModeOverride?: ZoomMode;
  zoomDurationOverride?: number;
};

function toClickstudioUrl(absPath: string) {
  const encoded = encodeURI(absPath);
  const url = `clickstudio://${encoded}`;
  return url.replace(/^clickstudio:\/{2,}/, "clickstudio:///");
}

function toFileUrl(absPath: string) {
  // Prefer direct file:// so the editor can open arbitrary local files.
  // Some Electron dev setups can block file:// from an http:// origin; we fallback to clickstudio:// on error.
  const encoded = encodeURI(absPath);
  return `file://${encoded}`;
}

function guessMissingVideoMessage(url: string) {
  const isBare = /^clickstudio:\/\/\/recording-.*\.(webm|mp4|mov)$/i.test(url);
  if (isBare) return "This draft points to a recording filename, but the file isn't on disk.";
  return "Failed to load video";
}

function makeId() {
  return `seg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type ClickEventStitched = {
  id: string;
  // Time on the stitched/exported timeline
  tOut: number;
  // Normalized click position within the video surface
  xNorm: number;
  yNorm: number;
  enabled?: boolean;
  zoomModeOverride?: ZoomMode;
  zoomDurationOverride?: number;
  // Index into clickEventsSource (used for deletion)
  sourceIndex: number;
};

export default function CapcutEditor() {
  const { id } = useParams<{ id: string }>();

  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [videoLoadError, setVideoLoadError] = React.useState<string | null>(null);
  const [cameraVideoUrl, setCameraVideoUrl] = React.useState<string | null>(null);
  const [videoDuration, setVideoDuration] = React.useState(0); // source duration (seconds)
  const [previewAspectRatio, setPreviewAspectRatio] = React.useState<number>(3 / 2);
  const [isPortraitVideo, setIsPortraitVideo] = React.useState(false);

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

  const [clickEventsSource, setClickEventsSource] = React.useState<ClickEventWithZoom[]>([]);
  const [clickEventsStitched, setClickEventsStitched] = React.useState<
    ClickEventStitched[]
  >([]);

  const clickMarkers = React.useMemo<TimelineClickMarker[]>(() => {
    return clickEventsStitched.map((e) => ({ id: e.id, tOut: e.tOut }));
  }, [clickEventsStitched]);

  const [selectedBackground, setSelectedBackground] = React.useState(0);
  const [padding, setPadding] = React.useState(100);

  const [zoomMode, setZoomMode] = React.useState<ZoomMode>("medium");
  const [zoomDuration, setZoomDuration] = React.useState<number>(1.0); // seconds

  const [showMenu, setShowMenu] = React.useState(true);

  const [cameraOverlayEnabled, setCameraOverlayEnabled] = React.useState(true);
  const [cameraOverlayShape, setCameraOverlayShape] = React.useState<"rect" | "circle">(
    "rect"
  );
  const [cameraOverlaySizePct, setCameraOverlaySizePct] = React.useState(22);

  // Timeline viewport (CapCut-like zoomable/scrollable timeline surface)
  const [timelinePxPerSecond, setTimelinePxPerSecond] = React.useState(90);
  const [timelineScrollSec, setTimelineScrollSec] = React.useState(0);

  const [selectedClickMarkerId, setSelectedClickMarkerId] = React.useState<string | null>(null);

  const [audioTracks, setAudioTracks] = React.useState<AudioTrack[]>([]);

  const [isExporting, setIsExporting] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState(0);
  const [exportStatusText, setExportStatusText] = React.useState("Exporting video...");
  const exportTaskRef = React.useRef<ReturnType<typeof createExportTask> | null>(null);
  const nativeExportJobIdRef = React.useRef<string | null>(null);
  const nativeExportUnsubRef = React.useRef<null | (() => void)>(null);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const cameraVideoRef = React.useRef<HTMLVideoElement>(null);
  const videoContainerRef = React.useRef<HTMLDivElement>(null);
  const zoomFrameRef = React.useRef<HTMLDivElement>(null);

  const isSeekingRef = React.useRef(false);

  const [projectTitle, setProjectTitle] = React.useState(
    id === "new" ? "Untitled Project" : "Project Demo"
  );
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const draftId = React.useMemo(() => {
    if (!id) return null;
    if (!id.startsWith("draft_")) return null;
    // `:id` params can be URL-encoded; decode so main-process sanitization matches.
    try {
      return decodeURIComponent(id.slice("draft_".length));
    } catch {
      return id.slice("draft_".length);
    }
  }, [id]);
  const draftCreatedAtRef = React.useRef<string | null>(null);
  const [isPickingVideo, setIsPickingVideo] = React.useState(false);

  React.useEffect(() => {
    outputTimeRef.current = outputTime;
  }, [outputTime]);

  React.useEffect(() => {
    return () => {
      if (outputTimeRafRef.current != null) {
        cancelAnimationFrame(outputTimeRafRef.current);
      }
      const jobId = nativeExportJobIdRef.current;
      if (jobId && window.clickStudio?.cancelNativeExport) {
        void window.clickStudio.cancelNativeExport(jobId);
      }
      nativeExportUnsubRef.current?.();
      nativeExportUnsubRef.current = null;
      exportTaskRef.current?.cancel();
    };
  }, []);

  React.useEffect(() => {
    if (draftId && window.clickStudio?.loadDraft) {
      (async () => {
        try {
          const draft = await window.clickStudio!.loadDraft(draftId);
          const d = (draft?.data ?? {}) as Partial<{
            videoPath: string;
            videoUrl: string;
            cameraVideoPath: string | null;
            cameraVideoUrl: string | null;
            clickEventsSource: ClickEventWithZoom[];
            segments: CapcutSegment[];
            audioTracks: AudioTrack[];
            selectedBackground: number;
            padding: number;
            zoomMode: ZoomMode;
            zoomDuration: number;
            showMenu: boolean;
            cameraOverlayEnabled: boolean;
            cameraOverlayShape: "rect" | "circle";
            cameraOverlaySizePct: number;
          }>;

          draftCreatedAtRef.current = draft.createdAt ?? null;
          setProjectTitle(draft.title ?? "Untitled draft");
          if (d.videoPath) {
            setVideoUrl(toFileUrl(d.videoPath));
          } else if (d.videoUrl) {
            setVideoUrl(d.videoUrl);
          }
          setVideoLoadError(null);
          if (d.cameraVideoPath) {
            setCameraVideoUrl(toFileUrl(d.cameraVideoPath));
          } else if (d.cameraVideoUrl) {
            setCameraVideoUrl(d.cameraVideoUrl);
          }
          if (Array.isArray(d.clickEventsSource)) setClickEventsSource(d.clickEventsSource);
          if (Array.isArray(d.segments) && d.segments.length) setSegments(d.segments);
          if (Array.isArray(d.audioTracks)) setAudioTracks(d.audioTracks);
          if (typeof d.selectedBackground === "number") setSelectedBackground(d.selectedBackground);
          if (typeof d.padding === "number") setPadding(d.padding);
          if (d.zoomMode) setZoomMode(d.zoomMode);
          if (typeof d.zoomDuration === "number") setZoomDuration(d.zoomDuration);
          if (typeof d.showMenu === "boolean") setShowMenu(d.showMenu);
          if (typeof d.cameraOverlayEnabled === "boolean") setCameraOverlayEnabled(d.cameraOverlayEnabled);
          if (d.cameraOverlayShape) setCameraOverlayShape(d.cameraOverlayShape);
          if (typeof d.cameraOverlaySizePct === "number") setCameraOverlaySizePct(d.cameraOverlaySizePct);
        } catch (e) {
          console.error("[draft] load failed", e);
          toast.error("Failed to load draft");
        }
      })();
      return;
    }

    if (id === "new") {
      const recordingVideoUrl = screenRecordingService.getRecordingVideoUrl();
      if (recordingVideoUrl) {
        setVideoUrl(recordingVideoUrl);
        setVideoLoadError(null);
        setClickEventsSource(screenRecordingService.getClickEvents() as ClickEventWithZoom[]);
        setCameraVideoUrl(screenRecordingService.getRecordingCameraVideoUrl());
      } else {
        toast.error("No recording found. Please record a video first.");
      }
      return;
    }

    if (id) {
      setVideoUrl(`/videos/${id}`);
    }
  }, [id, draftId]);

  React.useEffect(() => {
    if (!isEditingTitle) return;
    const t = window.setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [isEditingTitle]);

  const handleLocateVideo = React.useCallback(async () => {
    if (!draftId) return;
    if (!window.clickStudio?.pickVideoFile) {
      toast.error("File picker not available");
      return;
    }
    setIsPickingVideo(true);
    try {
      const res = await window.clickStudio.pickVideoFile();
      if (!res || res.canceled || !("path" in res)) return;

      const pickedPath = res.path;
      const nextUrl = toFileUrl(pickedPath);
      setVideoUrl(nextUrl);
      setVideoLoadError(null);

      // Persist so the draft never breaks again.
      await window.clickStudio.saveDraft({
        id: draftId,
        title: projectTitle,
        createdAt: draftCreatedAtRef.current ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: {
          videoPath: pickedPath,
          videoUrl: undefined,
          cameraVideoPath: null,
          cameraVideoUrl: undefined,
          clickEventsSource,
          segments,
          audioTracks,
          selectedBackground,
          padding,
          zoomMode,
          zoomDuration,
          showMenu,
          cameraOverlayEnabled,
          cameraOverlayShape,
          cameraOverlaySizePct,
        },
      });
      toast.success("Video linked to draft");
    } catch (e) {
      console.error("[draft] locate video failed", e);
      toast.error("Failed to locate video");
    } finally {
      setIsPickingVideo(false);
    }
  }, [
    cameraOverlayEnabled,
    cameraOverlayShape,
    cameraOverlaySizePct,
    audioTracks,
    clickEventsSource,
    draftId,
    padding,
    projectTitle,
    segments,
    selectedBackground,
    showMenu,
    zoomDuration,
    zoomMode,
  ]);

  React.useEffect(() => {
    if (!draftId) return;
    if (!window.clickStudio?.saveDraft) return;

    const t = setTimeout(() => {
      const baseVideoPath =
        typeof screenRecordingService.getCurrentRecordingPath === "function"
          ? screenRecordingService.getCurrentRecordingPath()
          : null;

      window.clickStudio!
        .saveDraft({
          id: draftId,
          title: projectTitle,
          createdAt: draftCreatedAtRef.current ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          data: {
            // Prefer an explicit file path if we have one; otherwise preserve current URL (best effort).
            videoPath: typeof videoUrl === "string" && videoUrl.startsWith("clickstudio://")
              ? decodeURIComponent(videoUrl.replace(/^clickstudio:\/\//, ""))
              : typeof videoUrl === "string" && videoUrl.startsWith("file://")
                ? decodeURIComponent(videoUrl.replace(/^file:\/\//, ""))
              : baseVideoPath,
            videoUrl:
              typeof videoUrl === "string" && !videoUrl.startsWith("clickstudio://")
                ? videoUrl
                : undefined,
            cameraVideoPath:
              typeof cameraVideoUrl === "string" && cameraVideoUrl.startsWith("clickstudio://")
                ? decodeURIComponent(cameraVideoUrl.replace(/^clickstudio:\/\//, ""))
                : typeof cameraVideoUrl === "string" && cameraVideoUrl.startsWith("file://")
                  ? decodeURIComponent(cameraVideoUrl.replace(/^file:\/\//, ""))
                : null,
            cameraVideoUrl:
              typeof cameraVideoUrl === "string" && !cameraVideoUrl.startsWith("clickstudio://")
                ? cameraVideoUrl
                : undefined,
            clickEventsSource,
            segments,
            audioTracks,
            selectedBackground,
            padding,
            zoomMode,
            zoomDuration,
            showMenu,
            cameraOverlayEnabled,
            cameraOverlayShape,
            cameraOverlaySizePct,
          },
        })
        .catch((e) => {
          console.warn("[draft] autosave failed", e);
        });
    }, 600);

    return () => clearTimeout(t);
  }, [
    draftId,
    projectTitle,
    videoUrl,
    cameraVideoUrl,
    clickEventsSource,
    segments,
    audioTracks,
    selectedBackground,
    padding,
    zoomMode,
    zoomDuration,
    showMenu,
    cameraOverlayEnabled,
    cameraOverlayShape,
    cameraOverlaySizePct,
  ]);

  React.useEffect(() => {
    if (!cameraVideoUrl) return;
    if (!cameraVideoRef.current) return;
    cameraVideoRef.current.src = cameraVideoUrl;
    cameraVideoRef.current.muted = true;
    cameraVideoRef.current.playsInline = true;
  }, [cameraVideoUrl]);

  React.useEffect(() => {
    if (!videoUrl) return;

    const el = videoRef.current;
    if (!el) return;

    const onLoadedMetadata = () => {
      setVideoDuration(el.duration || 0);
      const w = el.videoWidth || 0;
      const h = el.videoHeight || 0;
      if (w > 0 && h > 0) {
        setPreviewAspectRatio(w / h);
        setIsPortraitVideo(h > w);
      }
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

  // Initialize a default audio lane (placeholder visuals) aligned to output duration.
  React.useEffect(() => {
    if (!outputDuration || outputDuration <= 0) return;
    setAudioTracks((prev) => {
      if (prev.length) {
        // Keep existing tracks but ensure their first clip covers the output by default.
        return prev.map((t) => {
          const first = t.clips[0];
          if (!first) {
            return {
              ...t,
              clips: [{ id: `${t.id}_clip0`, tOutStart: 0, duration: outputDuration }],
            };
          }
          const nextDur = Math.max(0, outputDuration - Math.max(0, first.tOutStart));
          if (Math.abs(first.duration - nextDur) < 0.001 && first.tOutStart === 0) return t;
          return {
            ...t,
            clips: [{ ...first, tOutStart: 0, duration: nextDur }, ...t.clips.slice(1)],
          };
        });
      }

      return [
        {
          id: "audio_0",
          name: "Audio",
          muted: false,
          solo: false,
          volume: 1,
          clips: [{ id: "audio_0_clip0", tOutStart: 0, duration: outputDuration }],
        },
      ];
    });
  }, [outputDuration]);

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
          enabled: c.enabled,
          zoomModeOverride: c.zoomModeOverride,
          zoomDurationOverride: c.zoomDurationOverride,
        });
      }

      cumOut += segDur;
    }

    remapped.sort((a, b) => a.tOut - b.tOut);
    setClickEventsStitched(remapped);
  }, [segments, clickEventsSource]);

  const selectedClick = React.useMemo(() => {
    if (!selectedClickMarkerId) return null;
    return clickEventsStitched.find((c) => c.id === selectedClickMarkerId) ?? null;
  }, [clickEventsStitched, selectedClickMarkerId]);

  const updateSourceClick = React.useCallback(
    (sourceIndex: number, patch: Partial<ClickEventWithZoom>) => {
      setClickEventsSource((prev) =>
        prev.map((c, idx) => (idx === sourceIndex ? { ...c, ...patch } : c))
      );
    },
    []
  );

  const deleteSourceClick = React.useCallback((sourceIndex: number) => {
    setClickEventsSource((prev) => prev.filter((_, idx) => idx !== sourceIndex));
    setSelectedClickMarkerId(null);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedClick) return;
      if (e.key === "Escape") {
        setSelectedClickMarkerId(null);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteSourceClick(selectedClick.sourceIndex);
        toast.success("Deleted zoom point");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSourceClick, selectedClick]);

  const getSourceTimeFromOutputTime = React.useCallback(
    (tOut: number) => {
      return sourceTimeFromOutputTime(segments, tOut);
    },
    [segments]
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
    if (cameraVideoRef.current && cameraVideoUrl) {
      cameraVideoRef.current.currentTime = src;
    }
    requestAnimationFrame(() => {
      isSeekingRef.current = false;
    });
  }, [cameraVideoUrl, getSourceTimeFromOutputTime, outputDuration, outputTime, segments]);

  const activeZoomClick = React.useMemo(() => {
    if (zoomMode === "off" || zoomDuration <= 0) return null;
    if (!clickEventsStitched.length) return null;

    // Scan from the end to implement "last click wins".
    for (let i = clickEventsStitched.length - 1; i >= 0; i--) {
      const e = clickEventsStitched[i];
      if (e.enabled === false) continue;
      const dur = typeof e.zoomDurationOverride === "number" ? e.zoomDurationOverride : zoomDuration;
      if (dur <= 0) continue;
      if (outputTime >= e.tOut && outputTime <= e.tOut + dur) {
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

    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    if (zoomMode === "off" || !activeZoomClick) {
      return { totalScale, translateX, translateY };
    }

    const effectiveZoomMode = activeZoomClick.zoomModeOverride ?? zoomMode;
    const effectiveZoomDuration =
      typeof activeZoomClick.zoomDurationOverride === "number"
        ? activeZoomClick.zoomDurationOverride
        : zoomDuration;

    if (effectiveZoomMode === "off" || effectiveZoomDuration <= 0) {
      return { totalScale, translateX, translateY };
    }

    const maxScaleByMode: Record<Exclude<ZoomMode, "off">, number> = {
      low: 1.25,
      medium: 1.5,
      high: 2.0,
    };

    const progress = clamp(
      (outputTime - activeZoomClick.tOut) / effectiveZoomDuration,
      0,
      1
    );

    // Animate pan separately (avoid jump at scale=1):
    // pan in → zoom in/out → pan back.
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
      (maxScaleByMode[effectiveZoomMode as Exclude<ZoomMode, "off">] - 1) * zoomEased;

    totalScale = baseScale * zoomMultiplier;

    // Use container dimensions (stable) instead of zoomFrame boundingClientRect
    // to avoid feedback/jitter while transforming.
    const w = videoContainerRef.current?.clientWidth ?? 0;
    const h = videoContainerRef.current?.clientHeight ?? 0;
    if (w > 0 && h > 0) {
      const targetX = (0.5 - totalScale * activeZoomClick.xNorm) * w;
      const targetY = (0.5 - totalScale * activeZoomClick.yNorm) * h;
      translateX = targetX * panFactor;
      translateY = targetY * panFactor;
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

  const handleMoveClickMarker = React.useCallback(
    (id: string, nextTOut: number) => {
      const match = id.match(/^click_(\d+)$/);
      if (!match) return;
      const sourceIndex = Number(match[1]);
      if (!Number.isFinite(sourceIndex)) return;
      const nextSrc = getSourceTimeFromOutputTime(nextTOut);
      updateSourceClick(sourceIndex, { t: nextSrc });
    },
    [getSourceTimeFromOutputTime, updateSourceClick]
  );

  React.useEffect(() => {
    if (!videoRef.current) return;
    const v = videoRef.current;

    const handleTimeTick = () => {
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
    v.ontimeupdate = handleTimeTick;

    // Prefer requestVideoFrameCallback when available for smoother, frame-accurate updates.
    const anyV = v as unknown as {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    let rvfcId: number | null = null;
    const startRvfc = () => {
      if (!anyV.requestVideoFrameCallback) return;
      if (rvfcId != null) return;
      const onFrame = () => {
        rvfcId = null;
        if (v.paused || v.ended) return;
        handleTimeTick();
        rvfcId = anyV.requestVideoFrameCallback!(onFrame);
      };
      rvfcId = anyV.requestVideoFrameCallback(onFrame);
    };
    const stopRvfc = () => {
      if (rvfcId == null) return;
      anyV.cancelVideoFrameCallback?.(rvfcId);
      rvfcId = null;
    };
    v.onplay = () => startRvfc();
    v.onpause = () => stopRvfc();
    if (!v.paused) startRvfc();

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
      v.onplay = null;
      v.onpause = null;
      v.onended = null;
      stopRvfc();
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
    const src = getSourceTimeFromOutputTime(nextOut);
    videoRef.current.currentTime = src;
    if (cameraVideoRef.current && cameraVideoUrl) {
      cameraVideoRef.current.currentTime = src;
    }
    requestAnimationFrame(() => {
      isSeekingRef.current = false;
    });
  };

  const handleSplitAt = (tOut: number) => {
    if (isPlaying) return;
    if (!segments.length) return;
    setSegments((prev) => splitSegmentAtOutputTime(prev, tOut, makeId) as CapcutSegment[]);

    toast.success(`Split at ${formatTimeDisplay(tOut)}`);
  };

  const handleDeleteSegment = (segmentId: string) => {
    setSegments((prev) => deleteSegmentById(prev, segmentId) as CapcutSegment[]);
    toast.success("Segment deleted");
  };

  const handleReorderSegment = (dragSegmentId: string, insertIndex: number) => {
    setSegments((prev) => reorderSegment(prev, dragSegmentId, insertIndex) as CapcutSegment[]);
  };

  const handleExport = async (format: string, quality: string, ratio: string) => {
    try {
      if (!videoRef.current || !videoContainerRef.current) {
        toast.error("Video not ready for export");
        return;
      }

      setIsExporting(true);
      setExportProgress(0);
      setExportStatusText("Preparing export...");

      const resolveInputPath = () => {
        const src = videoRef.current?.currentSrc || videoUrl || "";
        if (src.startsWith("file://")) {
          return decodeURIComponent(src.replace(/^file:\/\//, ""));
        }
        if (src.startsWith("clickstudio://")) {
          return decodeURIComponent(src.replace(/^clickstudio:\/+/, "/"));
        }
        const fromService = screenRecordingService.getCurrentRecordingPath();
        return fromService ?? null;
      };

      const resolveLocalPath = (src: string | null) => {
        if (!src) return null;
        if (src.startsWith("file://")) {
          return decodeURIComponent(src.replace(/^file:\/\//, ""));
        }
        if (src.startsWith("clickstudio://")) {
          return decodeURIComponent(src.replace(/^clickstudio:\/+/, "/"));
        }
        return null;
      };

      const cameraPath = resolveLocalPath(cameraVideoUrl);
      const canNative =
        Boolean(window.clickStudio?.runNativeExport) && (format === "mp4" || format === "webm");
      const inputPath = resolveInputPath();

      if (canNative && inputPath) {
        setExportStatusText("Using native export engine...");
        nativeExportUnsubRef.current?.();
        nativeExportUnsubRef.current = window.clickStudio!.onNativeExportProgress((event) => {
          if (!nativeExportJobIdRef.current) return;
          if (event.jobId !== nativeExportJobIdRef.current) return;
          setExportProgress(event.progress);
          if (event.message) setExportStatusText(event.message);
        });

        const nativeRes = await window.clickStudio!.runNativeExport({
          inputPath,
          segments: segments.map((s) => ({ srcStart: s.srcStart, srcEnd: s.srcEnd })),
          format: format as "mp4" | "webm",
          quality: (quality === "2160p" || quality === "1080p" ? quality : "720p") as
            | "720p"
            | "1080p"
            | "2160p",
          backgroundIndex: selectedBackground,
          paddingPct: padding,
          defaultZoomMode: zoomMode,
          defaultZoomDuration: zoomDuration,
          showMenu,
          clicks: clickEventsStitched.map((c) => ({
            tOut: c.tOut,
            xNorm: c.xNorm,
            yNorm: c.yNorm,
            enabled: c.enabled,
            zoomModeOverride: c.zoomModeOverride,
            zoomDurationOverride: c.zoomDurationOverride,
          })),
          cameraOverlay: {
            enabled: cameraOverlayEnabled,
            path: cameraOverlayEnabled ? cameraPath : null,
            sizePct: cameraOverlaySizePct,
            shape: cameraOverlayShape,
          },
        });
        if ("jobId" in nativeRes && nativeRes.jobId) {
          nativeExportJobIdRef.current = nativeRes.jobId;
        }

        if (!nativeRes.ok) {
          const failed = nativeRes as Extract<NativeExportResult, { ok: false }>;
          if (failed.cancelled) {
            toast("Export cancelled");
          } else {
            throw new Error(failed.error?.message || "Native export failed");
          }
        } else {
          toast.success("Export completed");
          if (window.clickStudio?.revealInFolder) {
            void window.clickStudio.revealInFolder(nativeRes.path);
          }
        }
        setIsExporting(false);
        nativeExportUnsubRef.current?.();
        nativeExportUnsubRef.current = null;
        nativeExportJobIdRef.current = null;
        return;
      }

      setExportStatusText("Rendering styled export...");

      exportTaskRef.current = createExportTask(
        videoRef.current,
        videoContainerRef.current,
        format,
        quality,
        (progress) => setExportProgress(progress),
        {
          cameraVideoEl:
            cameraOverlayEnabled && cameraVideoUrl ? cameraVideoRef.current : null,
          cameraOverlayEl:
            cameraOverlayEnabled && cameraVideoUrl
              ? (document.getElementById("camera-overlay") as HTMLElement | null)
              : null,
          cameraShape: cameraOverlayShape,
        }
      );
      setExportStatusText("Exporting video...");
      await exportTaskRef.current.promise;

      setExportStatusText("Finalizing file...");
      setIsExporting(false);
      exportTaskRef.current = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("cancel")) {
        toast("Export cancelled");
      } else {
        console.error("Export failed:", error);
        toast.error(message || "Failed to export video");
      }
      setIsExporting(false);
      exportTaskRef.current = null;
      nativeExportUnsubRef.current?.();
      nativeExportUnsubRef.current = null;
      nativeExportJobIdRef.current = null;
    }
  };

  const cancelExport = React.useCallback(() => {
    if (!isExporting) return;
    const jobId = nativeExportJobIdRef.current;
    if (jobId && window.clickStudio?.cancelNativeExport) {
      void window.clickStudio.cancelNativeExport(jobId);
    }
    exportTaskRef.current?.cancel();
    setExportStatusText("Cancelling...");
  }, [isExporting]);

  const togglePlayPause = React.useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      cameraVideoRef.current?.pause();
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
      if (cameraOverlayEnabled && cameraVideoUrl) {
        try {
          void cameraVideoRef.current?.play();
        } catch {
          // ignore
        }
      }
      setIsPlaying(true);
    }
  }, [
    cameraOverlayEnabled,
    cameraVideoUrl,
    getSegmentIndexFromOutputTime,
    getSourceTimeFromOutputTime,
    isPlaying,
  ]);

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
    <div className="flex flex-col h-screen overflow-hidden">
      <MainNav
        centerContent={
          isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setIsEditingTitle(false);
                } else if (e.key === "Escape") {
                  setIsEditingTitle(false);
                }
              }}
              className="w-[min(520px,60vw)] bg-transparent text-center font-semibold text-base text-white/90 outline-none border border-white/10 rounded-md px-3 py-1.5 focus:border-white/25"
            />
          ) : (
            <button
              type="button"
              className="max-w-[min(520px,60vw)] truncate text-base font-semibold text-white/90 hover:text-white"
              title="Double-click to rename"
              onDoubleClick={() => setIsEditingTitle(true)}
              onClick={() => {
                // single click does nothing; keep behavior consistent with native editors
              }}
            >
              {projectTitle || "Untitled draft"}
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
              {isPlaying ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {isPlaying ? "Pause" : "Play"}
            </Button>
          </div>
        }
        hideDefaultRight
      />

      <main className="flex-1 px-6 py-4 flex flex-col overflow-hidden">
        <div className="w-full flex-1 flex flex-col min-h-0">
          <div className="flex flex-row gap-4 flex-1 min-h-0 overflow-hidden">
            <div
              style={{
                aspectRatio: previewAspectRatio,
              }}
              className="relative w-full flex-1 min-h-0 border flex justify-center items-center rounded-lg shadow-lg overflow-hidden"
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
                        onError={() => {
                          if (videoUrl?.startsWith("file://")) {
                            const absPath = decodeURIComponent(videoUrl.replace(/^file:\/\//, ""));
                            const fallback = toClickstudioUrl(absPath);
                            setVideoUrl(fallback);
                            return;
                          }
                          const msg = videoUrl ? guessMissingVideoMessage(videoUrl) : "Failed to load video";
                          setVideoLoadError(msg);
                          toast.error(`${msg}${videoUrl ? `: ${videoUrl}` : ""}`);
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
                          {draftId && window.clickStudio?.pickVideoFile ? (
                            <div className="mt-3 flex justify-end">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={isPickingVideo}
                                onClick={handleLocateVideo}
                              >
                                {isPickingVideo ? "Opening…" : "Locate video file…"}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {cameraVideoUrl && cameraOverlayEnabled ? (
                    <div
                      id="camera-overlay"
                      className={`absolute right-3 bottom-3 overflow-hidden border border-white/20 shadow-2xl ${
                        cameraOverlayShape === "circle" ? "rounded-full" : "rounded-2xl"
                      }`}
                      style={{
                        width: `${cameraOverlaySizePct}%`,
                        aspectRatio: "16 / 9",
                      }}
                    >
                      <video
                        ref={cameraVideoRef}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                      />
                    </div>
                  ) : null}
                </div>

                {/* Visual indicators for click-triggered zoom removed (kept zoom behavior). */}
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
              selectedZoomPoint={
                selectedClick
                  ? {
                      id: selectedClick.id,
                      tOut: selectedClick.tOut,
                      xNorm: selectedClick.xNorm,
                      yNorm: selectedClick.yNorm,
                      enabled: selectedClick.enabled !== false,
                      zoomModeOverride: selectedClick.zoomModeOverride,
                      zoomDurationOverride: selectedClick.zoomDurationOverride,
                      sourceIndex: selectedClick.sourceIndex,
                    }
                  : null
              }
              onUpdateSelectedZoomPoint={(patch) => {
                if (!selectedClick) return;
                updateSourceClick(selectedClick.sourceIndex, patch);
              }}
              onDeleteSelectedZoomPoint={() => {
                if (!selectedClick) return;
                deleteSourceClick(selectedClick.sourceIndex);
                toast.success("Deleted zoom point");
              }}
              handleExport={handleExport}
              cancelExport={cancelExport}
              isExporting={isExporting}
              exportProgress={exportProgress}
              exportStatusText={exportStatusText}
              showMenu={showMenu}
              setShowMenu={setShowMenu}
              cameraOverlayAvailable={Boolean(cameraVideoUrl)}
              cameraOverlayEnabled={cameraOverlayEnabled}
              setCameraOverlayEnabled={setCameraOverlayEnabled}
              cameraOverlayShape={cameraOverlayShape}
              setCameraOverlayShape={setCameraOverlayShape}
              cameraOverlaySizePct={cameraOverlaySizePct}
              setCameraOverlaySizePct={setCameraOverlaySizePct}
            />
          </div>

          <div className="pt-3 shrink-0">
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
              onTrimSegment={(segmentId, patch) => {
                setSegments((prev) =>
                  prev.map((s) => {
                    if (s.id !== segmentId) return s;
                    return trimSegment(s, patch, videoDuration) as CapcutSegment;
                  })
                );
              }}
              clickMarkers={clickMarkers}
              selectedClickMarkerId={selectedClickMarkerId}
              onSelectClickMarker={(id) => setSelectedClickMarkerId(id)}
              onMoveClickMarker={handleMoveClickMarker}
              audioTracks={audioTracks}
              onUpdateAudioTrack={(trackId, patch) => {
                setAudioTracks((prev) =>
                  prev.map((t) => (t.id === trackId ? { ...t, ...patch } : t))
                );
              }}
              pxPerSecond={timelinePxPerSecond}
              scrollSec={timelineScrollSec}
              onScrollSecChange={setTimelineScrollSec}
              onPxPerSecondChange={setTimelinePxPerSecond}
            />
          </div>
        </div>
      </main>
    </div>
  );
}


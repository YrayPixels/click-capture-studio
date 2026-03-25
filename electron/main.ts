import {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  session,
  desktopCapturer,
  shell,
  protocol,
  dialog,
} from "electron";
import path from "path";
import { performance } from "node:perf_hooks";
import { uIOhook } from "uiohook-napi";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";

// Make `clickstudio://` behave like a standard secure scheme so <video> can load it.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "clickstudio",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

type ClickEvent = {
  t: number;
  xNorm: number;
  yNorm: number;
};

let mainWindow: BrowserWindow | null = null;

let clickEvents: ClickEvent[] = [];
let clickStartPerfNow: number | null = null;
let clickCaptureRunning = false;
let clickListenerRegistered = false;
let lastClickCaptureError: { message: string } | null = null;

type DraftPayload = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  data: unknown;
};

type NativeExportSegment = {
  srcStart: number;
  srcEnd: number;
};

type NativeExportPayload = {
  inputPath: string;
  segments: NativeExportSegment[];
  format: "mp4" | "webm";
  quality: "720p" | "1080p" | "2160p";
  backgroundIndex?: number;
  paddingPct?: number;
  defaultZoomMode?: "off" | "low" | "medium" | "high";
  defaultZoomDuration?: number;
  showMenu?: boolean;
  clicks?: Array<{
    tOut: number;
    xNorm: number;
    yNorm: number;
    enabled?: boolean;
    zoomModeOverride?: "off" | "low" | "medium" | "high";
    zoomDurationOverride?: number;
  }>;
  cameraOverlay?: {
    enabled: boolean;
    path: string | null;
    sizePct: number;
    shape?: "rect" | "circle";
  };
};

type NativeExportProgress = {
  jobId: string;
  progress: number;
  status: "starting" | "encoding" | "done" | "error" | "cancelled";
  message?: string;
};

const exportJobs = new Map<string, { process: ChildProcessWithoutNullStreams; cancelled: boolean }>();

function getDraftsDir() {
  const docs = app.getPath("documents");
  return path.join(docs, "click-studio", "drafts");
}

function getRecordingsDir() {
  const docs = app.getPath("documents");
  return path.join(docs, "click-studio", "recordings");
}

function getVideosDir() {
  const docs = app.getPath("documents");
  return path.join(docs, "click-studio", "videos");
}

async function ensureDraftsDir() {
  const dir = getDraftsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function ensureRecordingsDir() {
  const dir = getRecordingsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function ensureVideosDir() {
  const dir = getVideosDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function qualityToSize(quality: NativeExportPayload["quality"]) {
  if (quality === "2160p") return { width: 3840, height: 2160 };
  if (quality === "1080p") return { width: 1920, height: 1080 };
  return { width: 1280, height: 720 };
}

function qualityToMp4Crf(quality: NativeExportPayload["quality"]) {
  if (quality === "2160p") return "18";
  if (quality === "1080p") return "20";
  return "23";
}

function escapeFilterNum(n: number) {
  if (!Number.isFinite(n)) return "0";
  return Math.max(0, n).toFixed(6);
}

function decodeStudioPath(raw: string) {
  if (raw.startsWith("file://")) {
    return decodeURIComponent(raw.replace(/^file:\/\//, ""));
  }
  if (raw.startsWith("clickstudio://")) {
    return decodeURIComponent(raw.replace(/^clickstudio:\/+/, "/"));
  }
  return raw;
}

async function detectHasAudioStream(inputPath: string): Promise<boolean> {
  if (!ffmpegPath) return false;
  return await new Promise<boolean>((resolve) => {
    const probe = spawn(ffmpegPath, ["-hide_banner", "-i", inputPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    probe.stderr.setEncoding("utf8");
    probe.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    probe.on("close", () => {
      resolve(/Audio:\s/i.test(stderr));
    });
    probe.on("error", () => resolve(false));
  });
}

function hexToRgb(hex: string) {
  const cleaned = hex.replace("#", "");
  const safe = cleaned.length === 3 ? cleaned.split("").map((c) => `${c}${c}`).join("") : cleaned;
  const value = Number.parseInt(safe, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function backgroundIndexToGradient(index: number) {
  const presets = [
    ["#3b3f6a", "#202a68", "#5f4dc9", "#a55fda"],
    ["#a88aff", "#7b6dff", "#5d8cff", "#75c9ff"],
    ["#72afff", "#6a87ff", "#8d6fff", "#b18eff"],
    ["#4a7dff", "#3d56f5", "#6f59ff", "#9b77ff"],
    ["#d98bff", "#965eff", "#5c63ff", "#8bd2ff"],
    ["#7e56ff", "#694df2", "#8b5df3", "#67a8ff"],
    ["#6d4fff", "#5c47ef", "#775eff", "#6ca5ff"],
    ["#4a64db", "#3f50bf", "#5d65d9", "#7ca3ff"],
    ["#8a74ff", "#6d5cef", "#7f6aff", "#99bcff"],
    ["#5163d8", "#444eb8", "#6e6ad7", "#89a9ff"],
  ] as const;
  if (!Number.isFinite(index)) return presets[0];
  const i = Math.max(0, Math.min(presets.length - 1, Math.round(index)));
  return presets[i];
}

function buildGradientBackgroundFilter(index: number, width: number, height: number, duration: number) {
  const [c00, c10, c01, c11] = backgroundIndexToGradient(index).map(hexToRgb);
  const rx = "X/W";
  const ry = "Y/H";
  const mix = (a: number, b: number, c: number, d: number) =>
    `${a}*(1-${rx})*(1-${ry})+${b}*${rx}*(1-${ry})+${c}*(1-${rx})*${ry}+${d}*${rx}*${ry}`;
  const radial = `0.18*exp(-6*(pow(${rx}-0.3,2)+pow(${ry}-0.25,2)))`;
  const re = `clip(${mix(c00.r, c10.r, c01.r, c11.r)}+255*${radial},0,255)`;
  const ge = `clip(${mix(c00.g, c10.g, c01.g, c11.g)}+190*${radial},0,255)`;
  const be = `clip(${mix(c00.b, c10.b, c01.b, c11.b)}+120*${radial},0,255)`;
  return `color=c=black:s=${width}x${height}:d=${escapeFilterNum(duration)},format=rgba,geq=r='${re}':g='${ge}':b='${be}':a='255'[bg]`;
}

function zoomModeToFactor(mode: "off" | "low" | "medium" | "high") {
  if (mode === "high") return 2.0;
  if (mode === "medium") return 1.5;
  if (mode === "low") return 1.25;
  return 1.0;
}

function buildNestedExpr(defaultExpr: string, conditions: Array<{ cond: string; value: string }>) {
  let expr = defaultExpr;
  for (let i = conditions.length - 1; i >= 0; i--) {
    const c = conditions[i];
    expr = `if(${c.cond},${c.value},${expr})`;
  }
  return expr;
}

function escapeFfmpegExpr(expr: string) {
  return expr.replaceAll(",", "\\,");
}

function buildEaseInOutCubicExpr(tExpr: string) {
  return `if(lt(${tExpr},0.5),4*pow(${tExpr},3),1-pow(-2*${tExpr}+2,3)/2)`;
}

function buildZoomWindowExpr(
  start: number,
  duration: number,
  xNorm: number,
  yNorm: number,
  maxZoom: number
) {
  const panLead = 0.18;
  const panTail = 0.18;
  const zoomWindow = Math.max(0.001, 1 - panLead - panTail);
  const p = `(t-${escapeFilterNum(start)})/${escapeFilterNum(duration)}`;
  const pClip = `clip(${p},0,1)`;
  const panInT = `clip((${pClip})/${escapeFilterNum(panLead)},0,1)`;
  const panOutT = `clip((1-(${pClip}))/${escapeFilterNum(panTail)},0,1)`;
  const panIn = buildEaseInOutCubicExpr(panInT);
  const panOut = buildEaseInOutCubicExpr(panOutT);
  const panFactor = `if(lt(${pClip},${escapeFilterNum(panLead)}),${panIn},if(gt(${pClip},${escapeFilterNum(
    1 - panTail
  )}),${panOut},1))`;
  const zoomT = `clip(((${pClip})-${escapeFilterNum(panLead)})/${escapeFilterNum(zoomWindow)},0,1)`;
  const zoomPhase = `if(lte(${zoomT},0.5),${zoomT}*2,(1-${zoomT})*2)`;
  const zoomEased = buildEaseInOutCubicExpr(zoomPhase);
  const scale = `1+${escapeFilterNum(maxZoom - 1)}*${zoomEased}`;
  const centerX = `${escapeFilterNum(0.5)}+${escapeFilterNum(xNorm - 0.5)}*${panFactor}`;
  const centerY = `${escapeFilterNum(0.5)}+${escapeFilterNum(yNorm - 0.5)}*${panFactor}`;
  return { scale, centerX, centerY };
}

// Enable screen-capture APIs in Electron renderer (especially on http://localhost dev origins).
app.commandLine.appendSwitch("enable-usermedia-screen-capturing");
app.commandLine.appendSwitch("allow-http-screen-capture");
app.commandLine.appendSwitch(
  "unsafely-treat-insecure-origin-as-secure",
  "http://localhost:8080,http://localhost:8081,http://localhost:8082"
);

function setClickCaptureRunning(next: boolean) {
  clickCaptureRunning = next;
}

function normalizeClick(x: number, y: number): { xNorm: number; yNorm: number } {
  const display = screen.getDisplayNearestPoint({ x, y });
  const b = display.bounds;
  const w = b.width || 1;
  const h = b.height || 1;
  const xNorm = Math.min(1, Math.max(0, (x - b.x) / w));
  const yNorm = Math.min(1, Math.max(0, (y - b.y) / h));
  return { xNorm, yNorm };
}

function startGlobalClickCapture() {
  clickEvents = [];
  clickStartPerfNow = performance.now();
  lastClickCaptureError = null;

  if (!clickCaptureRunning) {
    if (!clickListenerRegistered) {
      uIOhook.on("mousedown", (e) => {
        if (clickStartPerfNow == null) return;
        const t = (performance.now() - clickStartPerfNow) / 1000;
        if (t < 0) return;
        const { xNorm, yNorm } = normalizeClick(e.x, e.y);
        const evt = { t, xNorm, yNorm };
        clickEvents.push(evt);
        // Stream events to renderer so we can show a live click counter.
        mainWindow?.webContents.send("clicks:event", evt);
      });
      clickListenerRegistered = true;
    }
    try {
      uIOhook.start();
      setClickCaptureRunning(true);
      return { ok: true as const };
    } catch (e) {
      const msg =
        (e as { message?: string } | null)?.message ||
        "Failed to start global click capture. macOS may require Accessibility/Input Monitoring permission.";
      console.error("[clicks] failed to start uIOhook", e);
      lastClickCaptureError = { message: msg };
      setClickCaptureRunning(false);
      return { ok: false as const, error: { message: msg } };
    }
  }
  return { ok: true as const };
}

function stopGlobalClickCapture() {
  clickStartPerfNow = null;
  if (clickCaptureRunning) {
    // uIOhook doesn't expose a per-listener remove for anonymous fns,
    // so we just stop() and reset all listeners.
    uIOhook.stop();
    uIOhook.removeAllListeners("mousedown");
    // We removed the listener, so allow re-registering on next start.
    clickListenerRegistered = false;
    setClickCaptureRunning(false);
  }
  return clickEvents;
}

async function createWindow() {
  const preloadPath = path.join(__dirname, "../preload/preload.cjs");
  try {
    await fs.access(preloadPath);
  } catch (e) {
    console.error("[preload] preload file not found at", preloadPath, e);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // electron-vite outputs preload as `preload.cjs` (CommonJS).
      preload: preloadPath,
    },
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath2, error) => {
    console.error("[preload] error", { preloadPath: preloadPath2, error });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  // Allow the renderer to load local media files via a safe custom protocol.
  protocol.registerStreamProtocol("clickstudio", async (request, callback) => {
    try {
      const u = new URL(request.url);
      // `clickstudio:///Users/...` => pathname "/Users/..."
      // `clickstudio://Users/...`  => hostname "Users", pathname "/..." (missing leading segment)
      const rawPath = decodeURIComponent(u.pathname);
      const host = decodeURIComponent(u.hostname || "");
      const reconstructedHostPath =
        host && rawPath.startsWith("/") ? `/${host}${rawPath}` : null;
      const primaryPath = reconstructedHostPath ?? rawPath;

      const resolveCandidatePath = async () => {
        const candidates: string[] = [];

        // Most requests come in as absolute paths (e.g. /Users/...).
        candidates.push(primaryPath);

        // Some older drafts saved just a filename, which becomes `clickstudio:///recording-....webm`
        // and arrives here as `/recording-....webm`. Resolve those into our known Documents dirs.
        const looksLikeBareFilename =
          primaryPath.startsWith("/") &&
          !primaryPath.startsWith("/Users/") &&
          primaryPath.split("/").length === 2;
        if (looksLikeBareFilename) {
          const base = primaryPath.replace(/^\/+/, "");
          candidates.push(path.join(getVideosDir(), base));
          candidates.push(path.join(getRecordingsDir(), base));
        }

        for (const c of candidates) {
          try {
            const st = await fs.stat(c);
            return { path: c, size: st.size };
          } catch {
            // try next
          }
        }
        throw new Error(`clickstudio file not found: ${primaryPath}`);
      };

      const { path: filePath, size } = await resolveCandidatePath();

      const headers: Record<string, string> = {
        // Most of our captures are webm.
        "Content-Type": filePath.toLowerCase().endsWith(".webm") ? "video/webm" : "application/octet-stream",
        "Accept-Ranges": "bytes",
      };

      const rangeHeader =
        (request.headers?.Range as string | undefined) ??
        (request.headers?.range as string | undefined);

      if (rangeHeader) {
        // Example: "bytes=0-1023"
        const m = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader.trim());
        if (!m) {
          callback({ statusCode: 416, headers });
          return;
        }

        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : size - 1;

        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
          callback({ statusCode: 416, headers });
          return;
        }

        const safeEnd = Math.min(end, size - 1);
        const chunkSize = safeEnd - start + 1;

        headers["Content-Range"] = `bytes ${start}-${safeEnd}/${size}`;
        headers["Content-Length"] = String(chunkSize);

        callback({
          statusCode: 206,
          headers,
          data: createReadStream(filePath, { start, end: safeEnd }),
        });
        return;
      }

      headers["Content-Length"] = String(size);
      callback({
        statusCode: 200,
        headers,
        data: createReadStream(filePath),
      });
    } catch (e) {
      console.error("[protocol] clickstudio failed", e);
      callback({ statusCode: 404 });
    }
  });

  // Broader permission handling than just request prompts. Electron can deny access
  // at multiple stages (check/request/device), and dev origins can be treated as insecure.
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, _details) => {
    if (permission === "media") return true;
    return false;
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    // Allow media permission prompts in dev (camera/mic/screen).
    if (permission === "media") return callback(true);
    callback(false);
  });

  session.defaultSession.setDevicePermissionHandler((_details) => {
    // Allow camera/microphone device usage in dev.
    return true;
  });

  // Electron requires an explicit handler to pick which screen/window to share.
  // Without this, getDisplayMedia() can fail in the Electron renderer while it works in Chrome.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      const screenSource = sources.find((s) => s.id.startsWith("screen:")) ?? sources[0];
      if (!screenSource) return callback({});
      callback({ video: screenSource });
    } catch (e) {
      console.error("[recording] setDisplayMediaRequestHandler failed", e);
      callback({});
    }
  });

  ipcMain.handle("desktop:sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnailDataUrl: s.thumbnail.toDataURL(),
    }));
  });

  ipcMain.handle("clicks:status", () => {
    return {
      running: clickCaptureRunning,
      lastError: lastClickCaptureError?.message ?? null,
    };
  });

  ipcMain.handle("system:openScreenRecordingPreferences", async () => {
    if (process.platform !== "darwin") return false;
    // Opens System Settings > Privacy & Security > Screen Recording (macOS)
    // Works on most modern macOS versions; if it fails, user can still navigate manually.
    try {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      );
      return true;
    } catch (e) {
      console.error("[recording] failed to open Screen Recording preferences", e);
      return false;
    }
  });

  ipcMain.handle("system:openAccessibilityPreferences", async () => {
    if (process.platform !== "darwin") return false;
    try {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
      );
      return true;
    } catch (e) {
      console.error("[clicks] failed to open Accessibility preferences", e);
      return false;
    }
  });

  ipcMain.handle("system:openInputMonitoringPreferences", async () => {
    if (process.platform !== "darwin") return false;
    try {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
      );
      return true;
    } catch (e) {
      console.error("[clicks] failed to open Input Monitoring preferences", e);
      return false;
    }
  });

  ipcMain.handle("system:pickVideoFile", async () => {
    const res = await dialog.showOpenDialog({
      title: "Select a video file",
      properties: ["openFile"],
      filters: [
        { name: "Video", extensions: ["webm", "mp4", "mov"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (res.canceled) return { canceled: true as const };
    const filePath = res.filePaths?.[0];
    if (!filePath) return { canceled: true as const };
    return { canceled: false as const, path: filePath };
  });

  ipcMain.handle("system:revealInFolder", async (_event, payload: { path: string }) => {
    try {
      shell.showItemInFolder(payload.path);
      return { ok: true as const };
    } catch (e) {
      const msg = (e as { message?: string } | null)?.message || "Failed to reveal file";
      return { ok: false as const, error: { message: msg } };
    }
  });

  ipcMain.handle("clicks:start", () => {
    return startGlobalClickCapture();
  });

  ipcMain.handle("clicks:stop", () => {
    const events = stopGlobalClickCapture();
    return events;
  });

  ipcMain.handle("clicks:get", () => {
    return clickEvents;
  });

  ipcMain.handle(
    "recording:save",
    async (_event, payload: { suggestedName: string; data: Uint8Array }) => {
      try {
        const dir = await ensureVideosDir();
        const safeName = payload.suggestedName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = path.join(dir, safeName);
        await fs.writeFile(filePath, payload.data);
        console.info("[recording] saved", { filePath, bytes: payload.data?.byteLength ?? 0 });
        return { ok: true as const, path: filePath };
      } catch (e) {
        const msg = (e as { message?: string } | null)?.message || "Failed to save recording";
        console.error("[recording] save failed", e);
        return { ok: false as const, error: { message: msg } };
      }
    }
  );

  ipcMain.handle("export:runNative", async (_event, payload: NativeExportPayload) => {
    if (!ffmpegPath) {
      return { ok: false as const, error: { message: "ffmpeg binary not available" } };
    }

    const inputPath = decodeStudioPath(payload.inputPath);
    const segments = (payload.segments ?? []).filter(
      (s) =>
        Number.isFinite(s.srcStart) &&
        Number.isFinite(s.srcEnd) &&
        s.srcEnd > s.srcStart + 0.01
    );
    if (!segments.length) {
      return { ok: false as const, error: { message: "No valid segments to export" } };
    }

    const outputDir = await ensureVideosDir();
    const ext = payload.format === "webm" ? "webm" : "mp4";
    const outPath = path.join(
      outputDir,
      `export-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`
    );

    const totalDuration = segments.reduce((acc, s) => acc + (s.srcEnd - s.srcStart), 0);
    const { width, height } = qualityToSize(payload.quality);

    const hasAudio = await detectHasAudioStream(inputPath);
    const backgroundIndex = payload.backgroundIndex ?? 0;
    const paddingScale = Math.max(0.5, Math.min(1, (payload.paddingPct ?? 100) / 100));
    const showMenu = payload.showMenu !== false;
    const defaultZoomMode = payload.defaultZoomMode ?? "medium";
    const defaultZoomDuration = Math.max(0.1, payload.defaultZoomDuration ?? 1.0);
    const clickWindows = (payload.clicks ?? [])
      .filter((c) => Number.isFinite(c.tOut) && Number.isFinite(c.xNorm) && Number.isFinite(c.yNorm))
      .map((c) => {
        const mode = c.zoomModeOverride ?? defaultZoomMode;
        const duration = Math.max(0.1, c.zoomDurationOverride ?? defaultZoomDuration);
        const start = Math.max(0, c.tOut);
        const end = Math.max(start + 0.05, start + duration);
        const zoom = zoomModeToFactor(mode);
        const x = Math.max(0, Math.min(1, c.xNorm));
        const y = Math.max(0, Math.min(1, c.yNorm));
        return { start, end, zoom, x, y, duration, enabled: c.enabled !== false };
      })
      .filter((c) => c.enabled && c.zoom > 1.001);
    const clickWindowsLastWins = [...clickWindows].reverse();
    const scaleExpr = buildNestedExpr(
      "1",
      clickWindowsLastWins.map((z) => {
        const ex = buildZoomWindowExpr(z.start, z.duration, z.x, z.y, z.zoom);
        return {
          cond: `between(t,${escapeFilterNum(z.start)},${escapeFilterNum(z.end)})`,
          value: ex.scale,
        };
      })
    );
    const centerXExpr = buildNestedExpr(
      "0.5",
      clickWindowsLastWins.map((z) => {
        const ex = buildZoomWindowExpr(z.start, z.duration, z.x, z.y, z.zoom);
        return {
          cond: `between(t,${escapeFilterNum(z.start)},${escapeFilterNum(z.end)})`,
          value: ex.centerX,
        };
      })
    );
    const centerYExpr = buildNestedExpr(
      "0.5",
      clickWindowsLastWins.map((z) => {
        const ex = buildZoomWindowExpr(z.start, z.duration, z.x, z.y, z.zoom);
        return {
          cond: `between(t,${escapeFilterNum(z.start)},${escapeFilterNum(z.end)})`,
          value: ex.centerY,
        };
      })
    );
    const scaleExprEscaped = escapeFfmpegExpr(scaleExpr);
    const centerXExprEscaped = escapeFfmpegExpr(centerXExpr);
    const centerYExprEscaped = escapeFfmpegExpr(centerYExpr);

    const cameraOverlayEnabled = Boolean(payload.cameraOverlay?.enabled && payload.cameraOverlay?.path);
    let cameraPath: string | null = null;
    if (cameraOverlayEnabled && payload.cameraOverlay?.path) {
      cameraPath = decodeStudioPath(payload.cameraOverlay.path);
      try {
        await fs.access(cameraPath);
      } catch {
        cameraPath = null;
      }
    }
    const useCameraOverlay = Boolean(cameraPath);
    const cameraSizePct = Math.max(10, Math.min(40, payload.cameraOverlay?.sizePct ?? 22));
    const cameraShape = payload.cameraOverlay?.shape === "circle" ? "circle" : "rect";
    const videoParts: string[] = [];
    const audioParts: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      videoParts.push(
        `[0:v]trim=start=${escapeFilterNum(s.srcStart)}:end=${escapeFilterNum(
          s.srcEnd
        )},setpts=PTS-STARTPTS[v${i}]`
      );
      if (hasAudio) {
        audioParts.push(
          `[0:a]atrim=start=${escapeFilterNum(s.srcStart)}:end=${escapeFilterNum(
            s.srcEnd
          )},asetpts=PTS-STARTPTS[a${i}]`
        );
      }
    }

    const vConcatInputs = segments.map((_, i) => `[v${i}]`).join("");
    const frameW = Math.max(2, Math.round((width * paddingScale) / 2) * 2);
    const frameH = Math.max(2, Math.round((height * paddingScale) / 2) * 2);
    const frameX = Math.max(0, Math.round((width - frameW) / 2));
    const frameY = Math.max(0, Math.round((height - frameH) / 2));
    const menuH = Math.max(20, Math.round(frameH * 0.06));
    const dot = Math.max(6, Math.round(frameH * 0.015));
    const dotY = frameY + Math.max(6, Math.round((menuH - dot) / 2));

    const filterParts = [
      ...videoParts,
      `${vConcatInputs}concat=n=${segments.length}:v=1:a=0[vcat]`,
      `[vcat]scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease,setsar=1[vfit]`,
      `[vfit]drawbox=x=0:y=0:w=iw:h=ih:color=#4b5563@0.92:t=2[vframed0]`,
    ];
    if (showMenu) {
      filterParts.push(
        `[vframed0]drawbox=x=0:y=0:w=iw:h=${menuH}:color=#1f2937@0.96:t=fill,drawbox=x=14:y=${Math.max(
          8,
          Math.round((menuH - dot) / 2)
        )}:w=${dot}:h=${dot}:color=#ef4444@1:t=fill,drawbox=x=${18 + dot}:y=${Math.max(
          8,
          Math.round((menuH - dot) / 2)
        )}:w=${dot}:h=${dot}:color=#fde047@1:t=fill,drawbox=x=${22 + dot * 2}:y=${Math.max(
          8,
          Math.round((menuH - dot) / 2)
        )}:w=${dot}:h=${dot}:color=#22c55e@1:t=fill[vframed1]`
      );
    } else {
      filterParts.push("[vframed0]null[vframed1]");
    }
    if (hasAudio) {
      const aConcatInputs = segments.map((_, i) => `[a${i}]`).join("");
      filterParts.push(...audioParts);
      filterParts.push(`${aConcatInputs}concat=n=${segments.length}:v=0:a=1[acat]`);
    }
    if (useCameraOverlay) {
      const camWExpr = `trunc(${width}*${(cameraSizePct / 100).toFixed(4)}/2)*2`;
      if (cameraShape === "circle") {
        filterParts.push(
          `[1:v]scale=w=${camWExpr}:h=-2,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2),1),255,0)'[cam]`
        );
      } else {
        filterParts.push(`[1:v]scale=w=${camWExpr}:h=-2[cam]`);
      }
      filterParts.push(`[vframed1][cam]overlay=W-w-24:H-h-24[vframed2]`);
    } else {
      filterParts.push(`[vframed1]null[vframed2]`);
    }
    filterParts.push(
      `[vframed2]crop=w=iw/(${scaleExprEscaped}):h=ih/(${scaleExprEscaped}):x=(iw-iw/(${scaleExprEscaped}))*(${centerXExprEscaped}):y=(ih-ih/(${scaleExprEscaped}))*(${centerYExprEscaped}),scale=iw:ih[vzoom]`
    );
    filterParts.push(`[vzoom]scale=w=${frameW}:h=${frameH}[vinner]`);
    filterParts.push(
      `${buildGradientBackgroundFilter(backgroundIndex, width, height, totalDuration)}`
    );
    filterParts.push(
      `[bg][vinner]overlay=x=${frameX}:y=${frameY}:shortest=1[vout]`
    );
    const filterComplex = filterParts.join(";");

    const args: string[] = [
      "-y",
      "-i",
      inputPath,
    ];
    if (useCameraOverlay && cameraPath) {
      args.push("-i", cameraPath);
    }
    args.push(
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-progress",
      "pipe:1",
      "-nostats"
    );
    if (hasAudio) {
      args.push("-map", "[acat]");
    }

    if (payload.format === "webm") {
      args.push("-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0");
      if (hasAudio) args.push("-c:a", "libopus");
      else args.push("-an");
    } else {
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        qualityToMp4Crf(payload.quality),
        "-pix_fmt",
        "yuv420p"
      );
      if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k");
      else args.push("-an");
    }
    args.push(outPath);

    const jobId = randomUUID();
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    exportJobs.set(jobId, { process: proc, cancelled: false });

    const sendProgress = (p: NativeExportProgress) => {
      mainWindow?.webContents.send("export:progress", p);
    };
    sendProgress({ jobId, progress: 1, status: "starting", message: "Preparing export..." });

    proc.stdout.setEncoding("utf8");
    let stdoutBuf = "";
    proc.stdout.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;
        const [k, v] = line.split("=");
        if (k === "out_time_ms") {
          const outMs = Number(v);
          if (Number.isFinite(outMs) && totalDuration > 0) {
            const p = Math.max(
              1,
              Math.min(99, Math.round((outMs / 1_000_000 / totalDuration) * 100))
            );
            sendProgress({ jobId, progress: p, status: "encoding", message: "Encoding..." });
          }
        }
      }
    });

    proc.stderr.setEncoding("utf8");
    let stderrBuf = "";
    proc.stderr.on("data", (chunk: string) => {
      stderrBuf += chunk;
    });

    const result = await new Promise<
      | { ok: true; path: string; cancelled: boolean }
      | { ok: false; error: { message: string }; cancelled: boolean }
    >((resolve) => {
      proc.on("close", (code) => {
        const job = exportJobs.get(jobId);
        const cancelled = Boolean(job?.cancelled);
        exportJobs.delete(jobId);

        if (cancelled) {
          sendProgress({ jobId, progress: 0, status: "cancelled", message: "Export cancelled" });
          resolve({ ok: false, error: { message: "Export cancelled" }, cancelled: true });
          return;
        }

        if (code === 0) {
          sendProgress({ jobId, progress: 100, status: "done", message: "Export completed" });
          resolve({ ok: true, path: outPath, cancelled: false });
          return;
        }

        const msg = stderrBuf.split("\n").slice(-8).join("\n").trim() || "Export failed";
        sendProgress({ jobId, progress: 0, status: "error", message: msg });
        resolve({ ok: false, error: { message: msg }, cancelled: false });
      });
    });

    if (result.ok) {
      return { ok: true as const, path: result.path, jobId };
    }
    return { ok: false as const, error: result.error, jobId, cancelled: result.cancelled };
  });

  ipcMain.handle("export:cancelNative", async (_event, payload: { jobId: string }) => {
    const job = exportJobs.get(payload.jobId);
    if (!job) return { ok: false as const };
    job.cancelled = true;
    try {
      job.process.kill("SIGTERM");
      return { ok: true as const };
    } catch {
      return { ok: false as const };
    }
  });

  ipcMain.handle("drafts:list", async () => {
    const dir = await ensureDraftsDir();
    const entries = await fs.readdir(dir).catch(() => []);
    const drafts: Array<{ id: string; title: string; updatedAt: string; createdAt?: string }> = [];

    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      try {
        const raw = await fs.readFile(file, "utf8");
        const parsed = JSON.parse(raw) as Partial<DraftPayload>;
        const id = String(parsed.id ?? name.replace(/\.json$/i, ""));
        const title = String(parsed.title ?? "Untitled draft");
        const updatedAt = String(parsed.updatedAt ?? parsed.createdAt ?? new Date(0).toISOString());
        const createdAt = parsed.createdAt ? String(parsed.createdAt) : undefined;
        drafts.push({ id, title, updatedAt, createdAt });
      } catch {
        // ignore unreadable draft
      }
    }

    drafts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return drafts;
  });

  ipcMain.handle("drafts:load", async (_event, payload: { id: string }) => {
    const dir = await ensureDraftsDir();
    const safeId = payload.id.replace(/[^a-zA-Z0-9_-]/g, "");
    const file = path.join(dir, `${safeId}.json`);
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as DraftPayload;
    return parsed;
  });

  ipcMain.handle("drafts:save", async (_event, payload: DraftPayload) => {
    const dir = await ensureDraftsDir();
    const safeId = payload.id.replace(/[^a-zA-Z0-9_-]/g, "");
    const file = path.join(dir, `${safeId}.json`);

    const next: DraftPayload = {
      id: safeId,
      title: String(payload.title ?? "Untitled draft"),
      createdAt: String(payload.createdAt ?? new Date().toISOString()),
      updatedAt: String(payload.updatedAt ?? new Date().toISOString()),
      data: payload.data ?? null,
    };

    await fs.writeFile(file, JSON.stringify(next, null, 2), "utf8");
    return { ok: true as const, id: safeId };
  });

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});


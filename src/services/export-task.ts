import { exportVideo } from "@/utils/videoExport";

export type ExportTask = {
  promise: Promise<void>;
  cancel: () => void;
};

type ExportOptions = Parameters<typeof exportVideo>[5];

export function createExportTask(
  videoRef: HTMLVideoElement,
  videoContainer: HTMLElement,
  format: string,
  quality: string,
  onProgress: (progress: number) => void,
  options?: ExportOptions
): ExportTask {
  const controller = new AbortController();

  const promise = exportVideo(
    videoRef,
    videoContainer,
    format,
    quality,
    (progress) => {
      if (controller.signal.aborted) return;
      onProgress(progress);
    },
    {
      ...options,
      signal: controller.signal,
    }
  );

  return {
    promise,
    cancel: () => {
      controller.abort();
    },
  };
}

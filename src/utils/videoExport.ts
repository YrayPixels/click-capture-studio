// import html2canvas from "html2canvas";
// import { toast } from "sonner";

// export const formatTimeDisplay = (seconds: number): string => {
//   if (isNaN(seconds) || !isFinite(seconds)) {
//     return "00:00.00";
//   }
//   const mins = Math.floor(seconds / 60);
//   const secs = Math.floor(seconds % 60);
//   const ms = Math.floor((seconds % 1) * 100);
//   return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
// };

// export const exportVideo = async (
//   videoRef: HTMLVideoElement,
//   videoContainer: HTMLElement,
//   format: string,
//   quality: string,
//   onProgress: (progress: number) => void
// ): Promise<void> => {
//   try {
//     if (!videoRef || !videoContainer) {
//       toast.error("No video available to export");
//       return;
//     }

//     onProgress(5);
//     toast.info("Preparing for export...");

//     const wasPlaying = !videoRef.paused;
//     if (wasPlaying) videoRef.pause();

//     // Reset video to beginning
//     videoRef.currentTime = 0;
//     await new Promise(resolve => setTimeout(resolve, 500));

//     // Calculate high resolution canvas dimensions based on quality setting
//     const scaleFactor = quality === '2160p' ? 4 : quality === '1080p' ? 2.5 : 2;
//     const canvas = document.createElement('canvas');
//     const containerWidth = videoContainer.clientWidth;
//     const containerHeight = videoContainer.clientHeight;

//     // Ensure dimensions are even (required by some codecs)
//     canvas.width = Math.floor(containerWidth * scaleFactor / 2) * 2;
//     canvas.height = Math.floor(containerHeight * scaleFactor / 2) * 2;

//     const ctx = canvas.getContext('2d', { alpha: false });

//     if (!ctx) {
//       toast.error("Failed to create canvas context");
//       if (wasPlaying) videoRef.play();
//       return;
//     }

//     // Higher bitrates for better quality
//     const bitrate = quality === '2160p' ? 30000000 : quality === '1080p' ? 15000000 : 8000000;

//     // Use higher framerate for smoother video
//     const fps = 30;
//     const stream = canvas.captureStream(fps);

//     // Force appropriate codec based on format
//     let mimeType;
//     if (format === 'mp4') {
//       // Try different codecs for MP4
//       const possibleMimeTypes = [
//         'video/mp4;codecs=h264',
//         'video/mp4;codecs=avc1.42E01E',
//         'video/mp4'
//       ];

//       for (const type of possibleMimeTypes) {
//         if (MediaRecorder.isTypeSupported(type)) {
//           mimeType = type;
//           break;
//         }
//       }
//     } else if (format === 'webm') {
//       // Try different codecs for WebM
//       const possibleMimeTypes = [
//         'video/webm;codecs=vp9',
//         'video/webm;codecs=vp8',
//         'video/webm'
//       ];

//       for (const type of possibleMimeTypes) {
//         if (MediaRecorder.isTypeSupported(type)) {
//           mimeType = type;
//           break;
//         }
//       }
//     }

//     // Configure MediaRecorder with the best available codec
//     let mediaRecorder;
//     try {
//       const options: MediaRecorderOptions = {
//         videoBitsPerSecond: bitrate
//       };

//       if (mimeType) {
//         options.mimeType = mimeType;
//       }

//       mediaRecorder = new MediaRecorder(stream, options);
//       console.log(`Using codec: ${mediaRecorder.mimeType}`);
//     } catch (e) {
//       console.error("MediaRecorder error:", e);
//       // Fallback to default settings
//       mediaRecorder = new MediaRecorder(stream);
//       console.log(`Fallback codec: ${mediaRecorder.mimeType}`);
//     }

//     const chunks: BlobPart[] = [];

//     mediaRecorder.ondataavailable = (e) => {
//       if (e.data.size > 0) {
//         chunks.push(e.data);
//       }
//     };

//     onProgress(10);
//     toast.info("Starting video capture...");

//     // Get video position and dimensions
//     const videoRect = videoRef.getBoundingClientRect();
//     const containerRect = videoContainer.getBoundingClientRect();
//     const videoPositionX = videoRect.left - containerRect.left;
//     const videoPositionY = videoRect.top - containerRect.top;
//     const videoWidth = videoRef.offsetWidth;
//     const videoHeight = videoRef.offsetHeight;

//     // Store original video styles
//     const originalVideoStyles = {
//       display: videoRef.style.display,
//       visibility: videoRef.style.visibility,
//       opacity: videoRef.style.opacity
//     };

//     return new Promise((resolve, reject) => {
//       mediaRecorder.onstop = async () => {
//         try {
//           onProgress(95);
//           toast.info("Finalizing export...");

//           // Restore original video styles
//           videoRef.style.display = originalVideoStyles.display;
//           videoRef.style.visibility = originalVideoStyles.visibility;
//           videoRef.style.opacity = originalVideoStyles.opacity;

//           // Create appropriate MIME type for the output format
//           const outputMimeType = format === 'webm' ? 'video/webm' : 'video/mp4';

//           // Create blob with the correct type
//           const blob = new Blob(chunks, { type: outputMimeType });

//           if (blob.size === 0) {
//             toast.error("Export failed: No data recorded");
//             if (wasPlaying) videoRef.play();
//             reject(new Error("No data recorded"));
//             return;
//           }

//           onProgress(100);
//           const fileName = `screen-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${format}`;
//           const url = window.URL.createObjectURL(blob);

//           // Create a download link and trigger it
//           const a = document.createElement('a');
//           a.href = url;
//           a.download = fileName;
//           a.style.display = 'none';
//           document.body.appendChild(a);
//           a.click();

//           // Clean up
//           setTimeout(() => {
//             window.URL.revokeObjectURL(url);
//             document.body.removeChild(a);
//             if (wasPlaying) videoRef.play();
//           }, 100);

//           toast.success(`Export completed: ${fileName}`);
//           resolve();
//         } catch (error) {
//           console.error("Error in mediaRecorder.onstop:", error);
//           toast.error("Export failed: Error processing video");

//           // Restore original video styles
//           videoRef.style.display = originalVideoStyles.display;
//           videoRef.style.visibility = originalVideoStyles.visibility;
//           videoRef.style.opacity = originalVideoStyles.opacity;

//           if (wasPlaying) videoRef.play();
//           reject(error);
//         }
//       };

//       mediaRecorder.onerror = (event) => {
//         console.error("MediaRecorder error:", event);
//         toast.error("Error during recording");

//         // Restore original video styles
//         videoRef.style.display = originalVideoStyles.display;
//         videoRef.style.visibility = originalVideoStyles.visibility;
//         videoRef.style.opacity = originalVideoStyles.opacity;

//         if (wasPlaying) videoRef.play();
//         reject(new Error("MediaRecorder error"));
//       };

//       try {
//         // Start recording
//         mediaRecorder.start(1000); // Collect data every second
//         videoRef.play();

//         let lastProgress = 10;
//         const totalDuration = videoRef.duration || 0;
//         const progressInterval = setInterval(() => {
//           if (videoRef && totalDuration > 0) {
//             const currentProgress = 10 + (videoRef.currentTime / totalDuration) * 85;
//             lastProgress = Math.min(95, currentProgress);
//             onProgress(Math.floor(lastProgress));
//           }
//         }, 500);

//         const captureFrame = async () => {
//           try {
//             if (videoRef.paused || videoRef.ended) {
//               clearInterval(progressInterval);
//               setTimeout(() => {
//                 try {
//                   mediaRecorder.stop();
//                 } catch (e) {
//                   console.error("Error stopping mediaRecorder:", e);
//                   reject(e);
//                 }
//               }, 500);
//               return;
//             }

//             // For each frame, capture the entire container with the video playing
//             const containerSnapshot = await html2canvas(videoContainer, {
//               logging: false,
//               useCORS: true,
//               allowTaint: true,
//               backgroundColor: null,
//               scale: scaleFactor,
//               ignoreElements: (element) => false, // Don't ignore any elements
//               onclone: (clonedDoc, clonedElement) => {
//                 // Find the cloned video element and ensure it's visible
//                 const clonedVideos = clonedElement.querySelectorAll('video');
//                 clonedVideos.forEach(clonedVideo => {
//                   // Make sure the cloned video is visible and has opacity
//                   clonedVideo.style.visibility = 'visible';
//                   clonedVideo.style.display = 'block';
//                   clonedVideo.style.opacity = '1';
//                 });
//               }
//             });

//             // Clear canvas and draw the complete container snapshot
//             ctx.fillStyle = '#000000';
//             ctx.fillRect(0, 0, canvas.width, canvas.height);
//             ctx.drawImage(containerSnapshot, 0, 0, canvas.width, canvas.height);

//             // Now draw the high-quality video directly on top
//             // Calculate the scaled position and dimensions for the video
//             const scaledVideoX = videoPositionX * scaleFactor;
//             const scaledVideoY = videoPositionY * scaleFactor;
//             const scaledVideoWidth = videoWidth * scaleFactor;
//             const scaledVideoHeight = videoHeight * scaleFactor;

//             // Draw the video directly at high quality
//             ctx.drawImage(
//               videoRef,
//               scaledVideoX,
//               scaledVideoY,
//               scaledVideoWidth,
//               scaledVideoHeight
//             );

//             // Request next frame
//             requestAnimationFrame(captureFrame);
//           } catch (err) {
//             console.error("Error capturing frame:", err);
//             clearInterval(progressInterval);
//             toast.error("Export failed: Error capturing frames");

//             // Restore original video styles
//             videoRef.style.display = originalVideoStyles.display;
//             videoRef.style.visibility = originalVideoStyles.visibility;
//             videoRef.style.opacity = originalVideoStyles.opacity;

//             if (wasPlaying) videoRef.play();
//             reject(err);
//           }
//         };

//         // Start capturing frames
//         captureFrame().catch(err => {
//           console.error("Error in captureFrame:", err);
//           clearInterval(progressInterval);
//           toast.error("Export failed: Error initiating capture");

//           // Restore original video styles
//           videoRef.style.display = originalVideoStyles.display;
//           videoRef.style.visibility = originalVideoStyles.visibility;
//           videoRef.style.opacity = originalVideoStyles.opacity;

//           if (wasPlaying) videoRef.play();
//           reject(err);
//         });

//         // Set a maximum recording time as a safeguard
//         setTimeout(() => {
//           if (mediaRecorder.state === 'recording') {
//             mediaRecorder.stop();
//           }
//         }, (totalDuration * 1000) + 5000); // Video duration plus 5 seconds buffer

//       } catch (error) {
//         console.error("Error starting mediaRecorder:", error);
//         toast.error("Export failed: Could not start recording");

//         // Restore original video styles
//         videoRef.style.display = originalVideoStyles.display;
//         videoRef.style.visibility = originalVideoStyles.visibility;
//         videoRef.style.opacity = originalVideoStyles.opacity;

//         if (wasPlaying) videoRef.play();
//         reject(error);
//       }
//     });
//   } catch (error) {
//     console.error('Export failed:', error);
//     toast.error('Failed to export video');
//     throw error;
//   }
// };


import html2canvas from "html2canvas";
import { toast } from "sonner";

export const formatTimeDisplay = (seconds: number): string => {
  if (isNaN(seconds) || !isFinite(seconds)) {
    return "00:00.00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
};

export const exportVideo = async (
  videoRef: HTMLVideoElement,
  videoContainer: HTMLElement,
  format: string,
  quality: string,
  onProgress: (progress: number) => void,
  options?: {
    cameraVideoEl?: HTMLVideoElement | null;
    cameraOverlayEl?: HTMLElement | null;
    cameraShape?: "rect" | "circle";
    signal?: AbortSignal;
  }
): Promise<void> => {
  try {
    if (!videoRef || !videoContainer) {
      toast.error("No video available to export");
      return;
    }

    onProgress(5);
    toast.info("Preparing for export...");

    const wasPlaying = !videoRef.paused;
    if (wasPlaying) videoRef.pause();

    // Reset video to beginning
    videoRef.currentTime = 0;
    await new Promise(resolve => setTimeout(resolve, 500));

    // Calculate high resolution canvas dimensions based on quality setting
    const scaleFactor = quality === '2160p' ? 4 : quality === '1080p' ? 2.5 : 2;

    // Use the container's dimensions for the canvas to properly bound the export
    const containerWidth = videoContainer.clientWidth;
    const containerHeight = videoContainer.clientHeight;

    // Ensure dimensions are even (required by some codecs)
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(containerWidth * scaleFactor / 2) * 2;
    canvas.height = Math.floor(containerHeight * scaleFactor / 2) * 2;

    const ctx = canvas.getContext('2d', { alpha: false });

    if (!ctx) {
      toast.error("Failed to create canvas context");
      if (wasPlaying) videoRef.play();
      return;
    }

    // Higher bitrates for better quality
    const bitrate = quality === '2160p' ? 30000000 : quality === '1080p' ? 15000000 : 8000000;

    // Use higher framerate for smoother video
    const fps = 30;
    const stream = canvas.captureStream(fps);

    // Force appropriate codec based on format
    let mimeType;
    if (format === 'mp4') {
      // Try different codecs for MP4
      const possibleMimeTypes = [
        'video/mp4;codecs=h264',
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4'
      ];

      for (const type of possibleMimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
    } else if (format === 'webm') {
      // Try different codecs for WebM
      const possibleMimeTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];

      for (const type of possibleMimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
    }

    // Configure MediaRecorder with the best available codec
    let mediaRecorder;
    try {
      const options: MediaRecorderOptions = {
        videoBitsPerSecond: bitrate
      };

      if (mimeType) {
        options.mimeType = mimeType;
      }

      mediaRecorder = new MediaRecorder(stream, options);
      console.log(`Using codec: ${mediaRecorder.mimeType}`);
    } catch (e) {
      console.error("MediaRecorder error:", e);
      // Fallback to default settings
      mediaRecorder = new MediaRecorder(stream);
      console.log(`Fallback codec: ${mediaRecorder.mimeType}`);
    }

    const chunks: BlobPart[] = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    onProgress(10);
    toast.info("Starting video capture...");

    // Get video position and dimensions relative to container
    const videoRect = videoRef.getBoundingClientRect();
    const containerRect = videoContainer.getBoundingClientRect();

    // Calculate video position within container
    const videoPositionX = videoRect.left - containerRect.left;
    const videoPositionY = videoRect.top - containerRect.top;
    const videoWidth = videoRef.offsetWidth;
    const videoHeight = videoRef.offsetHeight;

    const overlayEl = options?.cameraOverlayEl ?? null;
    const cameraEl = options?.cameraVideoEl ?? null;
    const cameraShape = options?.cameraShape ?? "rect";

    // Store original video styles
    const originalVideoStyles = {
      display: videoRef.style.display,
      visibility: videoRef.style.visibility,
      opacity: videoRef.style.opacity
    };

    return new Promise((resolve, reject) => {
      const rejectIfAborted = () => {
        if (!options?.signal?.aborted) return false;
        reject(new Error("Export cancelled"));
        return true;
      };

      if (rejectIfAborted()) return;

      mediaRecorder.onstop = async () => {
        try {
          if (options?.signal?.aborted) {
            reject(new Error("Export cancelled"));
            return;
          }
          onProgress(95);
          toast.info("Finalizing export...");

          // Restore original video styles
          videoRef.style.display = originalVideoStyles.display;
          videoRef.style.visibility = originalVideoStyles.visibility;
          videoRef.style.opacity = originalVideoStyles.opacity;

          // Create appropriate MIME type for the output format
          const outputMimeType = format === 'webm' ? 'video/webm' : 'video/mp4';

          // Create blob with the correct type
          const blob = new Blob(chunks, { type: outputMimeType });

          if (blob.size === 0) {
            toast.error("Export failed: No data recorded");
            if (wasPlaying) videoRef.play();
            reject(new Error("No data recorded"));
            return;
          }

          onProgress(100);
          const fileName = `screen-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${format}`;
          const url = window.URL.createObjectURL(blob);

          // Create a download link and trigger it
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();

          // Clean up
          setTimeout(() => {
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            if (wasPlaying) videoRef.play();
          }, 100);

          toast.success(`Export completed: ${fileName}`);
          resolve();
        } catch (error) {
          console.error("Error in mediaRecorder.onstop:", error);
          toast.error("Export failed: Error processing video");

          // Restore original video styles
          videoRef.style.display = originalVideoStyles.display;
          videoRef.style.visibility = originalVideoStyles.visibility;
          videoRef.style.opacity = originalVideoStyles.opacity;

          if (wasPlaying) videoRef.play();
          reject(error);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
        toast.error("Error during recording");

        // Restore original video styles
        videoRef.style.display = originalVideoStyles.display;
        videoRef.style.visibility = originalVideoStyles.visibility;
        videoRef.style.opacity = originalVideoStyles.opacity;

        if (wasPlaying) videoRef.play();
        reject(new Error("MediaRecorder error"));
      };

      try {
        // Start recording
        mediaRecorder.start(1000); // Collect data every second
        videoRef.play();

        let lastProgress = 10;
        const totalDuration = videoRef.duration || 0;
        const progressInterval = setInterval(() => {
          if (options?.signal?.aborted) return;
          if (videoRef && totalDuration > 0) {
            const currentProgress = 10 + (videoRef.currentTime / totalDuration) * 85;
            lastProgress = Math.min(95, currentProgress);
            onProgress(Math.floor(lastProgress));
          }
        }, 500);

        // Create a wrapper to properly bound the html2canvas capture
        const boundingWrapper = document.createElement('div');
        boundingWrapper.style.position = 'fixed';
        boundingWrapper.style.top = '-9999px';
        boundingWrapper.style.left = '-9999px';
        boundingWrapper.style.width = `${containerWidth}px`;
        boundingWrapper.style.height = `${containerHeight}px`;
        boundingWrapper.style.overflow = 'hidden';
        document.body.appendChild(boundingWrapper);

        const captureFrame = async () => {
          try {
            if (options?.signal?.aborted) {
              clearInterval(progressInterval);
              if (boundingWrapper.parentNode) {
                document.body.removeChild(boundingWrapper);
              }
              if (mediaRecorder.state === "recording") {
                mediaRecorder.stop();
              }
              return;
            }
            if (videoRef.paused || videoRef.ended) {
              clearInterval(progressInterval);
              // Clean up
              if (boundingWrapper.parentNode) {
                document.body.removeChild(boundingWrapper);
              }
              setTimeout(() => {
                try {
                  mediaRecorder.stop();
                } catch (e) {
                  console.error("Error stopping mediaRecorder:", e);
                  reject(e);
                }
              }, 500);
              return;
            }

            // Create a clone of the container for html2canvas
            const containerClone = videoContainer.cloneNode(true) as HTMLElement;

            // Clear the wrapper and add the clone
            boundingWrapper.innerHTML = '';
            boundingWrapper.appendChild(containerClone);

            // Find the video in the clone and update it
            const clonedVideo = containerClone.querySelector('video');
            if (clonedVideo) {
              // Update the cloned video to show the current frame
              clonedVideo.currentTime = videoRef.currentTime;
              clonedVideo.style.visibility = 'visible';
              clonedVideo.style.display = 'block';
              clonedVideo.style.opacity = '1';
            }

            // Use html2canvas to capture just the container (with bounded dimensions)
            const containerSnapshot = await html2canvas(containerClone, {
              logging: false,
              useCORS: true,
              allowTaint: true,
              backgroundColor: null,
              scale: scaleFactor,
              width: containerWidth,
              height: containerHeight,
              ignoreElements: (element) => false,
            });

            // Clear canvas and draw the container snapshot
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(containerSnapshot, 0, 0, canvas.width, canvas.height);

            // Calculate the scaled position and dimensions for the video
            const scaledVideoX = videoPositionX * scaleFactor;
            const scaledVideoY = videoPositionY * scaleFactor;
            const scaledVideoWidth = videoWidth * scaleFactor;
            const scaledVideoHeight = videoHeight * scaleFactor;

            // Draw the high-quality video frame directly on top
            ctx.drawImage(
              videoRef,
              scaledVideoX,
              scaledVideoY,
              scaledVideoWidth,
              scaledVideoHeight
            );

            // Draw camera overlay on top (if present).
            if (overlayEl && cameraEl) {
              const overlayRect = overlayEl.getBoundingClientRect();
              const overlayX = overlayRect.left - containerRect.left;
              const overlayY = overlayRect.top - containerRect.top;
              const overlayW = overlayRect.width;
              const overlayH = overlayRect.height;

              if (overlayW > 2 && overlayH > 2) {
                const sx = overlayX * scaleFactor;
                const sy = overlayY * scaleFactor;
                const sw = overlayW * scaleFactor;
                const sh = overlayH * scaleFactor;

                ctx.save();
                if (cameraShape === "circle") {
                  const r = Math.min(sw, sh) / 2;
                  ctx.beginPath();
                  ctx.arc(sx + sw / 2, sy + sh / 2, r, 0, Math.PI * 2);
                  ctx.closePath();
                  ctx.clip();
                }
                ctx.drawImage(cameraEl, sx, sy, sw, sh);
                ctx.restore();
              }
            }

            // Request next frame
            requestAnimationFrame(captureFrame);
          } catch (err) {
            console.error("Error capturing frame:", err);
            clearInterval(progressInterval);
            toast.error("Export failed: Error capturing frames");

            // Clean up
            if (boundingWrapper.parentNode) {
              document.body.removeChild(boundingWrapper);
            }

            // Restore original video styles
            videoRef.style.display = originalVideoStyles.display;
            videoRef.style.visibility = originalVideoStyles.visibility;
            videoRef.style.opacity = originalVideoStyles.opacity;

            if (wasPlaying) videoRef.play();
            reject(err);
          }
        };

        // Start capturing frames
        captureFrame().catch(err => {
          console.error("Error in captureFrame:", err);
          clearInterval(progressInterval);
          toast.error("Export failed: Error initiating capture");

          // Clean up
          if (boundingWrapper.parentNode) {
            document.body.removeChild(boundingWrapper);
          }

          // Restore original video styles
          videoRef.style.display = originalVideoStyles.display;
          videoRef.style.visibility = originalVideoStyles.visibility;
          videoRef.style.opacity = originalVideoStyles.opacity;

          if (wasPlaying) videoRef.play();
          reject(err);
        });

        // Set a maximum recording time as a safeguard
        setTimeout(() => {
          if (options?.signal?.aborted) return;
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }

          // Clean up
          if (boundingWrapper.parentNode) {
            document.body.removeChild(boundingWrapper);
          }
        }, (totalDuration * 1000) + 5000); // Video duration plus 5 seconds buffer

      } catch (error) {
        console.error("Error starting mediaRecorder:", error);
        toast.error("Export failed: Could not start recording");

        // Restore original video styles
        videoRef.style.display = originalVideoStyles.display;
        videoRef.style.visibility = originalVideoStyles.visibility;
        videoRef.style.opacity = originalVideoStyles.opacity;

        if (wasPlaying) videoRef.play();
        reject(error);
      }
    });
  } catch (error) {
    console.error('Export failed:', error);
    toast.error('Failed to export video');
    throw error;
  }
};
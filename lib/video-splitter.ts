import { buildShortsPlan } from "@/lib/youtube-shorts";

export interface VideoSegment {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  blob: Blob | null;
  transcription: string;
  title: string;
}

export interface SplitProgress {
  current: number;
  total: number;
  status: string;
}

export interface SplitVideoOptions {
  segmentDurationSeconds?: number;
  overlapSeconds?: number;
  minimumClipSeconds?: number;
  onSegmentReady?: (
    segment: VideoSegment,
    index: number,
    total: number
  ) => Promise<void> | void;
}

function drawVerticalFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  backgroundCanvas?: HTMLCanvasElement | null
) {
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const videoWidth = Math.max(1, video.videoWidth || 1);
  const videoHeight = Math.max(1, video.videoHeight || 1);
  const containScale = Math.min(canvasWidth / videoWidth, canvasHeight / videoHeight);
  const containWidth = videoWidth * containScale;
  const containHeight = videoHeight * containScale;
  const containX = (canvasWidth - containWidth) / 2;
  const containY = (canvasHeight - containHeight) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (backgroundCanvas) {
    ctx.drawImage(backgroundCanvas, 0, 0, canvasWidth, canvasHeight);
  } else {
    ctx.save();
    ctx.fillStyle = "#090014";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
  }

  ctx.save();
  const framePadding = canvasWidth * 0.035;
  const frameX = containX - framePadding;
  const frameY = containY - framePadding;
  const frameWidth = containWidth + framePadding * 2;
  const frameHeight = containHeight + framePadding * 2;

  ctx.fillStyle = "rgba(10, 6, 22, 0.72)";
  ctx.fillRect(frameX, frameY, frameWidth, frameHeight);
  ctx.restore();

  ctx.drawImage(video, containX, containY, containWidth, containHeight);
}

function createStaticBackgroundFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
) {
  const backgroundCanvas = document.createElement("canvas");
  const backgroundCtx = backgroundCanvas.getContext("2d");

  if (!backgroundCtx) {
    return null;
  }

  backgroundCanvas.width = canvas.width;
  backgroundCanvas.height = canvas.height;

  const backgroundWidth = backgroundCanvas.width;
  const backgroundHeight = backgroundCanvas.height;
  const videoWidth = Math.max(1, video.videoWidth || 1);
  const videoHeight = Math.max(1, video.videoHeight || 1);
  const coverScale = Math.max(backgroundWidth / videoWidth, backgroundHeight / videoHeight);
  const coverWidth = videoWidth * coverScale;
  const coverHeight = videoHeight * coverScale;
  const coverX = (backgroundWidth - coverWidth) / 2;
  const coverY = (backgroundHeight - coverHeight) / 2;

  backgroundCtx.save();
  backgroundCtx.fillStyle = "#090014";
  backgroundCtx.fillRect(0, 0, backgroundWidth, backgroundHeight);
  backgroundCtx.filter = "blur(24px) brightness(0.52) saturate(1.1)";
  backgroundCtx.drawImage(video, coverX, coverY, coverWidth, coverHeight);
  backgroundCtx.restore();

  return backgroundCanvas;
}

/**
 * Split a long video into short vertical clips using the client-side splitter
 * that also powers the dashboard video splitter flow.
 */
export async function splitVideoIntoShorts(
  videoFile: File,
  onProgress?: (progress: SplitProgress) => void,
  options: SplitVideoOptions = {}
): Promise<VideoSegment[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const segments: VideoSegment[] = [];

    video.preload = "metadata";
    video.muted = true;

    video.onerror = (e) => {
      const errorMsg = video.error
        ? `Video error code: ${video.error.code}`
        : "Unknown video error";
      console.error("[v0] Video load error:", errorMsg);
      URL.revokeObjectURL(video.src);
      reject(new Error(errorMsg));
    };

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const plan = buildShortsPlan({
        durationSeconds: duration,
        segmentDurationSeconds: options.segmentDurationSeconds ?? 30,
        overlapSeconds: options.overlapSeconds ?? 0,
        minimumClipSeconds: options.minimumClipSeconds ?? 8,
      });
      const numSegments = plan.length;

      console.log(
        "[v0] Video duration:",
        duration,
        "seconds, will create",
        numSegments,
        "segments"
      );

      onProgress?.({
        current: 0,
        total: numSegments,
        status: "Analyzing video...",
      });

      for (const window of plan) {
        segments.push({
          id: `${window.id}-${Date.now()}`,
          startTime: window.startSeconds,
          endTime: window.endSeconds,
          duration: window.durationSeconds,
          blob: null,
          transcription: "",
          title: `Part ${window.index + 1} of ${numSegments}`,
        });
      }

      onProgress?.({
        current: 0,
        total: numSegments,
        status: "Processing segments...",
      });

      // Process each segment
      try {
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];

          onProgress?.({
            current: i,
            total: numSegments,
            status: `Processing segment ${i + 1}/${numSegments}...`,
          });

          const blob = await extractVideoSegmentSimple(
            videoFile,
            segment.startTime,
            segment.endTime
          );
          segment.blob = blob;

          onProgress?.({
            current: i + 1,
            total: numSegments,
            status: `Processed segment ${i + 1}/${numSegments}`,
          });

          await options.onSegmentReady?.(segment, i, numSegments);
        }

        URL.revokeObjectURL(video.src);
        resolve(segments);
      } catch (error) {
        console.error("[v0] Failed to process segments:", error);
        URL.revokeObjectURL(video.src);
        reject(error);
      }
    };

    video.src = URL.createObjectURL(videoFile);
  });
}

/**
 * Extract video segment using canvas and MediaRecorder with better error handling
 */
async function extractVideoSegmentSimple(
  videoFile: File,
  startTime: number,
  endTime: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      reject(new Error("Canvas not supported"));
      return;
    }

    // Keep this lighter than full 1080p to avoid browser-side lag.
    canvas.width = 720;
    canvas.height = 1280;

    video.preload = "auto";
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    let mediaRecorder: MediaRecorder | null = null;
    let recordingStarted = false;
    const chunks: Blob[] = [];
    let videoBlobUrl = "";
    let audioCtx: AudioContext | null = null;
    let finalStream: MediaStream | null = null;
    let canvasStream: MediaStream | null = null;
    let elementStream: MediaStream | null = null;
    let backgroundCanvas: HTMLCanvasElement | null = null;

    const cleanup = () => {
      try {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
        video.pause();
        finalStream?.getTracks().forEach((track) => track.stop());
        canvasStream?.getTracks().forEach((track) => track.stop());
        elementStream?.getTracks().forEach((track) => track.stop());
        if (audioCtx && audioCtx.state !== "closed") {
          void audioCtx.close().catch(() => undefined);
        }
        if (videoBlobUrl) {
          URL.revokeObjectURL(videoBlobUrl);
          videoBlobUrl = "";
        }
        video.removeAttribute("src");
        video.load();
      } catch (e) {
        console.error("[v0] Cleanup error:", e);
      }
    };

    const startRecording = async () => {
      if (recordingStarted) return;
      recordingStarted = true;

      console.log(
        "[v0] Starting recording for segment:",
        startTime,
        "-",
        endTime
      );

      try {
        // Get canvas stream
        canvasStream = canvas.captureStream(24);
        backgroundCanvas = createStaticBackgroundFrame(video, canvas);

        // Try to get audio from video
        const combinedStream = new MediaStream();
        canvasStream
          .getVideoTracks()
          .forEach((track) => combinedStream.addTrack(track));
        finalStream = combinedStream;
        video.muted = false;
        video.volume = 0;
        video.playbackRate = 1;

        const captureStream =
          (video as HTMLVideoElement & { captureStream?: () => MediaStream })
            .captureStream;

        if (typeof captureStream === "function") {
          elementStream = captureStream.call(video);
          elementStream
            .getAudioTracks()
            .forEach((track) => combinedStream.addTrack(track));
        }

        try {
          if (combinedStream.getAudioTracks().length === 0) {
            audioCtx = new AudioContext();
            await audioCtx.resume().catch(() => undefined);
            const source = audioCtx.createMediaElementSource(video);
            const dest = audioCtx.createMediaStreamDestination();
            const monitorGain = audioCtx.createGain();
            monitorGain.gain.value = 0;
            source.connect(dest);
            source.connect(monitorGain);
            monitorGain.connect(audioCtx.destination);
            dest.stream
              .getAudioTracks()
              .forEach((track) => combinedStream.addTrack(track));
          }

          console.log(
            "[v0] Audio tracks attached:",
            combinedStream.getAudioTracks().length
          );
        } catch (audioErr) {
          console.warn(
            "[v0] Could not capture audio, using video only:",
            audioErr
          );
        }

        const mimeTypes = [
          "video/mp4;codecs=h264,mp4a.40.2",
          "video/mp4",
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm;codecs=vp8",
          "video/webm",
        ];

        let selectedMimeType = "video/mp4";
        for (const type of mimeTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            selectedMimeType = type;
            console.log("[v0] Using mime type:", type);
            break;
          }
        }

        mediaRecorder = new MediaRecorder(finalStream, {
          mimeType: selectedMimeType,
          videoBitsPerSecond: 3500000,
          audioBitsPerSecond: 128000,
        });

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          console.log("[v0] Recording stopped, chunks:", chunks.length);
          if (chunks.length > 0) {
            const outputMimeType = selectedMimeType.includes("mp4")
              ? "video/mp4"
              : "video/webm";
            const blob = new Blob(chunks, { type: outputMimeType });
            cleanup();
            resolve(blob);
          } else {
            cleanup();
            reject(new Error("No data recorded"));
          }
        };

        mediaRecorder.onerror = (e: Event) => {
          console.error("[v0] MediaRecorder error:", e);
          cleanup();
          reject(new Error("Recording failed"));
        };

        mediaRecorder.start(100);
        console.log("[v0] MediaRecorder started");
        const hardStopAt = performance.now() + (endTime - startTime + 2) * 1000;

        const scheduleNextFrame = () => {
          const requestVideoFrameCallback = (
            video as HTMLVideoElement & {
              requestVideoFrameCallback?: (callback: () => void) => number;
            }
          ).requestVideoFrameCallback;

          if (typeof requestVideoFrameCallback === "function") {
            requestVideoFrameCallback.call(video, () => {
              renderFrame();
            });
            return;
          }

          requestAnimationFrame(renderFrame);
        };

        const renderFrame = () => {
          if (
            video.ended ||
            video.currentTime >= endTime - 0.02 ||
            performance.now() >= hardStopAt
          ) {
            console.log(
              "[v0] Recording complete, elapsed:",
              video.currentTime - startTime,
              "target:",
              endTime - startTime
            );
            if (mediaRecorder && mediaRecorder.state === "recording") {
              mediaRecorder.stop();
            }
            return;
          }

          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            drawVerticalFrame(ctx, video, canvas, backgroundCanvas);
          }

          scheduleNextFrame();
        };

        renderFrame();
      } catch (error) {
        console.error("[v0] Error starting recording:", error);
        cleanup();
        reject(error);
      }
    };

    video.onloadeddata = async () => {
      console.log("[v0] Video loaded, seeking to:", startTime);
      video.currentTime = startTime;
    };

    video.onseeked = async () => {
      console.log("[v0] Seeked to:", video.currentTime);
      if (!recordingStarted) {
        try {
          await video.play();
          await startRecording();
        } catch (error) {
          console.error("[v0] Play error:", error);
          cleanup();
          reject(error);
        }
      }
    };

    video.onerror = (e) => {
      let errorMsg = "Failed to load video";
      if (video.error) {
        const errorCodes: Record<number, string> = {
          1: "MEDIA_ERR_ABORTED: Video loading was aborted",
          2: "MEDIA_ERR_NETWORK: Network error occurred",
          3: "MEDIA_ERR_DECODE: Video decoding failed",
          4: "MEDIA_ERR_SRC_NOT_SUPPORTED: Video format not supported or source is empty",
        };
        errorMsg =
          errorCodes[video.error.code] ||
          `Unknown error (code: ${video.error.code})`;
      }
      console.error("[v0] Video error:", errorMsg);
      cleanup();
      reject(new Error(errorMsg));
    };

    videoBlobUrl = URL.createObjectURL(videoFile);
    video.src = videoBlobUrl;
    video.load();
  });
}

export async function transcribeVideoSegment(videoBlob: Blob): Promise<string> {
  return "Transcription would require backend API integration";
}

export function generateCaptions(
  transcription: string,
  timestamps: number[]
): Array<{ time: number; text: string }> {
  const words = transcription.split(" ");
  const captions: Array<{ time: number; text: string }> = [];

  for (let i = 0; i < words.length; i += 4) {
    const chunk = words.slice(i, i + 4).join(" ");
    const timeIndex = Math.floor((i / words.length) * timestamps.length);
    const time = timestamps[timeIndex] || 0;

    captions.push({ time, text: chunk });
  }

  return captions;
}

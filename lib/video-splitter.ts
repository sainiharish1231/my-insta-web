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

/**
 * Split a long video into 30-second segments using a simpler approach
 */
export async function splitVideoIntoShorts(
  videoFile: File,
  onProgress?: (progress: SplitProgress) => void
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
      const segmentDuration = 30;
      const numSegments = Math.ceil(duration / segmentDuration);

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

      // Create segments metadata
      for (let i = 0; i < numSegments; i++) {
        const startTime = i * segmentDuration;
        const endTime = Math.min((i + 1) * segmentDuration, duration);

        segments.push({
          id: `segment_${i}_${Date.now()}`,
          startTime,
          endTime,
          duration: endTime - startTime,
          blob: null,
          transcription: "",
          title: `Part ${i + 1} of ${numSegments}`,
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

    // Set Instagram Reels format (9:16)
    canvas.width = 1080;
    canvas.height = 1920;

    video.preload = "auto";
    video.muted = false;
    video.crossOrigin = "anonymous";

    let mediaRecorder: MediaRecorder | null = null;
    let recordingStarted = false;
    const chunks: Blob[] = [];
    let videoBlobUrl = "";

    const cleanup = () => {
      try {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
        video.pause();
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
        const canvasStream = canvas.captureStream(30);

        // Try to get audio from video
        let finalStream = canvasStream;

        try {
          // Create audio context to capture audio
          const audioCtx = new AudioContext();
          const source = audioCtx.createMediaElementSource(video);
          const dest = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          source.connect(audioCtx.destination);

          // Combine video and audio
          const combinedStream = new MediaStream();
          canvasStream
            .getVideoTracks()
            .forEach((track) => combinedStream.addTrack(track));
          dest.stream
            .getAudioTracks()
            .forEach((track) => combinedStream.addTrack(track));

          finalStream = combinedStream;
          console.log("[v0] Audio captured successfully");
        } catch (audioErr) {
          console.warn(
            "[v0] Could not capture audio, using video only:",
            audioErr
          );
        }

        // Determine supported mime type
        const mimeTypes = [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm;codecs=vp8",
          "video/webm",
        ];

        let selectedMimeType = "video/webm";
        for (const type of mimeTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            selectedMimeType = type;
            console.log("[v0] Using mime type:", type);
            break;
          }
        }

        mediaRecorder = new MediaRecorder(finalStream, {
          mimeType: selectedMimeType,
          videoBitsPerSecond: 5000000,
        });

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          console.log("[v0] Recording stopped, chunks:", chunks.length);
          if (chunks.length > 0) {
            const blob = new Blob(chunks, { type: selectedMimeType });
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

        // Start rendering frames
        const duration = endTime - startTime;
        const startTimestamp = performance.now();

        const renderFrame = () => {
          const elapsed = (performance.now() - startTimestamp) / 1000;

          if (elapsed >= duration || video.currentTime >= endTime) {
            console.log(
              "[v0] Recording complete, elapsed:",
              elapsed,
              "duration:",
              duration
            );
            if (mediaRecorder && mediaRecorder.state === "recording") {
              mediaRecorder.stop();
            }
            return;
          }

          // Calculate video aspect ratio
          const videoAspect = video.videoWidth / video.videoHeight;
          const targetAspect = 9 / 16;

          // Clear canvas with black background
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Draw video centered and cropped
          if (videoAspect > targetAspect) {
            // Video is wider - crop sides
            const scale = canvas.height / video.videoHeight;
            const scaledWidth = video.videoWidth * scale;
            const offsetX = (canvas.width - scaledWidth) / 2;
            ctx.drawImage(video, offsetX, 0, scaledWidth, canvas.height);
          } else {
            // Video is taller - crop top/bottom
            const scale = canvas.width / video.videoWidth;
            const scaledHeight = video.videoHeight * scale;
            const offsetY = (canvas.height - scaledHeight) / 2;
            ctx.drawImage(video, 0, offsetY, canvas.width, scaledHeight);
          }

          requestAnimationFrame(renderFrame);
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

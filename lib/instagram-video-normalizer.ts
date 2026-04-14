const OUTPUT_MAX_DIMENSION = 1920;
const OUTPUT_VIDEO_BITS_PER_SECOND = 5_000_000;

type ProgressCallback = (percent: number) => void;

function toEvenDimension(value: number) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function getSupportedMp4RecorderMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const mimeTypes = [
    "video/mp4;codecs=h264,mp4a.40.2",
    "video/mp4",
  ];

  return (
    mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ||
    null
  );
}

function buildNormalizedFilename(name: string) {
  const sanitizedBaseName = name.replace(/\.[^.]+$/, "") || "instagram-video";
  return `${sanitizedBaseName}-instagram.mp4`;
}

export function needsInstagramVideoNormalization(file: File) {
  const lowerName = file.name.toLowerCase();

  return (
    file.type === "video/quicktime" ||
    file.type === "video/x-m4v" ||
    /\.(mov|m4v|avi|mkv|webm|ogv|ogg)$/i.test(lowerName)
  );
}

export async function normalizeVideoForInstagram(
  file: File,
  onProgress?: ProgressCallback
): Promise<File> {
  const recorderMimeType = getSupportedMp4RecorderMimeType();

  if (!recorderMimeType) {
    throw new Error(
      "This device/browser can't convert the selected phone video to Instagram-safe MP4 automatically. Please use an MP4/H.264 video."
    );
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("This browser cannot process the selected video."));
      return;
    }

    const AudioContextCtor =
      window.AudioContext || (window as any).webkitAudioContext;

    let objectUrl = "";
    let animationFrameId = 0;
    let mediaRecorder: MediaRecorder | null = null;
    let audioContext: AudioContext | null = null;
    let completed = false;
    const chunks: Blob[] = [];

    const cleanup = async () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
      }

      try {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
      } catch {}

      video.pause();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = "";
      }
      video.removeAttribute("src");
      video.load();

      if (audioContext && audioContext.state !== "closed") {
        await audioContext.close().catch(() => {});
      }
    };

    const fail = (error: Error) => {
      if (completed) {
        return;
      }

      completed = true;
      cleanup().finally(() => reject(error));
    };

    const finish = (blob: Blob) => {
      if (completed) {
        return;
      }

      completed = true;
      onProgress?.(100);

      const normalizedFile = new File([blob], buildNormalizedFilename(file.name), {
        type: "video/mp4",
      });

      cleanup().finally(() => resolve(normalizedFile));
    };

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    video.onerror = () => {
      fail(new Error("Failed to read the selected phone video."));
    };

    video.onloadedmetadata = async () => {
      const sourceWidth = video.videoWidth || 720;
      const sourceHeight = video.videoHeight || 1280;
      const scale = Math.min(
        1,
        OUTPUT_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight)
      );

      canvas.width = toEvenDimension(sourceWidth * scale);
      canvas.height = toEvenDimension(sourceHeight * scale);

      const canvasStream = canvas.captureStream(30);
      const finalStream = new MediaStream();

      canvasStream.getVideoTracks().forEach((track) => {
        finalStream.addTrack(track);
      });

      if (AudioContextCtor) {
        try {
          audioContext = new AudioContextCtor();
          if (audioContext.state === "suspended") {
            await audioContext.resume();
          }

          const source = audioContext.createMediaElementSource(video);
          const destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
          destination.stream.getAudioTracks().forEach((track) => {
            finalStream.addTrack(track);
          });
        } catch (error) {
          console.warn(
            "[v0] Instagram video normalization audio capture unavailable:",
            error
          );
        }
      }

      try {
        mediaRecorder = new MediaRecorder(finalStream, {
          mimeType: recorderMimeType,
          videoBitsPerSecond: OUTPUT_VIDEO_BITS_PER_SECOND,
        });
      } catch (error: any) {
        fail(
          new Error(
            error?.message ||
              "Failed to start phone video conversion for Instagram."
          )
        );
        return;
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onerror = () => {
        fail(new Error("Failed to convert the selected phone video."));
      };

      mediaRecorder.onstop = () => {
        if (chunks.length === 0) {
          fail(new Error("Phone video conversion produced no output."));
          return;
        }

        finish(new Blob(chunks, { type: "video/mp4" }));
      };

      const drawFrame = () => {
        if (completed) {
          return;
        }

        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (video.duration > 0) {
          const percent = Math.min(
            99,
            Math.max(1, Math.round((video.currentTime / video.duration) * 100))
          );
          onProgress?.(percent);
        }

        if (video.ended) {
          if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
          }
          return;
        }

        animationFrameId = requestAnimationFrame(drawFrame);
      };

      mediaRecorder.start(250);
      onProgress?.(1);

      try {
        await video.play();
        drawFrame();
      } catch (error: any) {
        fail(
          new Error(
            error?.message ||
              "This browser blocked playback needed to convert the phone video."
          )
        );
      }
    };

    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.load();
  });
}

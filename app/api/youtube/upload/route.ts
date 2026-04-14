import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Vercel Hobby serverless functions must stay within 1-300 seconds.
export const maxDuration = 800;

const YOUTUBE_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

function parseTotalBytesFromContentRange(
  contentRange: string | null,
): number | null {
  if (!contentRange) {
    return null;
  }

  const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/i);
  if (!match) {
    return null;
  }

  const total = Number.parseInt(match[1], 10);
  return Number.isFinite(total) ? total : null;
}

function parseNextOffsetFromRange(rangeHeader: string | null): number | null {
  if (!rangeHeader) {
    return null;
  }

  const match = rangeHeader.match(/bytes=0-(\d+)/i);
  if (!match) {
    return null;
  }

  const lastUploadedByte = Number.parseInt(match[1], 10);
  if (!Number.isFinite(lastUploadedByte)) {
    return null;
  }

  return lastUploadedByte + 1;
}

async function getRemoteVideoInfo(videoUrl: string): Promise<{
  size: number;
  contentType: string;
}> {
  const headResponse = await fetch(videoUrl, { method: "HEAD" });

  if (headResponse.ok) {
    const headSize = Number.parseInt(
      headResponse.headers.get("content-length") || "",
      10,
    );
    const contentType = headResponse.headers.get("content-type") || "video/mp4";

    if (Number.isFinite(headSize) && headSize > 0) {
      return { size: headSize, contentType };
    }
  }

  const probeResponse = await fetch(videoUrl, {
    headers: {
      Range: "bytes=0-0",
    },
  });

  if (!probeResponse.ok) {
    throw new Error("Failed to inspect remote video file");
  }

  const contentType = probeResponse.headers.get("content-type") || "video/mp4";
  const totalFromRange = parseTotalBytesFromContentRange(
    probeResponse.headers.get("content-range"),
  );
  const sizeFromLength = Number.parseInt(
    probeResponse.headers.get("content-length") || "",
    10,
  );
  const size =
    totalFromRange || (Number.isFinite(sizeFromLength) ? sizeFromLength : 0);

  if (!size || size <= 0) {
    throw new Error("Could not determine remote video size");
  }

  return { size, contentType };
}

async function fetchVideoChunk(
  videoUrl: string,
  start: number,
  end: number,
  expectedLength: number,
): Promise<ArrayBuffer> {
  const chunkResponse = await fetch(videoUrl, {
    headers: {
      Range: `bytes=${start}-${end}`,
    },
  });

  if (!chunkResponse.ok) {
    throw new Error(
      `Failed to fetch source chunk ${start}-${end} (status ${chunkResponse.status})`,
    );
  }

  const chunkArrayBuffer = await chunkResponse.arrayBuffer();

  if (chunkArrayBuffer.byteLength !== expectedLength) {
    throw new Error(
      "Source server did not return expected byte range. Use a storage URL that supports range requests.",
    );
  }

  return chunkArrayBuffer;
}

export async function POST(request: Request) {
  try {
    const {
      accessToken,
      videoUrl,
      title,
      description,
      privacy = "public",
      keywords = [],
      isShort = false,
    } = await request.json();

    if (!accessToken || !videoUrl || !title) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    console.log("[v0] YouTube upload starting:", {
      videoUrl,
      title,
      privacy,
      isShort,
      keywords,
    });

    const { size: videoSize, contentType } = await getRemoteVideoInfo(videoUrl);
    console.log("[v0] Source video info:", {
      sizeBytes: videoSize,
      sizeMB: (videoSize / (1024 * 1024)).toFixed(2),
      contentType,
    });

    const snippet: any = {
      title,
      description: description || "",
      categoryId: "22", // People & Blogs
    };

    if (keywords && keywords.length > 0) {
      snippet.tags = keywords;
    }

    if (isShort) {
      if (!snippet.title.includes("#Shorts")) {
        snippet.title = `${snippet.title} #Shorts`;
      }
      if (!snippet.description.includes("#Shorts")) {
        snippet.description = `${snippet.description}\n\n#Shorts`;
      }
    }

    const initResponse = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": contentType,
          "X-Upload-Content-Length": videoSize.toString(),
        },
        body: JSON.stringify({
          snippet,
          status: {
            privacyStatus: privacy,
            selfDeclaredMadeForKids: false,
          },
        }),
      },
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error("[v0] YouTube init error:", errorText);
      throw new Error(`Failed to initialize upload: ${errorText}`);
    }

    const uploadUrl = initResponse.headers.get("location");
    if (!uploadUrl) {
      throw new Error("No upload URL received from YouTube");
    }

    console.log("[v0] Upload initialized, starting chunked upload...");

    let uploadedBytes = 0;
    let result: any = null;

    while (uploadedBytes < videoSize) {
      const chunkEnd = Math.min(
        uploadedBytes + YOUTUBE_UPLOAD_CHUNK_BYTES - 1,
        videoSize - 1,
      );
      const expectedLength = chunkEnd - uploadedBytes + 1;

      const chunk = await fetchVideoChunk(
        videoUrl,
        uploadedBytes,
        chunkEnd,
        expectedLength,
      );

      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": contentType,
          "Content-Length": expectedLength.toString(),
          "Content-Range": `bytes ${uploadedBytes}-${chunkEnd}/${videoSize}`,
        },
        body: chunk,
      });

      if (uploadResponse.status === 308) {
        const resumeOffset =
          parseNextOffsetFromRange(uploadResponse.headers.get("range")) ||
          chunkEnd + 1;
        uploadedBytes = resumeOffset;
        const progress = Math.min(
          100,
          Math.round((uploadedBytes / videoSize) * 100),
        );
        console.log(`[v0] YouTube chunk uploaded: ${progress}%`);
        continue;
      }

      if (uploadResponse.ok) {
        result = await uploadResponse.json();
        uploadedBytes = videoSize;
        break;
      }

      const errorText = await uploadResponse.text();
      console.error("[v0] YouTube upload error:", errorText);

      if (uploadResponse.status === 401) {
        throw new Error(
          "YouTube authentication expired. Please reconnect your account.",
        );
      }
      if (uploadResponse.status === 403) {
        throw new Error(
          "YouTube upload permission denied. Check your account permissions.",
        );
      }

      throw new Error(`Failed to upload video chunk: ${errorText}`);
    }

    if (!result?.id) {
      throw new Error("YouTube upload completed but video ID was not returned");
    }

    console.log("[v0] YouTube upload successful:", result.id);

    return NextResponse.json({
      success: true,
      videoId: result.id,
      url: isShort
        ? `https://www.youtube.com/shorts/${result.id}`
        : `https://www.youtube.com/watch?v=${result.id}`,
    });
  } catch (error: any) {
    console.error("[v0] YouTube upload error:", error);
    return NextResponse.json(
      { error: error.message || "YouTube upload failed" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

const YOUTUBE_UPLOAD_CHUNK_BYTES = 256 * 1024; // 256 KB chunk size for resumable uploads

async function refreshYouTubeAccessToken(refreshToken: string) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth credentials are not configured on the server.",
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();

  if (!response.ok || data.error || !data.access_token) {
    throw new Error(
      data.error_description ||
        data.error ||
        "Failed to refresh YouTube access token",
    );
  }

  return data.access_token as string;
}

export async function POST(request: Request) {
  try {
    const {
      accessToken,
      refreshToken,
      videoUrl,
      title,
      description,
      privacy = "public",
      publishAt,
      keywords = [],
      isShort = false,
    } = await request.json();

    if (!accessToken || !videoUrl || !title) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    let activeAccessToken = accessToken;

    const scheduledPublishAt =
      typeof publishAt === "string" && publishAt.trim()
        ? new Date(publishAt)
        : null;
    const isScheduledUpload =
      scheduledPublishAt != null && !Number.isNaN(scheduledPublishAt.getTime());

    if (scheduledPublishAt && scheduledPublishAt <= new Date()) {
      return NextResponse.json(
        { error: "YouTube schedule time future me hona chahiye." },
        { status: 400 },
      );
    }

    console.log("[v0] YouTube upload starting:", {
      videoUrl,
      title,
      privacy,
      publishAt: scheduledPublishAt?.toISOString(),
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

    const initUpload = async (token: string) =>
      fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Type": contentType || "video/mp4",
            "X-Upload-Content-Length": videoSize.toString(),
          },
          body: JSON.stringify({
            snippet,
            status: {
              privacyStatus: isScheduledUpload ? "private" : privacy,
              ...(isScheduledUpload
                ? { publishAt: scheduledPublishAt!.toISOString() }
                : {}),
              selfDeclaredMadeForKids: false,
            },
          }),
        },
      );

    let initResponse = await initUpload(activeAccessToken);

    if (initResponse.status === 401) {
      if (!refreshToken) {
        throw new Error(
          "YouTube session expired and no refresh token is available. Please reconnect your YouTube account.",
        );
      }

      console.log("[v0] YouTube access token expired, refreshing token...");
      activeAccessToken = await refreshYouTubeAccessToken(refreshToken);
      initResponse = await initUpload(activeAccessToken);
    }

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error("[v0] YouTube init error:", errorText);
      throw new Error(`Failed to initialize upload: ${errorText}`);
    }

    const uploadUrl = initResponse.headers.get("location");
    if (!uploadUrl) {
      throw new Error("No upload URL received from YouTube");
    }

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
          Authorization: `Bearer ${activeAccessToken}`,
          "Content-Type": contentType || "video/mp4",
          "Content-Length": expectedLength.toString(),
          "Content-Range": `bytes ${uploadedBytes}-${chunkEnd}/${videoSize}`,
        },
        body: chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk,
      });

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

      // Resumable uploads return 308 with Range header when more data is needed
      if (uploadResponse.status === 308) {
        const range = uploadResponse.headers.get("Range");
        if (range) {
          const m = range.match(/bytes=0-(\d+)/);
          if (m) {
            uploadedBytes = parseInt(m[1], 10) + 1;
          } else {
            uploadedBytes += expectedLength;
          }
        } else {
          uploadedBytes += expectedLength;
        }
        continue;
      }

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error("[v0] YouTube upload error:", errorText);
        throw new Error(`Failed to upload video chunk: ${errorText}`);
      }

      // Completed upload - parse response for video id
      result = await uploadResponse.json();
      uploadedBytes = videoSize;
    }

    if (!result?.id) {
      throw new Error("YouTube upload completed but video ID was not returned");
    }

    console.log("[v0] YouTube upload successful:", result.id);

    return NextResponse.json({
      success: true,
      accessToken: activeAccessToken,
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

async function getRemoteVideoInfo(
  videoUrl: string,
): Promise<{ size: number; contentType: string }> {
  // Try a HEAD request first to get content-length and content-type
  try {
    const headResp = await fetch(videoUrl, { method: "HEAD" });
    if (headResp.ok) {
      const contentLength = headResp.headers.get("content-length");
      const contentType = headResp.headers.get("content-type") || "video/mp4";
      if (contentLength) {
        return { size: parseInt(contentLength, 10), contentType };
      }
    }
  } catch (e) {
    // ignore and try GET fallback below
  }

  // Fallback to fetching a small byte range to determine size when HEAD not available
  const resp = await fetch(videoUrl, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
  });
  if (!resp.ok && resp.status !== 206) {
    throw new Error(`Failed to retrieve remote video info: ${resp.statusText}`);
  }
  const contentRange = resp.headers.get("content-range"); // e.g. bytes 0-0/12345
  const contentType = resp.headers.get("content-type") || "video/mp4";
  if (contentRange) {
    const m = contentRange.match(/\/(\d+)$/);
    if (m) {
      return { size: parseInt(m[1], 10), contentType };
    }
  }

  // As a final fallback, download the whole file (not ideal) and measure it
  const full = await fetch(videoUrl);
  if (!full.ok) {
    throw new Error(
      `Failed to fetch video to determine size: ${full.statusText}`,
    );
  }
  const buf = await full.arrayBuffer();
  return { size: buf.byteLength, contentType };
}

async function fetchVideoChunk(
  videoUrl: string,
  uploadedBytes: number,
  chunkEnd: number,
  expectedLength: number,
): Promise<ArrayBuffer> {
  const headers: Record<string, string> = {
    Range: `bytes=${uploadedBytes}-${chunkEnd}`,
  };
  const resp = await fetch(videoUrl, { method: "GET", headers });
  if (!resp.ok && resp.status !== 206 && resp.status !== 200) {
    throw new Error(`Failed to fetch video chunk: ${resp.statusText}`);
  }
  const ab = await resp.arrayBuffer();
  // Some servers may return the full content for non-range-supporting endpoints; we accept that.
  return ab;
}

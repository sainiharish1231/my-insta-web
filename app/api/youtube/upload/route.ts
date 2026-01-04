import { NextResponse } from "next/server";

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
        { status: 400 }
      );
    }

    console.log("[v0] YouTube upload starting:", {
      videoUrl,
      title,
      privacy,
      isShort,
      keywords,
    });

    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      throw new Error("Failed to download video from URL");
    }

    const videoBlob = await videoResponse.blob();
    const videoBuffer = await videoBlob.arrayBuffer();

    console.log("[v0] Video downloaded, size:", videoBuffer.byteLength);

    const snippet: any = {
      title,
      description: description || "",
      categoryId: "22", // People & Blogs
    };

    // Add tags/keywords if provided
    if (keywords && keywords.length > 0) {
      snippet.tags = keywords;
    }

    // For YouTube Shorts, add #Shorts to title and description
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
          "X-Upload-Content-Type": videoBlob.type || "video/mp4",
          "X-Upload-Content-Length": videoBuffer.byteLength.toString(),
        },
        body: JSON.stringify({
          snippet,
          status: {
            privacyStatus: privacy,
            selfDeclaredMadeForKids: false,
          },
        }),
      }
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

    console.log("[v0] Upload initialized, uploading video...");

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": videoBlob.type || "video/mp4",
        "Content-Length": videoBuffer.byteLength.toString(),
      },
      body: videoBuffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("[v0] YouTube upload error:", errorText);

      if (uploadResponse.status === 401) {
        throw new Error(
          "YouTube authentication expired. Please reconnect your account."
        );
      } else if (uploadResponse.status === 403) {
        throw new Error(
          "YouTube upload permission denied. Check your account permissions."
        );
      }

      throw new Error(`Failed to upload video: ${errorText}`);
    }

    const result = await uploadResponse.json();
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
      { status: 500 }
    );
  }
}

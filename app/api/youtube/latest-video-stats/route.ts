import { NextResponse } from "next/server";

type GoogleApiError = {
  message: string;
  status?: number;
};

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

async function readGoogleApiError(response: Response) {
  const fallbackMessage = "Failed to fetch YouTube data";

  try {
    const data = await response.json();
    return (
      data?.error?.message ||
      data?.error_description ||
      data?.message ||
      fallbackMessage
    );
  } catch {
    return fallbackMessage;
  }
}

async function fetchLatestVideo(channelId: string, accessToken: string) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };

  const searchResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&maxResults=1`,
    {
      headers,
      cache: "no-store",
    },
  );

  if (!searchResponse.ok) {
    throw {
      message: await readGoogleApiError(searchResponse),
      status: searchResponse.status,
    } satisfies GoogleApiError;
  }

  const searchData = await searchResponse.json();
  const latestVideo = searchData.items?.[0];

  if (!latestVideo?.id?.videoId) {
    return null;
  }

  const detailsResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,status&id=${latestVideo.id.videoId}`,
    {
      headers,
      cache: "no-store",
    },
  );

  if (!detailsResponse.ok) {
    throw {
      message: await readGoogleApiError(detailsResponse),
      status: detailsResponse.status,
    } satisfies GoogleApiError;
  }

  const detailsData = await detailsResponse.json();
  const video = detailsData.items?.[0];

  if (!video) {
    return null;
  }

  return {
    id: video.id,
    title: video.snippet?.title || "Latest YouTube Video",
    description: video.snippet?.description || "",
    thumbnail:
      video.snippet?.thumbnails?.high?.url ||
      video.snippet?.thumbnails?.default?.url,
    publishedAt: video.snippet?.publishedAt,
    viewCount: Number(video.statistics?.viewCount || 0),
    likeCount: Number(video.statistics?.likeCount || 0),
    commentCount: Number(video.statistics?.commentCount || 0),
    privacyStatus: video.status?.privacyStatus,
  };
}

export async function POST(request: Request) {
  try {
    const { channelId, accessToken, refreshToken } = await request.json();

    if (!channelId) {
      return NextResponse.json(
        { error: "Channel ID is required" },
        { status: 400 },
      );
    }

    let activeAccessToken = accessToken as string | undefined;

    if (!activeAccessToken && refreshToken) {
      activeAccessToken = await refreshYouTubeAccessToken(refreshToken);
    }

    if (!activeAccessToken) {
      return NextResponse.json(
        {
          error:
            "YouTube access token not found. Please reconnect your YouTube account.",
        },
        { status: 400 },
      );
    }

    let video;

    try {
      video = await fetchLatestVideo(channelId, activeAccessToken);
    } catch (error: any) {
      if (error?.status === 401 && refreshToken) {
        activeAccessToken = await refreshYouTubeAccessToken(refreshToken);
        video = await fetchLatestVideo(channelId, activeAccessToken);
      } else if (error?.status === 401) {
        throw new Error(
          "YouTube session expired. Please reconnect your account.",
        );
      } else {
        throw error;
      }
    }

    return NextResponse.json({
      accessToken: activeAccessToken,
      video,
    });
  } catch (error: any) {
    console.error("[v0] Failed to load latest YouTube video stats:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to load latest YouTube video stats",
      },
      { status: 500 },
    );
  }
}

export async function generateHashtags(caption: string): Promise<string[]> {
  const commonHashtags = [
    "#instagood",
    "#photooftheday",
    "#beautiful",
    "#happy",
    "#love",
    "#instadaily",
    "#followme",
    "#trending",
    "#viral",
    "#explore",
  ];

  // Extract existing hashtags from caption
  const existingHashtags = caption.match(/#\w+/g) || [];

  // Suggest hashtags based on keywords in caption
  const words = caption.toLowerCase().split(/\s+/);
  const suggestedHashtags = words
    .filter((word) => word.length > 3 && !word.startsWith("#"))
    .slice(0, 5)
    .map((word) => `#${word.replace(/[^a-z0-9]/g, "")}`);

  return [
    ...new Set([...existingHashtags, ...suggestedHashtags, ...commonHashtags]),
  ].slice(0, 30);
}

export function generateSmartCaption({
  title,
  description,
  keywords = [],
}: {
  title?: string;
  description?: string;
  keywords?: string[];
}) {
  const cleanTitle = title?.trim() || "Fresh upload";
  const cleanDescription =
    description?.trim() || "Built for reach, retention, and clean engagement.";
  const tagLine =
    keywords.length > 0
      ? keywords
          .map((keyword) => `#${keyword.replace(/^#/, "").trim()}`)
          .join(" ")
      : "#trending #viral #explore";

  return `${cleanTitle}\n\n${cleanDescription}\n\nSave this and share your take below.\n\n${tagLine}`;
}

export async function createMedia({
  igUserId,
  token,
  mediaUrl,
  caption,
  isReel,
  locationId,
  coverUrl,
}: any) {
  console.log("[v0] Creating media container with URL:", mediaUrl);

  const body: any = {
    media_type: isReel ? "REELS" : "IMAGE",
    caption,
    access_token: token,
  };

  if (isReel) {
    body.video_url = mediaUrl;
    if (coverUrl) {
      body.cover_url = coverUrl;
    }
  } else {
    body.image_url = mediaUrl;
  }

  if (locationId) {
    body.location_id = locationId;
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json();
  console.log("[v0] Instagram API response:", data);

  if (data.error) {
    const errorMsg = data.error.message || "Unknown error";
    const errorCode = data.error.code || "";
    console.error("[v0] Instagram API error:", data.error);
    throw new Error(`Media creation failed (${errorCode}): ${errorMsg}`);
  }

  if (!data.id) {
    throw new Error("Media creation failed: No container ID returned");
  }

  console.log("[v0] Media container created successfully:", data.id);
  return data.id;
}

export async function publishMedia({ igUserId, token, creationId }: any) {
  await waitForMediaReady(creationId, token);

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: token,
      }),
    },
  );

  const data = await res.json();

  if (data.error) {
    const errorMsg = data.error.message || "Unknown error";
    throw new Error(`Publishing failed: ${errorMsg}`);
  }

  return data;
}

export async function checkMediaStatus(
  containerId: string,
  token: string,
): Promise<{ statusCode: string; status: string }> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${containerId}?fields=status_code,status&access_token=${token}`,
  );
  const data = await res.json();

  if (data.error) {
    throw new Error(`Status check failed: ${data.error.message}`);
  }

  return {
    statusCode: data.status_code || "UNKNOWN",
    status:
      (typeof data.status === "string" && data.status) ||
      data.status?.message ||
      data.status?.description ||
      "",
  };
}

export async function waitForMediaReady(
  containerId: string,
  token: string,
  maxAttempts = 240,
): Promise<void> {
  console.log("[v0] Waiting for media to be ready...");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { statusCode, status } = await checkMediaStatus(containerId, token);
    console.log(
      `[v0] Media status (attempt ${attempt + 1}/${maxAttempts}):`,
      statusCode,
      status,
    );

    if (statusCode === "FINISHED") {
      console.log("[v0] Media is ready for publishing!");
      return;
    }

    if (statusCode === "ERROR") {
      throw new Error(
        status ||
          "Instagram could not process this video. Phone-recorded .mov/.hevc videos often need conversion to H.264 MP4.",
      );
    }

    if (statusCode === "EXPIRED") {
      throw new Error(
        "Media container has expired. Please try uploading again.",
      );
    }

    // Wait 5 seconds before next check (large videos can take longer to process)
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error("Media processing timed out. Please try again later.");
}

export async function getMediaList(igUserId: string, token: string) {
  const res = await fetch(
    `https://graph.facebook.com/v24.0/${igUserId}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,like_count,comments_count&access_token=${token}`,
  );

  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.message || "Failed to fetch media list");
  }

  return data.data || [];
}

function getCloudinaryConfig() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error(
      "Cloudinary is not configured. Add NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET to continue.",
    );
  }

  return { cloudName, uploadPreset };
}

function getCloudinaryResourceType(file: File): "image" | "video" | "raw" {
  if (file.type.startsWith("video/")) {
    return "video";
  }

  if (file.type.startsWith("image/")) {
    return "image";
  }

  return "raw";
}

export async function uploadMediaAssetToCloudinary(
  file: File,
  options?: { folder?: string },
): Promise<{ secureUrl: string; publicId: string; resourceType: string }> {
  const { cloudName, uploadPreset } = getCloudinaryConfig();
  const resourceType = getCloudinaryResourceType(file);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  if (options?.folder) {
    formData.append("folder", options.folder);
  }

  // Cloudinary can automatically split large uploads into smaller chunks.
  if (resourceType === "video" && file.size > 100 * 1024 * 1024) {
    formData.append("chunk_size", "6000000");
  }

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    {
      method: "POST",
      body: formData,
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Cloudinary upload failed: ${errorText}`);
  }

  const data = await res.json();

  if (!data.secure_url || !data.public_id) {
    throw new Error(
      "Cloudinary upload succeeded but response metadata was incomplete",
    );
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
    resourceType: data.resource_type || resourceType,
  };
}

export async function uploadRemoteMediaToCloudinary(
  mediaUrl: string,
  options?: {
    folder?: string;
    resourceType?: "image" | "video" | "raw" | "auto";
  },
): Promise<{ secureUrl: string; publicId: string; resourceType: string }> {
  const { cloudName, uploadPreset } = getCloudinaryConfig();
  const resourceType = options?.resourceType || "auto";
  const formData = new FormData();

  formData.append("file", mediaUrl);
  formData.append("upload_preset", uploadPreset);

  if (options?.folder) {
    formData.append("folder", options.folder);
  }

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    {
      method: "POST",
      body: formData,
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Cloudinary remote upload failed: ${errorText}`);
  }

  const data = await res.json();

  if (!data.secure_url || !data.public_id) {
    throw new Error(
      "Remote upload succeeded but response metadata was incomplete",
    );
  }

  return {
    secureUrl: data.secure_url,
    publicId: data.public_id,
    resourceType: data.resource_type || resourceType,
  };
}

export async function uploadMediaToCloudinary(file: File): Promise<string> {
  const asset = await uploadMediaAssetToCloudinary(file);
  return asset.secureUrl;
}

type MediaInsightMetric = number | "N/A";

type MediaInsightsResult = {
  engagement: MediaInsightMetric;
  impressions: MediaInsightMetric;
  reach: MediaInsightMetric;
  saved: MediaInsightMetric;
  video_views: MediaInsightMetric;
  views: MediaInsightMetric;
  likes: MediaInsightMetric;
  comments: MediaInsightMetric;
};

function getUnavailableMediaInsights(): MediaInsightsResult {
  return {
    engagement: "N/A",
    impressions: "N/A",
    reach: "N/A",
    saved: "N/A",
    video_views: "N/A",
    views: "N/A",
    likes: "N/A",
    comments: "N/A",
  };
}

function getNumericMetricValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function parseInsightsMetrics(
  metrics: Array<{ name?: string; values?: Array<{ value?: unknown }> }> = [],
) {
  const parsed: Record<string, number> = {};

  for (const metric of metrics) {
    if (!metric?.name) {
      continue;
    }

    const value = getNumericMetricValue(metric.values?.[0]?.value);
    if (typeof value === "number") {
      parsed[metric.name] = value;
    }
  }

  return parsed;
}

function isInstagramVideoMedia(mediaType: string) {
  return mediaType === "VIDEO" || mediaType === "REELS";
}

async function fetchMediaInsightMetricValue(
  mediaId: string,
  token: string,
  metric: string,
): Promise<number | undefined> {
  const res = await fetch(
    `https://graph.facebook.com/v24.0/${mediaId}/insights?metric=${metric}&access_token=${token}`,
  );
  const data = await res.json();

  if (data.error) {
    console.log(`[Insights] ${metric} metric error:`, data.error);
    return undefined;
  }

  return getNumericMetricValue(data.data?.[0]?.values?.[0]?.value);
}

export async function getMediaInsights(
  mediaId: string,
  token: string,
  mediaType: string,
): Promise<MediaInsightsResult> {
  try {
    const emptyInsights = getUnavailableMediaInsights();
    let fallbackLikes: number | undefined;
    let fallbackComments: number | undefined;
    let fallbackViews: number | undefined;
    const isVideo = isInstagramVideoMedia(mediaType);

    const [engagementValue, reachValue, savedValue, viewsValue, playsValue] =
      await Promise.all([
        fetchMediaInsightMetricValue(mediaId, token, "engagement"),
        fetchMediaInsightMetricValue(mediaId, token, "reach"),
        fetchMediaInsightMetricValue(mediaId, token, "saved"),
        fetchMediaInsightMetricValue(mediaId, token, "views"),
        isVideo
          ? fetchMediaInsightMetricValue(mediaId, token, "plays")
          : Promise.resolve(undefined),
      ]);

    const mediaRes = await fetch(
      `https://graph.facebook.com/v24.0/${mediaId}?fields=play_count,like_count,comments_count&access_token=${token}`,
    );
    const mediaData = await mediaRes.json();

    if (mediaData.error) {
      console.log("[Insights] Media fallback error:", mediaData.error);
    } else {
      fallbackLikes = getNumericMetricValue(mediaData.like_count);
      fallbackComments = getNumericMetricValue(mediaData.comments_count);
      fallbackViews = getNumericMetricValue(mediaData.play_count);
    }

    const engagement =
      engagementValue ?? fallbackLikes ?? emptyInsights.engagement;
    const reach = reachValue ?? emptyInsights.reach;
    const saved = savedValue ?? emptyInsights.saved;
    const videoViews =
      playsValue ??
      viewsValue ??
      fallbackViews ??
      emptyInsights.video_views;
    const views =
      playsValue ??
      viewsValue ??
      fallbackViews ??
      reachValue ??
      emptyInsights.views;

    return {
      engagement,
      impressions: viewsValue ?? emptyInsights.impressions,
      reach,
      saved,
      video_views: videoViews,
      views,
      likes: fallbackLikes ?? engagement,
      comments: fallbackComments ?? emptyInsights.comments,
    };
  } catch (err) {
    console.error("[Insights] Failed to fetch insights:", err);
    return getUnavailableMediaInsights();
  }
}

export async function getMediaComments(mediaId: string, token: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}/comments?fields=id,text,username,timestamp&access_token=${token}`,
    );

    const data = await res.json();

    if (data.error) {
      console.error("Comments error:", data.error);
      return [];
    }

    return data.data || [];
  } catch (err) {
    console.error("Failed to fetch comments:", err);
    return [];
  }
}

export async function replyToComment(
  commentId: string,
  message: string,
  token: string,
) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${commentId}/replies`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        access_token: token,
      }),
    },
  );

  const data = await res.json();

  if (data.error) {
    throw new Error(data.error.message || "Failed to reply to comment");
  }

  return data;
}

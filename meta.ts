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
  ]

  // Extract existing hashtags from caption
  const existingHashtags = caption.match(/#\w+/g) || []

  // Suggest hashtags based on keywords in caption
  const words = caption.toLowerCase().split(/\s+/)
  const suggestedHashtags = words
    .filter((word) => word.length > 3 && !word.startsWith("#"))
    .slice(0, 5)
    .map((word) => `#${word.replace(/[^a-z0-9]/g, "")}`)

  return [...new Set([...existingHashtags, ...suggestedHashtags, ...commonHashtags])].slice(0, 30)
}

export async function createMedia({ igUserId, token, mediaUrl, caption, isReel, locationId, coverUrl }: any) {
  console.log("[v0] Creating media container with URL:", mediaUrl)

  const body: any = {
    media_type: isReel ? "REELS" : "IMAGE",
    caption,
    access_token: token,
  }

  if (isReel) {
    body.video_url = mediaUrl
    if (coverUrl) {
      body.cover_url = coverUrl
    }
  } else {
    body.image_url = mediaUrl
  }

  if (locationId) {
    body.location_id = locationId
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  console.log("[v0] Instagram API response:", data)

  if (data.error) {
    const errorMsg = data.error.message || "Unknown error"
    const errorCode = data.error.code || ""
    console.error("[v0] Instagram API error:", data.error)
    throw new Error(`Media creation failed (${errorCode}): ${errorMsg}`)
  }

  if (!data.id) {
    throw new Error("Media creation failed: No container ID returned")
  }

  console.log("[v0] Media container created successfully:", data.id)
  return data.id
}

export async function publishMedia({ igUserId, token, creationId }: any) {
  await waitForMediaReady(creationId, token)

  const res = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: creationId,
      access_token: token,
    }),
  })

  const data = await res.json()

  if (data.error) {
    const errorMsg = data.error.message || "Unknown error"
    throw new Error(`Publishing failed: ${errorMsg}`)
  }

  return data
}

export async function checkMediaStatus(containerId: string, token: string): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${token}`)
  const data = await res.json()

  if (data.error) {
    throw new Error(`Status check failed: ${data.error.message}`)
  }

  return data.status_code || "UNKNOWN"
}

export async function waitForMediaReady(containerId: string, token: string, maxAttempts = 30): Promise<void> {
  console.log("[v0] Waiting for media to be ready...")

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await checkMediaStatus(containerId, token)
    console.log(`[v0] Media status (attempt ${attempt + 1}/${maxAttempts}):`, status)

    if (status === "FINISHED") {
      console.log("[v0] Media is ready for publishing!")
      return
    }

    if (status === "ERROR") {
      throw new Error("Media processing failed on Instagram's side")
    }

    if (status === "EXPIRED") {
      throw new Error("Media container has expired. Please try uploading again.")
    }

    // Wait 2 seconds before next check
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error("Media processing timed out. Please try again later.")
}

export async function getMediaList(igUserId: string, token: string) {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}/media?fields=id,media_type,media_url,thumbnail_url,caption,timestamp&access_token=${token}`,
  )

  const data = await res.json()

  if (data.error) {
    throw new Error(data.error.message || "Failed to fetch media list")
  }

  return data.data || []
}

export async function uploadMediaToBlob(file: File): Promise<string> {
  const formData = new FormData()
  formData.append("file", file)

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Failed to upload file: ${errorText}`)
  }

  const data = await res.json()

  if (!data.url) {
    throw new Error("Upload succeeded but no URL returned")
  }

  return data.url
}

export async function getMediaInsights(mediaId: string, token: string, mediaType: string) {
  try {
    let metrics = "engagement,impressions,reach"

    if (mediaType === "IMAGE" || mediaType === "CAROUSEL_ALBUM") {
      metrics = "engagement,impressions,reach,saved"
    } else if (mediaType === "VIDEO" || mediaType === "REELS") {
      metrics = "engagement,impressions,reach,saved,video_views"
    }

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}/insights?metric=${metrics}&access_token=${token}`,
    )

    const data = await res.json()

    if (data.error) {
      console.log("[v0] Insights API error:", data.error)

      if (data.error.code === 10 || data.error.code === 100) {
        console.log("[v0] Insights not available for this media (permissions or not enough data)")
        return {
          engagement: "N/A",
          impressions: "N/A",
          reach: "N/A",
          saved: "N/A",
          views: "N/A",
        }
      }

      return {}
    }

    const insights: any = {}
    if (data.data) {
      data.data.forEach((metric: any) => {
        insights[metric.name] = metric.values?.[0]?.value || 0
      })
    }

    return {
      engagement: insights.engagement || 0,
      impressions: insights.impressions || 0,
      reach: insights.reach || 0,
      saved: insights.saved || 0,
      views: insights.video_views || insights.reach || 0,
    }
  } catch (err) {
    console.error("[v0] Failed to fetch insights:", err)
    return {
      engagement: "N/A",
      impressions: "N/A",
      reach: "N/A",
      saved: "N/A",
      views: "N/A",
    }
  }
}

export async function getMediaComments(mediaId: string, token: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${mediaId}/comments?fields=id,text,username,timestamp&access_token=${token}`,
    )

    const data = await res.json()

    if (data.error) {
      console.error("Comments error:", data.error)
      return []
    }

    return data.data || []
  } catch (err) {
    console.error("Failed to fetch comments:", err)
    return []
  }
}

export async function replyToComment(commentId: string, message: string, token: string) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${commentId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      access_token: token,
    }),
  })

  const data = await res.json()

  if (data.error) {
    throw new Error(data.error.message || "Failed to reply to comment")
  }

  return data
}

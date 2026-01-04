export async function getYouTubeVideoDetails(videoId: string, accessToken: string) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,status&id=${videoId}&access_token=${accessToken}`,
    )

    if (!response.ok) {
      throw new Error("Failed to fetch video details")
    }

    const data = await response.json()
    if (!data.items || data.items.length === 0) {
      throw new Error("Video not found")
    }

    const video = data.items[0]
    return {
      id: video.id,
      title: video.snippet.title,
      description: video.snippet.description,
      thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url,
      publishedAt: video.snippet.publishedAt,
      viewCount: video.statistics?.viewCount || 0,
      likeCount: video.statistics?.likeCount || 0,
      commentCount: video.statistics?.commentCount || 0,
      privacyStatus: video.status?.privacyStatus,
    }
  } catch (error) {
    console.error("[v0] Failed to fetch YouTube video details:", error)
    return null
  }
}

export async function getYouTubeComments(videoId: string, accessToken: string) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&access_token=${accessToken}`,
    )

    if (!response.ok) {
      const errorData = await response.json()
      console.error("[v0] YouTube comments error:", errorData)
      return []
    }

    const data = await response.json()

    return (
      data.items?.map((item: any) => ({
        id: item.id,
        text: item.snippet.topLevelComment.snippet.textDisplay,
        author: item.snippet.topLevelComment.snippet.authorDisplayName,
        authorProfileImage: item.snippet.topLevelComment.snippet.authorProfileImageUrl,
        likeCount: item.snippet.topLevelComment.snippet.likeCount,
        publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
        videoId: item.snippet.videoId,
      })) || []
    )
  } catch (error) {
    console.error("[v0] Failed to fetch YouTube comments:", error)
    return []
  }
}

export async function replyToYouTubeComment(commentId: string, message: string, accessToken: string) {
  try {
    const response = await fetch("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          parentId: commentId,
          textOriginal: message,
        },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error?.message || "Failed to reply to comment")
    }

    return await response.json()
  } catch (error: any) {
    console.error("[v0] Failed to reply to YouTube comment:", error)
    throw error
  }
}

export async function getChannelAnalytics(channelId: string, accessToken: string) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&access_token=${accessToken}`,
    )

    if (!response.ok) {
      throw new Error("Failed to fetch channel analytics")
    }

    const data = await response.json()
    if (!data.items || data.items.length === 0) {
      return null
    }

    const stats = data.items[0].statistics
    return {
      subscriberCount: stats.subscriberCount || 0,
      viewCount: stats.viewCount || 0,
      videoCount: stats.videoCount || 0,
    }
  } catch (error) {
    console.error("[v0] Failed to fetch channel analytics:", error)
    return null
  }
}

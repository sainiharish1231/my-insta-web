"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { getMediaList, getMediaComments, replyToComment } from "@/src/lib/meta"
import { getYouTubeComments, replyToYouTubeComment } from "@/src/lib/youtube"
import {
  ArrowLeft,
  Send,
  MessageCircle,
  RefreshCw,
  Loader2,
  User,
  Search,
  CheckSquare,
  Square,
  Instagram,
  Youtube,
  Clock,
  ThumbsUp,
} from "lucide-react"

interface Comment {
  id: string
  text: string
  username?: string
  author?: string
  timestamp: string
  likeCount?: number
  authorProfileImage?: string
  platform: "instagram" | "youtube"
  mediaId: string
  videoId?: string
}

interface MediaWithComments {
  id: string
  caption?: string
  title?: string
  media_url?: string
  thumbnail_url?: string
  thumbnail?: string
  media_type?: string
  platform: "instagram" | "youtube"
  comments: Comment[]
  accountUsername: string
}

export default function CommentsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [mediaList, setMediaList] = useState<MediaWithComments[]>([])
  const [filteredMediaList, setFilteredMediaList] = useState<MediaWithComments[]>([])
  const [replyText, setReplyText] = useState<Record<string, string>>({})
  const [replying, setReplying] = useState<Record<string, boolean>>({})
  const [selectedComments, setSelectedComments] = useState<Set<string>>(new Set())
  const [filterPlatform, setFilterPlatform] = useState<"all" | "instagram" | "youtube">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const quickReplies = [
    "Thank you!",
    "Appreciate your comment!",
    "Thanks for watching!",
    "Glad you enjoyed it!",
    "Thanks for the support!",
  ]

  const applyQuickReply = (commentId: string, message: string) => {
    setReplyText({ ...replyText, [commentId]: message })
  }

  useEffect(() => {
    const igAccountsStored = JSON.parse(localStorage.getItem("ig_accounts") || "[]")
    const ytAccountsStored = JSON.parse(localStorage.getItem("youtube_accounts") || "[]")

    if (igAccountsStored.length === 0 && ytAccountsStored.length === 0) {
      router.push("/")
      return
    }

    loadAllComments(igAccountsStored, ytAccountsStored)
  }, [router])

  useEffect(() => {
    let filtered = mediaList

    if (filterPlatform !== "all") {
      filtered = filtered.filter((m) => m.platform === filterPlatform)
    }

    if (searchQuery) {
      filtered = filtered.filter(
        (m) =>
          m.caption?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.comments.some(
            (c) =>
              c.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
              c.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
              c.author?.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
      )
    }

    setFilteredMediaList(filtered)
  }, [mediaList, filterPlatform, searchQuery])

  const loadAllComments = async (igAccounts: any[], ytAccounts: any[], isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)

      const allMediaWithComments: MediaWithComments[] = []

      for (const igAccount of igAccounts) {
        try {
          const media = await getMediaList(igAccount.id, igAccount.token)

          for (const item of media.slice(0, 10)) {
            try {
              const comments = await getMediaComments(item.id, igAccount.token)
              if (comments.length > 0) {
                allMediaWithComments.push({
                  ...item,
                  platform: "instagram",
                  accountUsername: igAccount.username,
                  comments: comments.map((c: any) => ({
                    ...c,
                    platform: "instagram",
                    mediaId: item.id,
                    username: c.username,
                  })),
                })
              }
            } catch (err) {
              console.error(`[v0] Failed to load comments for Instagram media ${item.id}`)
            }
          }
        } catch (err) {
          console.error(`[v0] Failed to load Instagram media for ${igAccount.username}`)
        }
      }

      for (const ytAccount of ytAccounts) {
        try {
          // Get recent videos from channel
          const channelResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${ytAccount.id}&order=date&type=video&maxResults=10&access_token=${ytAccount.accessToken}`,
          )

          if (channelResponse.ok) {
            const channelData = await channelResponse.json()

            for (const video of channelData.items || []) {
              try {
                const comments = await getYouTubeComments(video.id.videoId, ytAccount.accessToken)
                if (comments.length > 0) {
                  allMediaWithComments.push({
                    id: video.id.videoId,
                    title: video.snippet.title,
                    caption: video.snippet.description,
                    thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url,
                    platform: "youtube",
                    accountUsername: ytAccount.name,
                    comments: comments.map((c: any) => ({
                      ...c,
                      platform: "youtube",
                      mediaId: video.id.videoId,
                      videoId: video.id.videoId,
                      author: c.author,
                    })),
                  })
                }
              } catch (err) {
                console.error(`[v0] Failed to load comments for YouTube video ${video.id.videoId}`)
              }
            }
          }
        } catch (err) {
          console.error(`[v0] Failed to load YouTube videos for ${ytAccount.name}`)
        }
      }

      setMediaList(allMediaWithComments)
    } catch (err: any) {
      console.error("[v0] Error loading comments:", err)
      setError(err.message || "Failed to load comments")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleRefresh = () => {
    const igAccountsStored = JSON.parse(localStorage.getItem("ig_accounts") || "[]")
    const ytAccountsStored = JSON.parse(localStorage.getItem("youtube_accounts") || "[]")
    loadAllComments(igAccountsStored, ytAccountsStored, true)
  }

  const handleReply = async (comment: Comment) => {
    if (!replyText[comment.id]) return

    try {
      setReplying({ ...replying, [comment.id]: true })

      if (comment.platform === "instagram") {
        const igAccountsStored = JSON.parse(localStorage.getItem("ig_accounts") || "[]")
        const mediaItem = mediaList.find((m) => m.id === comment.mediaId)
        const igAccount = igAccountsStored.find((a: any) => a.username === mediaItem?.accountUsername)

        if (!igAccount) throw new Error("Account not found")

        await replyToComment(comment.id, replyText[comment.id], igAccount.token)
      } else if (comment.platform === "youtube") {
        const ytAccountsStored = JSON.parse(localStorage.getItem("youtube_accounts") || "[]")
        const mediaItem = mediaList.find((m) => m.id === comment.videoId)
        const ytAccount = ytAccountsStored.find((a: any) => a.name === mediaItem?.accountUsername)

        if (!ytAccount) throw new Error("Account not found")

        await replyToYouTubeComment(comment.id, replyText[comment.id], ytAccount.accessToken)
      }

      setReplyText({ ...replyText, [comment.id]: "" })
      alert("Reply sent successfully!")
    } catch (err: any) {
      console.error("[v0] Reply error:", err)
      alert(err.message || "Failed to send reply")
    } finally {
      setReplying({ ...replying, [comment.id]: false })
    }
  }

  const toggleCommentSelection = (commentId: string) => {
    const newSelected = new Set(selectedComments)
    if (newSelected.has(commentId)) {
      newSelected.delete(commentId)
    } else {
      newSelected.add(commentId)
    }
    setSelectedComments(newSelected)
  }

  const selectAllComments = () => {
    const allCommentIds = new Set<string>()
    filteredMediaList.forEach((media) => {
      media.comments.forEach((comment) => {
        allCommentIds.add(comment.id)
      })
    })
    setSelectedComments(allCommentIds)
  }

  const deselectAllComments = () => {
    setSelectedComments(new Set())
  }

  const handleBulkReply = (message: string) => {
    selectedComments.forEach((commentId) => {
      setReplyText({ ...replyText, [commentId]: message })
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-pink-500 animate-spin" />
          <p className="text-white/60">Loading comments...</p>
        </div>
      </div>
    )
  }

  const totalComments = filteredMediaList.reduce((sum, m) => sum + m.comments.length, 0)

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push("/dashboard")}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-white/60" />
              </button>
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-pink-400" />
                <h1 className="text-xl font-semibold text-white">Comments Manager</h1>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-white/70 transition-colors border border-white/10"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search comments, usernames, captions..."
                className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setFilterPlatform("all")}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                  filterPlatform === "all"
                    ? "bg-pink-500 border-pink-500 text-white"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterPlatform("instagram")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                  filterPlatform === "instagram"
                    ? "bg-gradient-to-br from-purple-500 to-pink-500 border-transparent text-white"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                }`}
              >
                <Instagram className="w-4 h-4" />
                Instagram
              </button>
              <button
                onClick={() => setFilterPlatform("youtube")}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                  filterPlatform === "youtube"
                    ? "bg-red-500 border-red-500 text-white"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                }`}
              >
                <Youtube className="w-4 h-4" />
                YouTube
              </button>
            </div>
          </div>

          {selectedComments.size > 0 && (
            <div className="mt-4 flex items-center justify-between p-3 bg-pink-500/10 border border-pink-500/30 rounded-xl">
              <span className="text-sm text-pink-400 font-medium">{selectedComments.size} comments selected</span>
              <div className="flex items-center gap-2">
                <select
                  onChange={(e) => e.target.value && handleBulkReply(e.target.value)}
                  className="px-3 py-1.5 bg-white/10 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                  defaultValue=""
                >
                  <option value="" disabled>
                    Quick Reply
                  </option>
                  {quickReplies.map((reply, idx) => (
                    <option key={idx} value={reply}>
                      {reply}
                    </option>
                  ))}
                </select>
                <button
                  onClick={deselectAllComments}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
              <span className="text-white/60 text-sm">Total: </span>
              <span className="text-white font-semibold">{totalComments} comments</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAllComments}
              className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white/70 transition-colors border border-white/10"
            >
              <CheckSquare className="w-4 h-4" />
              Select All
            </button>
          </div>
        </div>

        {filteredMediaList.length === 0 ? (
          <div className="bg-slate-900/50 rounded-2xl p-12 text-center border border-white/10">
            <MessageCircle className="w-12 h-12 text-white/30 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">No Comments Found</h2>
            <p className="text-white/50">
              {searchQuery || filterPlatform !== "all"
                ? "Try adjusting your filters or search query."
                : "Comments on your posts will appear here."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredMediaList.map((media) => (
              <div
                key={media.id}
                className="bg-slate-900/50 backdrop-blur-sm rounded-2xl overflow-hidden border border-white/10"
              >
                <div className="p-4 bg-white/5 border-b border-white/10">
                  <div className="flex items-center gap-4">
                    {(media.media_url || media.thumbnail_url || media.thumbnail) && (
                      <img
                        src={media.thumbnail || media.thumbnail_url || media.media_url}
                        alt="Media"
                        className="w-20 h-20 rounded-xl object-cover"
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {media.platform === "instagram" ? (
                          <Instagram className="w-4 h-4 text-pink-400" />
                        ) : (
                          <Youtube className="w-4 h-4 text-red-400" />
                        )}
                        <span className="text-white/60 text-sm">@{media.accountUsername}</span>
                      </div>
                      <p className="text-white/70 text-sm line-clamp-2">
                        {media.title || media.caption || "No caption"}
                      </p>
                    </div>
                    <span className="px-3 py-1 bg-pink-500/20 text-pink-400 text-xs font-medium rounded-full">
                      {media.comments.length} comments
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-white/5">
                  {media.comments.map((comment) => (
                    <div key={comment.id} className="p-4 hover:bg-white/5 transition-colors">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggleCommentSelection(comment.id)}
                          className="mt-1 p-1 hover:bg-white/10 rounded transition-colors"
                        >
                          {selectedComments.has(comment.id) ? (
                            <CheckSquare className="w-5 h-5 text-pink-400" />
                          ) : (
                            <Square className="w-5 h-5 text-white/30" />
                          )}
                        </button>

                        {comment.authorProfileImage ? (
                          <img
                            src={comment.authorProfileImage || "/placeholder.svg"}
                            alt={comment.author || comment.username}
                            className="w-10 h-10 rounded-full"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-purple-500 rounded-full flex items-center justify-center">
                            <User className="w-5 h-5 text-white" />
                          </div>
                        )}

                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-white">
                              {comment.author || comment.username || "Unknown"}
                            </span>
                            <span className="text-xs text-white/30 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(comment.timestamp).toLocaleDateString()}
                            </span>
                            {comment.likeCount !== undefined && comment.likeCount > 0 && (
                              <span className="text-xs text-white/40 flex items-center gap-1">
                                <ThumbsUp className="w-3 h-3" />
                                {comment.likeCount}
                              </span>
                            )}
                          </div>
                          <p className="text-white/70 mb-3">{comment.text}</p>

                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-2">
                              {quickReplies.map((reply, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => applyQuickReply(comment.id, reply)}
                                  className="px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs text-white/70 transition-colors"
                                >
                                  {reply}
                                </button>
                              ))}
                            </div>

                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="Write a reply..."
                                value={replyText[comment.id] || ""}
                                onChange={(e) => setReplyText({ ...replyText, [comment.id]: e.target.value })}
                                className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                              />
                              <button
                                onClick={() => handleReply(comment)}
                                disabled={!replyText[comment.id] || replying[comment.id]}
                                className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl text-white text-sm font-medium flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
                              >
                                {replying[comment.id] ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Send className="w-4 h-4" />
                                )}
                                Reply
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

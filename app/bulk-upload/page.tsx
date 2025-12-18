"use client"
import { useState, useRef, useEffect } from "react"
import type React from "react"

import { useRouter } from "next/navigation"
import { ArrowLeft, FolderOpen, Upload, Check, Clock, AlertCircle, Play, Pause, Trash2 } from "lucide-react"

interface VideoFile {
  id: string
  file: File
  preview: string
  status: "pending" | "processing" | "uploaded" | "error"
  uploadedUrl?: string
  error?: string
  processedAt?: string
}

interface QueueSettings {
  title: string
  description: string
  keywords: string
  intervalMinutes: number
}

export default function BulkUploadPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [videos, setVideos] = useState<VideoFile[]>([])
  const [settings, setSettings] = useState<QueueSettings>({
    title: "",
    description: "",
    keywords: "",
    intervalMinutes: 5,
  })
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  const handleFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const videoFiles = files.filter((file) => file.type.startsWith("video/"))

    const newVideos: VideoFile[] = await Promise.all(
      videoFiles.map(async (file) => {
        const preview = URL.createObjectURL(file)
        return {
          id: `${Date.now()}-${Math.random()}`,
          file,
          preview,
          status: "pending" as const,
        }
      }),
    )

    setVideos((prev) => [...prev, ...newVideos])
  }

  const removeVideo = (id: string) => {
    setVideos((prev) => {
      const video = prev.find((v) => v.id === id)
      if (video) {
        URL.revokeObjectURL(video.preview)
      }
      return prev.filter((v) => v.id !== id)
    })
  }

  const startBulkUpload = async () => {
    if (videos.length === 0) {
      alert("Please add at least one video")
      return
    }

    if (!settings.title || !settings.description) {
      alert("Please fill in title and description")
      return
    }

    setIsProcessing(true)
    processNextVideo()
  }

  const processNextVideo = async () => {
    const pendingVideos = videos.filter((v) => v.status === "pending")

    if (pendingVideos.length === 0) {
      stopProcessing()
      return
    }

    const nextVideo = pendingVideos[0]

    // Update status to processing
    setVideos((prev) => prev.map((v) => (v.id === nextVideo.id ? { ...v, status: "processing" } : v)))

    try {
      const formData = new FormData()
      formData.append("file", nextVideo.file)

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!uploadRes.ok) {
        throw new Error("Failed to upload video")
      }

      const { url } = await uploadRes.json()

      const igAccounts = JSON.parse(localStorage.getItem("ig_accounts") || "[]")
      const ytAccounts = JSON.parse(localStorage.getItem("youtube_accounts") || "[]")

      for (const account of igAccounts) {
        try {
          const caption = `${settings.title}\n\n${settings.description}\n\n${settings.keywords
            .split(",")
            .map((k) => `#${k.trim()}`)
            .join(" ")}`

          const createRes = await fetch(`https://graph.facebook.com/v21.0/${account.id}/media`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              video_url: url,
              caption,
              media_type: "REELS",
              access_token: account.token,
            }),
          })

          const createData = await createRes.json()

          if (createData.id) {
            // Wait for processing
            await new Promise((resolve) => setTimeout(resolve, 5000))

            // Publish
            await fetch(`https://graph.facebook.com/v21.0/${account.id}/media_publish`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                creation_id: createData.id,
                access_token: account.token,
              }),
            })
          }
        } catch (err) {
          console.error(`[v0] Failed to upload to Instagram account ${account.username}:`, err)
        }
      }

      for (const account of ytAccounts) {
        try {
          const uploadResponse = await fetch("/api/youtube/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: account.accessToken,
              videoUrl: url,
              title: settings.title,
              description: settings.description,
              keywords: settings.keywords
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean),
              privacy: "public",
              isShort: true,
            }),
          })

          if (!uploadResponse.ok) {
            console.error(`[v0] Failed to upload to YouTube account ${account.name}`)
          }
        } catch (err) {
          console.error(`[v0] Failed to upload to YouTube account ${account.name}:`, err)
        }
      }

      setVideos((prev) =>
        prev.map((v) =>
          v.id === nextVideo.id
            ? {
                ...v,
                status: "uploaded",
                uploadedUrl: url,
                processedAt: new Date().toISOString(),
              }
            : v,
        ),
      )

      if (pendingVideos.length > 1) {
        intervalRef.current = setTimeout(
          () => {
            processNextVideo()
          },
          settings.intervalMinutes * 60 * 1000,
        )
      } else {
        stopProcessing()
      }
    } catch (error: any) {
      setVideos((prev) =>
        prev.map((v) =>
          v.id === nextVideo.id
            ? {
                ...v,
                status: "error",
                error: error.message,
              }
            : v,
        ),
      )
      stopProcessing()
    }
  }

  const stopProcessing = () => {
    setIsProcessing(false)
    if (intervalRef.current) {
      clearTimeout(intervalRef.current)
      intervalRef.current = null
    }
  }

  const stats = {
    total: videos.length,
    pending: videos.filter((v) => v.status === "pending").length,
    processing: videos.filter((v) => v.status === "processing").length,
    uploaded: videos.filter((v) => v.status === "uploaded").length,
    error: videos.filter((v) => v.status === "error").length,
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push("/dashboard")}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-white/60" />
              </button>
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-pink-400" />
                <h1 className="text-xl font-semibold text-white">Bulk Upload Automation</h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isProcessing ? (
                <button
                  onClick={stopProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 rounded-xl text-white font-medium transition-colors"
                >
                  <Pause className="w-4 h-4" />
                  Stop Queue
                </button>
              ) : (
                <button
                  onClick={startBulkUpload}
                  disabled={videos.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-red-500 hover:from-pink-600 hover:to-red-600 rounded-xl text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" />
                  Start Upload Queue
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="text-2xl font-bold text-white">{stats.total}</div>
            <div className="text-sm text-white/60">Total Videos</div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-yellow-500/30">
            <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
            <div className="text-sm text-white/60">Pending</div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-blue-500/30">
            <div className="text-2xl font-bold text-blue-400">{stats.processing}</div>
            <div className="text-sm text-white/60">Processing</div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-green-500/30">
            <div className="text-2xl font-bold text-green-400">{stats.uploaded}</div>
            <div className="text-sm text-white/60">Uploaded</div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-red-500/30">
            <div className="text-2xl font-bold text-red-400">{stats.error}</div>
            <div className="text-sm text-white/60">Failed</div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Settings */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold text-white mb-4">Upload Settings</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">Title (for YouTube)</label>
                  <input
                    type="text"
                    value={settings.title}
                    onChange={(e) => setSettings({ ...settings, title: e.target.value })}
                    placeholder="Enter video title..."
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Description (for Instagram caption)
                  </label>
                  <textarea
                    value={settings.description}
                    onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                    placeholder="Enter description..."
                    rows={4}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">Keywords (comma separated)</label>
                  <input
                    type="text"
                    value={settings.keywords}
                    onChange={(e) => setSettings({ ...settings, keywords: e.target.value })}
                    placeholder="tech, coding, tutorial"
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                  <p className="text-xs text-white/40 mt-1">Will be added as hashtags for Instagram</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">Upload Interval</label>
                  <select
                    value={settings.intervalMinutes}
                    onChange={(e) => setSettings({ ...settings, intervalMinutes: Number(e.target.value) })}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                  >
                    <option value="5">Every 5 minutes</option>
                    <option value="10">Every 10 minutes</option>
                    <option value="15">Every 15 minutes</option>
                    <option value="30">Every 30 minutes</option>
                    <option value="60">Every 1 hour</option>
                  </select>
                </div>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border-2 border-dashed border-white/20 rounded-xl text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FolderOpen className="w-5 h-5" />
                  Select Videos from Folder
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  onChange={handleFilesSelect}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          {/* Video Queue */}
          <div className="lg:col-span-2">
            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold text-white mb-4">Video Queue ({videos.length})</h2>

              {videos.length === 0 ? (
                <div className="text-center py-12">
                  <Upload className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-white/40">No videos in queue</p>
                  <p className="text-sm text-white/30 mt-1">Select videos from a folder to get started</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  {videos.map((video, index) => (
                    <div
                      key={video.id}
                      className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                        video.status === "processing"
                          ? "border-blue-500/50 bg-blue-500/5"
                          : video.status === "uploaded"
                            ? "border-green-500/50 bg-green-500/5"
                            : video.status === "error"
                              ? "border-red-500/50 bg-red-500/5"
                              : "border-white/10 bg-white/5"
                      }`}
                    >
                      <div className="relative">
                        <video src={video.preview} className="w-20 h-20 object-cover rounded-lg" />
                        {video.status === "processing" && (
                          <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium truncate">{video.file.name}</p>
                        <p className="text-sm text-white/40">{(video.file.size / 1024 / 1024).toFixed(2)} MB</p>
                        {video.processedAt && (
                          <p className="text-xs text-green-400 mt-1">
                            Uploaded at {new Date(video.processedAt).toLocaleTimeString()}
                          </p>
                        )}
                        {video.error && <p className="text-xs text-red-400 mt-1">{video.error}</p>}
                      </div>

                      <div className="flex items-center gap-2">
                        {video.status === "pending" && (
                          <>
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/10 rounded-lg">
                              <Clock className="w-4 h-4 text-yellow-400" />
                              <span className="text-sm text-yellow-400">Pending</span>
                            </div>
                            <button
                              onClick={() => removeVideo(video.id)}
                              disabled={isProcessing}
                              className="p-2 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="w-4 h-4 text-red-400" />
                            </button>
                          </>
                        )}
                        {video.status === "processing" && (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 rounded-lg">
                            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                            <span className="text-sm text-blue-400">Uploading...</span>
                          </div>
                        )}
                        {video.status === "uploaded" && (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 rounded-lg">
                            <Check className="w-4 h-4 text-green-400" />
                            <span className="text-sm text-green-400">Uploaded</span>
                          </div>
                        )}
                        {video.status === "error" && (
                          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 rounded-lg">
                            <AlertCircle className="w-4 h-4 text-red-400" />
                            <span className="text-sm text-red-400">Failed</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

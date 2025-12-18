"use client"
import { useState, useEffect, useRef } from "react"
import type React from "react"

import { useRouter, useSearchParams } from "next/navigation"
import { createMedia, publishMedia, uploadMediaToBlob } from "@/src/lib/meta"
import {
  ArrowLeft,
  Upload,
  Youtube,
  CheckCircle,
  XCircle,
  Loader2,
  Instagram,
  Globe,
  X,
  Check,
  Calendar,
  Clock,
  MapPin,
  Sparkles,
} from "lucide-react"
import { HashtagPicker } from "@/components/hashtag-picker"

interface SelectedAccount {
  id: string
  username: string
  profile_picture_url?: string
  platform: "instagram" | "youtube"
  status: "pending" | "uploading" | "success" | "error"
  error?: string
  token?: string
}

interface AvailableAccount {
  id: string
  username: string
  profile_picture_url?: string
  platform: "instagram" | "youtube"
  token?: string
  followers_count?: number
  subscriberCount?: string
}

type ContentType = "POST" | "REEL" | "VIDEO" | "SHORT"

export default function UploadPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [caption, setCaption] = useState("")
  const [title, setTitle] = useState("")
  const [keywords, setKeywords] = useState("")
  const [mediaUrl, setMediaUrl] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string>("")
  const [contentType, setContentType] = useState<ContentType>("POST")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState<string>("")
  const [selectedAccounts, setSelectedAccounts] = useState<SelectedAccount[]>([])
  const [availableAccounts, setAvailableAccounts] = useState<AvailableAccount[]>([])
  const [showAccountSelector, setShowAccountSelector] = useState(false)
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string>("")
  const [scheduleType, setScheduleType] = useState<"now" | "schedule">("now")
  const [scheduleDate, setScheduleDate] = useState("")
  const [scheduleTime, setScheduleTime] = useState("")
  const [selectedHashtags, setSelectedHashtags] = useState<string[]>([])
  const [showHashtagPicker, setShowHashtagPicker] = useState(false)
  const [location, setLocation] = useState("")

  useEffect(() => {
    const igAccountsStored = JSON.parse(localStorage.getItem("ig_accounts") || "[]")
    const ytAccountsStored = JSON.parse(localStorage.getItem("youtube_accounts") || "[]")

    if (igAccountsStored.length === 0 && ytAccountsStored.length === 0) {
      router.push("/")
      return
    }

    const allAvailable: AvailableAccount[] = [
      ...igAccountsStored.map((acc: any) => ({
        id: acc.id,
        username: acc.username,
        profile_picture_url: acc.profile_picture_url,
        platform: "instagram" as const,
        token: acc.token,
        followers_count: acc.followers_count,
      })),
      ...ytAccountsStored.map((acc: any) => ({
        id: acc.id,
        username: acc.name,
        profile_picture_url: acc.thumbnail,
        platform: "youtube" as const,
        token: acc.accessToken,
        subscriberCount: acc.subscriberCount,
      })),
    ]
    setAvailableAccounts(allAvailable)

    setSelectedAccounts(
      allAvailable.map((acc) => ({
        ...acc,
        status: "pending" as const,
      })),
    )
  }, [router])

  const toggleAccountSelection = (accountId: string) => {
    const account = availableAccounts.find((acc) => acc.id === accountId)
    if (!account) return

    setSelectedAccounts((prev) => {
      const isSelected = prev.some((acc) => acc.id === accountId)
      if (isSelected) {
        return prev.filter((acc) => acc.id !== accountId)
      } else {
        return [
          ...prev,
          {
            ...account,
            status: "pending" as const,
          },
        ]
      }
    })
  }

  const removeAccount = (accountId: string) => {
    setSelectedAccounts((prev) => prev.filter((acc) => acc.id !== accountId))
  }

  const handleSubmit = async () => {
    if (selectedAccounts.length === 0) {
      setError("Please select at least one account")
      return
    }

    if (scheduleType === "schedule") {
      if (!scheduleDate || !scheduleTime) {
        setError("Please select a date and time for scheduling")
        return
      }
      const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}`)
      if (scheduledDateTime <= new Date()) {
        setError("Scheduled time must be in the future")
        return
      }
    }

    setIsLoading(true)
    setError("")

    try {
      const ytAccountsStored = JSON.parse(localStorage.getItem("youtube_accounts") || "[]")

      let finalMediaUrl = mediaUrl

      if (selectedFile && !uploadedFileUrl) {
        setProgress("Uploading file...")
        finalMediaUrl = await uploadMediaToBlob(selectedFile)
        setUploadedFileUrl(finalMediaUrl)

        if (finalMediaUrl.includes("localhost") || finalMediaUrl.includes("127.0.0.1")) {
          throw new Error("Local URLs won't work! Please deploy your app first.")
        }
      } else if (uploadedFileUrl) {
        finalMediaUrl = uploadedFileUrl
      } else if (!mediaUrl) {
        throw new Error("Please provide a media URL or select a file")
      }

      const finalCaption = selectedHashtags.length > 0 ? `${caption}\n\n${selectedHashtags.join(" ")}` : caption

      if (scheduleType === "schedule") {
        const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}`)

        const scheduledPosts = JSON.parse(localStorage.getItem("scheduled_posts") || "[]")
        scheduledPosts.push({
          id: Date.now().toString(),
          mediaUrl: finalMediaUrl,
          caption: finalCaption,
          title,
          keywords,
          contentType,
          location,
          accounts: selectedAccounts.map((acc) => ({
            id: acc.id,
            username: acc.username,
            platform: acc.platform,
            token: acc.token,
          })),
          scheduledFor: scheduledDateTime.toISOString(),
          status: "scheduled",
        })
        localStorage.setItem("scheduled_posts", JSON.stringify(scheduledPosts))

        setProgress("Post scheduled successfully!")
        setTimeout(() => {
          router.push("/dashboard")
        }, 2000)
        return
      }

      for (let i = 0; i < selectedAccounts.length; i++) {
        const account = selectedAccounts[i]

        setSelectedAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, status: "uploading" } : a)))

        setProgress(
          `Publishing to ${account.platform === "youtube" ? "" : "@"}${account.username} (${i + 1}/${selectedAccounts.length})...`,
        )

        try {
          if (account.platform === "instagram" && account.token) {
            const isReel = contentType === "REEL"
            const creationId = await createMedia({
              igUserId: account.id,
              token: account.token,
              mediaUrl: finalMediaUrl,
              caption: finalCaption,
              isReel,
              locationId: location || undefined,
            })

            await publishMedia({
              igUserId: account.id,
              token: account.token,
              creationId,
            })
          } else if (account.platform === "youtube") {
            const ytAccount = ytAccountsStored.find((a: any) => a.id === account.id)
            if (!ytAccount?.accessToken) {
              throw new Error("YouTube access token not found. Please reconnect your YouTube account.")
            }

            const uploadResponse = await fetch("/api/youtube/upload", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                accessToken: ytAccount.accessToken,
                videoUrl: finalMediaUrl,
                title: title || caption.substring(0, 100) || "Untitled Video",
                description: caption,
                keywords: keywords
                  .split(",")
                  .map((k) => k.trim())
                  .filter(Boolean),
                privacy: "public",
                isShort: contentType === "SHORT",
              }),
            })

            if (!uploadResponse.ok) {
              const errorData = await uploadResponse.json()
              throw new Error(errorData.error || "YouTube upload failed")
            }

            const result = await uploadResponse.json()
            console.log("[v0] YouTube video uploaded:", result.url)
          }

          setSelectedAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, status: "success" } : a)))
        } catch (err: any) {
          setSelectedAccounts((prev) =>
            prev.map((a) => (a.id === account.id ? { ...a, status: "error", error: err.message } : a)),
          )
        }
      }

      setProgress("Done!")

      const allSuccess = selectedAccounts.every((a) => a.status === "success")
      if (allSuccess) {
        setTimeout(() => {
          router.push("/dashboard")
        }, 2000)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setFilePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleRemoveFile = () => {
    setSelectedFile(null)
    setFilePreview("")
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-white/60" />
            </button>
            <div className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-pink-400" />
              <h1 className="text-xl font-semibold text-white">Create Content</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10 mb-6">
          <h2 className="text-lg font-semibold text-white mb-4">Content Type</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button
              onClick={() => setContentType("POST")}
              className={`p-4 rounded-xl border-2 transition-all ${
                contentType === "POST"
                  ? "border-pink-500 bg-pink-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <Instagram className="w-6 h-6 mx-auto mb-2 text-pink-400" />
              <p className="text-sm font-medium text-white">Instagram Post</p>
            </button>
            <button
              onClick={() => setContentType("REEL")}
              className={`p-4 rounded-xl border-2 transition-all ${
                contentType === "REEL"
                  ? "border-pink-500 bg-pink-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <Instagram className="w-6 h-6 mx-auto mb-2 text-purple-400" />
              <p className="text-sm font-medium text-white">Instagram Reel</p>
            </button>
            <button
              onClick={() => setContentType("VIDEO")}
              className={`p-4 rounded-xl border-2 transition-all ${
                contentType === "VIDEO"
                  ? "border-red-500 bg-red-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <Youtube className="w-6 h-6 mx-auto mb-2 text-red-400" />
              <p className="text-sm font-medium text-white">YouTube Video</p>
            </button>
            <button
              onClick={() => setContentType("SHORT")}
              className={`p-4 rounded-xl border-2 transition-all ${
                contentType === "SHORT"
                  ? "border-red-500 bg-red-500/10"
                  : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <Youtube className="w-6 h-6 mx-auto mb-2 text-orange-400" />
              <p className="text-sm font-medium text-white">YouTube Short</p>
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left Column - Media Upload */}
          <div className="space-y-6">
            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold text-white mb-4">Media Upload</h2>

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center cursor-pointer hover:border-pink-500/50 transition-colors"
              >
                {filePreview ? (
                  <div className="relative">
                    {selectedFile?.type.startsWith("video/") ? (
                      <video src={filePreview} className="max-h-64 mx-auto rounded-lg" controls />
                    ) : (
                      <img
                        src={filePreview || "/placeholder.svg"}
                        alt="Preview"
                        className="max-h-64 mx-auto rounded-lg"
                      />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemoveFile()
                      }}
                      className="absolute top-2 right-2 p-2 bg-red-500 rounded-full hover:bg-red-600 transition-colors"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="p-4 bg-white/5 rounded-full">
                      <Upload className="w-8 h-8 text-white/40" />
                    </div>
                    <div>
                      <p className="text-white font-medium mb-1">Click to upload</p>
                      <p className="text-sm text-white/40">or drag and drop</p>
                    </div>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="mt-4">
                <label className="block text-sm font-medium text-white/70 mb-2">Or paste URL</label>
                <input
                  type="text"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>
            </div>

            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold text-white mb-4">Content Details</h2>

              {(contentType === "VIDEO" || contentType === "SHORT") && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-white/70 mb-2">Title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Enter video title..."
                      maxLength={100}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                    <p className="text-xs text-white/40 mt-1">{title.length}/100 characters</p>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-white/70 mb-2">Keywords (comma separated)</label>
                    <input
                      type="text"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="tech, tutorial, coding, programming"
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  </div>
                </>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-white/70 mb-2">
                  {contentType === "VIDEO" || contentType === "SHORT" ? "Description" : "Caption"}
                </label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={
                    contentType === "VIDEO" || contentType === "SHORT"
                      ? "Enter video description..."
                      : "Write your caption..."
                  }
                  rows={6}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500 resize-none"
                />
              </div>

              {(contentType === "POST" || contentType === "REEL") && (
                <div className="mb-4">
                  <button
                    onClick={() => setShowHashtagPicker(!showHashtagPicker)}
                    className="flex items-center gap-2 text-sm text-pink-400 hover:text-pink-300 font-medium mb-3"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{showHashtagPicker ? "Hide" : "Add"} Hashtags</span>
                  </button>
                  {showHashtagPicker && (
                    <HashtagPicker
                      caption={caption}
                      onHashtagsChange={setSelectedHashtags}
                      selectedHashtags={selectedHashtags}
                    />
                  )}
                </div>
              )}

              {(contentType === "POST" || contentType === "REEL") && (
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    <MapPin className="w-4 h-4 inline mr-1" />
                    Location (optional)
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Add location..."
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                </div>
              )}
            </div>

            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold text-white mb-4">Schedule</h2>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={() => setScheduleType("now")}
                  className={`p-3 rounded-xl border-2 transition-all ${
                    scheduleType === "now"
                      ? "border-pink-500 bg-pink-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <Clock className="w-5 h-5 mx-auto mb-1 text-pink-400" />
                  <p className="text-sm font-medium text-white">Post Now</p>
                </button>
                <button
                  onClick={() => setScheduleType("schedule")}
                  className={`p-3 rounded-xl border-2 transition-all ${
                    scheduleType === "schedule"
                      ? "border-pink-500 bg-pink-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <Calendar className="w-5 h-5 mx-auto mb-1 text-pink-400" />
                  <p className="text-sm font-medium text-white">Schedule</p>
                </button>
              </div>

              {scheduleType === "schedule" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">Date</label>
                    <input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-2">Time</label>
                    <input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Account Selection & Publish */}
          <div className="space-y-6">
            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Selected Accounts ({selectedAccounts.length})</h2>
                <button
                  onClick={() => setShowAccountSelector(!showAccountSelector)}
                  className="text-sm text-pink-400 hover:text-pink-300 font-medium"
                >
                  {showAccountSelector ? "Done" : "Edit"}
                </button>
              </div>

              {showAccountSelector && (
                <div className="mb-4 p-4 bg-white/5 rounded-xl border border-white/10 max-h-64 overflow-y-auto">
                  <p className="text-sm text-white/60 mb-3">Select accounts to post to:</p>
                  <div className="space-y-2">
                    {availableAccounts.map((account) => {
                      const isSelected = selectedAccounts.some((acc) => acc.id === account.id)
                      return (
                        <button
                          key={account.id}
                          onClick={() => toggleAccountSelection(account.id)}
                          className="w-full flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                        >
                          <div className="relative flex-shrink-0">
                            <img
                              src={
                                account.profile_picture_url ||
                                "/placeholder.svg?height=40&width=40&query=user avatar" ||
                                "/placeholder.svg" ||
                                "/placeholder.svg"
                              }
                              alt={account.username}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                            <div
                              className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-slate-900 ${
                                account.platform === "instagram"
                                  ? "bg-gradient-to-br from-purple-500 to-pink-500"
                                  : "bg-red-500"
                              }`}
                            >
                              {account.platform === "instagram" ? (
                                <Instagram className="w-3 h-3 text-white" />
                              ) : (
                                <Youtube className="w-3 h-3 text-white" />
                              )}
                            </div>
                          </div>
                          <div className="flex-1 text-left">
                            <p className="font-medium text-white text-sm">
                              {account.platform === "instagram" ? `@${account.username}` : account.username}
                            </p>
                            <p className="text-xs text-white/40">
                              {account.platform === "instagram"
                                ? `${account.followers_count?.toLocaleString() || 0} followers`
                                : `${Number.parseInt(account.subscriberCount || "0").toLocaleString()} subscribers`}
                            </p>
                          </div>
                          <div
                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                              isSelected ? "bg-pink-500 border-pink-500" : "border-white/30"
                            }`}
                          >
                            {isSelected && <Check className="w-4 h-4 text-white" />}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {selectedAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10"
                  >
                    <div className="relative flex-shrink-0">
                      <img
                        src={account.profile_picture_url || "/placeholder.svg?height=40&width=40&query=user avatar"}
                        alt={account.username}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      <div
                        className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-slate-900 ${
                          account.platform === "instagram"
                            ? "bg-gradient-to-br from-purple-500 to-pink-500"
                            : "bg-red-500"
                        }`}
                      >
                        {account.platform === "instagram" ? (
                          <Instagram className="w-3 h-3 text-white" />
                        ) : (
                          <Youtube className="w-3 h-3 text-white" />
                        )}
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-white text-sm">
                        {account.platform === "instagram" ? `@${account.username}` : account.username}
                      </p>
                      {account.status === "error" && <p className="text-xs text-red-400">{account.error}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {!isLoading && (
                        <button
                          onClick={() => removeAccount(account.id)}
                          className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                        >
                          <X className="w-4 h-4 text-white/40 hover:text-red-400" />
                        </button>
                      )}
                      {/* Status indicator */}
                      {account.status === "pending" && (
                        <div className="w-6 h-6 rounded-full border-2 border-white/30" />
                      )}
                      {account.status === "uploading" && <Loader2 className="w-6 h-6 text-pink-400 animate-spin" />}
                      {account.status === "success" && <CheckCircle className="w-6 h-6 text-emerald-400" />}
                      {account.status === "error" && <XCircle className="w-6 h-6 text-red-400" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Publish Button */}
            <button
              onClick={handleSubmit}
              disabled={isLoading || selectedAccounts.length === 0}
              className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:from-gray-700 disabled:to-gray-700 rounded-xl text-white font-semibold transition-all disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{progress || "Publishing..."}</span>
                </>
              ) : (
                <span>{scheduleType === "schedule" ? "Schedule Post" : "Publish Now"}</span>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

"use client"
import { useRouter } from "next/navigation"
import { useEffect, useState, useCallback } from "react"
import {
  Instagram,
  Youtube,
  Upload,
  LogOut,
  BarChart2,
  MessageCircle,
  Settings,
  Plus,
  ChevronDown,
  Check,
  Users,
  X,
  Clock,
  FolderOpen,
} from "lucide-react"
import { getMediaList, getMediaInsights } from "@/src/lib/meta"

interface InstagramProfile {
  username: string
  followers_count?: number
  follows_count?: number
  media_count?: number
  profile_picture_url?: string
}

interface InstagramAccount {
  id: string
  username: string
  profile_picture_url?: string
  followers_count?: number
  platform: "instagram"
}

interface YouTubeAccount {
  id: string
  name: string
  thumbnail?: string
  subscriberCount?: string
  accessToken: string
  refreshToken: string
  platform: "youtube"
}

type SocialAccount = InstagramAccount | YouTubeAccount

interface MediaInsights {
  totalLikes: number
  totalViews: number
  totalReach: number
  engagementRate: number
}

export default function Dashboard() {
  const router = useRouter()
  const [profile, setProfile] = useState<InstagramProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [instagramAccounts, setInstagramAccounts] = useState<InstagramAccount[]>([])
  const [youtubeAccounts, setYoutubeAccounts] = useState<YouTubeAccount[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"all" | "instagram" | "youtube">("all")
  const [insights, setInsights] = useState<MediaInsights>({
    totalLikes: 0,
    totalViews: 0,
    totalReach: 0,
    engagementRate: 0,
  })
  const [loadingInsights, setLoadingInsights] = useState(false)
  const [scheduledPosts, setScheduledPosts] = useState<any[]>([])
  const [showScheduled, setShowScheduled] = useState(false)

  const loadInstagramAccounts = useCallback(async (token: string) => {
    try {
      const storedAccounts = localStorage.getItem("ig_accounts")

      if (storedAccounts) {
        // New multi-account format
        const accounts = JSON.parse(storedAccounts).map((a: any) => ({
          ...a,
          platform: "instagram" as const,
        }))
        setInstagramAccounts(accounts)

        // Select first account by default if none selected
        if (accounts.length > 0) {
          const storedId = localStorage.getItem("ig_user_id")
          if (storedId && accounts.some((a: any) => a.id === storedId)) {
            setSelectedAccounts((prev) => [...new Set([...prev, storedId])])
          } else {
            setSelectedAccounts((prev) => [...new Set([...prev, accounts[0].id])])
            localStorage.setItem("ig_user_id", accounts[0].id)
          }
        }
        return
      }

      // Fallback: old single-account format - fetch from API
      const res = await fetch(
        `https://graph.facebook.com/v21.0/me/accounts?fields=instagram_business_account&access_token=${token}`,
      )
      const data = await res.json()

      if (data.data) {
        const igAccounts: InstagramAccount[] = []

        for (const page of data.data) {
          if (page.instagram_business_account) {
            const igId = page.instagram_business_account.id
            const profileRes = await fetch(
              `https://graph.facebook.com/v21.0/${igId}?fields=username,profile_picture_url,followers_count&access_token=${token}`,
            )
            const profileData = await profileRes.json()

            if (profileData.username) {
              igAccounts.push({
                id: igId,
                username: profileData.username,
                profile_picture_url: profileData.profile_picture_url,
                followers_count: profileData.followers_count,
                platform: "instagram",
              })
            }
          }
        }

        setInstagramAccounts(igAccounts)

        const storedId = localStorage.getItem("ig_user_id")
        if (storedId && igAccounts.some((a) => a.id === storedId)) {
          setSelectedAccounts((prev) => [...new Set([...prev, storedId])])
        } else if (igAccounts.length > 0) {
          setSelectedAccounts((prev) => [...new Set([...prev, igAccounts[0].id])])
          localStorage.setItem("ig_user_id", igAccounts[0].id)
        }
      }
    } catch (err) {
      console.error("[v0] Error loading Instagram accounts:", err)
    }
  }, [])

  const loadYouTubeAccounts = useCallback(() => {
    const stored = localStorage.getItem("youtube_accounts")
    if (stored) {
      const accounts = JSON.parse(stored).map((a: any) => ({
        ...a,
        platform: "youtube",
      }))
      setYoutubeAccounts(accounts)
    }
  }, [])

  const loadProfile = useCallback(async (token: string, igUserId: string) => {
    try {
      const storedAccounts = localStorage.getItem("ig_accounts")
      let accountToken = token

      if (storedAccounts) {
        const accounts = JSON.parse(storedAccounts)
        const account = accounts.find((a: any) => a.id === igUserId)
        if (account && account.token) {
          accountToken = account.token
        }
      }

      const res = await fetch(
        `https://graph.facebook.com/v21.0/${igUserId}?fields=username,followers_count,follows_count,media_count,profile_picture_url&access_token=${accountToken}`,
      )
      const data = await res.json()

      if (data.username) {
        setProfile(data)
      }
      setLoading(false)
    } catch (err) {
      console.error("[v0] Error fetching profile:", err)
      setLoading(false)
    }
  }, [])

  const loadInsights = useCallback(
    async (token: string, igUserId: string) => {
      setLoadingInsights(true)
      try {
        const storedAccounts = localStorage.getItem("ig_accounts")
        let accountToken = token

        if (storedAccounts) {
          const accounts = JSON.parse(storedAccounts)
          const account = accounts.find((a: any) => a.id === igUserId)
          if (account && account.token) {
            accountToken = account.token
          }
        }

        const mediaList = await getMediaList(igUserId, accountToken)

        let totalLikes = 0
        let totalViews = 0
        let totalReach = 0
        let mediaWithInsights = 0

        const recentMedia = mediaList.slice(0, 10)

        for (const media of recentMedia) {
          try {
            const mediaInsights = await getMediaInsights(media.id, accountToken, media.media_type)
            if (mediaInsights && mediaInsights.engagement !== "N/A") {
              totalLikes += Number(mediaInsights.engagement) || 0
              totalViews += Number(mediaInsights.views) || 0
              totalReach += Number(mediaInsights.reach) || 0
              mediaWithInsights++
            }
          } catch (e) {
            console.log("Could not get insights for media:", media.id)
          }
        }

        const followers = profile?.followers_count || 1
        const engagementRate = mediaWithInsights > 0 ? (totalLikes / mediaWithInsights / followers) * 100 : 0

        setInsights({
          totalLikes,
          totalViews,
          totalReach,
          engagementRate: Math.round(engagementRate * 100) / 100,
        })
      } catch (err) {
        console.error("[v0] Error loading insights:", err)
      } finally {
        setLoadingInsights(false)
      }
    },
    [profile?.followers_count],
  )

  useEffect(() => {
    const token = localStorage.getItem("fb_access_token")
    const igUserId = localStorage.getItem("ig_user_id")

    loadYouTubeAccounts()

    if (token && igUserId) {
      loadProfile(token, igUserId)
      loadInstagramAccounts(token)
    } else {
      // Check if we have YouTube accounts
      const ytAccounts = localStorage.getItem("youtube_accounts")
      if (ytAccounts && JSON.parse(ytAccounts).length > 0) {
        setLoading(false)
      } else {
        router.push("/")
      }
    }

    const loadScheduledPosts = () => {
      const posts = JSON.parse(localStorage.getItem("scheduled_posts") || "[]")
      const futurePosts = posts.filter((p: any) => new Date(p.scheduledFor) > new Date())
      setScheduledPosts(futurePosts)
    }
    loadScheduledPosts()
  }, [router, loadProfile, loadInstagramAccounts, loadYouTubeAccounts])

  const handleDeleteScheduledPost = (postId: string) => {
    const posts = JSON.parse(localStorage.getItem("scheduled_posts") || "[]")
    const updated = posts.filter((p: any) => p.id !== postId)
    localStorage.setItem("scheduled_posts", JSON.stringify(updated))
    setScheduledPosts(updated.filter((p: any) => new Date(p.scheduledFor) > new Date()))
  }

  const toggleAccountSelection = (accountId: string) => {
    setSelectedAccounts((prev) => {
      if (prev.includes(accountId)) {
        if (prev.length === 1) return prev
        return prev.filter((id) => id !== accountId)
      } else {
        return [...prev, accountId]
      }
    })
  }

  const selectAllAccounts = () => {
    setSelectedAccounts([...instagramAccounts, ...youtubeAccounts].map((a) => a.id))
  }

  const handleLogout = () => {
    localStorage.removeItem("fb_access_token")
    localStorage.removeItem("ig_user_id")
    localStorage.removeItem("fb_page_id")
    localStorage.removeItem("ig_accounts")
    localStorage.removeItem("youtube_accounts")
    localStorage.removeItem("selected_accounts")
    router.push("/")
  }

  const handleAddAccount = () => {
    router.push("/")
  }

  const navigateToUpload = (type: string) => {
    localStorage.setItem("selected_accounts", JSON.stringify(selectedAccounts))
    localStorage.setItem(
      "selected_platforms",
      JSON.stringify(
        selectedAccounts
          .map((id) => {
            const ig = instagramAccounts.find((a) => a.id === id)
            const yt = youtubeAccounts.find((a) => a.id === id)
            return ig ? "instagram" : yt ? "youtube" : null
          })
          .filter(Boolean),
      ),
    )
    router.push(`/upload?type=${type}`)
  }

  const selectedIGCount = selectedAccounts.filter((id) => instagramAccounts.some((a) => a.id === id)).length

  const selectedYTCount = selectedAccounts.filter((id) => youtubeAccounts.some((a) => a.id === id)).length

  const handleRemoveAccount = (accountId: string, platform: "instagram" | "youtube") => {
    if (platform === "instagram") {
      const accounts = JSON.parse(localStorage.getItem("ig_accounts") || "[]")
      const updatedAccounts = accounts.filter((a: any) => a.id !== accountId)

      if (updatedAccounts.length > 0) {
        localStorage.setItem("ig_accounts", JSON.stringify(updatedAccounts))
        setInstagramAccounts(updatedAccounts.map((a: any) => ({ ...a, platform: "instagram" })))
      } else {
        localStorage.removeItem("ig_accounts")
        localStorage.removeItem("fb_access_token")
        localStorage.removeItem("ig_user_id")
        localStorage.removeItem("fb_page_id")
        setInstagramAccounts([])
      }
    } else {
      const accounts = JSON.parse(localStorage.getItem("youtube_accounts") || "[]")
      const updatedAccounts = accounts.filter((a: any) => a.id !== accountId)

      if (updatedAccounts.length > 0) {
        localStorage.setItem("youtube_accounts", JSON.stringify(updatedAccounts))
        setYoutubeAccounts(updatedAccounts.map((a: any) => ({ ...a, platform: "youtube" })))
      } else {
        localStorage.removeItem("youtube_accounts")
        setYoutubeAccounts([])
      }
    }

    // Remove from selected accounts
    setSelectedAccounts((prev) => prev.filter((id) => id !== accountId))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-white/60">Loading your dashboard...</p>
        </div>
      </div>
    )
  }

  const allAccounts: SocialAccount[] = [...instagramAccounts, ...youtubeAccounts]
  const filteredAccounts = activeTab === "all" ? allAccounts : allAccounts.filter((a) => a.platform === activeTab)

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-pink-500 via-red-500 to-orange-500 rounded-xl">
                <Upload className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-white">SocialHub</span>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full">
                PRO
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Notifications */}
              <button className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors relative">
                <BarChart2 className="w-5 h-5" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-pink-500 rounded-full" />
              </button>

              {/* Multi-Account Selector */}
              <div className="relative">
                <button
                  onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
                  className="flex items-center gap-3 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors border border-white/10"
                >
                  <div className="flex -space-x-2">
                    {selectedAccounts.slice(0, 3).map((accountId) => {
                      const igAccount = instagramAccounts.find((a) => a.id === accountId)
                      const ytAccount = youtubeAccounts.find((a) => a.id === accountId)
                      const account = igAccount || ytAccount
                      const imgUrl = igAccount?.profile_picture_url || ytAccount?.thumbnail
                      return (
                        <div key={accountId} className="relative">
                          <img
                            src={imgUrl || "/placeholder.svg?height=32&width=32&query=user avatar"}
                            alt={igAccount?.username || ytAccount?.name}
                            className="w-8 h-8 rounded-full border-2 border-slate-900 object-cover"
                          />
                          <div
                            className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 flex items-center justify-center ${
                              igAccount ? "bg-gradient-to-br from-purple-500 to-pink-500" : "bg-red-500"
                            }`}
                          >
                            {igAccount ? (
                              <Instagram className="w-2 h-2 text-white" />
                            ) : (
                              <Youtube className="w-2 h-2 text-white" />
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {selectedAccounts.length > 3 && (
                      <div className="w-8 h-8 rounded-full border-2 border-slate-900 bg-slate-700 flex items-center justify-center text-xs font-medium text-white">
                        +{selectedAccounts.length - 3}
                      </div>
                    )}
                  </div>
                  <span className="text-sm font-medium text-white/80 hidden sm:block">
                    {selectedAccounts.length} selected
                  </span>
                  <ChevronDown className="w-4 h-4 text-white/50" />
                </button>

                {/* Dropdown */}
                {accountDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-96 bg-slate-900 rounded-2xl shadow-2xl border border-white/10 overflow-hidden z-50">
                    <div className="p-4 border-b border-white/10">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-white">Select Accounts</h3>
                        <button
                          onClick={selectAllAccounts}
                          className="text-sm text-pink-400 hover:text-pink-300 font-medium"
                        >
                          Select All
                        </button>
                      </div>
                      {/* Platform Tabs */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setActiveTab("all")}
                          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            activeTab === "all" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
                          }`}
                        >
                          All ({allAccounts.length})
                        </button>
                        <button
                          onClick={() => setActiveTab("instagram")}
                          className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                            activeTab === "instagram"
                              ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-pink-400 border border-pink-500/30"
                              : "text-white/50 hover:text-white"
                          }`}
                        >
                          <Instagram className="w-3.5 h-3.5" />
                          Instagram ({instagramAccounts.length})
                        </button>
                        <button
                          onClick={() => setActiveTab("youtube")}
                          className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                            activeTab === "youtube"
                              ? "bg-red-500/20 text-red-400 border border-red-500/30"
                              : "text-white/50 hover:text-white"
                          }`}
                        >
                          <Youtube className="w-3.5 h-3.5" />
                          YouTube ({youtubeAccounts.length})
                        </button>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {filteredAccounts.map((account) => {
                        const isIG = account.platform === "instagram"
                        const igAcc = account as InstagramAccount
                        const ytAcc = account as YouTubeAccount
                        return (
                          <button
                            key={account.id}
                            onClick={() => toggleAccountSelection(account.id)}
                            className="w-full flex items-center gap-3 p-3 hover:bg-white/5 transition-colors"
                          >
                            <div className="relative">
                              <img
                                src={
                                  isIG
                                    ? igAcc.profile_picture_url ||
                                      "/placeholder.svg?height=40&width=40&query=user avatar"
                                    : ytAcc.thumbnail || "/placeholder.svg?height=40&width=40&query=youtube channel"
                                }
                                alt={isIG ? igAcc.username : ytAcc.name}
                                className="w-10 h-10 rounded-full object-cover"
                              />
                              <div
                                className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-slate-900 flex items-center justify-center ${
                                  isIG ? "bg-gradient-to-br from-purple-500 to-pink-500" : "bg-red-500"
                                }`}
                              >
                                {isIG ? (
                                  <Instagram className="w-2.5 h-2.5 text-white" />
                                ) : (
                                  <Youtube className="w-2.5 h-2.5 text-white" />
                                )}
                              </div>
                            </div>
                            <div className="flex-1 text-left">
                              <p className="font-medium text-white">{isIG ? `@${igAcc.username}` : ytAcc.name}</p>
                              <p className="text-xs text-white/50">
                                {isIG
                                  ? `${igAcc.followers_count?.toLocaleString() || 0} followers`
                                  : `${Number.parseInt(ytAcc.subscriberCount || "0").toLocaleString()} subscribers`}
                              </p>
                            </div>
                            <div
                              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                selectedAccounts.includes(account.id)
                                  ? "bg-pink-500 border-pink-500"
                                  : "border-white/30"
                              }`}
                            >
                              {selectedAccounts.includes(account.id) && <Check className="w-4 h-4 text-white" />}
                            </div>
                          </button>
                        )
                      })}
                      {filteredAccounts.length === 0 && (
                        <div className="p-6 text-center text-white/50">
                          <Users className="w-8 h-8 mx-auto mb-2 text-white/30" />
                          <p>No {activeTab === "all" ? "" : activeTab} accounts found</p>
                        </div>
                      )}
                    </div>
                    {/* Add Account Button */}
                    <div className="p-3 border-t border-white/10">
                      <button
                        onClick={handleAddAccount}
                        className="w-full flex items-center justify-center gap-2 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors text-white/70 hover:text-white"
                      >
                        <Plus className="w-5 h-5" />
                        <span className="font-medium">Add Another Account</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Settings */}
              <button className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                <Settings className="w-5 h-5" />
              </button>

              <button
                onClick={handleLogout}
                className="p-2 text-white/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Click outside to close dropdown */}
      {accountDropdownOpen && <div className="fixed inset-0 z-40" onClick={() => setAccountDropdownOpen(false)} />}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Welcome Banner */}
        <div className="bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-orange-500/10 rounded-2xl p-6 mb-8 border border-white/10">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white mb-2">
                Welcome back{profile ? `, @${profile.username}` : ""}!
              </h1>
              <p className="text-white/50">
                Manage your social media presence across {allAccounts.length} connected account
                {allAccounts.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {selectedIGCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-xl border border-pink-500/30">
                  <Instagram className="w-4 h-4 text-pink-400" />
                  <span className="text-sm font-medium text-pink-400">{selectedIGCount} Instagram</span>
                </div>
              )}
              {selectedYTCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-500/20 rounded-xl border border-red-500/30">
                  <Youtube className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">{selectedYTCount} YouTube</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-pink-500/20 rounded-xl">
                <Upload className="w-5 h-5 text-pink-400" />
              </div>
              <span className="text-sm text-white/50">Total Engagement</span>
            </div>
            <p className="text-2xl font-bold text-white">{insights.totalLikes.toLocaleString()}</p>
            <p className="text-xs text-emerald-400 mt-1">+12.5% from last week</p>
          </div>

          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-purple-500/20 rounded-xl">
                <BarChart2 className="w-5 h-5 text-purple-400" />
              </div>
              <span className="text-sm text-white/50">Total Views</span>
            </div>
            <p className="text-2xl font-bold text-white">{insights.totalViews.toLocaleString()}</p>
            <p className="text-xs text-emerald-400 mt-1">+8.2% from last week</p>
          </div>

          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-orange-500/20 rounded-xl">
                <Users className="w-5 h-5 text-orange-400" />
              </div>
              <span className="text-sm text-white/50">Total Reach</span>
            </div>
            <p className="text-2xl font-bold text-white">{insights.totalReach.toLocaleString()}</p>
            <p className="text-xs text-emerald-400 mt-1">+15.3% from last week</p>
          </div>

          <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 bg-emerald-500/20 rounded-xl">
                <MessageCircle className="w-5 h-5 text-emerald-400" />
              </div>
              <span className="text-sm text-white/50">Engagement Rate</span>
            </div>
            <p className="text-2xl font-bold text-white">{insights.engagementRate}%</p>
            <p className="text-xs text-emerald-400 mt-1">Above average</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <button
            onClick={() => navigateToUpload("post")}
            className="p-6 bg-gradient-to-br from-purple-500/20 to-pink-500/20 hover:from-purple-500/30 hover:to-pink-500/30 border border-purple-500/30 rounded-2xl transition-all group"
          >
            <Instagram className="w-8 h-8 text-pink-400 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-white mb-1">Post</h3>
            <p className="text-xs text-white/50">Create Instagram post</p>
          </button>

          <button
            onClick={() => navigateToUpload("reel")}
            className="p-6 bg-gradient-to-br from-pink-500/20 to-red-500/20 hover:from-pink-500/30 hover:to-red-500/30 border border-pink-500/30 rounded-2xl transition-all group"
          >
            <Instagram className="w-8 h-8 text-red-400 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-white mb-1">Reel</h3>
            <p className="text-xs text-white/50">Upload Instagram reel</p>
          </button>

          <button
            onClick={() => navigateToUpload("video")}
            className="p-6 bg-gradient-to-br from-red-500/20 to-orange-500/20 hover:from-red-500/30 hover:to-orange-500/30 border border-red-500/30 rounded-2xl transition-all group"
          >
            <Youtube className="w-8 h-8 text-red-400 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-white mb-1">YouTube</h3>
            <p className="text-xs text-white/50">Upload video</p>
          </button>

          <button
            onClick={() => router.push("/bulk-upload")}
            className="p-6 bg-gradient-to-br from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/30 rounded-2xl transition-all group"
          >
            <FolderOpen className="w-8 h-8 text-amber-400 mb-3 group-hover:scale-110 transition-transform" />
            <h3 className="font-semibold text-white mb-1">Bulk Upload</h3>
            <p className="text-xs text-white/50">Auto-post multiple videos</p>
          </button>
        </div>

        {/* Scheduled Posts Section */}
        {scheduledPosts.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Scheduled Posts</h2>
                <span className="px-2 py-1 bg-pink-500/20 text-pink-400 text-xs font-medium rounded-full">
                  {scheduledPosts.length}
                </span>
              </div>
              <button
                onClick={() => setShowScheduled(!showScheduled)}
                className="text-sm text-pink-400 hover:text-pink-300 font-medium"
              >
                {showScheduled ? "Hide" : "Show"}
              </button>
            </div>

            {showScheduled && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {scheduledPosts.map((post) => (
                  <div
                    key={post.id}
                    className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-4 border border-white/10 hover:border-pink-500/30 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {post.contentType === "POST" && <Instagram className="w-4 h-4 text-pink-400" />}
                        {post.contentType === "REEL" && <Instagram className="w-4 h-4 text-purple-400" />}
                        {(post.contentType === "VIDEO" || post.contentType === "SHORT") && (
                          <Youtube className="w-4 h-4 text-red-400" />
                        )}
                        <span className="text-xs font-medium text-white/60">{post.contentType}</span>
                      </div>
                      <button
                        onClick={() => handleDeleteScheduledPost(post.id)}
                        className="p-1 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <p className="text-white text-sm mb-2 line-clamp-2">{post.title || post.caption || "No caption"}</p>

                    <div className="flex items-center gap-2 mb-3">
                      <Clock className="w-3 h-3 text-white/40" />
                      <span className="text-xs text-white/50">{new Date(post.scheduledFor).toLocaleString()}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {post.accounts.slice(0, 3).map((acc: any) => (
                          <div
                            key={acc.id}
                            className="w-6 h-6 rounded-full border-2 border-slate-900 bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center"
                          >
                            {acc.platform === "instagram" ? (
                              <Instagram className="w-3 h-3 text-white" />
                            ) : (
                              <Youtube className="w-3 h-3 text-white" />
                            )}
                          </div>
                        ))}
                      </div>
                      {post.accounts.length > 3 && (
                        <span className="text-xs text-white/40">+{post.accounts.length - 3}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Connected Accounts Overview */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Connected Accounts</h2>
            <button
              onClick={handleAddAccount}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-white/70 hover:text-white transition-colors border border-white/10"
            >
              <Plus className="w-4 h-4" />
              Add Account
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {instagramAccounts.map((account) => (
              <div
                key={account.id}
                className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-5 border border-white/10 hover:border-pink-500/30 transition-colors"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative">
                    <img
                      src={account.profile_picture_url || "/placeholder.svg?height=56&width=56&query=user avatar"}
                      alt={account.username}
                      className="w-14 h-14 rounded-full object-cover"
                    />
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                      <Instagram className="w-3 h-3 text-white" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-white">@{account.username}</p>
                    <p className="text-sm text-white/50">Instagram Business</p>
                  </div>
                  <button
                    onClick={() => handleRemoveAccount(account.id, "instagram")}
                    className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Remove account"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/40">Followers</span>
                  <span className="font-semibold text-white">{account.followers_count?.toLocaleString() || 0}</span>
                </div>
              </div>
            ))}
            {youtubeAccounts.map((account) => (
              <div
                key={account.id}
                className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-5 border border-white/10 hover:border-red-500/30 transition-colors"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative">
                    <img
                      src={account.thumbnail || "/placeholder.svg?height=56&width=56&query=youtube channel"}
                      alt={account.name}
                      className="w-14 h-14 rounded-full object-cover"
                    />
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                      <Youtube className="w-3 h-3 text-white" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-white">{account.name}</p>
                    <p className="text-sm text-white/50">YouTube Channel</p>
                  </div>
                  <button
                    onClick={() => handleRemoveAccount(account.id, "youtube")}
                    className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Remove account"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/40">Subscribers</span>
                  <span className="font-semibold text-white">
                    {Number.parseInt(account.subscriberCount || "0").toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
            {/* Add Account Card */}
            <button
              onClick={handleAddAccount}
              className="bg-slate-900/30 rounded-2xl p-5 border border-dashed border-white/20 hover:border-white/40 transition-colors flex flex-col items-center justify-center min-h-[160px] group"
            >
              <div className="w-12 h-12 bg-white/5 group-hover:bg-white/10 rounded-full flex items-center justify-center mb-3 transition-colors">
                <Plus className="w-6 h-6 text-white/40 group-hover:text-white/60" />
              </div>
              <p className="text-sm font-medium text-white/40 group-hover:text-white/60 transition-colors">
                Add New Account
              </p>
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

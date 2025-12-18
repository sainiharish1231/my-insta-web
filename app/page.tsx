"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { generateCodeVerifier, generateCodeChallenge } from "@/src/lib/pkce"
import {
  Instagram,
  Youtube,
  BarChart3,
  Upload,
  Users,
  ArrowRight,
  Sparkles,
  Shield,
  Globe,
  Crown,
  CheckCircle,
} from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState<"instagram" | "youtube" | null>(null)
  const [showAddAccountMessage, setShowAddAccountMessage] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem("fb_access_token")
    const igUserId = localStorage.getItem("ig_user_id")
    const ytAccounts = localStorage.getItem("youtube_accounts")

    const hasAccounts = (token && igUserId) || (ytAccounts && JSON.parse(ytAccounts).length > 0)

    if (hasAccounts) {
      setShowAddAccountMessage(true)
    }
  }, [router])

  const loginInstagram = async () => {
    setIsLoading("instagram")
    const fbAppId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID

    if (!fbAppId) {
      alert("Facebook App ID not configured. Please add NEXT_PUBLIC_FACEBOOK_APP_ID to environment variables.")
      setIsLoading(null)
      return
    }

    try {
      const codeVerifier = await generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)
      sessionStorage.setItem("pkce_code_verifier", codeVerifier)

      const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : ""
      const scope =
        "instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management"

      const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&scope=${scope}&response_type=code&code_challenge=${codeChallenge}&code_challenge_method=S256`

      window.location.href = authUrl
    } catch (error) {
      console.error("PKCE generation error:", error)
      alert("Failed to generate secure authentication. Please try again.")
      setIsLoading(null)
    }
  }

  const loginYouTube = async () => {
    setIsLoading("youtube")
    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

    if (!googleClientId) {
      alert("Google Client ID not configured. Please add NEXT_PUBLIC_GOOGLE_CLIENT_ID to environment variables.")
      setIsLoading(null)
      return
    }

    try {
      const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/auth/youtube-callback` : ""
      const scope = encodeURIComponent(
        "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube",
      )

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(
        redirectUri,
      )}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`

      window.location.href = authUrl
    } catch (error) {
      console.error("YouTube auth error:", error)
      alert("Failed to authenticate with YouTube. Please try again.")
      setIsLoading(null)
    }
  }

  const features = [
    {
      icon: Users,
      title: "Multi-Account Management",
      description: "Manage unlimited Instagram & YouTube accounts from one dashboard",
    },
    {
      icon: Upload,
      title: "Cross-Platform Posting",
      description: "Post to multiple platforms simultaneously with one click",
    },
    {
      icon: BarChart3,
      title: "Unified Analytics",
      description: "Track performance across all accounts in real-time",
    },
    {
      icon: Shield,
      title: "Secure & Private",
      description: "Enterprise-grade security with OAuth 2.0 authentication",
    },
  ]

  const stats = [
    { value: "10M+", label: "Posts Published" },
    { value: "50K+", label: "Active Users" },
    { value: "99.9%", label: "Uptime" },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-red-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-r from-pink-500/10 to-red-500/10 rounded-full blur-3xl" />
        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:50px_50px]" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-pink-500 to-red-500 rounded-xl blur-lg opacity-50" />
                <div className="relative p-2.5 bg-gradient-to-br from-pink-500 via-red-500 to-orange-500 rounded-xl">
                  <Globe className="w-6 h-6 text-white" />
                </div>
              </div>
              <div>
                <span className="text-xl font-bold text-white">SocialHub</span>
                <span className="ml-2 px-2 py-0.5 text-[10px] font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full">
                  PRO
                </span>
              </div>
            </div>
            {showAddAccountMessage && (
              <button
                onClick={() => router.push("/dashboard")}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <ArrowRight className="w-4 h-4 rotate-180" />
                <span className="text-sm">Back to Dashboard</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="max-w-7xl w-full">
            {/* Hero Section */}
            <div className="text-center mb-12">
              {showAddAccountMessage ? (
                <>
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 backdrop-blur-sm rounded-full border border-emerald-500/30 mb-6">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm text-emerald-400">Add More Accounts</span>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-4">
                    Connect Another
                    <span className="block bg-gradient-to-r from-pink-400 via-red-400 to-orange-400 bg-clip-text text-transparent">
                      Social Account
                    </span>
                  </h1>
                  <p className="text-lg text-white/50 max-w-2xl mx-auto">
                    Manage multiple accounts from one dashboard. Connect Instagram and YouTube accounts to get started.
                  </p>
                </>
              ) : (
                <>
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 backdrop-blur-sm rounded-full border border-white/10 mb-6">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span className="text-sm text-white/80">Trusted by 50,000+ creators worldwide</span>
                  </div>
                  <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-white leading-tight mb-6">
                    Manage All Your
                    <span className="block bg-gradient-to-r from-pink-400 via-red-400 to-orange-400 bg-clip-text text-transparent">
                      Social Accounts
                    </span>
                  </h1>
                  <p className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto">
                    One powerful platform to manage Instagram, YouTube, and more. Post, analyze, and grow across all
                    platforms.
                  </p>
                </>
              )}
            </div>

            {!showAddAccountMessage && (
              <div className="flex justify-center gap-8 md:gap-16 mb-12">
                {stats.map((stat, index) => (
                  <div key={index} className="text-center">
                    <p className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-pink-400 to-orange-400 bg-clip-text text-transparent">
                      {stat.value}
                    </p>
                    <p className="text-sm text-white/40">{stat.label}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-12 items-start">
              {/* Left Side - Login Cards */}
              <div className="space-y-4">
                {/* Instagram Login Card */}
                <div className="p-6 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 hover:border-pink-500/50 transition-all duration-300 group">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 rounded-xl shadow-lg shadow-pink-500/20">
                      <Instagram className="w-8 h-8 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-white mb-1">Instagram Business</h3>
                      <p className="text-sm text-white/50 mb-4">Connect your Instagram Business or Creator accounts</p>
                      <div className="flex flex-wrap gap-2 mb-4">
                        <span className="px-2 py-1 text-xs bg-white/10 text-white/70 rounded-md">Posts & Reels</span>
                        <span className="px-2 py-1 text-xs bg-white/10 text-white/70 rounded-md">Analytics</span>
                        <span className="px-2 py-1 text-xs bg-white/10 text-white/70 rounded-md">Comments</span>
                        <span className="px-2 py-1 text-xs bg-white/10 text-white/70 rounded-md">Multi-Account</span>
                      </div>
                      <button
                        onClick={loginInstagram}
                        disabled={isLoading !== null}
                        className="w-full py-3 px-4 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 rounded-xl font-semibold text-white flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading === "instagram" ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <>
                            <span>Connect Instagram</span>
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* YouTube Login Card */}
                <div className="p-6 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 hover:border-red-500/50 transition-all duration-300 group">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-gradient-to-br from-red-600 to-red-500 rounded-xl shadow-lg shadow-red-500/20">
                      <Youtube className="w-8 h-8 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-white mb-1">YouTube Channel</h3>
                      <p className="text-sm text-white/50 mb-4">Connect your YouTube channels for video management</p>
                      <div className="flex flex-wrap gap-2 mb-4">
                        <span className="px-2 py-1 text-xs bg-white/10 text-white/70 rounded-md">Video Upload</span>
                        <span className="px-2 py-1 text-xs bg-white/10 text-white/70 rounded-md">Shorts</span>
                        <span className="px-2 py-1 text-xs bg-white/10 text-white/70 rounded-md">Analytics</span>
                        <span className="px-2 py-1 text-xs bg-white/10 text-white/70 rounded-md">Multi-Channel</span>
                      </div>
                      <button
                        onClick={loginYouTube}
                        disabled={isLoading !== null}
                        className="w-full py-3 px-4 bg-gradient-to-r from-red-600 to-red-500 rounded-xl font-semibold text-white flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading === "youtube" ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <>
                            <span>Connect YouTube</span>
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <p className="text-center text-xs text-white/30 px-4">
                  By connecting, you agree to our Terms of Service. We only request permissions needed for posting and
                  analytics.
                </p>
              </div>

              {/* Right Side - Features */}
              <div className="space-y-4">
                {features.map((feature, index) => (
                  <div
                    key={index}
                    className="p-5 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 hover:bg-white/10 transition-all duration-300 flex items-start gap-4"
                  >
                    <div className="p-2.5 bg-gradient-to-br from-pink-500/20 to-orange-500/20 rounded-lg border border-white/10">
                      <feature.icon className="w-6 h-6 text-pink-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1">{feature.title}</h3>
                      <p className="text-sm text-white/50">{feature.description}</p>
                    </div>
                    <CheckCircle className="w-5 h-5 text-emerald-400 ml-auto flex-shrink-0" />
                  </div>
                ))}

                {/* Pro Features Badge */}
                <div className="p-5 bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-xl border border-amber-500/20">
                  <div className="flex items-center gap-3 mb-3">
                    <Crown className="w-6 h-6 text-amber-400" />
                    <h3 className="font-bold text-white">Pro Features Included</h3>
                  </div>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-2 text-sm text-white/70">
                      <CheckCircle className="w-4 h-4 text-amber-400" />
                      Unlimited account connections
                    </li>
                    <li className="flex items-center gap-2 text-sm text-white/70">
                      <CheckCircle className="w-4 h-4 text-amber-400" />
                      Advanced analytics dashboard
                    </li>
                    <li className="flex items-center gap-2 text-sm text-white/70">
                      <CheckCircle className="w-4 h-4 text-amber-400" />
                      Priority support 24/7
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="px-6 py-6 border-t border-white/5">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-white/30 text-sm">2024 SocialHub Pro. Professional social media management.</p>
            <div className="flex items-center gap-6 text-sm text-white/30">
              <span className="hover:text-white/50 cursor-pointer">Privacy</span>
              <span className="hover:text-white/50 cursor-pointer">Terms</span>
              <span className="hover:text-white/50 cursor-pointer">Support</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}

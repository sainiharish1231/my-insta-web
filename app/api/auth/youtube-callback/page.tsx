"use client"
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Youtube, CheckCircle, AlertCircle, Loader2 } from "lucide-react"

export default function YouTubeCallback() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [error, setError] = useState("")

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams?.get("code")
      const errorParam = searchParams?.get("error")

      console.log("[v0] YouTube callback received:", { hasCode: !!code, error: errorParam })

      if (errorParam) {
        setStatus("error")
        setError("Authorization was denied or cancelled.")
        return
      }

      if (!code) {
        setStatus("error")
        setError("No authorization code received.")
        return
      }

      try {
        console.log("[v0] Exchanging code for YouTube access token")

        // Exchange code for token
        const res = await fetch("/api/auth/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })

        const data = await res.json()

        if (!res.ok || data.error) {
          console.error("[v0] YouTube auth API error:", data)
          throw new Error(data.error || data.details || "Failed to authenticate with YouTube")
        }

        console.log("[v0] YouTube authentication successful, storing account data")

        // Store YouTube tokens
        const existingYTAccounts = JSON.parse(localStorage.getItem("youtube_accounts") || "[]")
        const newAccount = {
          id: data.channelId,
          name: data.channelName,
          thumbnail: data.thumbnail,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          subscriberCount: data.subscriberCount,
        }

        // Check if account already exists
        const existingIndex = existingYTAccounts.findIndex((a: any) => a.id === newAccount.id)
        if (existingIndex >= 0) {
          existingYTAccounts[existingIndex] = newAccount
        } else {
          existingYTAccounts.push(newAccount)
        }

        localStorage.setItem("youtube_accounts", JSON.stringify(existingYTAccounts))

        console.log("[v0] YouTube account stored, redirecting to dashboard")

        setStatus("success")
        setTimeout(() => {
          router.push("/dashboard")
        }, 2000)
      } catch (err: any) {
        console.error("[v0] YouTube callback error:", err)
        setStatus("error")
        setError(err.message || "Authentication failed")
      }
    }

    handleCallback()
  }, [searchParams, router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full p-8 bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 text-center">
        <div className="w-20 h-20 mx-auto bg-gradient-to-br from-red-600 to-red-500 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-red-500/30">
          <Youtube className="w-10 h-10 text-white" />
        </div>

        {status === "loading" && (
          <>
            <Loader2 className="w-8 h-8 text-red-400 mx-auto mb-4 animate-spin" />
            <h2 className="text-xl font-bold text-white mb-2">Connecting YouTube...</h2>
            <p className="text-white/50">Please wait while we set up your account</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">YouTube Connected!</h2>
            <p className="text-white/50">Redirecting to dashboard...</p>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Connection Failed</h2>
            <p className="text-white/50 mb-4">{error}</p>
            {error.includes("credentials not configured") && (
              <div className="text-sm text-yellow-400 mb-4 p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                Please check YOUTUBE_SETUP.md file for setup instructions
              </div>
            )}
            <button
              onClick={() => router.push("/")}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-colors"
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </div>
  )
}

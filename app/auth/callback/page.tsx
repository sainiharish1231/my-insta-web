"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CircularProgress, Stack, Typography, Alert, Box } from "@mui/material"

export default function AuthCallback() {
  const router = useRouter()
  const [status, setStatus] = useState("Processing authentication...")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const code = urlParams.get("code")
    const errorParam = urlParams.get("error")
    const errorDescription = urlParams.get("error_description")

    console.log("[v0] Callback received, code:", code ? "present" : "missing")

    if (errorParam) {
      console.error("[v0] OAuth error:", errorParam, errorDescription)
      setError(`Authentication failed: ${errorDescription || errorParam}`)
      setTimeout(() => router.push("/"), 3000)
      return
    }

    if (!code) {
      console.error("[v0] No authorization code received")
      setError("Authentication failed: No authorization code received")
      setTimeout(() => router.push("/"), 3000)
      return
    }

    async function exchangeCodeForToken() {
      try {
        setStatus("Exchanging authorization code for access token...")
        console.log("[v0] Exchanging code for token with PKCE")

        const codeVerifier = sessionStorage.getItem("pkce_code_verifier")
        const fbAppId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID

        if (!codeVerifier) {
          throw new Error("PKCE code verifier not found. Please try logging in again.")
        }

        if (!fbAppId) {
          throw new Error("Facebook App ID not configured")
        }

        const redirectUri = `${window.location.origin}/auth/callback`

        // Exchange code for access token using PKCE
        const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${fbAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}&code_verifier=${codeVerifier}`

        const tokenRes = await fetch(tokenUrl)
        const tokenData = await tokenRes.json()

        console.log("[v0] Token exchange response:", tokenData.access_token ? "success" : "failed")

        if (tokenData.error) {
          throw new Error(tokenData.error.message || "Failed to exchange authorization code")
        }

        if (!tokenData.access_token) {
          throw new Error("No access token received from Facebook")
        }

        const accessToken = tokenData.access_token

        // Clear the code verifier
        sessionStorage.removeItem("pkce_code_verifier")

        setStatus("Fetching Instagram account...")
        console.log("[v0] Fetching Instagram account")

        // Get Facebook Pages
        const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${accessToken}`)
        const pagesData = await pagesRes.json()

        console.log("[v0] Pages data:", pagesData.data ? `${pagesData.data.length} pages found` : "no pages")

        if (!pagesData.data || pagesData.data.length === 0) {
          throw new Error("No Facebook Pages found. Please connect an Instagram Business account to a Facebook Page.")
        }

        const pageId = pagesData.data[0].id
        const pageToken = pagesData.data[0].access_token

        // Get Instagram Business Account
        const igRes = await fetch(
          `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`,
        )
        const igData = await igRes.json()

        console.log("[v0] Instagram data:", igData.instagram_business_account ? "found" : "not found")

        if (!igData.instagram_business_account) {
          throw new Error(
            "No Instagram Business Account found. Please convert your Instagram account to a Business account and connect it to your Facebook Page.",
          )
        }

        const igUserId = igData.instagram_business_account.id

        // Get Instagram account profile info
        const profileRes = await fetch(
          `https://graph.facebook.com/v21.0/${igUserId}?fields=username,followers_count,profile_picture_url&access_token=${pageToken}`,
        )
        const profileData = await profileRes.json()

        const existingIGAccounts = JSON.parse(localStorage.getItem("ig_accounts") || "[]")
        const newAccount = {
          id: igUserId,
          username: profileData.username || "Instagram User",
          profile_picture_url: profileData.profile_picture_url,
          followers_count: profileData.followers_count || 0,
          token: pageToken, // Store token WITH the account
          pageId: pageId,
        }

        // Check if account already exists and update it, otherwise add new
        const existingIndex = existingIGAccounts.findIndex((a: any) => a.id === newAccount.id)
        if (existingIndex >= 0) {
          existingIGAccounts[existingIndex] = newAccount
        } else {
          existingIGAccounts.push(newAccount)
        }

        localStorage.setItem("ig_accounts", JSON.stringify(existingIGAccounts))

        // Also keep the old format for backwards compatibility with first account
        localStorage.setItem("fb_access_token", pageToken)
        localStorage.setItem("ig_user_id", igUserId)
        localStorage.setItem("fb_page_id", pageId)

        console.log("[v0] Auth successful, redirecting to dashboard")
        setStatus("Success! Redirecting to dashboard...")
        setTimeout(() => router.push("/dashboard"), 1000)
      } catch (error: any) {
        console.error("[v0] Auth error:", error)
        setError(error.message)
        setTimeout(() => router.push("/"), 5000)
      }
    }

    exchangeCodeForToken()
  }, [router])

  return (
    <Stack height="100vh" alignItems="center" justifyContent="center" gap={3} sx={{ bgcolor: "#f5f5f5", p: 2 }}>
      {error ? (
        <Box maxWidth={600} width="100%">
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            Redirecting back to login...
          </Typography>
        </Box>
      ) : (
        <>
          <CircularProgress size={60} />
          <Typography variant="h6" textAlign="center" px={2}>
            {status}
          </Typography>
        </>
      )}
    </Stack>
  )
}

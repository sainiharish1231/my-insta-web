import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json()

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/youtube-callback`

    if (!clientId || !clientSecret) {
      console.error("[v0] Missing Google OAuth credentials:", {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        redirectUri,
      })
      return NextResponse.json(
        {
          error: "Google OAuth credentials not configured",
          details: "Please set NEXT_PUBLIC_GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables",
        },
        { status: 500 },
      )
    }

    console.log("[v0] Exchanging YouTube auth code for tokens")

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    })

    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error("[v0] Token exchange failed:", tokenData)
      return NextResponse.json({ error: tokenData.error_description || "Token exchange failed" }, { status: 400 })
    }

    console.log("[v0] Successfully got YouTube access token, fetching channel info")

    // Get channel info
    const channelRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    })

    const channelData = await channelRes.json()

    if (!channelData.items || channelData.items.length === 0) {
      console.error("[v0] No YouTube channel found for user")
      return NextResponse.json({ error: "No YouTube channel found" }, { status: 404 })
    }

    const channel = channelData.items[0]

    console.log("[v0] YouTube authentication successful:", channel.snippet.title)

    return NextResponse.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      channelId: channel.id,
      channelName: channel.snippet.title,
      thumbnail: channel.snippet.thumbnails.default.url,
      subscriberCount: channel.statistics.subscriberCount,
    })
  } catch (error: any) {
    console.error("[v0] YouTube auth error:", error)
    return NextResponse.json({ error: error.message || "Authentication failed" }, { status: 500 })
  }
}

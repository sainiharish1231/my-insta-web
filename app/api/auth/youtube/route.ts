import { type NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    // Get the origin from the request headers (actual request origin, not env var)
    const origin =
      request.headers.get("origin") || request.headers.get("x-forwarded-proto")
        ? `${request.headers.get("x-forwarded-proto")}://${request.headers.get("host")}`
        : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const redirectUri = `${origin}/auth/youtube-callback`;

    // Determine environment for logging
    const isProduction = origin.includes("sainiharish.in");
    const environment = isProduction ? "PRODUCTION" : "DEVELOPMENT (localhost)";

    if (!clientId || !clientSecret) {
      console.error(
        `[v0] Missing Google OAuth credentials in ${environment}. Ensure variables are set in your environment.`,
        {
          clientIdStatus: clientId
            ? "Configured"
            : "MISSING (NEXT_PUBLIC_GOOGLE_CLIENT_ID)",
          clientSecretStatus: clientSecret
            ? "Configured"
            : "MISSING (GOOGLE_CLIENT_SECRET)",
          redirectUri,
          environment,
        },
      );
      return NextResponse.json(
        {
          error: "Google OAuth credentials not configured",
          details: `Environment: ${environment}. Missing: ${
            !clientId ? "NEXT_PUBLIC_GOOGLE_CLIENT_ID" : ""
          } ${!clientSecret ? "GOOGLE_CLIENT_SECRET" : ""}`.trim(),
        },
        { status: 500 },
      );
    }

    console.log(`[v0] YouTube auth - Exchanging code in ${environment}`, {
      redirectUri,
      origin,
      clientIdPrefix: clientId?.substring(0, 10) + "...",
      environment,
      host: request.headers.get("host"),
    });

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
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      const troubleshootMsg =
        tokenData.error === "redirect_uri_mismatch"
          ? `\nTroubleshooting:\n1. Go to Google Cloud Console > APIs & Services > Credentials\n2. Edit your OAuth 2.0 Client ID\n3. Add this redirect URI to "Authorized redirect URIs":\n   ${redirectUri}\n4. Save and try again`
          : "";

      console.error(`[v0] YouTube token exchange failed in ${environment}:`, {
        error: tokenData.error,
        description: tokenData.error_description,
        sentRedirectUri: redirectUri,
        detectedOrigin: origin,
        detectedHost: request.headers.get("host"),
        code: code?.substring(0, 20) + "...",
        environment,
        troubleshootMsg,
      });

      return NextResponse.json(
        {
          error: tokenData.error_description || "Token exchange failed",
          errorCode: tokenData.error,
          redirectUri,
          environment,
          troubleshooting:
            tokenData.error === "redirect_uri_mismatch"
              ? `Add ${redirectUri} to Google Cloud Console OAuth credentials`
              : undefined,
        },
        { status: 400 },
      );
    }

    console.log(
      "[v0] Successfully got YouTube access token, fetching channel info",
    );

    // Get channel info
    const channelRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      },
    );

    const channelData = await channelRes.json();

    if (!channelData.items || channelData.items.length === 0) {
      console.error("[v0] No YouTube channel found for user");
      return NextResponse.json(
        { error: "No YouTube channel found" },
        { status: 404 },
      );
    }

    const channel = channelData.items[0];

    console.log(
      "[v0] YouTube authentication successful:",
      channel.snippet.title,
    );

    return NextResponse.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      channelId: channel.id,
      channelName: channel.snippet.title,
      thumbnail: channel.snippet.thumbnails.default.url,
      subscriberCount: channel.statistics.subscriberCount,
    });
  } catch (error: any) {
    console.error("[v0] YouTube auth error:", error);
    return NextResponse.json(
      { error: error.message || "Authentication failed" },
      { status: 500 },
    );
  }
}

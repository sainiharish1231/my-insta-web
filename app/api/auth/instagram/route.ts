import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { code, redirectUri } = (await request.json()) as {
      code?: string;
      redirectUri?: string;
    };
    const appId = process.env.FACEBOOK_APP_ID || process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!code || !redirectUri || !appId || !appSecret) {
      return NextResponse.json(
        { error: "Instagram OAuth configuration or authorization code is missing." },
        { status: 400 },
      );
    }

    const expectedRedirectUri = new URL("/auth/callback", request.url).toString();
    if (redirectUri !== expectedRedirectUri) {
      return NextResponse.json({ error: "Invalid OAuth redirect URI." }, { status: 400 });
    }

    const tokenUrl = new URL("https://graph.facebook.com/v27.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);

    const tokenResponse = await fetch(tokenUrl, { cache: "no-store" });
    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.error || !tokenData.access_token) {
      return NextResponse.json(
        { error: tokenData.error?.message || "Facebook token exchange failed." },
        { status: 400 },
      );
    }

    return NextResponse.json({ access_token: tokenData.access_token });
  } catch {
    return NextResponse.json({ error: "Unable to complete Instagram login." }, { status: 400 });
  }
}

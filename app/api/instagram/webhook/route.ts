import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processInstagramMessageWebhook } from "@/lib/server/instagram-automation";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token") || "";
  const challenge = request.nextUrl.searchParams.get("hub.challenge") || "";
  const expected = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "";
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.FACEBOOK_APP_SECRET || "";
  const signature = request.headers.get("x-hub-signature-256") || "";
  if (!appSecret || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    return NextResponse.json({ error: "Webhook signature missing or invalid." }, { status: 401 });
  }

  const rawBody = await request.text();
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const suppliedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return NextResponse.json({ error: "Webhook signature check failed." }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Webhook payload invalid." }, { status: 400 });
  }

  try {
    await processInstagramMessageWebhook(payload);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[instagram-dm] Webhook processing failed:", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}

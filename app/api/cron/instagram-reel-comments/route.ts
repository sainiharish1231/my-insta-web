import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processRecentInstagramReelComments } from "@/lib/server/instagram-automation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const expected = process.env.REEL_COMMENT_CRON_SECRET || "";
  const supplied = request.headers.get("authorization") || "";
  const expectedHeader = `Bearer ${expected}`;
  const authorized = Boolean(expected) &&
    supplied.length === expectedHeader.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expectedHeader));

  if (!authorized) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const results = await processRecentInstagramReelComments();
    return NextResponse.json({ accounts: results.length, results });
  } catch (error: any) {
    console.error("[instagram-comments] Poll run failed:", error);
    return NextResponse.json({ error: "Instagram Reel comment scan failed." }, { status: 500 });
  }
}

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runDueInstagramScheduledPosts } from "@/lib/server/instagram-scheduled-posts";
import { processRecentInstagramReelComments } from "@/lib/server/instagram-automation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET || "";
  const supplied = request.headers.get("authorization") || "";
  const expectedHeader = `Bearer ${expected}`;
  const authorized = Boolean(expected) &&
    supplied.length === expectedHeader.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expectedHeader));

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const results = await runDueInstagramScheduledPosts(3);
    const commentResults = await processRecentInstagramReelComments();
    return NextResponse.json({ processed: results.length, results, commentResults });
  } catch (error: any) {
    console.error("[instagram-scheduler] Cron run failed:", error);
    return NextResponse.json({ error: "Instagram scheduler run failed." }, { status: 500 });
  }
}

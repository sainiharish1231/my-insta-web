import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runDueInstagramScheduledPosts } from "@/lib/server/instagram-scheduled-posts";
import { processRecentInstagramReelComments } from "@/lib/server/instagram-automation";
import { runDueInstagramBridgeAutomation } from "@/lib/server/instagram-bridge-automation";
import { getDb } from "@/lib/mongodb";

export const runtime = "nodejs";
export const maxDuration = 60;

async function claimFiveMinuteSlot() {
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const collection = (await getDb()).collection("instagram_cron_guard");
  try {
    const result = await collection.findOneAndUpdate(
      { _id: "main-scheduler", bucket: { $ne: bucket } },
      { $set: { bucket, startedAt: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    return Boolean(result);
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

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
    if (!(await claimFiveMinuteSlot())) {
      return NextResponse.json({ skipped: true, reason: "Runs once per five-minute interval." });
    }
    const bridgeResults = await runDueInstagramBridgeAutomation();
    const results = await runDueInstagramScheduledPosts(10);
    const commentResults = await processRecentInstagramReelComments();
    return NextResponse.json({ bridgeResults, processed: results.length, results, commentResults });
  } catch (error: any) {
    console.error("[instagram-scheduler] Cron run failed:", error);
    return NextResponse.json({ error: "Instagram scheduler run failed." }, { status: 500 });
  }
}

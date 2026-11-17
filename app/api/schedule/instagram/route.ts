import { NextRequest, NextResponse } from "next/server";
import {
  insertInstagramScheduledPost,
  listInstagramScheduledPosts,
} from "@/lib/server/instagram-scheduled-posts";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ownerKey = request.headers.get("x-schedule-owner-key") || "";
  if (!/^[a-f0-9]{64}$/i.test(ownerKey)) {
    return NextResponse.json({ jobs: [] });
  }
  try {
    return NextResponse.json({ jobs: await listInstagramScheduledPosts(ownerKey) });
  } catch (error: any) {
    console.error("[instagram-scheduler] Failed to list scheduled posts:", error);
    return NextResponse.json({ error: "Schedule list load nahi ho paayi." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ownerKey = request.headers.get("x-schedule-owner-key") || "";
  if (!/^[a-f0-9]{64}$/i.test(ownerKey)) {
    return NextResponse.json({ error: "Schedule owner key invalid hai." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const igUserId = typeof body.igUserId === "string" ? body.igUserId.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim().slice(0, 100) : "Instagram account";
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl.trim() : "";
  const caption = typeof body.caption === "string" ? body.caption.trim() : "";
  const scheduledFor = typeof body.scheduledFor === "string" ? new Date(body.scheduledFor) : new Date(NaN);

  if (!igUserId || !accessToken || !mediaUrl || !Number.isFinite(scheduledFor.getTime())) {
    return NextResponse.json({ error: "Scheduled Instagram post ki details incomplete hain." }, { status: 400 });
  }
  if (caption.length > 2200) {
    return NextResponse.json({ error: "Instagram caption 2,200 characters se chhota rakho." }, { status: 400 });
  }
  try {
    const media = new URL(mediaUrl);
    if (media.protocol !== "https:" || media.hostname !== "res.cloudinary.com") {
      return NextResponse.json({ error: "Scheduled video Cloudinary HTTPS URL hona chahiye." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Video URL valid nahi hai." }, { status: 400 });
  }

  const leadMs = scheduledFor.getTime() - Date.now();
  if (leadMs < 20 * 60 * 1000 || leadMs > 75 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "Instagram schedule 20 minutes se 75 days ke beech hona chahiye." }, { status: 400 });
  }

  try {
    const jobId = await insertInstagramScheduledPost({
      ownerKey,
      igUserId,
      username,
      accessToken,
      mediaUrl,
      caption,
      scheduledFor,
    });
    return NextResponse.json({ jobId, status: "scheduled" }, { status: 201 });
  } catch (error: any) {
    console.error("[instagram-scheduler] Failed to save scheduled post:", error);
    return NextResponse.json(
      { error: error?.message || "Scheduled post save nahi ho paaya." },
      { status: 503 },
    );
  }
}

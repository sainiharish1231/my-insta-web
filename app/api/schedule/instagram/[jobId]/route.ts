import { NextRequest, NextResponse } from "next/server";
import { deleteInstagramScheduledPost } from "@/lib/server/instagram-scheduled-posts";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const ownerKey = request.headers.get("x-schedule-owner-key") || "";
  if (!/^[a-f0-9]{64}$/i.test(ownerKey)) {
    return NextResponse.json({ error: "Schedule owner key invalid hai." }, { status: 401 });
  }
  const { jobId } = await context.params;
  try {
    const deleted = await deleteInstagramScheduledPost(ownerKey, jobId);
    return deleted
      ? NextResponse.json({ deleted: true })
      : NextResponse.json({ error: "Post nahi mila ya ab publish ho raha hai." }, { status: 404 });
  } catch (error: any) {
    console.error("[instagram-scheduler] Failed to delete scheduled post:", error);
    return NextResponse.json({ error: "Schedule delete nahi ho paaya." }, { status: 503 });
  }
}

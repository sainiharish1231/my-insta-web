import { NextRequest, NextResponse } from "next/server";
import { downloadYouTubeSourceVideoLocally } from "@/lib/server/youtube-shorts";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "YouTube URL is required." },
        { status: 400 },
      );
    }

    const data = await downloadYouTubeSourceVideoLocally({
      sourceUrl: url,
    });

    return new NextResponse(data.fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": data.contentType,
        "Content-Disposition": `inline; filename="${data.fileName}"`,
        "Content-Length": String(data.fileBuffer.byteLength),
        "X-Source-Download-Engine": data.downloadEngine,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("[v0] Failed to download YouTube shorts source:", error);
    return NextResponse.json(
      { error: error.message || "Failed to download source video." },
      { status: 500 },
    );
  }
}

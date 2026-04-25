import { NextRequest, NextResponse } from "next/server";
import { getYouTubeShortsMetadata } from "@/lib/server/youtube-shorts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const {
      url,
      segmentDurationSeconds = 30,
      overlapSeconds = 0,
    } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "YouTube URL is required." },
        { status: 400 },
      );
    }

    const data = await getYouTubeShortsMetadata({
      sourceUrl: url,
      segmentDurationSeconds,
      overlapSeconds,
    });

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error: any) {
    console.error("[v0] Failed to analyze YouTube shorts source:", error);
    return NextResponse.json(
      { error: error.message || "Failed to analyze YouTube video." },
      { status: 500 },
    );
  }
}

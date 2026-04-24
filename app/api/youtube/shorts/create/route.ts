import { NextRequest, NextResponse } from "next/server";
import { buildYouTubeShortAssets } from "@/lib/server/youtube-shorts";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const {
      url,
      segmentDurationSeconds = 30,
      overlapSeconds = 0,
      title,
      description,
      keywords = [],
    } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "YouTube URL is required." },
        { status: 400 },
      );
    }

    const normalizedKeywords = Array.isArray(keywords)
      ? keywords.filter((keyword) => typeof keyword === "string")
      : [];

    const data = await buildYouTubeShortAssets({
      sourceUrl: url,
      segmentDurationSeconds,
      overlapSeconds,
      title: typeof title === "string" ? title : undefined,
      description: typeof description === "string" ? description : undefined,
      keywords: normalizedKeywords,
    });

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error: any) {
    console.error("[v0] Failed to create YouTube shorts:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create YouTube shorts." },
      { status: 500 },
    );
  }
}

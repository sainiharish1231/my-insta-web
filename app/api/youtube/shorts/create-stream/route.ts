import { NextRequest, NextResponse } from "next/server";
import { createShortsStreamResponse } from "../_stream";
import { buildYouTubeShortAssets } from "@/lib/server/youtube-shorts";
import { extractYouTubeVideoId, normalizeYouTubeUrl } from "@/lib/youtube-shorts";
import type {
  ShortsFramingMode,
  ShortsQualityPreset,
} from "@/lib/youtube-shorts";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseFramingMode(value: unknown): ShortsFramingMode | undefined {
  return value === "fill" || value === "show-full" ? value : undefined;
}

function parseQualityPreset(value: unknown): ShortsQualityPreset | undefined {
  return value === "auto" ||
    value === "720p" ||
    value === "1080p" ||
    value === "1440p" ||
    value === "2160p"
    ? value
    : undefined;
}

function parseBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function parseString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const {
      url,
      segmentDurationSeconds = 30,
      overlapSeconds = 0,
      title,
      description,
      keywords = [],
      framingMode,
      qualityPreset,
      includeLogoOverlay,
      includeHeadlineOverlay,
      includeCopyrightOverlay,
      copyrightText,
    } = await request.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "YouTube URL is required." },
        { status: 400 },
      );
    }

    const normalizedUrl = normalizeYouTubeUrl(url);
    if (!extractYouTubeVideoId(normalizedUrl)) {
      return NextResponse.json(
        {
          error:
            "Please enter a valid YouTube video URL. Uploaded or Cloudinary sources should use the upload stream endpoint.",
        },
        { status: 400 },
      );
    }

    const normalizedKeywords = Array.isArray(keywords)
      ? keywords.filter((keyword) => typeof keyword === "string")
      : [];

    return createShortsStreamResponse(async (emit) => {
      const data = await buildYouTubeShortAssets({
        sourceUrl: normalizedUrl,
        segmentDurationSeconds,
        overlapSeconds,
        title: typeof title === "string" ? title : undefined,
        description: typeof description === "string" ? description : undefined,
        keywords: normalizedKeywords,
        renderSettings: {
          framingMode: parseFramingMode(framingMode),
          qualityPreset: parseQualityPreset(qualityPreset),
          includeLogoOverlay: parseBoolean(includeLogoOverlay),
          includeHeadlineOverlay: parseBoolean(includeHeadlineOverlay),
          includeCopyrightOverlay: parseBoolean(includeCopyrightOverlay),
          copyrightText: parseString(copyrightText),
        },
        callbacks: {
          onPlanReady: async ({
            video,
            plan,
            uploadFolder,
            renderWidth,
            renderHeight,
            renderLabel,
            framingMode: resolvedFramingMode,
            hasLogoOverlay,
          }) => {
            await emit({
              type: "ready",
              video,
              plan,
              uploadFolder,
              renderWidth,
              renderHeight,
              renderLabel,
              framingMode: resolvedFramingMode,
              hasLogoOverlay,
            });
          },
          onClipCreated: async ({ video, asset, index, total }) => {
            await emit({
              type: "clip",
              video,
              item: asset,
              index,
              total,
            });
          },
          onClipProgress: async ({ clipIndex, total, progress, stage }) => {
            await emit({
              type: "clip-progress",
              clipIndex,
              total,
              progress,
              stage,
            });
          },
        },
      });

      await emit({
        type: "complete",
        video: data.video,
        count: data.queue.length,
        uploadFolder: data.uploadFolder,
      });
    });
  } catch (error: any) {
    console.error("[v0] Failed to create YouTube shorts stream:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create YouTube shorts." },
      { status: 500 },
    );
  }
}

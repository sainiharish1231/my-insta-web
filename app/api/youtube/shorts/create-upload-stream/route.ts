import { NextRequest, NextResponse } from "next/server";
import { createShortsStreamResponse } from "../_stream";
import {
  buildRemoteVideoShortAssets,
  buildUploadedVideoShortAssets,
} from "@/lib/server/youtube-shorts";
import type {
  ShortsFramingMode,
  ShortsQualityPreset,
} from "@/lib/youtube-shorts";

export const runtime = "nodejs";
export const maxDuration = 600;

function parseNumber(value: FormDataEntryValue | null, fallback: number) {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseKeywords(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (keyword): keyword is string => typeof keyword === "string",
      );
    }
  } catch {
    return value
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);
  }

  return [];
}

function parseFramingMode(
  value: FormDataEntryValue | null,
): ShortsFramingMode | undefined {
  return value === "fill" || value === "show-full" ? value : undefined;
}

function parseQualityPreset(
  value: FormDataEntryValue | null,
): ShortsQualityPreset | undefined {
  return value === "auto" ||
    value === "1080p" ||
    value === "1440p" ||
    value === "2160p"
    ? value
    : undefined;
}

function parseBoolean(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const sourceUrlEntry = formData.get("sourceUrl");
    const sourceUrl =
      typeof sourceUrlEntry === "string" ? sourceUrlEntry : undefined;

    if (!(file instanceof File) && !sourceUrl) {
      return NextResponse.json(
        { error: "Video file ya uploaded source URL required hai." },
        { status: 400 },
      );
    }

    const title = formData.get("title");
    const description = formData.get("description");

    return createShortsStreamResponse(async (emit) => {
      const data =
        file instanceof File
          ? await buildUploadedVideoShortAssets({
              fileBuffer: Buffer.from(await file.arrayBuffer()),
              fileName: file.name,
              contentType: file.type,
              durationSeconds: parseNumber(formData.get("durationSeconds"), 0),
              segmentDurationSeconds: parseNumber(
                formData.get("segmentDurationSeconds"),
                30,
              ),
              overlapSeconds: parseNumber(formData.get("overlapSeconds"), 0),
              title: typeof title === "string" ? title : undefined,
              description:
                typeof description === "string" ? description : undefined,
              keywords: parseKeywords(formData.get("keywords")),
              renderSettings: {
                framingMode: parseFramingMode(formData.get("framingMode")),
                qualityPreset: parseQualityPreset(
                  formData.get("qualityPreset"),
                ),
                includeLogoOverlay: parseBoolean(
                  formData.get("includeLogoOverlay"),
                ),
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
              },
            })
          : await buildRemoteVideoShortAssets({
              sourceUrl: sourceUrl!,
              fileName:
                typeof formData.get("fileName") === "string"
                  ? String(formData.get("fileName"))
                  : undefined,
              contentType:
                typeof formData.get("contentType") === "string"
                  ? String(formData.get("contentType"))
                  : undefined,
              durationSeconds: parseNumber(formData.get("durationSeconds"), 0),
              segmentDurationSeconds: parseNumber(
                formData.get("segmentDurationSeconds"),
                30,
              ),
              overlapSeconds: parseNumber(formData.get("overlapSeconds"), 0),
              title: typeof title === "string" ? title : undefined,
              description:
                typeof description === "string" ? description : undefined,
              keywords: parseKeywords(formData.get("keywords")),
              renderSettings: {
                framingMode: parseFramingMode(formData.get("framingMode")),
                qualityPreset: parseQualityPreset(
                  formData.get("qualityPreset"),
                ),
                includeLogoOverlay: parseBoolean(
                  formData.get("includeLogoOverlay"),
                ),
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
    console.error("[v0] Failed to create uploaded-video shorts stream:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to create shorts from uploaded video.",
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  buildRemoteVideoShortAssets,
  buildUploadedVideoShortAssets,
} from "@/lib/server/youtube-shorts";

export const runtime = "nodejs";
export const maxDuration = 300;

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
      return parsed.filter((keyword): keyword is string => typeof keyword === "string");
    }
  } catch {
    return value
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);
  }

  return [];
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
            description: typeof description === "string" ? description : undefined,
            keywords: parseKeywords(formData.get("keywords")),
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
            description: typeof description === "string" ? description : undefined,
            keywords: parseKeywords(formData.get("keywords")),
          });

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error: any) {
    console.error("[v0] Failed to create uploaded-video shorts:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create shorts from uploaded video." },
      { status: 500 },
    );
  }
}

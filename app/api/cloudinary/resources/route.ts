import { v2 as cloudinary } from "cloudinary";
import { NextRequest, NextResponse } from "next/server";
import type {
  StoredGeneratedShortMetadata,
  ShortsFramingMode,
} from "@/lib/youtube-shorts";

export const runtime = "nodejs";

function getCloudinaryAdminConfig() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary admin access is not configured. Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.",
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
}

function parseMaxResults(value: string | null) {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function getCloudinaryContextRecord(value: unknown) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const baseRecord = value as Record<string, unknown>;
  const customContext = baseRecord.custom;
  if (customContext && typeof customContext === "object") {
    return customContext as Record<string, unknown>;
  }

  return baseRecord;
}

function parseContextString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseContextNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function parseContextBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    if (value === "1" || value.toLowerCase() === "true") {
      return true;
    }

    if (value === "0" || value.toLowerCase() === "false") {
      return false;
    }
  }

  return undefined;
}

function parseContextStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  const trimmedValue = value.trim();
  if (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmedValue);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      // Fall through to the comma-delimited parser.
    }
  }

  return trimmedValue
    .split(",")
    .map((item) => item.replace(/^"+|"+$/g, "").trim())
    .filter(Boolean);
}

function parseGeneratedShortMetadata(context: Record<string, unknown>) {
  const title = parseContextString(context.shorts_title);
  const description = parseContextString(context.shorts_description);
  const caption = parseContextString(context.shorts_caption);

  if (!title || !description || !caption) {
    return null;
  }

  const partLabel =
    parseContextString(context.shorts_part_label) || "Generated Short";
  const keywords = parseContextStringArray(context.shorts_keywords);
  const headlineLines = parseContextStringArray(context.shorts_headline_lines);
  const highlightedLineIndex =
    parseContextNumber(context.shorts_highlighted_line_index) || 0;
  const renderWidth = parseContextNumber(context.shorts_render_width) || 0;
  const renderHeight = parseContextNumber(context.shorts_render_height) || 0;
  const renderLabel =
    parseContextString(context.shorts_render_label) || "Rendered";
  const framingMode =
    parseContextString(context.shorts_framing_mode) === "fill"
      ? "fill"
      : "show-full";
  const hasLogoOverlay = parseContextBoolean(
    context.shorts_has_logo_overlay,
  );

  return {
    title,
    description,
    caption,
    keywords,
    partLabel,
    headlineLines,
    highlightedLineIndex,
    renderWidth,
    renderHeight,
    renderLabel,
    framingMode: framingMode as ShortsFramingMode,
    hasLogoOverlay: hasLogoOverlay ?? false,
    sourceUrl: parseContextString(context.shorts_source_url),
    sourceTitle: parseContextString(context.shorts_source_title),
    sourceDescription: parseContextString(context.shorts_source_description),
    sourceKeywords: parseContextStringArray(context.shorts_source_keywords),
  } satisfies StoredGeneratedShortMetadata;
}

export async function GET(request: NextRequest) {
  try {
    const folder = request.nextUrl.searchParams.get("folder")?.trim() || "";
    const nextCursor =
      request.nextUrl.searchParams.get("nextCursor")?.trim() || undefined;
    const maxResults = parseMaxResults(
      request.nextUrl.searchParams.get("maxResults"),
    );

    if (!folder) {
      return NextResponse.json(
        { error: "Cloudinary folder is required." },
        { status: 400 },
      );
    }

    getCloudinaryAdminConfig();

    const prefix = folder.endsWith("/") ? folder : `${folder}/`;
    const result = await cloudinary.api.resources({
      type: "upload",
      resource_type: "video",
      prefix,
      max_results: maxResults,
      next_cursor: nextCursor,
      context: true,
    });

    const resources = Array.isArray(result.resources)
      ? [...result.resources]
          .sort((left, right) =>
            String(right.created_at || "").localeCompare(
              String(left.created_at || ""),
            ),
          )
          .map((resource) => {
            const context = getCloudinaryContextRecord(resource.context);
            const generatedShortMetadata =
              parseGeneratedShortMetadata(context);

            return {
              assetId: String(resource.asset_id || ""),
              publicId: String(resource.public_id || ""),
              resourceType: String(resource.resource_type || "video"),
              secureUrl: String(resource.secure_url || ""),
              bytes:
                typeof resource.bytes === "number" ? resource.bytes : undefined,
              durationSeconds:
                typeof resource.duration === "number"
                  ? resource.duration
                  : undefined,
              format:
                typeof resource.format === "string"
                  ? resource.format
                  : undefined,
              createdAt:
                typeof resource.created_at === "string"
                  ? resource.created_at
                  : undefined,
              folder,
              originalFilename:
                typeof resource.filename === "string"
                  ? resource.filename
                  : typeof resource.original_filename === "string"
                    ? resource.original_filename
                    : String(resource.public_id || "")
                        .split("/")
                        .filter(Boolean)
                        .pop(),
              generatedShortMetadata,
            };
          })
          .filter((resource) => resource.publicId && resource.secureUrl)
      : [];

    return NextResponse.json({
      success: true,
      resources,
      nextCursor: result.next_cursor || null,
    });
  } catch (error: any) {
    console.error("[v0] Failed to load Cloudinary resources:", error);
    return NextResponse.json(
      {
        error:
          error?.message || "Failed to fetch Cloudinary folder resources.",
      },
      { status: 500 },
    );
  }
}

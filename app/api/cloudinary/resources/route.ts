import { v2 as cloudinary } from "cloudinary";
import { NextRequest, NextResponse } from "next/server";

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
    });

    const resources = Array.isArray(result.resources)
      ? [...result.resources]
          .sort((left, right) =>
            String(right.created_at || "").localeCompare(
              String(left.created_at || ""),
            ),
          )
          .map((resource) => ({
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
          }))
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

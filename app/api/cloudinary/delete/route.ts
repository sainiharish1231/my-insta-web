import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function createSignature(params: Record<string, string>, apiSecret: string) {
  const sorted = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return createHash("sha1")
    .update(`${sorted}${apiSecret}`)
    .digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    const { publicId, resourceType = "video" } = await request.json();

    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return NextResponse.json(
        {
          error:
            "Cloudinary delete is not configured. Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.",
        },
        { status: 500 },
      );
    }

    if (!publicId) {
      return NextResponse.json(
        { error: "publicId is required" },
        { status: 400 },
      );
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createSignature(
      {
        invalidate: "true",
        public_id: publicId,
        timestamp,
      },
      apiSecret,
    );

    const body = new URLSearchParams({
      public_id: publicId,
      timestamp,
      api_key: apiKey,
      invalidate: "true",
      signature,
    });

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    const data = await response.json();

    if (!response.ok || data.error) {
      return NextResponse.json(
        { error: data.error?.message || "Failed to delete Cloudinary asset" },
        { status: 500 },
      );
    }

    return NextResponse.json({ result: data.result || "ok" });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete Cloudinary asset" },
      { status: 500 },
    );
  }
}

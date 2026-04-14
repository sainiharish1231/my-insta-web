import { NextResponse } from "next/server";
import { getGridFSBucket } from "@/lib/mongodb";
import { Readable } from "stream";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Get GridFS bucket
    const bucket = await getGridFSBucket();

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${timestamp}-${file.name}`;

    // Stream file directly instead of buffering entire content in memory
    const readableStream = Readable.fromWeb(file.stream() as any);

    // Upload to GridFS
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: file.type,
      metadata: {
        originalName: file.name,
        uploadedAt: new Date(),
      },
    });

    // Pipe the file to GridFS
    await new Promise((resolve, reject) => {
      readableStream
        .pipe(uploadStream)
        .on("finish", resolve)
        .on("error", reject);
    });

    // Generate URL for the uploaded file
    const fileId = uploadStream.id.toString();
    const origin = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
    const url = `${origin}/api/files/${fileId}`;

    return NextResponse.json({ url });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}

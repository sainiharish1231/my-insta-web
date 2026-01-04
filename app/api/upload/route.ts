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

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create a readable stream from buffer
    const readableStream = Readable.from(buffer);

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
    const url = `${process.env.NEXT_PUBLIC_BASE_URL}/api/files/${fileId}`;

    return NextResponse.json({ url });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}

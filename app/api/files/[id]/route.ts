import { NextResponse } from "next/server";
import { getGridFSBucket } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { Readable } from "stream";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bucket = await getGridFSBucket();

    // Find the file in GridFS
    const files = await bucket.find({ _id: new ObjectId(id) }).toArray();

    if (files.length === 0) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const file = files[0];

    // Stream file directly from GridFS
    const downloadStream = bucket.openDownloadStream(new ObjectId(id));
    const webStream = Readable.toWeb(downloadStream as any) as ReadableStream;

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": file.contentType || "application/octet-stream",
        "Content-Length": String(file.length || 0),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    console.error("File retrieval error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve file" },
      { status: 500 }
    );
  }
}

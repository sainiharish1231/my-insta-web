import { NextResponse } from "next/server";
import { Readable } from "stream";
import { ObjectId } from "mongodb";
import { getDb, getGridFSBucket } from "@/lib/mongodb";

export const runtime = "nodejs";
export const maxDuration = 300;

const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024; // 4MB
const CHUNK_UPLOAD_MAX_BYTES = 4 * 1024 * 1024; // 4MB

function buildFileUrl(request: Request, fileId: string) {
  const origin =
    process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
  return `${origin}/api/files/${fileId}`;
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseInteger(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function handleSingleUpload(request: Request, file: File) {
  if (file.size > SIMPLE_UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          "File is too large for single-request upload. Retry with chunked upload.",
      },
      { status: 413 }
    );
  }

  const bucket = await getGridFSBucket();
  const timestamp = Date.now();
  const filename = `${timestamp}-${sanitizeFilename(file.name)}`;
  const readableStream = Readable.fromWeb(file.stream() as any);

  const uploadStream = bucket.openUploadStream(filename, {
    contentType: file.type,
    metadata: {
      originalName: file.name,
      uploadedAt: new Date(),
      source: "single-request",
    },
  });

  await new Promise<void>((resolve, reject) => {
    readableStream
      .pipe(uploadStream)
      .on("finish", () => resolve())
      .on("error", reject);
  });

  return NextResponse.json({
    url: buildFileUrl(request, uploadStream.id.toString()),
  });
}

async function handleChunkedUpload(request: Request, formData: FormData, file: File) {
  if (file.size > CHUNK_UPLOAD_MAX_BYTES) {
    return NextResponse.json(
      {
        error: "Chunk payload is too large. Reduce chunk size and try again.",
      },
      { status: 413 }
    );
  }

  const chunkIndex = parseInteger(formData.get("chunkIndex"));
  const totalChunks = parseInteger(formData.get("totalChunks"));
  const chunkSize = parseInteger(formData.get("chunkSize"));
  const fileSize = parseInteger(formData.get("fileSize"));
  const originalNameEntry = formData.get("filename");
  const contentTypeEntry = formData.get("contentType");
  const uploadIdEntry = formData.get("uploadId");

  if (
    chunkIndex === null ||
    totalChunks === null ||
    chunkSize === null ||
    fileSize === null ||
    typeof originalNameEntry !== "string" ||
    typeof contentTypeEntry !== "string"
  ) {
    return NextResponse.json(
      { error: "Missing chunk upload metadata" },
      { status: 400 }
    );
  }

  if (chunkIndex < 0 || totalChunks <= 0 || chunkIndex >= totalChunks) {
    return NextResponse.json(
      { error: "Invalid chunk indices" },
      { status: 400 }
    );
  }

  if (chunkSize <= 0 || fileSize <= 0) {
    return NextResponse.json(
      { error: "Invalid file size metadata" },
      { status: 400 }
    );
  }

  const fileId =
    typeof uploadIdEntry === "string" && ObjectId.isValid(uploadIdEntry)
      ? new ObjectId(uploadIdEntry)
      : new ObjectId();

  const db = await getDb();
  const chunkBuffer = Buffer.from(await file.arrayBuffer());

  await db.collection("uploads.chunks").updateOne(
    { files_id: fileId, n: chunkIndex },
    {
      $set: {
        files_id: fileId,
        n: chunkIndex,
        data: chunkBuffer,
      },
    },
    { upsert: true }
  );

  const uploadId = fileId.toString();
  const isFinalChunk = chunkIndex === totalChunks - 1;

  if (!isFinalChunk) {
    return NextResponse.json({
      uploadId,
      uploadedChunks: chunkIndex + 1,
      totalChunks,
    });
  }

  const uploadedChunkCount = await db
    .collection("uploads.chunks")
    .countDocuments({ files_id: fileId });

  if (uploadedChunkCount < totalChunks) {
    return NextResponse.json(
      {
        error: "Upload is incomplete. Please retry the missing chunks.",
        uploadId,
        uploadedChunks: uploadedChunkCount,
        totalChunks,
      },
      { status: 409 }
    );
  }

  const filename = `${Date.now()}-${sanitizeFilename(originalNameEntry)}`;
  const now = new Date();

  await db.collection("uploads.files").updateOne(
    { _id: fileId },
    {
      $set: {
        length: fileSize,
        chunkSize,
        uploadDate: now,
        filename,
        contentType: contentTypeEntry || "application/octet-stream",
        metadata: {
          originalName: originalNameEntry,
          uploadedAt: now,
          source: "chunked-upload",
          totalChunks,
        },
      },
    },
    { upsert: true }
  );

  return NextResponse.json({
    uploadId,
    url: buildFileUrl(request, uploadId),
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const isChunkedUpload =
      formData.has("chunkIndex") ||
      formData.has("totalChunks") ||
      formData.has("chunkSize") ||
      formData.has("fileSize");

    if (isChunkedUpload) {
      return handleChunkedUpload(request, formData, file);
    }

    return handleSingleUpload(request, file);
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}

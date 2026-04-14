import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { Readable } from "stream";
import { getGridFSBucket } from "@/lib/mongodb";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function buildCommonHeaders(file: {
  contentType?: string;
  length?: number;
  filename?: string;
}) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": `inline; filename="${file.filename || "file"}"`,
    "Content-Type": file.contentType || "application/octet-stream",
    "Content-Length": String(file.length || 0),
  };
}

function parseRangeHeader(rangeHeader: string, fileLength: number) {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];

  let start: number;
  let end: number;

  if (startRaw === "" && endRaw === "") {
    return null;
  }

  if (startRaw === "") {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(fileLength - suffixLength, 0);
    end = fileLength - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    end =
      endRaw === ""
        ? fileLength - 1
        : Number.parseInt(endRaw, 10);
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= fileLength
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, fileLength - 1),
  };
}

async function getFileById(id: string) {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const objectId = new ObjectId(id);
  const bucket = await getGridFSBucket();
  const files = await bucket.find({ _id: objectId }).toArray();

  if (files.length === 0) {
    return null;
  }

  return {
    bucket,
    file: files[0],
    objectId,
  };
}

async function handleRequest(
  request: Request,
  { params }: RouteContext,
  method: "GET" | "HEAD"
) {
  try {
    const { id } = await params;
    const result = await getFileById(id);

    if (!result) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const { bucket, file, objectId } = result;
    const baseHeaders = buildCommonHeaders(file);

    if (method === "HEAD") {
      return new NextResponse(null, {
        status: 200,
        headers: baseHeaders,
      });
    }

    const rangeHeader = request.headers.get("range");
    if (rangeHeader && file.length) {
      const parsedRange = parseRangeHeader(rangeHeader, file.length);

      if (!parsedRange) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes */${file.length}`,
          },
        });
      }

      const { start, end } = parsedRange;
      const downloadStream = bucket.openDownloadStream(objectId, {
        start,
        end: end + 1,
      });
      const webStream = Readable.toWeb(downloadStream as any) as ReadableStream;

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${file.length}`,
        },
      });
    }

    const downloadStream = bucket.openDownloadStream(objectId);
    const webStream = Readable.toWeb(downloadStream as any) as ReadableStream;

    return new NextResponse(webStream, {
      status: 200,
      headers: baseHeaders,
    });
  } catch (error: any) {
    console.error("File retrieval error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve file" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handleRequest(request, context, "GET");
}

export async function HEAD(request: Request, context: RouteContext) {
  return handleRequest(request, context, "HEAD");
}

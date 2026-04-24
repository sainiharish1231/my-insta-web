import { createWriteStream, existsSync } from "fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, unlink } from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ytdl from "@distube/ytdl-core";
import { v2 as cloudinary } from "cloudinary";
import {
  buildGeneratedShortCopy,
  buildShortsPlan,
  extractYouTubeVideoId,
  type GeneratedShortAsset,
  type ShortsVideoMetadata,
} from "@/lib/youtube-shorts";

function resolveBundledFfmpegPath() {
  const candidates = [
    ffmpegPath as string | null,
    typeof ffmpegPath === "string"
      ? ffmpegPath.replace(/^\/ROOT\//, "/root/")
      : null,
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

const resolvedFfmpegPath = resolveBundledFfmpegPath();
const PLAYABLE_INFO_PLAYER_CLIENTS: Array<
  NonNullable<ytdl.getInfoOptions["playerClients"]>
> = [
  ["WEB_EMBEDDED", "IOS", "ANDROID", "TV", "WEB"],
  ["WEB", "WEB_EMBEDDED", "IOS", "ANDROID", "TV"],
  ["IOS", "ANDROID", "TV", "WEB_EMBEDDED"],
  ["WEB"],
];

if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
}

type SourceVideoMetadata = Omit<ShortsVideoMetadata, "sourceUrl">;
type DownloadEngine = "ytdl" | "yt-dlp" | "youtubei.js";

let youtubeJsClientPromise: Promise<any> | null = null;

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeYouTubeError(error: unknown, mode: "metadata" | "download") {
  const fallbackMessage =
    mode === "metadata"
      ? "Failed to fetch YouTube video metadata."
      : "Failed to prepare the YouTube video for shorts generation.";

  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  const message = error.message || fallbackMessage;

  if (
    message.includes("Failed to find any playable formats") ||
    message.includes("No playable formats found")
  ) {
    return mode === "metadata"
      ? "YouTube se basic metadata nahi mil paya. Public long video URL try karo."
      : "YouTube ne is video ke playable/downloadable formats block kar diye. Public, non-restricted long video try karo. Private, age-restricted, region-locked, ya premium videos ke liye cookies/proxy support chahiye ho sakta hai.";
  }

  return message;
}

function getCloudinaryConfig() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary server upload is not configured. Add NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });

  return { cloudName, apiKey, apiSecret };
}

function pickMuxedDownloadFormat(formats: ytdl.videoFormat[]) {
  const preferredFormats = formats
    .filter(
      (format) =>
        format.hasVideo &&
        format.hasAudio &&
        Boolean(format.url),
    )
    .sort((left, right) => {
      const leftContainerBonus = left.container === "mp4" ? 1_000_000_000 : 0;
      const rightContainerBonus = right.container === "mp4" ? 1_000_000_000 : 0;
      const leftScore = (left.height || 0) * 10_000 + (left.bitrate || 0);
      const rightScore = (right.height || 0) * 10_000 + (right.bitrate || 0);
      return rightContainerBonus + rightScore - (leftContainerBonus + leftScore);
    });

  return preferredFormats[0];
}

function getBestThumbnail(thumbnails: Array<{ url: string; width?: number; height?: number }> = []) {
  return [...thumbnails].sort((left, right) => {
    const leftScore = (left.width || 0) * (left.height || 0);
    const rightScore = (right.width || 0) * (right.height || 0);
    return rightScore - leftScore;
  })[0]?.url;
}

function buildSourceVideoMetadataFromYtdlInfo(info: ytdl.videoInfo): SourceVideoMetadata {
  const title = info.videoDetails.title?.trim() || "YouTube Video";
  const description = info.videoDetails.description?.trim() || "";

  return {
    videoId: info.videoDetails.videoId,
    title,
    description,
    keywords: deriveKeywordsFromMetadata(
      title,
      description,
      Array.isArray(info.videoDetails.keywords) ? info.videoDetails.keywords : [],
    ),
    durationSeconds: Number(info.videoDetails.lengthSeconds || 0),
    thumbnailUrl: getBestThumbnail(info.videoDetails.thumbnails),
    authorName: info.videoDetails.author?.name,
  };
}

function buildSourceVideoMetadataFromYouTubeJsInfo(info: any): SourceVideoMetadata {
  const basicInfo = info?.basic_info || {};
  const title = basicInfo.title?.trim?.() || "YouTube Video";
  const description = basicInfo.short_description?.trim?.() || "";

  return {
    videoId: basicInfo.id,
    title,
    description,
    keywords: deriveKeywordsFromMetadata(
      title,
      description,
      Array.isArray(basicInfo.keywords) ? basicInfo.keywords : [],
    ),
    durationSeconds: Number(basicInfo.duration || 0),
    thumbnailUrl: getBestThumbnail(
      Array.isArray(basicInfo.thumbnail)
        ? basicInfo.thumbnail.map((thumbnail: any) => ({
            url: thumbnail.url,
            width: thumbnail.width,
            height: thumbnail.height,
          }))
        : [],
    ),
    authorName: basicInfo.author,
  };
}

function deriveKeywordsFromMetadata(title: string, description: string, keywords: string[]) {
  const values = [
    ...keywords,
    ...title.split(/\s+/),
    ...description.split(/\s+/),
  ];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const nextValue = value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
    if (!nextValue || nextValue.length < 3 || seen.has(nextValue)) {
      continue;
    }

    seen.add(nextValue);
    normalized.push(nextValue);
  }

  return normalized.slice(0, 15);
}

async function getSourceVideoMetadata(sourceUrl: string): Promise<SourceVideoMetadata> {
  const info = await getYouTubeBasicInfo(sourceUrl);
  return buildSourceVideoMetadataFromYtdlInfo(info);
}

async function downloadYouTubeSourceVideo(sourceUrl: string, outputBasePath: string) {
  const outputPath = `${outputBasePath}.mp4`;

  try {
    const info = await getPlayableYouTubeInfo(sourceUrl);
    const selectedFormat =
      pickMuxedDownloadFormat(info.formats) ||
      ytdl.chooseFormat(info.formats, { quality: "highest", filter: "audioandvideo" });

    if (!selectedFormat?.itag) {
      throw new Error(
        "Could not find a downloadable combined audio/video format for this video.",
      );
    }

    const downloadStream = ytdl.downloadFromInfo(info, {
      quality: selectedFormat.itag,
    });

    await pipeline(downloadStream, createWriteStream(outputPath));

    return {
      engine: "ytdl" as DownloadEngine,
      outputPath,
    };
  } catch (error) {
    console.warn("[v0] ytdl download failed, falling back to yt-dlp:", error);

    try {
      return await downloadYouTubeSourceVideoWithYtDlp(sourceUrl, outputBasePath);
    } catch (ytDlpError) {
      console.warn("[v0] yt-dlp download failed, falling back to youtubei.js:", ytDlpError);
      return downloadYouTubeSourceVideoWithYouTubeJs(sourceUrl, outputBasePath);
    }
  }
}

async function getYouTubeBasicInfo(sourceUrl: string) {
  try {
    return await ytdl.getBasicInfo(sourceUrl);
  } catch (error) {
    throw new Error(normalizeYouTubeError(error, "metadata"));
  }
}

async function getPlayableYouTubeInfo(sourceUrl: string) {
  let lastError: unknown;

  for (const playerClients of PLAYABLE_INFO_PLAYER_CLIENTS) {
    try {
      const info = await ytdl.getInfo(sourceUrl, { playerClients });
      if (info.formats?.length) {
        return info;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(normalizeYouTubeError(lastError, "download"));
}

async function getYouTubeJsClient() {
  if (!youtubeJsClientPromise) {
    youtubeJsClientPromise = import("youtubei.js").then(
      async ({ Innertube, UniversalCache }) =>
        Innertube.create({
          cache: new UniversalCache(false),
        }),
    );
  }

  return youtubeJsClientPromise;
}

async function resolveYtDlpCommand() {
  const localBinary = path.join(process.cwd(), ".venv-ytdlp", "bin", "yt-dlp");
  if (await pathExists(localBinary)) {
    return {
      command: localBinary,
      argsPrefix: [] as string[],
    };
  }

  return {
    command: "yt-dlp",
    argsPrefix: [] as string[],
  };
}

async function getResolvedFfmpegPath() {
  return resolvedFfmpegPath;
}

async function downloadYouTubeSourceVideoWithYtDlp(
  sourceUrl: string,
  outputBasePath: string,
): Promise<{ engine: DownloadEngine; outputPath: string }> {
  const { command, argsPrefix } = await resolveYtDlpCommand();
  const ytDlpFfmpegPath = await getResolvedFfmpegPath();
  const outputTemplate = `${outputBasePath}.%(ext)s`;
  const tempDir = path.dirname(outputBasePath);

  const args = [
    ...argsPrefix,
    "--no-playlist",
    "--no-warnings",
    "--format",
    "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "--output",
    outputTemplate,
    "--force-overwrites",
  ];

  if (ytDlpFfmpegPath) {
    args.push("--ffmpeg-location", ytDlpFfmpegPath);
  }

  args.push(sourceUrl);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
    });
  });

  const downloadedFiles = (await readdir(tempDir))
    .filter((file) => file.startsWith(path.basename(outputBasePath)))
    .sort();

  const downloadedFile = downloadedFiles
    .map((file) => path.join(tempDir, file))
    .find((file) => file.endsWith(".mp4")) || downloadedFiles.map((file) => path.join(tempDir, file))[0];

  if (!downloadedFile) {
    throw new Error("yt-dlp did not produce a downloadable video file.");
  }

  return {
    engine: "yt-dlp",
    outputPath: downloadedFile,
  };
}

async function downloadYouTubeSourceVideoWithYouTubeJs(
  sourceUrl: string,
  outputBasePath: string,
): Promise<{ engine: DownloadEngine; outputPath: string }> {
  const videoId = extractYouTubeVideoId(sourceUrl);
  const outputPath = `${outputBasePath}.mp4`;

  if (!videoId) {
    throw new Error("Could not determine the YouTube video id from this URL.");
  }

  try {
    const innertube = await getYouTubeJsClient();
    const info = await innertube.getBasicInfo(videoId, { client: "IOS" });
    const attempts = [
      { client: "IOS", type: "video+audio", quality: "best", format: "mp4" },
      { client: "WEB", type: "video+audio", quality: "best", format: "mp4" },
      { client: "IOS", type: "video+audio", quality: "best", format: "any" },
      { client: "WEB", type: "video+audio", quality: "best", format: "any" },
    ];

    let lastError: unknown;

    for (const attempt of attempts) {
      try {
        const webStream = await innertube.download(videoId, attempt);
        await pipeline(Readable.fromWeb(webStream as any), createWriteStream(outputPath));

        return {
          engine: "youtubei.js",
          outputPath,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("youtubei.js download failed");
  } catch (error) {
    throw new Error(
      `YouTube source download failed after ytdl + youtubei.js fallback. ${
        error instanceof Error ? error.message : "Unknown download error."
      }`,
    );
  }
}

async function renderVerticalShort({
  inputPath,
  outputPath,
  startSeconds,
  durationSeconds,
}: {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  durationSeconds: number;
}) {
  await mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startSeconds)
      .duration(durationSeconds)
      .videoFilters(
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p",
      )
      .outputOptions([
        "-c:v libx264",
        "-preset veryfast",
        "-crf 23",
        "-movflags +faststart",
        "-profile:v high",
        "-level 4.1",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-b:a 128k",
        "-ar 44100",
        "-ac 2",
      ])
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .save(outputPath);
  });
}

async function uploadClipToCloudinary({
  filePath,
  folder,
  publicId,
}: {
  filePath: string;
  folder: string;
  publicId: string;
}) {
  getCloudinaryConfig();

  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: "video",
    folder,
    public_id: publicId,
    overwrite: true,
    use_filename: false,
  });

  return {
    assetUrl: result.secure_url,
    cloudinaryPublicId: result.public_id,
    cloudinaryResourceType: result.resource_type,
  };
}

export async function getYouTubeShortsMetadata({
  sourceUrl,
  segmentDurationSeconds = 30,
  overlapSeconds = 0,
}: {
  sourceUrl: string;
  segmentDurationSeconds?: number;
  overlapSeconds?: number;
}) {
  if (!ytdl.validateURL(sourceUrl)) {
    throw new Error("Please enter a valid YouTube long video URL.");
  }

  const info = await getYouTubeBasicInfo(sourceUrl);
  const title = info.videoDetails.title?.trim() || "YouTube Video";
  const description = info.videoDetails.description?.trim() || "";
  const keywords = deriveKeywordsFromMetadata(
    title,
    description,
    Array.isArray(info.videoDetails.keywords) ? info.videoDetails.keywords : [],
  );
  const durationSeconds = Number(info.videoDetails.lengthSeconds || 0);
  const plan = buildShortsPlan({
    durationSeconds,
    segmentDurationSeconds,
    overlapSeconds,
  });

  const video: ShortsVideoMetadata = {
    sourceUrl,
    videoId: info.videoDetails.videoId,
    title,
    description,
    keywords,
    durationSeconds,
    thumbnailUrl: getBestThumbnail(info.videoDetails.thumbnails),
    authorName: info.videoDetails.author?.name,
  };

  return {
    video,
    plan,
  };
}

export async function prepareYouTubeShortsSource({
  sourceUrl,
  segmentDurationSeconds = 30,
  overlapSeconds = 0,
  title,
  description,
  keywords = [],
}: {
  sourceUrl: string;
  segmentDurationSeconds?: number;
  overlapSeconds?: number;
  title?: string;
  description?: string;
  keywords?: string[];
}) {
  if (!ytdl.validateURL(sourceUrl)) {
    throw new Error("Please enter a valid YouTube long video URL.");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "youtube-shorts-source-"));
  const sourcePathBase = path.join(tempRoot, "source-video");
  const uploadFolder = `youtube-shorts/source/${new Date().toISOString().slice(0, 10)}/${Date.now()}`;

  try {
    const metadata = await getSourceVideoMetadata(sourceUrl);
    const { engine, outputPath: sourcePath } = await downloadYouTubeSourceVideo(
      sourceUrl,
      sourcePathBase,
    );
    const sourceTitle = title?.trim() || metadata.title || "YouTube Video";
    const sourceDescription = description?.trim() || metadata.description || "";
    const sourceKeywords = keywords.length > 0 ? keywords : metadata.keywords;
    const durationSeconds = Number(metadata.durationSeconds || 0);
    const plan = buildShortsPlan({
      durationSeconds,
      segmentDurationSeconds,
      overlapSeconds,
    });

    if (plan.length === 0) {
      throw new Error("This video is too short to split into shorts.");
    }

    const sourceAsset = await uploadClipToCloudinary({
      filePath: sourcePath,
      folder: uploadFolder,
      publicId: sanitizePathPart(metadata.videoId || `${sourceTitle}-${Date.now()}`),
    });

    const video: ShortsVideoMetadata = {
      sourceUrl,
      videoId: metadata.videoId,
      title: sourceTitle,
      description: sourceDescription,
      keywords: sourceKeywords,
      durationSeconds,
      thumbnailUrl: metadata.thumbnailUrl,
      authorName: metadata.authorName,
    };

    return {
      video,
      plan,
      sourceAsset,
      downloadEngine: engine,
      uploadFolder,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function downloadYouTubeSourceVideoLocally({
  sourceUrl,
}: {
  sourceUrl: string;
}) {
  if (!ytdl.validateURL(sourceUrl)) {
    throw new Error("Please enter a valid YouTube long video URL.");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "youtube-shorts-local-"));
  const sourcePathBase = path.join(tempRoot, "source-video");

  try {
    const { engine, outputPath } = await downloadYouTubeSourceVideo(
      sourceUrl,
      sourcePathBase,
    );
    const fileBuffer = await readFile(outputPath);
    const extension = path.extname(outputPath) || ".mp4";
    const safeBaseName = sanitizePathPart(
      extractYouTubeVideoId(sourceUrl) || `youtube-source-${Date.now()}`,
    );

    return {
      fileBuffer,
      fileName: `${safeBaseName}${extension}`,
      contentType:
        extension === ".webm"
          ? "video/webm"
          : extension === ".mov"
            ? "video/quicktime"
            : "video/mp4",
      downloadEngine: engine,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function buildYouTubeShortAssets({
  sourceUrl,
  segmentDurationSeconds = 15,
  overlapSeconds = 5,
  title,
  description,
  keywords = [],
}: {
  sourceUrl: string;
  segmentDurationSeconds?: number;
  overlapSeconds?: number;
  title?: string;
  description?: string;
  keywords?: string[];
}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "youtube-shorts-"));
  const sourcePathBase = path.join(tempRoot, "source-video");
  const uploadFolder = `youtube-shorts/${new Date().toISOString().slice(0, 10)}/${Date.now()}`;

  try {
    const metadata = await getSourceVideoMetadata(sourceUrl);
    const { outputPath: sourcePath } = await downloadYouTubeSourceVideo(sourceUrl, sourcePathBase);
    const sourceTitle = title?.trim() || metadata.title || "YouTube Video";
    const sourceDescription = description?.trim() || metadata.description || "";
    const sourceKeywords =
      keywords.length > 0
        ? keywords
        : metadata.keywords;
    const durationSeconds = Number(metadata.durationSeconds || 0);
    const plan = buildShortsPlan({
      durationSeconds,
      segmentDurationSeconds,
      overlapSeconds,
    });

    if (plan.length === 0) {
      throw new Error("This video is too short to split into 10-15 second shorts.");
    }

    const generatedAssets: GeneratedShortAsset[] = [];

    for (const segment of plan) {
      const clipFilename = `${sanitizePathPart(segment.id)}.mp4`;
      const clipPath = path.join(tempRoot, clipFilename);

      await renderVerticalShort({
        inputPath: sourcePath,
        outputPath: clipPath,
        startSeconds: segment.startSeconds,
        durationSeconds: segment.durationSeconds,
      });

      const uploadedAsset = await uploadClipToCloudinary({
        filePath: clipPath,
        folder: uploadFolder,
        publicId: sanitizePathPart(segment.id),
      });

      const generatedCopy = buildGeneratedShortCopy({
        originalTitle: sourceTitle,
        originalDescription: sourceDescription,
        originalKeywords: sourceKeywords,
        segment,
        totalSegments: plan.length,
      });

      generatedAssets.push({
        ...segment,
        ...generatedCopy,
        ...uploadedAsset,
      });

      await unlink(clipPath).catch(() => undefined);
    }

    const video: ShortsVideoMetadata = {
      sourceUrl,
      videoId: metadata.videoId,
      title: sourceTitle,
      description: sourceDescription,
      keywords: sourceKeywords,
      durationSeconds,
      thumbnailUrl: metadata.thumbnailUrl,
      authorName: metadata.authorName,
    };

    return {
      video,
      queue: generatedAssets,
      uploadFolder,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

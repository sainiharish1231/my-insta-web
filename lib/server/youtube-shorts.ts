import { createWriteStream, existsSync } from "fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "fs/promises";
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
  normalizeYouTubeUrl,
  type GeneratedShortCopy,
  type GeneratedShortAsset,
  type ShortsFramingMode,
  type ShortsQualityPreset,
  type ShortsRenderSettings,
  type ShortsResolvedQualityPreset,
  type ShortsWindow,
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

async function detectHardwareAcceleration(): Promise<{
  encoder: string | null;
  hwaccel: string | null;
}> {
  const ffmpegBinaryPath = resolvedFfmpegPath || "ffmpeg";
  const encodersToTry = [
    { encoder: "h264_videotoolbox", hwaccel: null }, // macOS
    { encoder: "h264_nvenc", hwaccel: "cuda" }, // NVIDIA Linux/Windows
    { encoder: "h264_vaapi", hwaccel: "vaapi" }, // Intel/AMD Linux
    { encoder: "h264_qsv", hwaccel: "qsv" }, // Intel QuickSync
  ];

  for (const { encoder } of encodersToTry) {
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const child = spawn(ffmpegBinaryPath, ["-hide_banner", "-encoders"], {
          cwd: process.cwd(),
          env: process.env,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", () => resolve(stdout + stderr));
      });
      if (result.includes(encoder)) {
        console.log(`[v0] Hardware acceleration detected: ${encoder}`);
        return {
          encoder,
          hwaccel:
            encodersToTry.find((e) => e.encoder === encoder)?.hwaccel || null,
        };
      }
    } catch {
      // ignore
    }
  }

  return { encoder: null, hwaccel: null };
}

let cachedHwAccelPromise: Promise<{
  encoder: string | null;
  hwaccel: string | null;
}> | null = null;
function getHardwareAcceleration() {
  if (!cachedHwAccelPromise) {
    cachedHwAccelPromise = detectHardwareAcceleration();
  }
  return cachedHwAccelPromise;
}

type SourceVideoMetadata = Omit<ShortsVideoMetadata, "sourceUrl">;
type DownloadEngine = "ytdl" | "yt-dlp" | "youtubei.js";
type YtDlpCookieContext = {
  cookieFilePath?: string;
  cleanup: () => Promise<void>;
};
type YtDlpRuntimeContext = {
  command: string;
  argsPrefix: string[];
  cookieArgs: string[];
  cleanup: () => Promise<void>;
};
type DownloadPreferences = {
  maxHeight?: number;
};

let youtubeJsClientPromise: Promise<any> | null = null;
const GENERATED_SHORTS_UPLOAD_ROOT = "shorts-videos";
const DEFAULT_SHORTS_FRAMING_MODE: ShortsFramingMode = "show-full";
const DEFAULT_SHORTS_QUALITY_PRESET: ShortsQualityPreset = "1080p";
const DEFAULT_INCLUDE_LOGO_OVERLAY = true;
const CLOUDINARY_VIDEO_UPLOAD_CHUNK_SIZE = 20_000_000;

type ShortsRenderProfile = {
  key: ShortsResolvedQualityPreset;
  width: number;
  height: number;
  label: string;
  frameRate: number;
  crf: number;
  preset: string;
  maxRate: string;
  bufSize: string;
  audioBitrate: string;
  level: string;
  videoCodec: string;
  videoCodecOptions: string[];
};

type ShortsRenderOptions = {
  framingMode: ShortsFramingMode;
  qualityPreset: ShortsQualityPreset;
  includeLogoOverlay: boolean;
};

type ProbedVideoStream = {
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  frameRate: number;
};

type ShortsTextOverlay = Pick<
  GeneratedShortCopy,
  "partLabel" | "headlineLines" | "highlightedLineIndex"
>;

type ResolvedShortsRenderContext = {
  profile: ShortsRenderProfile;
  framingMode: ShortsFramingMode;
  logoOverlayPath: string | null;
  fontPath: string | null;
};

const SHORTS_RENDER_PROFILES: Record<
  ShortsResolvedQualityPreset,
  ShortsRenderProfile
> = {
  "1080p": {
    key: "1080p",
    width: 1080,
    height: 1920,
    label: "1080x1920",
    frameRate: 30,
    crf: 22,
    preset: "veryfast",
    maxRate: "10M",
    bufSize: "20M",
    audioBitrate: "192k",
    level: "4.2",
    videoCodec: "libx264",
    videoCodecOptions: [
      "-profile:v high",
      "-level 4.2",
      "-g 60",
      "-pix_fmt yuv420p",
    ],
  },
  "1440p": {
    key: "1440p",
    width: 1440,
    height: 2560,
    label: "1440x2560",
    frameRate: 30,
    crf: 22,
    preset: "veryfast",
    maxRate: "18M",
    bufSize: "36M",
    audioBitrate: "192k",
    level: "5.1",
    videoCodec: "libx264",
    videoCodecOptions: [
      "-profile:v high",
      "-level 5.1",
      "-g 60",
      "-pix_fmt yuv420p",
    ],
  },
  "2160p": {
    key: "2160p",
    width: 2160,
    height: 3840,
    label: "2160x3840 (4K)",
    frameRate: 30,
    crf: 23,
    preset: "veryfast",
    maxRate: "30M",
    bufSize: "60M",
    audioBitrate: "192k",
    level: "5.2",
    videoCodec: "libx264",
    videoCodecOptions: [
      "-profile:v high",
      "-level 5.2",
      "-g 60",
      "-pix_fmt yuv420p",
    ],
  },
};

const SHORTS_LOGO_OVERLAY_PATH = resolveShortsLogoOverlayPath();
const SHORTS_FONT_PATH = resolveShortsFontPath();

type ShortsBuildProgressPayload = {
  video: ShortsVideoMetadata;
  plan: ShortsWindow[];
  uploadFolder: string;
  renderWidth: number;
  renderHeight: number;
  renderLabel: string;
  framingMode: ShortsFramingMode;
  hasLogoOverlay: boolean;
};

type ShortAssetCreatedPayload = ShortsBuildProgressPayload & {
  asset: GeneratedShortAsset;
  index: number;
  total: number;
};

type ShortBuildCallbacks = {
  onPlanReady?: (payload: ShortsBuildProgressPayload) => Promise<void> | void;
  onClipCreated?: (payload: ShortAssetCreatedPayload) => Promise<void> | void;
};

function resolveShortsLogoOverlayPath() {
  const configuredLogoPath = process.env.YOUTUBE_SHORTS_LOGO_PATH?.trim();
  const candidates = [
    configuredLogoPath,
    path.join(process.cwd(), "public", "logo-overlay.png"),
    path.join(process.cwd(), "public", "logo-overlay.webp"),
    path.join(process.cwd(), "public", "logo-overlay.jpg"),
    path.join(process.cwd(), "public", "logo-overlay.jpeg"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveShortsFontPath() {
  const configuredFontPath = process.env.YOUTUBE_SHORTS_FONT_PATH?.trim();
  const candidates = [
    configuredFontPath,
    path.join(process.cwd(), "public", "fonts", "NotoSansDevanagari-Bold.ttf"),
    path.join(process.cwd(), "public", "fonts", "NotoSans-Bold.ttf"),
    path.join(process.cwd(), "public", "fonts", "Inter-Bold.ttf"),
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/NotoSansDevanagari.ttc",
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function normalizeShortsRenderOptions(
  options?: ShortsRenderSettings,
): ShortsRenderOptions {
  const framingMode =
    options?.framingMode === "fill" ? "fill" : DEFAULT_SHORTS_FRAMING_MODE;
  const qualityPreset =
    options?.qualityPreset === "1080p" ||
    options?.qualityPreset === "1440p" ||
    options?.qualityPreset === "2160p"
      ? options.qualityPreset
      : DEFAULT_SHORTS_QUALITY_PRESET;

  return {
    framingMode,
    qualityPreset,
    includeLogoOverlay:
      typeof options?.includeLogoOverlay === "boolean"
        ? options.includeLogoOverlay
        : DEFAULT_INCLUDE_LOGO_OVERLAY,
  };
}

function resolveDownloadPreferences(
  options?: ShortsRenderSettings,
): DownloadPreferences {
  if (options?.qualityPreset === "1080p") {
    return { maxHeight: 1080 };
  }

  if (options?.qualityPreset === "1440p") {
    return { maxHeight: 1440 };
  }

  if (options?.qualityPreset === "2160p") {
    return { maxHeight: 2160 };
  }

  return {};
}

function parseDetectedFrameRate(value?: string) {
  if (!value) {
    return 30;
  }

  const normalizedValue = value.trim();
  if (normalizedValue.includes("/")) {
    const [numeratorValue, denominatorValue] = normalizedValue.split("/", 2);
    const numerator = Number(numeratorValue);
    const denominator = Number(denominatorValue);

    if (
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator > 0
    ) {
      return Math.max(24, Math.min(60, numerator / denominator));
    }
  }

  const parsed = Number(normalizedValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(24, Math.min(60, parsed));
  }

  return 30;
}

function parseVideoProbeOutput(output: string): ProbedVideoStream | null {
  const lines = output.split("\n");
  const videoStreamLine = lines.find((line) =>
    /Stream #\d+:\d+.*Video:/i.test(line),
  );

  if (!videoStreamLine) {
    return null;
  }

  const dimensionsMatch = videoStreamLine.match(
    /(\d{2,5})x(\d{2,5})(?:\s|\[|,)/,
  );

  if (!dimensionsMatch) {
    return null;
  }

  const width = Number(dimensionsMatch[1]);
  const height = Number(dimensionsMatch[2]);
  const rotationMatch = output.match(
    /(?:rotate\s*:\s*(-?\d+)|rotation of (-?\d+(?:\.\d+)?) degrees)/i,
  );
  const rotation = rotationMatch
    ? Math.round(Number(rotationMatch[1] || rotationMatch[2] || 0) / 90) * 90
    : 0;
  const isSideways = Math.abs(rotation % 180) === 90;
  const frameRateMatch =
    videoStreamLine.match(/,\s*([0-9.]+)\s*fps\b/i) ||
    videoStreamLine.match(/,\s*([0-9.]+)\s*tbr\b/i);
  const avgFrameRateMatch = output.match(/avg_frame_rate=([0-9]+\/[0-9]+)/i);
  const frameRate = parseDetectedFrameRate(
    avgFrameRateMatch?.[1] || frameRateMatch?.[1],
  );

  return {
    width,
    height,
    displayWidth: isSideways ? height : width,
    displayHeight: isSideways ? width : height,
    rotation,
    frameRate,
  };
}

async function probeVideoStream(inputPath: string) {
  const ffmpegBinaryPath = resolvedFfmpegPath || "ffmpeg";

  try {
    return await new Promise<ProbedVideoStream | null>((resolve, reject) => {
      const child = spawn(ffmpegBinaryPath, ["-hide_banner", "-i", inputPath], {
        cwd: process.cwd(),
        env: process.env,
      });

      let output = "";

      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", () => {
        resolve(parseVideoProbeOutput(output));
      });
    });
  } catch (error) {
    console.warn("[v0] Failed to probe source video stream:", error);
    return null;
  }
}

function resolveShortsRenderProfile(
  qualityPreset: ShortsQualityPreset,
  videoStream: ProbedVideoStream | null,
) {
  if (qualityPreset !== "auto") {
    return SHORTS_RENDER_PROFILES[qualityPreset];
  }

  const preservedSourceWidth =
    Math.min(videoStream?.displayWidth || 0, videoStream?.displayHeight || 0) ||
    SHORTS_RENDER_PROFILES["1080p"].width;

  if (preservedSourceWidth >= SHORTS_RENDER_PROFILES["2160p"].width) {
    return SHORTS_RENDER_PROFILES["2160p"];
  }

  if (preservedSourceWidth >= SHORTS_RENDER_PROFILES["1440p"].width) {
    return SHORTS_RENDER_PROFILES["1440p"];
  }

  return SHORTS_RENDER_PROFILES["1080p"];
}

async function resolveShortsRenderContext(
  sourcePath: string,
  options?: ShortsRenderSettings,
): Promise<ResolvedShortsRenderContext> {
  const normalizedOptions = normalizeShortsRenderOptions(options);
  const probedVideoStream = await probeVideoStream(sourcePath);
  const profile = resolveShortsRenderProfile(
    normalizedOptions.qualityPreset,
    probedVideoStream,
  );

  return {
    profile,
    framingMode: normalizedOptions.framingMode,
    logoOverlayPath:
      normalizedOptions.includeLogoOverlay && SHORTS_LOGO_OVERLAY_PATH
        ? SHORTS_LOGO_OVERLAY_PATH
        : null,
    fontPath: SHORTS_FONT_PATH,
  };
}

function escapeFfmpegFilterValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function escapeAssText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function resolveAssFontName(fontPath: string | null) {
  if (!fontPath) {
    return "Arial";
  }

  const normalizedBaseName = path
    .basename(fontPath, path.extname(fontPath))
    .replace(/[-_]+/g, " ")
    .trim();
  const lowerBaseName = normalizedBaseName.toLowerCase();

  if (lowerBaseName.includes("devanagari")) {
    return "Noto Sans Devanagari";
  }

  if (lowerBaseName.includes("arial")) {
    return "Arial";
  }

  if (lowerBaseName.includes("helvetica")) {
    return "Helvetica";
  }

  if (lowerBaseName.includes("inter")) {
    return "Inter";
  }

  return normalizedBaseName || "Arial";
}

function buildShortsAssScript({
  renderContext,
  overlayText,
}: {
  renderContext: ResolvedShortsRenderContext;
  overlayText: ShortsTextOverlay;
}) {
  const fontName = resolveAssFontName(renderContext.fontPath);
  const { profile } = renderContext;
  const headlineLines = overlayText.headlineLines.filter(Boolean).slice(0, 3);
  const headlineFontSize = Math.max(44, Math.round(profile.width * 0.058));
  const headlineLineGap = Math.max(
    Math.round(headlineFontSize * 1.18),
    headlineFontSize + 18,
  );
  const headlineStartY = Math.max(
    Math.round(profile.height * 0.17),
    Math.round(profile.height * 0.15),
  );
  const shadowOffset = Math.max(2, Math.round(profile.width * 0.0035));
  const partFontSize = Math.max(30, Math.round(profile.width * 0.038));
  const partBoxHeight = Math.max(70, Math.round(partFontSize * 1.85));
  const partBoxY =
    profile.height - Math.max(120, Math.round(profile.height * 0.09));
  const centerX = Math.round(profile.width / 2);
  const events: string[] = [];

  headlineLines.forEach((line, index) => {
    const lineY = headlineStartY + index * headlineLineGap;
    const styleName =
      index === overlayText.highlightedLineIndex
        ? "HeadlineDark"
        : "HeadlineLight";

    events.push(
      `Dialogue: 0,0:00:00.00,9:59:59.00,${styleName},,0,0,0,,{\\an8\\pos(${centerX},${lineY})}${escapeAssText(line)}`,
    );
  });

  events.push(
    `Dialogue: 0,0:00:00.00,9:59:59.00,PartLabel,,0,0,0,,{\\an8\\pos(${centerX},${partBoxY + Math.round(partBoxHeight * 0.22)})}${escapeAssText(overlayText.partLabel)}`,
  );

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    `PlayResX: ${profile.width}`,
    `PlayResY: ${profile.height}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: HeadlineLight,${fontName},${headlineFontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,${shadowOffset},8,0,0,0,1`,
    `Style: HeadlineDark,${fontName},${headlineFontSize},&H00000000,&H00000000,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,${Math.max(1, Math.round(shadowOffset * 0.7))},8,0,0,0,1`,
    `Style: PartLabel,${fontName},${partFontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,${shadowOffset},8,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

function estimateHeadlineBoxWidth(
  line: string,
  fontSize: number,
  frameWidth: number,
) {
  return Math.min(
    Math.round(frameWidth * 0.86),
    Math.max(
      Math.round(frameWidth * 0.34),
      Math.round(line.length * fontSize * 0.66) + Math.round(frameWidth * 0.08),
    ),
  );
}

function buildShortsFilterGraph({
  renderContext,
  overlayText,
  subtitlePath,
}: {
  renderContext: ResolvedShortsRenderContext;
  overlayText: ShortsTextOverlay;
  subtitlePath: string | null;
}) {
  const { profile, framingMode, logoOverlayPath, fontPath } = renderContext;
  const baseOutputLabel = "shorts_base";
  const filters: string[] = [];

  if (framingMode === "fill") {
    filters.push(
      `[0:v]fps=${profile.frameRate},scale=${profile.width}:${profile.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${profile.width}:${profile.height},setsar=1,format=yuv420p[${baseOutputLabel}]`,
    );
  } else {
    filters.push(
      `[0:v]fps=${profile.frameRate},split=2[shorts_bg_src][shorts_fg_src]`,
    );
    filters.push(
      `[shorts_bg_src]scale=${profile.width}:${profile.height}:force_original_aspect_ratio=increase:flags=bicubic,crop=${profile.width}:${profile.height},gblur=sigma=12,eq=brightness=-0.05:saturation=1.08[shorts_bg]`,
    );
    filters.push(
      `[shorts_fg_src]scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease:flags=lanczos[shorts_fg]`,
    );
    filters.push(
      `[shorts_bg][shorts_fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[${baseOutputLabel}]`,
    );
  }

  let currentOutputLabel = baseOutputLabel;

  if (logoOverlayPath) {
    const logoMaxWidth = Math.max(160, Math.round(profile.width * 0.17));
    const logoMarginX = Math.max(24, Math.round(profile.width * 0.04));
    const logoMarginY = Math.max(36, Math.round(profile.height * 0.045));

    filters.push(`[1:v]scale=w='min(${logoMaxWidth},iw)':h=-1[shorts_logo]`);
    filters.push(
      `[${currentOutputLabel}][shorts_logo]overlay=x=${logoMarginX}:y=${logoMarginY}:format=auto:eval=init[shorts_logo_applied]`,
    );
    currentOutputLabel = "shorts_logo_applied";
  }

  const headlineLines = overlayText.headlineLines.filter(Boolean).slice(0, 3);
  const headlineFontSize = Math.max(44, Math.round(profile.width * 0.058));
  const headlineLineGap = Math.max(
    Math.round(headlineFontSize * 1.18),
    headlineFontSize + 18,
  );
  const headlineStartY = Math.max(
    Math.round(profile.height * 0.17),
    Math.round(profile.height * 0.15),
  );

  headlineLines.forEach((line, index) => {
    const lineY = headlineStartY + index * headlineLineGap;

    if (index === overlayText.highlightedLineIndex) {
      const boxWidth = estimateHeadlineBoxWidth(
        line,
        headlineFontSize,
        profile.width,
      );
      const boxHeight = Math.round(headlineFontSize * 1.45);
      const boxX = Math.round((profile.width - boxWidth) / 2);
      const boxY = lineY - Math.round(headlineFontSize * 0.42);

      filters.push(
        `[${currentOutputLabel}]drawbox=x=${boxX}:y=${boxY}:w=${boxWidth}:h=${boxHeight}:color=0xFFF4D6@0.96:t=fill[shorts_text_box_${index}]`,
      );
      currentOutputLabel = `shorts_text_box_${index}`;
    }
  });

  const partFontSize = Math.max(30, Math.round(profile.width * 0.038));
  const partBoxWidth = Math.max(230, Math.round(profile.width * 0.28));
  const partBoxHeight = Math.max(70, Math.round(partFontSize * 1.85));
  const partBoxX = Math.round((profile.width - partBoxWidth) / 2);
  const partBoxY =
    profile.height - Math.max(120, Math.round(profile.height * 0.09));

  if (subtitlePath) {
    filters.push(
      `[${currentOutputLabel}]drawbox=x=${partBoxX}:y=${partBoxY}:w=${partBoxWidth}:h=${partBoxHeight}:color=0x0A0F1E@0.48:t=fill[shorts_part_box]`,
    );

    const subtitleOptions = [
      `filename='${escapeFfmpegFilterValue(subtitlePath)}'`,
    ];

    if (fontPath) {
      subtitleOptions.push(
        `fontsdir='${escapeFfmpegFilterValue(path.dirname(fontPath))}'`,
      );
    }

    filters.push(
      `[shorts_part_box]subtitles=${subtitleOptions.join(":")}[shorts_video]`,
    );
  } else {
    filters.push(
      `[${currentOutputLabel}]drawbox=x=${partBoxX}:y=${partBoxY}:w=${partBoxWidth}:h=${partBoxHeight}:color=0x0A0F1E@0.48:t=fill[shorts_video]`,
    );
  }

  return filters;
}

function sanitizePathPart(value: string) {
  return value
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function hasConfiguredYouTubeCookies() {
  return Boolean(
    process.env.YOUTUBE_COOKIES_FILE ||
    process.env.YOUTUBE_COOKIES_BASE64 ||
    process.env.YOUTUBE_COOKIES,
  );
}

function normalizeAndValidateYouTubeSourceUrl(sourceUrl: string) {
  const normalizedSourceUrl = normalizeYouTubeUrl(sourceUrl);

  if (
    !normalizedSourceUrl ||
    !extractYouTubeVideoId(normalizedSourceUrl) ||
    !ytdl.validateURL(normalizedSourceUrl)
  ) {
    throw new Error("Please enter a valid YouTube video URL.");
  }

  return normalizedSourceUrl;
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
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("sign in to confirm you're not a bot") ||
    normalizedMessage.includes("sign in to confirm you’re not a bot")
  ) {
    return hasConfiguredYouTubeCookies()
      ? "YouTube bot-check trigger ho gaya. Cookies refresh karke dubara try karo."
      : "YouTube ne 'sign in to confirm you're not a bot' block diya. Mobile/shared links ab auto-normalize honge, lekin agar block continue rahe to YOUTUBE_COOKIES_FILE ya YOUTUBE_COOKIES_BASE64 configure karo.";
  }

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

function filterFormatsByMaxHeight(
  formats: ytdl.videoFormat[],
  maxHeight?: number,
) {
  if (!maxHeight) {
    return formats;
  }

  const boundedFormats = formats.filter(
    (format) => !format.height || format.height <= maxHeight,
  );

  return boundedFormats.length > 0 ? boundedFormats : formats;
}

function pickMuxedDownloadFormat(
  formats: ytdl.videoFormat[],
  maxHeight?: number,
) {
  const preferredFormats = filterFormatsByMaxHeight(formats, maxHeight)
    .filter(
      (format) => format.hasVideo && format.hasAudio && Boolean(format.url),
    )
    .sort((left, right) => {
      const leftScore =
        (left.height || 0) * 100_000 +
        (left.fps || 0) * 1_000 +
        (left.bitrate || 0) +
        getContainerPreferenceBonus(left.container);
      const rightScore =
        (right.height || 0) * 100_000 +
        (right.fps || 0) * 1_000 +
        (right.bitrate || 0) +
        getContainerPreferenceBonus(right.container);
      return rightScore - leftScore;
    });

  return preferredFormats[0];
}

function getContainerPreferenceBonus(container?: string | null) {
  if (container === "mp4") {
    return 2_000;
  }

  if (container === "webm") {
    return 1_000;
  }

  return 0;
}

function pickVideoOnlyDownloadFormat(
  formats: ytdl.videoFormat[],
  maxHeight?: number,
) {
  const preferredFormats = filterFormatsByMaxHeight(formats, maxHeight)
    .filter(
      (format) => format.hasVideo && !format.hasAudio && Boolean(format.url),
    )
    .sort((left, right) => {
      const leftScore =
        (left.height || 0) * 100_000 +
        (left.fps || 0) * 1_000 +
        (left.bitrate || 0) +
        getContainerPreferenceBonus(left.container);
      const rightScore =
        (right.height || 0) * 100_000 +
        (right.fps || 0) * 1_000 +
        (right.bitrate || 0) +
        getContainerPreferenceBonus(right.container);
      return rightScore - leftScore;
    });

  return preferredFormats[0];
}

function pickAudioOnlyDownloadFormat(formats: ytdl.videoFormat[]) {
  const preferredFormats = formats
    .filter(
      (format) => format.hasAudio && !format.hasVideo && Boolean(format.url),
    )
    .sort(
      (left, right) =>
        (right.audioBitrate || right.bitrate || 0) +
        getContainerPreferenceBonus(right.container) -
        ((left.audioBitrate || left.bitrate || 0) +
          getContainerPreferenceBonus(left.container)),
    );

  return preferredFormats[0];
}

function getFormatExtension(format?: ytdl.videoFormat, fallback = "mp4") {
  if (format?.container) {
    return format.container;
  }

  if (format?.mimeType?.includes("webm")) {
    return "webm";
  }

  if (format?.mimeType?.includes("mp4")) {
    return "mp4";
  }

  if (format?.mimeType?.includes("matroska")) {
    return "mkv";
  }

  return fallback;
}

function resolveMergedOutputExtension(
  videoFormat?: ytdl.videoFormat,
  audioFormat?: ytdl.videoFormat,
) {
  const videoCodec = `${videoFormat?.videoCodec || ""}`.toLowerCase();
  const audioCodec = `${audioFormat?.audioCodec || ""}`.toLowerCase();
  const isMp4FriendlyVideo =
    videoCodec.includes("avc1") ||
    videoCodec.includes("h264") ||
    videoCodec.includes("hev1") ||
    videoCodec.includes("h265");
  const isMp4FriendlyAudio =
    audioCodec.includes("mp4a") || audioCodec.includes("aac");

  return isMp4FriendlyVideo && isMp4FriendlyAudio ? "mp4" : "mkv";
}

function getBestThumbnail(
  thumbnails: Array<{ url: string; width?: number; height?: number }> = [],
) {
  return [...thumbnails].sort((left, right) => {
    const leftScore = (left.width || 0) * (left.height || 0);
    const rightScore = (right.width || 0) * (right.height || 0);
    return rightScore - leftScore;
  })[0]?.url;
}

function buildSourceVideoMetadataFromYtdlInfo(
  info: ytdl.videoInfo,
): SourceVideoMetadata {
  const title = info.videoDetails.title?.trim() || "YouTube Video";
  const description = info.videoDetails.description?.trim() || "";

  return {
    videoId: info.videoDetails.videoId,
    title,
    description,
    keywords: deriveKeywordsFromMetadata(
      title,
      description,
      Array.isArray(info.videoDetails.keywords)
        ? info.videoDetails.keywords
        : [],
    ),
    durationSeconds: Number(info.videoDetails.lengthSeconds || 0),
    thumbnailUrl: getBestThumbnail(info.videoDetails.thumbnails),
    authorName: info.videoDetails.author?.name,
  };
}

function buildSourceVideoMetadataFromYtDlpInfo(info: any): SourceVideoMetadata {
  const title = info?.title?.trim?.() || "YouTube Video";
  const description = info?.description?.trim?.() || "";

  return {
    videoId: info?.id,
    title,
    description,
    keywords: deriveKeywordsFromMetadata(
      title,
      description,
      Array.isArray(info?.tags) ? info.tags : [],
    ),
    durationSeconds: Number(info?.duration || 0),
    thumbnailUrl:
      getBestThumbnail(
        Array.isArray(info?.thumbnails) ? info.thumbnails : [],
      ) || info?.thumbnail,
    authorName: info?.uploader || info?.channel,
  };
}

function deriveKeywordsFromMetadata(
  title: string,
  description: string,
  keywords: string[],
) {
  const values = [
    ...keywords,
    ...title.split(/\s+/),
    ...description.split(/\s+/),
  ];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const nextValue = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
    if (!nextValue || nextValue.length < 3 || seen.has(nextValue)) {
      continue;
    }

    seen.add(nextValue);
    normalized.push(nextValue);
  }

  return normalized.slice(0, 15);
}

async function getSourceVideoMetadata(
  sourceUrl: string,
): Promise<SourceVideoMetadata> {
  let lastError: unknown;

  try {
    const ytDlpInfo = await getYouTubeMetadataWithYtDlp(sourceUrl);
    return buildSourceVideoMetadataFromYtDlpInfo(ytDlpInfo);
  } catch (error) {
    lastError = error;
    console.warn("[v0] yt-dlp metadata failed, falling back to ytdl:", error);
  }

  try {
    const info = await getYouTubeBasicInfo(sourceUrl);
    return buildSourceVideoMetadataFromYtdlInfo(info);
  } catch (error) {
    lastError = error;
  }

  throw new Error(normalizeYouTubeError(lastError, "metadata"));
}

async function downloadYouTubeSourceVideo(
  sourceUrl: string,
  outputBasePath: string,
  preferences: DownloadPreferences = {},
) {
  try {
    return await downloadYouTubeSourceVideoWithYtDlp(
      sourceUrl,
      outputBasePath,
      preferences,
    );
  } catch (ytDlpError) {
    console.warn(
      "[v0] yt-dlp download failed, falling back to ytdl:",
      ytDlpError,
    );

    try {
      return await downloadYouTubeSourceVideoWithYtdl(
        sourceUrl,
        outputBasePath,
        preferences,
      );
    } catch (ytdlError) {
      console.warn(
        "[v0] ytdl download failed, falling back to youtubei.js:",
        ytdlError,
      );
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

async function createYtDlpCookieContext(): Promise<YtDlpCookieContext> {
  const cookieFilePath = process.env.YOUTUBE_COOKIES_FILE?.trim();
  if (cookieFilePath) {
    if (await pathExists(cookieFilePath)) {
      return {
        cookieFilePath,
        cleanup: async () => undefined,
      };
    }

    console.warn(
      "[v0] YOUTUBE_COOKIES_FILE was configured but the file was not found:",
      cookieFilePath,
    );
  }

  const encodedCookies = process.env.YOUTUBE_COOKIES_BASE64?.trim();
  const inlineCookies = process.env.YOUTUBE_COOKIES?.trim();

  if (!encodedCookies && !inlineCookies) {
    return {
      cleanup: async () => undefined,
    };
  }

  const cookieContent = encodedCookies
    ? Buffer.from(encodedCookies, "base64").toString("utf8")
    : inlineCookies!.replace(/\\n/g, "\n");

  if (!cookieContent.trim()) {
    return {
      cleanup: async () => undefined,
    };
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "youtube-cookies-"));
  const tempCookiePath = path.join(tempRoot, "cookies.txt");
  await writeFile(tempCookiePath, cookieContent, "utf8");

  return {
    cookieFilePath: tempCookiePath,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
    },
  };
}

async function resolveYtDlpRuntimeContext(): Promise<YtDlpRuntimeContext> {
  const { command, argsPrefix } = await resolveYtDlpCommand();
  const cookieContext = await createYtDlpCookieContext();

  return {
    command,
    argsPrefix,
    cookieArgs: cookieContext.cookieFilePath
      ? ["--cookies", cookieContext.cookieFilePath]
      : [],
    cleanup: cookieContext.cleanup,
  };
}

async function getResolvedFfmpegPath() {
  return resolvedFfmpegPath;
}

function getYtDlpBaseArgs() {
  return [
    "--no-playlist",
    "--no-warnings",
    "--extractor-args",
    "youtube:player_client=android,web,ios",
    "--add-header",
    "Referer:https://www.youtube.com/",
    "--add-header",
    "Origin:https://www.youtube.com",
  ];
}

async function runYtDlp(args: string[]) {
  const { command, argsPrefix, cookieArgs, cleanup } =
    await resolveYtDlpRuntimeContext();

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(command, [...argsPrefix, ...cookieArgs, ...args], {
        cwd: process.cwd(),
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }

        reject(
          new Error(
            stderr.trim() || stdout.trim() || `yt-dlp exited with code ${code}`,
          ),
        );
      });
    });
  } finally {
    await cleanup();
  }
}

async function getYouTubeMetadataWithYtDlp(sourceUrl: string) {
  const output = await runYtDlp([
    ...getYtDlpBaseArgs(),
    "--dump-single-json",
    "--skip-download",
    sourceUrl,
  ]);

  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `yt-dlp metadata parse failed: ${error.message}`
        : "yt-dlp metadata parse failed",
    );
  }
}

async function downloadYouTubeSourceVideoWithYtdl(
  sourceUrl: string,
  outputBasePath: string,
  preferences: DownloadPreferences = {},
): Promise<{ engine: DownloadEngine; outputPath: string }> {
  const info = await getPlayableYouTubeInfo(sourceUrl);
  const selectedVideoFormat = pickVideoOnlyDownloadFormat(
    info.formats,
    preferences.maxHeight,
  );
  const selectedAudioFormat = pickAudioOnlyDownloadFormat(info.formats);

  if (
    selectedVideoFormat?.itag &&
    selectedAudioFormat?.itag &&
    resolvedFfmpegPath
  ) {
    const outputPath = `${outputBasePath}.${resolveMergedOutputExtension(
      selectedVideoFormat,
      selectedAudioFormat,
    )}`;
    const tempVideoPath = `${outputBasePath}.video.${getFormatExtension(
      selectedVideoFormat,
      "mp4",
    )}`;
    const tempAudioPath = `${outputBasePath}.audio.${getFormatExtension(
      selectedAudioFormat,
      "m4a",
    )}`;

    try {
      await Promise.all([
        pipeline(
          ytdl.downloadFromInfo(info, {
            quality: selectedVideoFormat.itag,
          }),
          createWriteStream(tempVideoPath),
        ),
        pipeline(
          ytdl.downloadFromInfo(info, {
            quality: selectedAudioFormat.itag,
          }),
          createWriteStream(tempAudioPath),
        ),
      ]);

      await mergeDownloadedTracks({
        videoPath: tempVideoPath,
        audioPath: tempAudioPath,
        outputPath,
      });

      return {
        engine: "ytdl",
        outputPath,
      };
    } finally {
      await Promise.allSettled([unlink(tempVideoPath), unlink(tempAudioPath)]);
    }
  }

  const selectedFormat =
    pickMuxedDownloadFormat(info.formats, preferences.maxHeight) ||
    ytdl.chooseFormat(
      filterFormatsByMaxHeight(
        info.formats.filter(
          (format) => format.hasVideo && format.hasAudio && Boolean(format.url),
        ),
        preferences.maxHeight,
      ),
      {
        quality: "highest",
        filter: "audioandvideo",
      },
    );

  if (!selectedFormat?.itag) {
    throw new Error(
      "Could not find a downloadable combined audio/video format for this video.",
    );
  }

  const outputPath = `${outputBasePath}.${getFormatExtension(
    selectedFormat,
    "mp4",
  )}`;
  const downloadStream = ytdl.downloadFromInfo(info, {
    quality: selectedFormat.itag,
  });

  await pipeline(downloadStream, createWriteStream(outputPath));

  return {
    engine: "ytdl",
    outputPath,
  };
}

async function downloadYouTubeSourceVideoWithYtDlp(
  sourceUrl: string,
  outputBasePath: string,
  preferences: DownloadPreferences = {},
): Promise<{ engine: DownloadEngine; outputPath: string }> {
  const ytDlpFfmpegPath = await getResolvedFfmpegPath();
  const outputTemplate = `${outputBasePath}.%(ext)s`;
  const tempDir = path.dirname(outputBasePath);
  const boundedFormat =
    preferences.maxHeight && preferences.maxHeight > 0
      ? `bv*[height<=${preferences.maxHeight}]+ba/b[height<=${preferences.maxHeight}]/bestvideo*[height<=${preferences.maxHeight}]+bestaudio/best[height<=${preferences.maxHeight}]/bv*+ba/bestvideo*+bestaudio/b`
      : "bv*+ba/bestvideo*+bestaudio/b";

  const args = [
    ...getYtDlpBaseArgs(),
    "--format",
    boundedFormat,
    "--output",
    outputTemplate,
    "--force-overwrites",
  ];

  if (ytDlpFfmpegPath) {
    args.push("--ffmpeg-location", ytDlpFfmpegPath);
  }

  args.push(sourceUrl);

  await runYtDlp(args);

  const downloadedFiles = (await readdir(tempDir))
    .filter((file) => file.startsWith(path.basename(outputBasePath)))
    .sort();

  const downloadedFile =
    downloadedFiles
      .map((file) => path.join(tempDir, file))
      .find((file) =>
        [".mp4", ".mkv", ".webm", ".mov"].some((extension) =>
          file.endsWith(extension),
        ),
      ) || downloadedFiles.map((file) => path.join(tempDir, file))[0];

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
        await pipeline(
          Readable.fromWeb(webStream as any),
          createWriteStream(outputPath),
        );

        return {
          engine: "youtubei.js",
          outputPath,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("youtubei.js download failed");
  } catch (error) {
    throw new Error(
      `YouTube source download failed after yt-dlp + ytdl + youtubei.js fallback. ${
        error instanceof Error ? error.message : "Unknown download error."
      }`,
    );
  }
}

async function downloadRemoteSourceVideo(
  sourceUrl: string,
  outputPath: string,
) {
  const response = await fetch(sourceUrl, {
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Uploaded source file download failed with status ${response.status}.`,
    );
  }

  await pipeline(
    Readable.fromWeb(response.body as any),
    createWriteStream(outputPath),
  );
}

async function mergeDownloadedTracks({
  videoPath,
  audioPath,
  outputPath,
}: {
  videoPath: string;
  audioPath: string;
  outputPath: string;
}) {
  const outputExtension = path.extname(outputPath).toLowerCase();
  const isMatroskaOutput = outputExtension === ".mkv";

  return new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .input(audioPath)
      .outputOptions([
        "-c:v copy",
        isMatroskaOutput ? "-c:a copy" : "-c:a aac",
        ...(isMatroskaOutput ? [] : ["-b:a 192k", "-movflags +faststart"]),
      ])
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .save(outputPath);
  });
}

async function renderVerticalShort({
  inputPath,
  outputPath,
  startSeconds,
  durationSeconds,
  renderContext,
  overlayText,
  threadCount,
}: {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  durationSeconds: number;
  renderContext: ResolvedShortsRenderContext;
  overlayText: ShortsTextOverlay;
  threadCount: number;
}) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const subtitlePath = `${outputPath}.ass`;
  const subtitleScript = buildShortsAssScript({
    renderContext,
    overlayText,
  });
  await writeFile(subtitlePath, subtitleScript, "utf8");

  // Detect hardware acceleration once per process
  const hwAccel = await getHardwareAcceleration();
  const useHwAccel = Boolean(hwAccel.encoder);
  const videoCodec = useHwAccel
    ? hwAccel.encoder!
    : renderContext.profile.videoCodec;

  // Build codec-specific output options
  const videoOutputOptions: string[] = useHwAccel
    ? [
        "-c:v " + videoCodec,
        `-b:v ${renderContext.profile.maxRate}`,
        ...(hwAccel.hwaccel ? [`-hwaccel ${hwAccel.hwaccel}`] : []),
        // Hardware encoders don't use CRF/preset the same way
      ]
    : [
        "-c:v " + videoCodec,
        `-preset ${renderContext.profile.preset}`,
        `-crf ${renderContext.profile.crf}`,
        `-maxrate ${renderContext.profile.maxRate}`,
        `-bufsize ${renderContext.profile.bufSize}`,
        ...renderContext.profile.videoCodecOptions,
      ];

  try {
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg()
        .input(inputPath)
        .inputOptions([`-ss ${Math.max(0, startSeconds)}`])
        .duration(durationSeconds);

      if (renderContext.logoOverlayPath) {
        command.input(renderContext.logoOverlayPath).inputOptions(["-loop 1"]);
      }

      command
        .complexFilter(
          buildShortsFilterGraph({
            renderContext,
            overlayText,
            subtitlePath,
          }),
          "shorts_video",
        )
        .outputOptions([
          "-map 0:a?",
          `-threads ${threadCount}`,
          ...videoOutputOptions,
          "-movflags +faststart",
          "-shortest",
          "-c:a aac",
          `-b:a ${renderContext.profile.audioBitrate}`,
          "-ar 48000",
          "-ac 2",
        ])
        .on("end", () => resolve())
        .on("error", (error) => reject(error))
        .save(outputPath);
    });
  } finally {
    await unlink(subtitlePath).catch(() => undefined);
  }
}

function resolveShortsRenderConcurrency(
  profile: ShortsRenderProfile,
  clipCount: number,
) {
  const availableCores = Math.max(1, os.cpus().length || 1);
  // Allow more concurrency with faster presets and hardware accel
  const cpuBoundLimit =
    availableCores >= 12
      ? 6
      : availableCores >= 8
        ? 4
        : availableCores >= 4
          ? 3
          : 2;
  const qualityBoundLimit =
    profile.key === "2160p" ? 2 : profile.key === "1080p" ? 5 : 3;

  return Math.max(1, Math.min(clipCount, cpuBoundLimit, qualityBoundLimit));
}

function resolveShortsRenderThreadCount(renderConcurrency: number) {
  const availableCores = Math.max(1, os.cpus().length || 1);
  return Math.max(
    1,
    Math.floor(availableCores / Math.max(1, renderConcurrency)),
  );
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(items.length, concurrency));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(items[currentIndex]);
      }
    }),
  );
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

  const result = await new Promise<any>((resolve, reject) => {
    cloudinary.uploader.upload_chunked(
      filePath,
      {
        resource_type: "video",
        folder,
        public_id: publicId,
        overwrite: true,
        use_filename: false,
        chunk_size: CLOUDINARY_VIDEO_UPLOAD_CHUNK_SIZE,
        timeout: 600_000,
      },
      (uploadResult: any) => {
        if (!uploadResult) {
          return;
        }

        if (uploadResult.error) {
          reject(uploadResult.error);
          return;
        }

        if (uploadResult.done === false) {
          return;
        }

        resolve(uploadResult);
      },
    );
  });

  return {
    assetUrl: result.secure_url,
    cloudinaryPublicId: result.public_id,
    cloudinaryResourceType: result.resource_type,
  };
}

async function buildShortAssetsFromPreparedSource({
  sourcePath,
  sourceUrl,
  videoId,
  sourceTitle,
  sourceDescription,
  sourceKeywords,
  durationSeconds,
  thumbnailUrl,
  authorName,
  segmentDurationSeconds,
  overlapSeconds,
  uploadFolder,
  renderSettings,
  callbacks,
}: {
  sourcePath: string;
  sourceUrl: string;
  videoId?: string;
  sourceTitle: string;
  sourceDescription: string;
  sourceKeywords: string[];
  durationSeconds: number;
  thumbnailUrl?: string;
  authorName?: string;
  segmentDurationSeconds: number;
  overlapSeconds: number;
  uploadFolder: string;
  renderSettings?: ShortsRenderSettings;
  callbacks?: ShortBuildCallbacks;
}) {
  const plan = buildShortsPlan({
    durationSeconds,
    segmentDurationSeconds,
    overlapSeconds,
  });

  if (plan.length === 0) {
    throw new Error("This video is too short to split into shorts.");
  }

  const video: ShortsVideoMetadata = {
    sourceUrl,
    videoId,
    title: sourceTitle,
    description: sourceDescription,
    keywords: sourceKeywords,
    durationSeconds,
    thumbnailUrl,
    authorName,
  };
  const renderContext = await resolveShortsRenderContext(
    sourcePath,
    renderSettings,
  );

  await callbacks?.onPlanReady?.({
    video,
    plan,
    uploadFolder,
    renderWidth: renderContext.profile.width,
    renderHeight: renderContext.profile.height,
    renderLabel: renderContext.profile.label,
    framingMode: renderContext.framingMode,
    hasLogoOverlay: Boolean(renderContext.logoOverlayPath),
  });

  const tempRoot = path.dirname(sourcePath);
  const generatedAssets = new Array<GeneratedShortAsset>(plan.length);
  let completedUploads = 0;
  const renderConcurrency = resolveShortsRenderConcurrency(
    renderContext.profile,
    plan.length,
  );
  const renderThreadCount = resolveShortsRenderThreadCount(renderConcurrency);

  // Pipeline: render workers produce clips, upload happens as soon as each render finishes
  // while other renders continue in parallel.
  const uploadQueue: Array<{
    segment: ShortsWindow;
    clipPath: string;
    generatedCopy: GeneratedShortCopy;
  }> = [];
  let uploadIndex = 0;
  let renderDoneCount = 0;
  let allRendersDone = false;

  const processUploadQueue = async () => {
    while (true) {
      if (uploadIndex >= uploadQueue.length) {
        if (allRendersDone) break;
        // Wait a bit for more renders to finish
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const { segment, clipPath, generatedCopy } = uploadQueue[uploadIndex];
      uploadIndex += 1;

      try {
        const uploadedAsset = await uploadClipToCloudinary({
          filePath: clipPath,
          folder: uploadFolder,
          publicId: sanitizePathPart(segment.id),
        });

        const nextAsset: GeneratedShortAsset = {
          ...segment,
          ...generatedCopy,
          renderWidth: renderContext.profile.width,
          renderHeight: renderContext.profile.height,
          renderLabel: renderContext.profile.label,
          framingMode: renderContext.framingMode,
          hasLogoOverlay: Boolean(renderContext.logoOverlayPath),
          ...uploadedAsset,
        };

        generatedAssets[segment.index] = nextAsset;
        completedUploads += 1;

        await callbacks?.onClipCreated?.({
          video,
          plan,
          uploadFolder,
          renderWidth: renderContext.profile.width,
          renderHeight: renderContext.profile.height,
          renderLabel: renderContext.profile.label,
          framingMode: renderContext.framingMode,
          hasLogoOverlay: Boolean(renderContext.logoOverlayPath),
          asset: nextAsset,
          index: completedUploads,
          total: plan.length,
        });
      } finally {
        await unlink(clipPath).catch(() => undefined);
      }
    }
  };

  // Start upload consumer(s)
  const uploadPromise = processUploadQueue();

  await processWithConcurrency(plan, renderConcurrency, async (segment) => {
    const clipFilename = `${sanitizePathPart(segment.id)}.mp4`;
    const clipPath = path.join(tempRoot, clipFilename);
    const generatedCopy = buildGeneratedShortCopy({
      originalTitle: sourceTitle,
      originalDescription: sourceDescription,
      originalKeywords: sourceKeywords,
      segment,
      totalSegments: plan.length,
    });

    try {
      await renderVerticalShort({
        inputPath: sourcePath,
        outputPath: clipPath,
        startSeconds: segment.startSeconds,
        durationSeconds: segment.durationSeconds,
        renderContext,
        overlayText: generatedCopy,
        threadCount: renderThreadCount,
      });

      uploadQueue.push({ segment, clipPath, generatedCopy });
    } catch (error) {
      // If render fails, clean up
      await unlink(clipPath).catch(() => undefined);
      throw error;
    } finally {
      renderDoneCount += 1;
      if (renderDoneCount >= plan.length) {
        allRendersDone = true;
      }
    }
  });

  allRendersDone = true;
  await uploadPromise;

  return {
    video,
    queue: generatedAssets.filter((asset): asset is GeneratedShortAsset =>
      Boolean(asset),
    ),
    uploadFolder,
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
  const normalizedSourceUrl = normalizeAndValidateYouTubeSourceUrl(sourceUrl);
  const metadata = await getSourceVideoMetadata(normalizedSourceUrl);
  const durationSeconds = Number(metadata.durationSeconds || 0);
  const plan = buildShortsPlan({
    durationSeconds,
    segmentDurationSeconds,
    overlapSeconds,
  });

  const video: ShortsVideoMetadata = {
    sourceUrl: normalizedSourceUrl,
    videoId: metadata.videoId,
    title: metadata.title,
    description: metadata.description,
    keywords: metadata.keywords,
    durationSeconds,
    thumbnailUrl: metadata.thumbnailUrl,
    authorName: metadata.authorName,
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
  const normalizedSourceUrl = normalizeAndValidateYouTubeSourceUrl(sourceUrl);

  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "youtube-shorts-source-"),
  );
  const sourcePathBase = path.join(tempRoot, "source-video");
  const uploadFolder = `youtube-shorts/source/${new Date().toISOString().slice(0, 10)}/${Date.now()}`;

  try {
    const [metadata, { engine, outputPath: sourcePath }] = await Promise.all([
      getSourceVideoMetadata(normalizedSourceUrl),
      downloadYouTubeSourceVideo(normalizedSourceUrl, sourcePathBase),
    ]);
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
      publicId: sanitizePathPart(
        metadata.videoId || `${sourceTitle}-${Date.now()}`,
      ),
    });

    const video: ShortsVideoMetadata = {
      sourceUrl: normalizedSourceUrl,
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
  const normalizedSourceUrl = normalizeAndValidateYouTubeSourceUrl(sourceUrl);

  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "youtube-shorts-local-"),
  );
  const sourcePathBase = path.join(tempRoot, "source-video");

  try {
    const { engine, outputPath } = await downloadYouTubeSourceVideo(
      normalizedSourceUrl,
      sourcePathBase,
    );
    const fileBuffer = await readFile(outputPath);
    const extension = path.extname(outputPath) || ".mp4";
    const safeBaseName = sanitizePathPart(
      extractYouTubeVideoId(normalizedSourceUrl) ||
        `youtube-source-${Date.now()}`,
    );

    return {
      fileBuffer,
      fileName: `${safeBaseName}${extension}`,
      contentType:
        extension === ".webm"
          ? "video/webm"
          : extension === ".mkv"
            ? "video/x-matroska"
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
  renderSettings,
  callbacks,
}: {
  sourceUrl: string;
  segmentDurationSeconds?: number;
  overlapSeconds?: number;
  title?: string;
  description?: string;
  keywords?: string[];
  renderSettings?: ShortsRenderSettings;
  callbacks?: ShortBuildCallbacks;
}) {
  const normalizedSourceUrl = normalizeAndValidateYouTubeSourceUrl(sourceUrl);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "youtube-shorts-"));
  const sourcePathBase = path.join(tempRoot, "source-video");
  const uploadFolder = `${GENERATED_SHORTS_UPLOAD_ROOT}/${new Date().toISOString().slice(0, 10)}/${Date.now()}`;

  try {
    const downloadPreferences = resolveDownloadPreferences(renderSettings);
    const [metadata, { outputPath: sourcePath }] = await Promise.all([
      getSourceVideoMetadata(normalizedSourceUrl),
      downloadYouTubeSourceVideo(
        normalizedSourceUrl,
        sourcePathBase,
        downloadPreferences,
      ),
    ]);
    const sourceTitle = title?.trim() || metadata.title || "YouTube Video";
    const sourceDescription = description?.trim() || metadata.description || "";
    const sourceKeywords = keywords.length > 0 ? keywords : metadata.keywords;
    const durationSeconds = Number(metadata.durationSeconds || 0);

    return await buildShortAssetsFromPreparedSource({
      sourcePath,
      sourceUrl: normalizedSourceUrl,
      videoId: metadata.videoId,
      sourceTitle,
      sourceDescription,
      sourceKeywords,
      durationSeconds,
      thumbnailUrl: metadata.thumbnailUrl,
      authorName: metadata.authorName,
      segmentDurationSeconds,
      overlapSeconds,
      uploadFolder,
      renderSettings,
      callbacks,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function buildUploadedVideoShortAssets({
  fileBuffer,
  fileName,
  contentType,
  durationSeconds,
  segmentDurationSeconds = 15,
  overlapSeconds = 5,
  title,
  description,
  keywords = [],
  renderSettings,
  callbacks,
}: {
  fileBuffer: Buffer;
  fileName: string;
  contentType?: string;
  durationSeconds: number;
  segmentDurationSeconds?: number;
  overlapSeconds?: number;
  title?: string;
  description?: string;
  keywords?: string[];
  renderSettings?: ShortsRenderSettings;
  callbacks?: ShortBuildCallbacks;
}) {
  if (!fileBuffer.length) {
    throw new Error("Uploaded video file is empty.");
  }

  const safeDurationSeconds = Math.max(0, Math.floor(durationSeconds));
  if (safeDurationSeconds <= 0) {
    throw new Error(
      "Uploaded video duration invalid hai. Dusri file try karo.",
    );
  }

  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "uploaded-youtube-shorts-"),
  );
  const extension =
    path.extname(fileName) ||
    (contentType?.includes("webm")
      ? ".webm"
      : contentType?.includes("quicktime")
        ? ".mov"
        : ".mp4");
  const sanitizedBaseName = sanitizePathPart(
    path.basename(fileName, path.extname(fileName)) ||
      `uploaded-video-${Date.now()}`,
  );
  const sourcePath = path.join(tempRoot, `${sanitizedBaseName}${extension}`);
  const uploadFolder = `${GENERATED_SHORTS_UPLOAD_ROOT}/${new Date().toISOString().slice(0, 10)}/${Date.now()}`;

  try {
    await writeFile(sourcePath, fileBuffer);

    const sourceTitle =
      title?.trim() ||
      path.basename(fileName, path.extname(fileName)) ||
      "Uploaded Video";
    const sourceDescription =
      description?.trim() || "Uploaded source video for shorts generation.";
    const sourceKeywords =
      keywords.length > 0
        ? keywords
        : deriveKeywordsFromMetadata(sourceTitle, sourceDescription, []);

    return await buildShortAssetsFromPreparedSource({
      sourcePath,
      sourceUrl: `uploaded-file:${fileName}`,
      videoId: sanitizedBaseName,
      sourceTitle,
      sourceDescription,
      sourceKeywords,
      durationSeconds: safeDurationSeconds,
      segmentDurationSeconds,
      overlapSeconds,
      uploadFolder,
      authorName: "Uploaded from device",
      renderSettings,
      callbacks,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function buildRemoteVideoShortAssets({
  sourceUrl,
  fileName,
  contentType,
  durationSeconds,
  segmentDurationSeconds = 15,
  overlapSeconds = 5,
  title,
  description,
  keywords = [],
  renderSettings,
  callbacks,
}: {
  sourceUrl: string;
  fileName?: string;
  contentType?: string;
  durationSeconds: number;
  segmentDurationSeconds?: number;
  overlapSeconds?: number;
  title?: string;
  description?: string;
  keywords?: string[];
  renderSettings?: ShortsRenderSettings;
  callbacks?: ShortBuildCallbacks;
}) {
  if (!sourceUrl.trim()) {
    throw new Error("Uploaded source URL missing hai.");
  }

  const safeDurationSeconds = Math.max(0, Math.floor(durationSeconds));
  if (safeDurationSeconds <= 0) {
    throw new Error(
      "Uploaded video duration invalid hai. Dusri file try karo.",
    );
  }

  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "remote-youtube-shorts-"),
  );
  const sourceUrlPathname = (() => {
    try {
      return new URL(sourceUrl).pathname;
    } catch {
      return sourceUrl;
    }
  })();
  const extension =
    path.extname(fileName || sourceUrlPathname) ||
    (contentType?.includes("webm")
      ? ".webm"
      : contentType?.includes("quicktime")
        ? ".mov"
        : ".mp4");
  const sanitizedBaseName = sanitizePathPart(
    path.basename(
      fileName || sourceUrlPathname,
      path.extname(fileName || sourceUrlPathname),
    ) || `uploaded-video-${Date.now()}`,
  );
  const sourcePath = path.join(tempRoot, `${sanitizedBaseName}${extension}`);
  const uploadFolder = `${GENERATED_SHORTS_UPLOAD_ROOT}/${new Date().toISOString().slice(0, 10)}/${Date.now()}`;

  try {
    await downloadRemoteSourceVideo(sourceUrl, sourcePath);

    const sourceTitle =
      title?.trim() ||
      path.basename(
        fileName || sourceUrlPathname,
        path.extname(fileName || sourceUrlPathname),
      ) ||
      "Uploaded Video";
    const sourceDescription =
      description?.trim() || "Uploaded source video for shorts generation.";
    const sourceKeywords =
      keywords.length > 0
        ? keywords
        : deriveKeywordsFromMetadata(sourceTitle, sourceDescription, []);

    return await buildShortAssetsFromPreparedSource({
      sourcePath,
      sourceUrl,
      videoId: sanitizedBaseName,
      sourceTitle,
      sourceDescription,
      sourceKeywords,
      durationSeconds: safeDurationSeconds,
      segmentDurationSeconds,
      overlapSeconds,
      uploadFolder,
      authorName: "Uploaded from device",
      renderSettings,
      callbacks,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

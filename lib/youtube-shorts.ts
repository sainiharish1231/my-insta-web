export interface ShortsWindow {
  id: string;
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  label: string;
}

export interface ShortsVideoMetadata {
  sourceUrl: string;
  videoId?: string;
  title: string;
  description: string;
  keywords: string[];
  durationSeconds: number;
  thumbnailUrl?: string;
  authorName?: string;
}

export type ShortsFramingMode = "show-full" | "fill";
export type ShortsQualityPreset = "auto" | "1080p" | "1440p" | "2160p";
export type ShortsResolvedQualityPreset = Exclude<ShortsQualityPreset, "auto">;

export const SHORTS_FRAMING_MODE_OPTIONS = [
  {
    value: "show-full",
    label: "Show Full Video",
    description: "Keep the whole video visible with a blurred vertical background.",
  },
  {
    value: "fill",
    label: "Fill Frame",
    description: "Zoom and crop the source so the full 9:16 frame stays filled.",
  },
] as const;

export const SHORTS_QUALITY_PRESET_OPTIONS = [
  {
    value: "auto",
    label: "Auto Up To 4K",
    description: "Match the source quality and render as high as 2160x3840.",
  },
  {
    value: "1080p",
    label: "1080p",
    description: "Fastest Full HD vertical render at 1080x1920.",
  },
  {
    value: "1440p",
    label: "1440p",
    description: "Sharper vertical render at 1440x2560.",
  },
  {
    value: "2160p",
    label: "4K",
    description: "Maximum vertical render at 2160x3840.",
  },
] as const;

export interface ShortsRenderSettings {
  framingMode?: ShortsFramingMode;
  qualityPreset?: ShortsQualityPreset;
  includeLogoOverlay?: boolean;
}

export interface ShortsRenderMetadata {
  renderWidth: number;
  renderHeight: number;
  renderLabel: string;
  framingMode: ShortsFramingMode;
  hasLogoOverlay: boolean;
}

export interface GeneratedShortCopy {
  title: string;
  description: string;
  keywords: string[];
  caption: string;
  partLabel: string;
  headlineLines: string[];
  highlightedLineIndex: number;
}

export interface GeneratedShortAsset
  extends ShortsWindow,
    GeneratedShortCopy,
    ShortsRenderMetadata {
  assetUrl: string;
  cloudinaryPublicId: string;
  cloudinaryResourceType: string;
}

export interface BuildShortsPlanOptions {
  durationSeconds: number;
  segmentDurationSeconds?: number;
  overlapSeconds?: number;
  minimumClipSeconds?: number;
  minimumSegmentSeconds?: number;
  maximumSegmentSeconds?: number;
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{6,}$/;

function sanitizeKeyword(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function uniqueKeywords(values: string[]) {
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const value of values) {
    const normalized = sanitizeKeyword(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    keywords.push(normalized);
  }

  return keywords;
}

function trimText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function cleanHeadlineSourceText(value: string) {
  return value
    .replace(/\b(official|video|shorts?|reels?|instagram|youtube|viral|clip)\b/gi, " ")
    .replace(/[#|]+/g, " ")
    .replace(/[^\p{L}\p{N}\s!?.,&'/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function joinWords(words: string[]) {
  return words.join(" ").trim();
}

function splitHeadlineWords(
  words: string[],
  lineCount: number,
  maxLineLength: number,
) {
  if (words.length === 0) {
    return [];
  }

  const breakCount = Math.max(0, lineCount - 1);
  const best = {
    score: Number.POSITIVE_INFINITY,
    lines: [joinWords(words)],
  };

  const considerLines = (indices: number[]) => {
    const lines: string[] = [];
    let cursor = 0;

    for (const index of [...indices, words.length]) {
      lines.push(joinWords(words.slice(cursor, index)));
      cursor = index;
    }

    if (lines.some((line) => !line)) {
      return;
    }

    const lengths = lines.map((line) => line.length);
    const longest = Math.max(...lengths);
    const shortest = Math.min(...lengths);
    const overflowPenalty = lengths.reduce((penalty, length) => {
      if (length <= maxLineLength) {
        return penalty;
      }

      const overflow = length - maxLineLength;
      return penalty + overflow * overflow * 5;
    }, 0);
    const score = overflowPenalty + (longest - shortest) * 2 + longest;

    if (score < best.score) {
      best.score = score;
      best.lines = lines;
    }
  };

  const search = (startIndex: number, remainingBreaks: number, indices: number[]) => {
    if (remainingBreaks === 0) {
      considerLines(indices);
      return;
    }

    const maxIndex = words.length - remainingBreaks;
    for (let index = startIndex; index <= maxIndex; index += 1) {
      search(index + 1, remainingBreaks - 1, [...indices, index]);
    }
  };

  if (breakCount === 0 || words.length === 1) {
    return best.lines;
  }

  search(1, breakCount, []);
  return best.lines;
}

export function buildHeadlineLinesFromTitle(title: string) {
  const cleanedTitle = cleanHeadlineSourceText(title);
  const words = cleanedTitle
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (words.length === 0) {
    return ["Zaroor Dekho", "Aage Kya Hua"];
  }

  if (words.length === 1) {
    return [words[0], "Zaroor Dekho"];
  }

  if (words.length <= 4) {
    return splitHeadlineWords(words, 2, 18).slice(0, 2);
  }

  if (words.length <= 8) {
    return splitHeadlineWords(words, 2, 22).slice(0, 2);
  }

  return splitHeadlineWords(words, 3, 20).slice(0, 3);
}

export function getHeadlineHighlightLineIndex(lines: string[]) {
  if (lines.length <= 1) {
    return 0;
  }

  let bestIndex = 0;
  let bestLength = Number.POSITIVE_INFINITY;

  lines.forEach((line, index) => {
    const nextLength = line.trim().length;
    if (nextLength > 0 && nextLength < bestLength) {
      bestLength = nextLength;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function formatSeconds(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function buildShortsPlan({
  durationSeconds,
  segmentDurationSeconds = 15,
  overlapSeconds = 5,
  minimumClipSeconds = 8,
  minimumSegmentSeconds = 1,
  maximumSegmentSeconds = 60,
}: BuildShortsPlanOptions): ShortsWindow[] {
  const safeDuration = Math.max(0, Math.floor(durationSeconds));
  const safeMinimumSegmentSeconds = Math.max(
    1,
    Math.floor(minimumSegmentSeconds),
  );
  const safeMaximumSegmentSeconds = Math.max(
    safeMinimumSegmentSeconds,
    Math.floor(maximumSegmentSeconds),
  );
  const safeSegmentDuration = Math.max(
    safeMinimumSegmentSeconds,
    Math.min(safeMaximumSegmentSeconds, Math.floor(segmentDurationSeconds)),
  );
  const safeOverlap = Math.max(0, Math.min(safeSegmentDuration - 1, Math.floor(overlapSeconds)));
  const stepSeconds = Math.max(1, safeSegmentDuration - safeOverlap);

  if (safeDuration <= 0) {
    return [];
  }

  const windows: ShortsWindow[] = [];
  let startSeconds = 0;
  let index = 0;

  while (startSeconds < safeDuration) {
    const endSeconds = Math.min(startSeconds + safeSegmentDuration, safeDuration);
    const clipDuration = endSeconds - startSeconds;

    if (clipDuration < minimumClipSeconds && windows.length > 0) {
      const lastWindow = windows[windows.length - 1];
      lastWindow.endSeconds = safeDuration;
      lastWindow.durationSeconds = lastWindow.endSeconds - lastWindow.startSeconds;
      lastWindow.label = `${formatSeconds(lastWindow.startSeconds)}-${formatSeconds(
        lastWindow.endSeconds,
      )}`;
      break;
    }

    windows.push({
      id: `short-${index + 1}-${startSeconds}-${endSeconds}`,
      index,
      startSeconds,
      endSeconds,
      durationSeconds: clipDuration,
      label: `${formatSeconds(startSeconds)}-${formatSeconds(endSeconds)}`,
    });

    if (endSeconds >= safeDuration) {
      break;
    }

    startSeconds += stepSeconds;
    index += 1;
  }

  return windows;
}

export function buildGeneratedShortCopy({
  originalTitle,
  originalDescription,
  originalKeywords,
  segment,
  totalSegments,
}: {
  originalTitle: string;
  originalDescription?: string;
  originalKeywords?: string[];
  segment: ShortsWindow;
  totalSegments: number;
}): GeneratedShortCopy {
  const baseTitle = trimText(originalTitle || "YouTube Short", 70);
  const normalizedDescription = trimText(
    originalDescription || "Auto-generated short clip for Instagram Reels.",
    280,
  );
  const partLabel = `Part ${segment.index + 1}`;
  const partSummary = `${partLabel}/${totalSegments}`;
  const headlineLines = buildHeadlineLinesFromTitle(originalTitle || baseTitle);
  const highlightedLineIndex = getHeadlineHighlightLineIndex(headlineLines);
  const derivedKeywords = uniqueKeywords([
    ...(originalKeywords || []),
    ...baseTitle.split(/\s+/),
    ...normalizedDescription.split(/\s+/),
    "shorts",
    "reels",
    "instagram",
    "viral",
    "clip",
  ]).slice(0, 15);

  const hashtagLine = derivedKeywords
    .slice(0, 8)
    .map((keyword) => `#${keyword}`)
    .join(" ");
  const clipPrefix = `${partLabel} of ${totalSegments}`;
  const rangeLine = `${clipPrefix} | ${formatSeconds(segment.startSeconds)} - ${formatSeconds(
    segment.endSeconds,
  )}`;
  const title = trimText(`${baseTitle} | ${clipPrefix}`, 96);
  const description = [normalizedDescription, rangeLine, hashtagLine]
    .filter(Boolean)
    .join("\n\n");
  const caption = [`${baseTitle} • ${partSummary}`, rangeLine, normalizedDescription, hashtagLine]
    .filter(Boolean)
    .join("\n\n");

  return {
    title,
    description,
    keywords: derivedKeywords,
    caption,
    partLabel,
    headlineLines,
    highlightedLineIndex,
  };
}

function getParsableYouTubeUrl(url: string) {
  const trimmed = url.trim();

  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com/i.test(trimmed) || /^youtu\.be/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

function normalizeExtractedVideoId(value?: string | null) {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return YOUTUBE_VIDEO_ID_PATTERN.test(normalized) ? normalized : undefined;
}

export function extractYouTubeVideoId(url: string) {
  try {
    const parsed = new URL(getParsableYouTubeUrl(url));
    const hostname = parsed.hostname.toLowerCase();
    const pathSegments = parsed.pathname.split("/").filter(Boolean);

    if (hostname === "youtu.be" || hostname.endsWith(".youtu.be")) {
      return normalizeExtractedVideoId(pathSegments[0]);
    }

    const attributionLink = parsed.searchParams.get("u");
    if (pathSegments[0] === "attribution_link" && attributionLink) {
      const nestedUrl = attributionLink.startsWith("http")
        ? attributionLink
        : `https://www.youtube.com${attributionLink}`;

      return extractYouTubeVideoId(nestedUrl);
    }

    if (!hostname.includes("youtube.com") && !hostname.includes("youtube-nocookie.com")) {
      return undefined;
    }

    const directVideoId = normalizeExtractedVideoId(parsed.searchParams.get("v"));
    if (directVideoId) {
      return directVideoId;
    }

    if (["shorts", "embed", "live", "v"].includes(pathSegments[0] || "")) {
      return normalizeExtractedVideoId(pathSegments[1]);
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export function normalizeYouTubeUrl(url: string) {
  const parsableUrl = getParsableYouTubeUrl(url);
  const videoId = extractYouTubeVideoId(parsableUrl);

  if (!videoId) {
    return parsableUrl;
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}

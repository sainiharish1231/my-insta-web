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

export interface GeneratedShortCopy {
  title: string;
  description: string;
  keywords: string[];
  caption: string;
}

export interface GeneratedShortAsset extends ShortsWindow, GeneratedShortCopy {
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
  maximumSegmentSeconds = 30,
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
  const clipPrefix = `Clip ${segment.index + 1}/${totalSegments}`;
  const rangeLine = `${clipPrefix} | ${formatSeconds(segment.startSeconds)} - ${formatSeconds(
    segment.endSeconds,
  )}`;
  const title = trimText(`${baseTitle} | ${clipPrefix}`, 96);
  const description = [normalizedDescription, rangeLine, hashtagLine]
    .filter(Boolean)
    .join("\n\n");
  const caption = [baseTitle, rangeLine, normalizedDescription, hashtagLine]
    .filter(Boolean)
    .join("\n\n");

  return {
    title,
    description,
    keywords: derivedKeywords,
    caption,
  };
}

export function extractYouTubeVideoId(url: string) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace("/", "").trim();
    }

    return parsed.searchParams.get("v") || undefined;
  } catch {
    return undefined;
  }
}

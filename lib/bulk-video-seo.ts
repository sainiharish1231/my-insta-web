export interface BulkVideoSeoDraft {
  title: string;
  description: string;
  keywords: string[];
}

const DEFAULT_KEYWORDS = [
  "instagram reels",
  "youtube shorts",
  "short video",
  "vertical video",
  "viral content",
  "content creator",
  "social media marketing",
  "video engagement",
  "audience retention",
  "discoverability",
  "video strategy",
  "creator workflow",
  "multi platform posting",
  "social media growth",
  "trend focused content",
  "content repurposing",
  "high reach video",
  "shareable clip",
  "reel ideas",
  "shorts content",
];

const STOP_WORDS = new Set([
  "and",
  "for",
  "from",
  "have",
  "just",
  "into",
  "over",
  "that",
  "this",
  "with",
  "your",
  "video",
  "final",
  "edit",
  "clip",
  "new",
]);

function uniqueValues(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    const lookupKey = normalized.toLowerCase();

    if (!normalized || seen.has(lookupKey)) {
      continue;
    }

    seen.add(lookupKey);
    result.push(normalized);
  }

  return result;
}

function trimText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function humanizeSourceName(value: string) {
  return value
    .replace(/\.[^/.]+$/, "")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Short Video";
}

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function extractKeywordTokens(value?: string) {
  if (!value) {
    return [];
  }

  return value
    .toLowerCase()
    .replace(/[_/.-]+/g, " ")
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !STOP_WORDS.has(token) &&
        !/^\d+$/.test(token),
    );
}

function buildDerivedKeywordPhrases(tokens: string[]) {
  const phrases: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];

    phrases.push(current);

    if (next) {
      phrases.push(`${current} ${next}`);
    }
  }

  return phrases;
}

function sanitizeHashtag(value: string) {
  return value.replace(/[^a-zA-Z0-9]+/g, "");
}

export function splitKeywordText(value: string) {
  return uniqueValues(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function buildBulkVideoSeoDraft({
  rawName,
  folder,
  titlePrefix,
  descriptionContext,
  extraKeywords = [],
  durationSeconds,
}: {
  rawName: string;
  folder?: string;
  titlePrefix?: string;
  descriptionContext?: string;
  extraKeywords?: string[];
  durationSeconds?: number;
}): BulkVideoSeoDraft {
  const humanizedName = toTitleCase(humanizeSourceName(rawName));
  const cleanedPrefix = titlePrefix?.trim();
  const title = trimText(
    cleanedPrefix ? `${cleanedPrefix} | ${humanizedName}` : humanizedName,
    96,
  );

  const derivedTokens = uniqueValues([
    ...extractKeywordTokens(rawName),
    ...extractKeywordTokens(folder),
    ...extraKeywords.flatMap((keyword) => extractKeywordTokens(keyword)),
  ]);

  const keywordPool = uniqueValues([
    title,
    ...extraKeywords,
    ...buildDerivedKeywordPhrases(derivedTokens).map((value) =>
      value.length > 2 ? value : "",
    ),
    ...DEFAULT_KEYWORDS,
  ]);

  const keywords = keywordPool.slice(0, 18);
  const focusKeywords = keywords.slice(0, 6).join(", ");
  const folderContext = folder
    ? folder
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/[_-]+/g, " ")
        .trim()
    : "";
  const durationLine =
    typeof durationSeconds === "number" && durationSeconds > 0
      ? `Runtime: about ${Math.round(durationSeconds)} seconds.`
      : "Runtime tuned for short-form viewing.";
  const contextLine =
    descriptionContext?.trim() ||
    "Prepared for Instagram Reels, YouTube Shorts, and fast multi-platform reposting.";

  const description = [
    `${title} is ready for short-form publishing.`,
    contextLine,
    folderContext ? `Folder context: ${toTitleCase(folderContext)}.` : null,
    `${durationLine} Focus keywords: ${focusKeywords}.`,
  ].join("\n\n");

  return {
    title,
    description,
    keywords,
  };
}

export function buildCaptionFromSeoDraft(draft: BulkVideoSeoDraft) {
  const hashtags = draft.keywords
    .slice(0, 10)
    .map((keyword) => sanitizeHashtag(keyword))
    .filter(Boolean)
    .map((keyword) => `#${keyword}`);

  return [draft.title, draft.description, hashtags.join(" ")]
    .filter(Boolean)
    .join("\n\n");
}

export function buildYouTubeTagsFromKeywords(keywords: string[]) {
  return uniqueValues([
    ...keywords,
    "shorts",
    "youtube shorts",
    "instagram reels",
    "viral video",
    "creator workflow",
    "social media growth",
    "content repurposing",
  ]).slice(0, 40);
}

export function buildYouTubeDescriptionFromSeoDraft(
  draft: BulkVideoSeoDraft,
  options?: { isShort?: boolean },
) {
  const hashtags = draft.keywords
    .slice(0, 12)
    .map((keyword) => sanitizeHashtag(keyword))
    .filter(Boolean)
    .map((keyword) => `#${keyword}`);

  if (options?.isShort !== false && !hashtags.includes("#Shorts")) {
    hashtags.push("#Shorts");
  }

  return [draft.description, hashtags.join(" ")].filter(Boolean).join("\n\n");
}

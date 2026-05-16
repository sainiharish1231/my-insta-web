export const AUTO_TEXT_DRAFTS_STORAGE_KEY = "auto_text_maction_posts";
export const AUTO_TEXT_SETTINGS_STORAGE_KEY = "auto_text_maction_settings";
export const AUTO_PHOTO_DRAFTS_STORAGE_KEY = "auto_photo_text_maction_posts";
export const AUTO_PHOTO_SEED_STORAGE_KEY = "auto_photo_seed_text";

export type AutoMactionSource =
  | "groq"
  | "openrouter"
  | "gemini"
  | "openai"
  | "pollinations"
  | "together"
  | "fallback";

export interface AutoTextDraft {
  id: string;
  hook: string;
  caption: string;
  hashtags: string[];
  cta: string;
  trendAngle: string;
  audienceReason: string;
  topic: string;
  language: string;
  score: number;
  createdAt: string;
  accountIds: string[];
  status: "draft" | "used" | "posted";
  source: AutoMactionSource;
}

export interface AutoPhotoDraft extends AutoTextDraft {
  backgroundPrompt: string;
  imageDataUrl?: string;
  aspect: "landscape" | "square" | "portrait" | "reel";
}

export function createAutoMactionId(prefix: string) {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanHashtag(value: string) {
  const cleaned = value
    .replace(/^#/, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .trim();

  return cleaned ? `#${cleaned}` : "";
}

export function normalizeHashtags(values: string[]) {
  return Array.from(
    new Set(values.map((value) => cleanHashtag(value)).filter(Boolean)),
  ).slice(0, 18);
}

export function createFallbackTextDraft({
  topic,
  language,
  tone,
  accountIds = [],
  source = "fallback",
}: {
  topic?: string;
  language?: string;
  tone?: string;
  accountIds?: string[];
  source?: AutoMactionSource;
}): AutoTextDraft {
  const cleanTopic = topic?.trim() || "creator growth";
  const cleanLanguage = language?.trim() || "Hinglish";
  const cleanTone = tone?.trim() || "curious, sharp, and shareable";
  const hook = `${cleanTopic}: log is point ko miss kar dete hain`;
  const hashtags = normalizeHashtags([
    cleanTopic,
    "trending",
    "viral",
    "explore",
    "creator",
    "india",
    "reels",
    "content",
  ]);

  return {
    id: createAutoMactionId("text"),
    hook,
    caption: `${hook}\n\nSabse zyada attention wahi post leti hai jo simple baat ko fresh angle se bolti hai. ${cleanTopic} me curiosity, timing, aur clear opinion teen cheezein engagement ko push karti hain.\n\nAapka take kya hai?`,
    hashtags,
    cta: "Comment me apna take drop karo.",
    trendAngle: `A ${cleanTone} angle on ${cleanTopic}.`,
    audienceReason:
      "Short hook, clear opinion, and an easy comment prompt make it simple to react.",
    topic: cleanTopic,
    language: cleanLanguage,
    score: 82,
    createdAt: new Date().toISOString(),
    accountIds,
    status: "draft",
    source,
  };
}

export function createFallbackPhotoDraft({
  topic,
  language,
  tone,
  accountIds = [],
  aspect = "portrait",
}: {
  topic?: string;
  language?: string;
  tone?: string;
  accountIds?: string[];
  aspect?: AutoPhotoDraft["aspect"];
}): AutoPhotoDraft {
  const textDraft = createFallbackTextDraft({
    topic,
    language,
    tone,
    accountIds,
  });

  return {
    ...textDraft,
    id: createAutoMactionId("photo"),
    hook: `${textDraft.topic} par ek line jo rukne pe majboor kare`,
    caption: `${textDraft.caption}\n\nSave this for your next post idea.`,
    backgroundPrompt: buildPhotoBackgroundPrompt({
      topic: textDraft.topic,
      headline: textDraft.hook,
      style: "dark editorial news meme background",
    }),
    aspect,
  };
}

export function buildPhotoBackgroundPrompt({
  topic,
  headline,
  caption,
  style,
}: {
  topic?: string;
  headline?: string;
  caption?: string;
  style?: string;
}) {
  const cleanTopic = topic?.trim() || headline?.trim() || "viral social post";
  const cleanStyle = style?.trim() || "cinematic editorial background";
  const cleanCaption = caption?.replace(/\s+/g, " ").trim();

  const parts = [
    `${cleanStyle} for a social media text post about ${cleanTopic}.`,
    headline?.trim() ? `Visual mood should support this headline: ${headline.trim()}.` : "",
    cleanCaption ? `Caption context: ${cleanCaption.slice(0, 240)}.` : "",
    "No readable text, no logos, no watermark.",
    "Leave clean space near the center for a bold overlay text block.",
    "High contrast, modern, realistic, scroll-stopping composition.",
  ];

  return parts.filter(Boolean).join(" ");
}

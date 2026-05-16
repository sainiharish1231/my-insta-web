import { NextRequest, NextResponse } from "next/server";
import {
  AutoMactionSource,
  AutoPhotoDraft,
  buildPhotoBackgroundPrompt,
  createAutoMactionId,
  createFallbackPhotoDraft,
  normalizeHashtags,
} from "@/lib/auto-maction";
import {
  createAIImageWithSource,
  createAIJsonResponseWithSource,
} from "@/lib/openai-response";

export const runtime = "nodejs";
export const maxDuration = 90;

const MIN_CONTEXT_WORDS = 20;
const MAX_TOPIC_WORDS = 45;
const MAX_HEADLINE_WORDS = 34;

interface PhotoPostRequest {
  topic?: string;
  language?: string;
  tone?: string;
  style?: string;
  accountIds?: string[];
  aspect?: AutoPhotoDraft["aspect"];
  headline?: string;
  caption?: string;
  cta?: string;
  backgroundPrompt?: string;
}

interface AIPhotoDraft {
  hook: string;
  caption: string;
  hashtags: string[];
  cta: string;
  trendAngle: string;
  audienceReason: string;
  score: number;
  backgroundPrompt: string;
}

const photoDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "hook",
    "caption",
    "hashtags",
    "cta",
    "trendAngle",
    "audienceReason",
    "score",
    "backgroundPrompt",
  ],
  properties: {
    hook: { type: "string" },
    caption: { type: "string" },
    hashtags: {
      type: "array",
      minItems: 5,
      maxItems: 14,
      items: { type: "string" },
    },
    cta: { type: "string" },
    trendAngle: { type: "string" },
    audienceReason: { type: "string" },
    score: { type: "number", minimum: 0, maximum: 100 },
    backgroundPrompt: { type: "string" },
  },
};

function countWords(value = "") {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function limitWords(value: string, maxWords: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return words.length > maxWords ? words.slice(0, maxWords).join(" ") : value;
}

function ensureMinimumContext({
  requested,
  generated,
  topic,
  caption,
  fallback,
  kind,
}: {
  requested?: string;
  generated?: string;
  topic?: string;
  caption?: string;
  fallback: string;
  kind: "topic" | "headline";
}) {
  const requestedText = requested?.replace(/\s+/g, " ").trim() || "";
  const generatedText = generated?.replace(/\s+/g, " ").trim() || "";
  const maxWords = kind === "topic" ? MAX_TOPIC_WORDS : MAX_HEADLINE_WORDS;

  if (countWords(requestedText) >= MIN_CONTEXT_WORDS) {
    return limitWords(requestedText, maxWords);
  }

  if (countWords(generatedText) >= MIN_CONTEXT_WORDS) {
    return limitWords(generatedText, maxWords);
  }

  const base = generatedText || requestedText || fallback;
  const captionContext = caption?.replace(/\s+/g, " ").trim();
  const extension =
    captionContext && countWords(captionContext) >= 6
      ? `kyunki is caption ka main context hai ${captionContext}`
      : kind === "topic"
        ? "jisme audience reaction, creator angle, timing, social discussion aur practical opinion clearly cover hota hai"
        : "kyunki iske peeche audience reaction, timing, creator angle, real opinion aur Instagram discussion wali baat hai";
  const expanded = `${base} ${extension}`.replace(/\s+/g, " ").trim();

  if (countWords(expanded) >= MIN_CONTEXT_WORDS) {
    return limitWords(expanded, maxWords);
  }

  return limitWords(
    `${expanded} aur isi wajah se ye ${kind} aaj ek strong visual post aur genuine discussion create kar sakta hai ${topic || base}`,
    maxWords,
  );
}

function getImageSize(aspect: AutoPhotoDraft["aspect"] = "portrait") {
  if (aspect === "portrait" || aspect === "reel") {
    return "1024x1536" as const;
  }

  if (aspect === "square") {
    return "1024x1024" as const;
  }

  return "1536x1024" as const;
}

function normalizeDraft(
  draft: AIPhotoDraft,
  requestBody: PhotoPostRequest,
  source: AutoMactionSource,
  imageDataUrl?: string,
): AutoPhotoDraft {
  const fallback = createFallbackPhotoDraft({
    topic: requestBody.topic,
    language: requestBody.language,
    tone: requestBody.tone,
    accountIds: requestBody.accountIds,
    aspect: requestBody.aspect || "portrait",
  });

  const normalizedTopic = ensureMinimumContext({
    requested: requestBody.topic,
    generated: draft.trendAngle,
    topic: requestBody.topic,
    caption: requestBody.caption || draft.caption,
    fallback: fallback.topic,
    kind: "topic",
  });
  const hook = ensureMinimumContext({
    requested: requestBody.headline,
    generated: draft.hook,
    topic: normalizedTopic,
    caption: requestBody.caption || draft.caption,
    fallback: fallback.hook,
    kind: "headline",
  });
  const backgroundPrompt =
    requestBody.backgroundPrompt?.trim() ||
    draft.backgroundPrompt?.trim() ||
    buildPhotoBackgroundPrompt({
      topic: requestBody.topic,
      headline: hook,
      caption: requestBody.caption,
      style: requestBody.style,
    });

  return {
    ...fallback,
    id: createAutoMactionId("photo"),
    topic: normalizedTopic,
    hook,
    caption: draft.caption?.trim() || fallback.caption,
    hashtags: normalizeHashtags(draft.hashtags || fallback.hashtags),
    cta: draft.cta?.trim() || fallback.cta,
    trendAngle: draft.trendAngle?.trim() || fallback.trendAngle,
    audienceReason: draft.audienceReason?.trim() || fallback.audienceReason,
    score: Number.isFinite(draft.score) ? Math.round(draft.score) : fallback.score,
    backgroundPrompt,
    imageDataUrl,
    source: imageDataUrl ? source : "fallback",
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as PhotoPostRequest;

  try {
    const rawTopic = body.topic?.trim() || body.headline?.trim() || "viral moment";
    const language = body.language?.trim() || "Hinglish";
    const tone = body.tone?.trim() || "bold, topical, and witty";
    const style = body.style?.trim() || "dark editorial viral news meme";
    const currentCaption = body.caption?.trim() || "";
    const currentCta = body.cta?.trim() || "";
    const topic = ensureMinimumContext({
      requested: rawTopic,
      topic: rawTopic,
      caption: currentCaption || currentCta,
      fallback: "viral social media moment with creator reaction and audience discussion",
      kind: "topic",
    });
    const aiResult = await createAIJsonResponseWithSource<AIPhotoDraft>({
      schemaName: "photo_text_auto_maction_draft",
      schema: photoDraftSchema,
      instructions:
        "You create professional social media photo-with-text post concepts. The final image text will be rendered by canvas, so the background prompt must explicitly avoid readable text, logos, and watermarks. The image idea must match the provided topic, caption, CTA, and headline context instead of being generic. Never ignore the topic or caption when choosing the scene. If the language is Hindi, write polished natural Hindi. If it is Hinglish, write clean creator-style Hinglish, not broken words.",
      input: JSON.stringify({
        task: "Create one photo-with-text post concept.",
        topic,
        language,
        tone,
        style,
        requestedHeadline: body.headline || "",
        currentCaption,
        currentCta,
        canvasAspect: body.aspect || "portrait",
        requirements: [
          "Topic/context must contain at least 20 words and should describe the full post angle.",
          "Hook should be suitable as large overlay text and must contain at least 20 words.",
          "Do not return a hook/headline shorter than 20 words.",
          "Use professional Hindi/Hinglish phrasing with a clear, premium Instagram-news-post tone.",
          "If currentCaption is provided, keep the concept and visual prompt aligned with it.",
          "The image scene must include concrete visual elements from the topic and caption, not a generic studio, gradient, or abstract news background.",
          "Caption should add context and invite real opinions.",
          "Background prompt should create a photo-like backdrop with clean center space.",
          "Background prompt must mention the visual objects, mood, and scene implied by the topic and caption.",
          "Avoid claims that depend on unverified breaking news.",
        ],
      }),
      maxOutputTokens: 1100,
    });

    const visualCaption = currentCaption || aiResult.data.caption;
    const finalTopic = ensureMinimumContext({
      requested: topic,
      generated: aiResult.data.trendAngle,
      topic,
      caption: visualCaption,
      fallback: topic,
      kind: "topic",
    });
    const overlayHeadline = ensureMinimumContext({
      requested: body.headline,
      generated: aiResult.data.hook,
      topic: finalTopic,
      caption: visualCaption,
      fallback: topic,
      kind: "headline",
    });
    const generatedPrompt =
      aiResult.data.backgroundPrompt?.trim() ||
      buildPhotoBackgroundPrompt({
        topic: finalTopic,
        headline: overlayHeadline,
        caption: visualCaption,
        style,
      });
    const prompt =
      body.backgroundPrompt?.trim() ||
      [
        generatedPrompt,
        `Create a specific image scene matching this full topic: ${finalTopic}.`,
        `Caption context that must guide the image: ${visualCaption.slice(0, 320)}.`,
        `Overlay headline will be rendered separately: ${overlayHeadline.slice(0, 220)}.`,
        "Use visual objects, setting, colors, expressions, and mood connected to the topic and caption; avoid generic abstract wallpaper, empty studio backgrounds, and unrelated landscapes.",
        "Keep the middle area clean for a centered text block above a small bottom line.",
        "Do not generate any readable text inside the image.",
      ].join(" ");

    const imageResult = await createAIImageWithSource({
      prompt,
      size: getImageSize(body.aspect || "portrait"),
    });

    return NextResponse.json({
      draft: normalizeDraft(
        {
          ...aiResult.data,
          hook: overlayHeadline,
          trendAngle: finalTopic,
          backgroundPrompt: prompt,
        },
        {
          ...body,
          topic: finalTopic,
          headline: overlayHeadline,
        },
        imageResult.provider,
        imageResult.imageDataUrl,
      ),
      source: aiResult.provider,
      imageSource: imageResult.provider,
    });
  } catch (error: any) {
    const fallback = createFallbackPhotoDraft({
      topic: body.topic || body.headline,
      language: body.language,
      tone: body.tone,
      accountIds: body.accountIds,
      aspect: body.aspect || "portrait",
    });
    const fallbackTopic = ensureMinimumContext({
      requested: body.topic,
      generated: fallback.topic,
      topic: body.topic,
      caption: body.caption || fallback.caption,
      fallback: fallback.topic,
      kind: "topic",
    });
    const fallbackHook = ensureMinimumContext({
      requested: body.headline,
      generated: fallback.hook,
      topic: fallbackTopic,
      caption: body.caption || fallback.caption,
      fallback: fallback.hook,
      kind: "headline",
    });

    return NextResponse.json({
      draft: {
        ...fallback,
        topic: fallbackTopic,
        hook: fallbackHook,
        backgroundPrompt: buildPhotoBackgroundPrompt({
          topic: fallbackTopic,
          headline: fallbackHook,
          caption: body.caption || fallback.caption,
          style: body.style,
        }),
      },
      source: "fallback",
      warning:
        error?.message ||
        "AI API did not respond, so a local photo draft was created instead.",
    });
  }
}

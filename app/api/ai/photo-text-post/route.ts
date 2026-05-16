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

const MAX_TOPIC_WORDS = 45;
const MAX_HEADLINE_WORDS = 12;

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

function cleanTrendContext(value = "") {
  return value
    .replace(/\s+/g, " ")
    .replace(
      /search interest is rising\s*\(([^)]+)\)\s*;\s*turn it into a quick opinion post\.?/i,
      "search interest rising ($1) hai, isliye ise quick opinion angle banao",
    )
    .replace(
      /turn this rising search into a quick opinion post\.?/i,
      "rising search ko quick opinion angle mein convert karo",
    )
    .replace(
      /turn it into a quick opinion post\.?/i,
      "quick opinion angle banao",
    )
    .replace(/^use the search spike to explain:\s*/i, "")
    .trim();
}

function removePromptLeakage(value = "", kind: "topic" | "headline") {
  let cleanValue = value.replace(/\s+/g, " ").trim();
  if (!cleanValue) {
    return "";
  }

  cleanValue = cleanValue
    .replace(/\s+isliye ye visual post\b.*$/i, "")
    .replace(/\s+aur isi wajah se ye\b.*$/i, "")
    .trim();

  const mainContextMatch = cleanValue.match(
    /^(.*?)\s+kyunki is(?:ka| caption ka)? main context hai\s+(.+)$/i,
  );
  if (mainContextMatch) {
    const base = mainContextMatch[1].trim();
    const context = cleanTrendContext(mainContextMatch[2]);
    return kind === "headline"
      ? base
      : [base, context].filter(Boolean).join(": ");
  }

  const fillerIndex = cleanValue.search(
    /\s+(?:jisme audience reaction|kyunki iske peeche audience reaction)\b/i,
  );
  if (fillerIndex > 0) {
    return cleanValue.slice(0, fillerIndex).trim();
  }

  return cleanTrendContext(cleanValue);
}

function normalizePostText({
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
  const requestedText = removePromptLeakage(requested, kind);
  const generatedText = removePromptLeakage(generated, kind);
  const maxWords = kind === "topic" ? MAX_TOPIC_WORDS : MAX_HEADLINE_WORDS;

  if (kind === "headline") {
    return limitWords(generatedText || requestedText || fallback, maxWords);
  }

  if (requestedText && generatedText && generatedText !== requestedText) {
    const lowerRequested = requestedText.toLowerCase();
    const lowerGenerated = generatedText.toLowerCase();
    if (!lowerGenerated.includes(lowerRequested)) {
      return limitWords(`${requestedText}: ${generatedText}`, maxWords);
    }
  }

  if (requestedText) {
    return limitWords(requestedText, maxWords);
  }

  if (generatedText) {
    return limitWords(generatedText, maxWords);
  }

  const captionContext = removePromptLeakage(caption, "topic");
  if (captionContext) {
    return limitWords(`${fallback}: ${captionContext}`, maxWords);
  }

  return limitWords(removePromptLeakage(topic || fallback, "topic"), maxWords);
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

  const normalizedTopic = normalizePostText({
    requested: requestBody.topic,
    generated: draft.trendAngle,
    topic: requestBody.topic,
    caption: requestBody.caption || draft.caption,
    fallback: fallback.topic,
    kind: "topic",
  });
  const hook = normalizePostText({
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
    caption: removePromptLeakage(draft.caption, "topic") || fallback.caption,
    hashtags: normalizeHashtags(draft.hashtags || fallback.hashtags),
    cta: limitWords(
      removePromptLeakage(draft.cta, "headline") || fallback.cta,
      12,
    ),
    trendAngle: removePromptLeakage(draft.trendAngle, "topic") || fallback.trendAngle,
    audienceReason:
      removePromptLeakage(draft.audienceReason, "topic") ||
      fallback.audienceReason,
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
    const currentCaption = removePromptLeakage(
      body.caption?.trim() || "",
      "topic",
    );
    const currentCta = removePromptLeakage(
      body.cta?.trim() || "",
      "headline",
    );
    const topic = normalizePostText({
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
        "You create professional social media photo-with-text post concepts. The final image text will be rendered by canvas, so the background prompt must explicitly avoid readable text, logos, and watermarks. The image idea must match the provided topic, caption, CTA, and headline context instead of being generic. Never ignore the topic or caption when choosing the scene. If the language is Hindi, write polished natural Hindi. If it is Hinglish, write clean creator-style Hinglish, not broken words. Never paste internal planning phrases like 'main context', 'audience reaction timing creator angle', or 'search interest is rising' into the hook, caption, or CTA.",
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
          "TrendAngle should describe the full post angle for internal use.",
          "Hook must be suitable as large overlay text: 5 to 12 words, sharp, readable, and opinion-led.",
          "Do not return a long explanatory hook/headline.",
          "Use professional Hindi/Hinglish phrasing with a clear, premium Instagram-news-post tone.",
          "If currentCaption is provided, keep the concept and visual prompt aligned with it.",
          "The image scene must include concrete visual elements from the topic and caption, not a generic studio, gradient, or abstract news background.",
          "Caption should add context, explain why people are reacting now, and invite real opinions.",
          "Background prompt should create a photo-like backdrop with clean center space.",
          "Background prompt must mention the visual objects, mood, and scene implied by the topic and caption.",
          "Background prompt must not request readable text, screenshots, UI text, news tickers, or posters.",
          "Avoid claims that depend on unverified breaking news.",
        ],
      }),
      maxOutputTokens: 1100,
    });

    const visualCaption =
      currentCaption || removePromptLeakage(aiResult.data.caption, "topic");
    const finalTopic = normalizePostText({
      requested: topic,
      generated: aiResult.data.trendAngle,
      topic,
      caption: visualCaption,
      fallback: topic,
      kind: "topic",
    });
    const overlayHeadline = normalizePostText({
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
    const fallbackTopic = normalizePostText({
      requested: body.topic,
      generated: fallback.topic,
      topic: body.topic,
      caption: body.caption || fallback.caption,
      fallback: fallback.topic,
      kind: "topic",
    });
    const fallbackHook = normalizePostText({
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

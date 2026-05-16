import { NextRequest, NextResponse } from "next/server";
import {
  AutoMactionSource,
  AutoTextDraft,
  createAutoMactionId,
  createFallbackTextDraft,
  normalizeHashtags,
} from "@/lib/auto-maction";
import { createAIJsonResponseWithSource } from "@/lib/openai-response";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TextPostRequest {
  topic?: string;
  language?: string;
  tone?: string;
  accountIds?: string[];
  accountUsername?: string;
  recentCaptions?: string[];
}

interface AITextDraft {
  hook: string;
  caption: string;
  hashtags: string[];
  cta: string;
  trendAngle: string;
  audienceReason: string;
  score: number;
}

const textDraftSchema = {
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
  },
};

function normalizeDraft(
  draft: AITextDraft,
  requestBody: TextPostRequest,
  source: AutoMactionSource,
): AutoTextDraft {
  const fallback = createFallbackTextDraft({
    topic: requestBody.topic,
    language: requestBody.language,
    tone: requestBody.tone,
    accountIds: requestBody.accountIds,
    source,
  });

  return {
    ...fallback,
    id: createAutoMactionId("text"),
    hook: draft.hook?.trim() || fallback.hook,
    caption: draft.caption?.trim() || fallback.caption,
    hashtags: normalizeHashtags(draft.hashtags || fallback.hashtags),
    cta: draft.cta?.trim() || fallback.cta,
    trendAngle: draft.trendAngle?.trim() || fallback.trendAngle,
    audienceReason: draft.audienceReason?.trim() || fallback.audienceReason,
    score: Number.isFinite(draft.score) ? Math.round(draft.score) : fallback.score,
    source,
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as TextPostRequest;

  try {
    const topic = body.topic?.trim() || "Instagram growth";
    const language = body.language?.trim() || "Hinglish";
    const tone = body.tone?.trim() || "sharp, curious, and positive";
    const aiResult = await createAIJsonResponseWithSource<AITextDraft>({
      schemaName: "text_auto_maction_draft",
      schema: textDraftSchema,
      instructions:
        "You create ethical, high-engagement social media text drafts. Do not make false claims, do not ask for spammy engagement, and do not impersonate anyone. Keep output practical for Instagram captions.",
      input: JSON.stringify({
        task: "Create one scroll-stopping text post draft.",
        topic,
        language,
        tone,
        accountUsername: body.accountUsername || "",
        recentCaptions: body.recentCaptions?.slice(0, 5) || [],
        requirements: [
          "Write in the requested language style.",
          "Hook should be short and strong.",
          "Caption should be 3 to 6 short paragraphs.",
          "CTA should invite a real opinion, not spam.",
          "Hashtags should be relevant and ASCII.",
        ],
      }),
      maxOutputTokens: 1000,
    });

    return NextResponse.json({
      draft: normalizeDraft(aiResult.data, body, aiResult.provider),
      source: aiResult.provider,
    });
  } catch (error: any) {
    return NextResponse.json({
      draft: createFallbackTextDraft({
        topic: body.topic,
        language: body.language,
        tone: body.tone,
        accountIds: body.accountIds,
      }),
      source: "fallback",
      warning:
        error?.message ||
        "AI API did not respond, so a local draft was created instead.",
    });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createAIJsonResponseWithSource } from "@/lib/openai-response";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "instagram", "x", "telegram", "hashtags"],
  properties: {
    headline: { type: "string" },
    instagram: { type: "string" },
    x: { type: "string" },
    telegram: { type: "string" },
    hashtags: {
      type: "array",
      minItems: 3,
      maxItems: 10,
      items: { type: "string" },
    },
  },
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const source = typeof body.source === "string" ? body.source.trim() : "";
  const language = typeof body.language === "string" ? body.language.trim() : "Hinglish";
  const tone = typeof body.tone === "string" ? body.tone.trim() : "clear and engaging";

  if (source.length < 40) {
    return NextResponse.json(
      { error: "Source text kam hai. Kam se kam 40 characters paste karo." },
      { status: 400 },
    );
  }
  if (source.length > 12000) {
    return NextResponse.json(
      { error: "Source 12,000 characters se chhota rakho." },
      { status: 400 },
    );
  }

  try {
    const result = await createAIJsonResponseWithSource({
      schemaName: "social_content_repurpose",
      schema,
      instructions:
        "Repurpose only the source material supplied by the user. Preserve its meaning, do not invent facts or claim independent verification. Write original platform-ready drafts in the requested language and tone. Instagram can be conversational with a genuine question; X must be concise; Telegram can include a little more context. Do not include unsupported breaking-news claims or spam engagement requests.",
      input: JSON.stringify({ task: "Create distinct social post drafts from this source.", source, language, tone }),
      maxOutputTokens: 1200,
    });

    return NextResponse.json({ drafts: result.data, source: result.provider });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Drafts generate nahi ho paaye. Thodi der baad try karo." },
      { status: 503 },
    );
  }
}

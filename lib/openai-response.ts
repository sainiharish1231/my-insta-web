const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_CHAT_COMPLETIONS_URL =
  "https://openrouter.ai/api/v1/chat/completions";
const GEMINI_GENERATE_CONTENT_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const POLLINATIONS_IMAGES_URL = "https://image.pollinations.ai/prompt/";
const TOGETHER_IMAGES_URL = "https://api.together.xyz/v1/images/generations";

const DEFAULT_GROQ_TEXT_MODEL = "deepseek-r1-distill-llama-70b";
const DEFAULT_OPENROUTER_TEXT_MODEL = "deepseek/deepseek-r1:free";
const DEFAULT_GEMINI_TEXT_MODEL = "gemini-2.0-flash";
const DEFAULT_TOGETHER_IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell-Free";
const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1";

const TEXT_PROVIDERS = ["groq", "openrouter", "gemini", "openai"] as const;
const IMAGE_PROVIDERS = ["pollinations", "together", "openai"] as const;

export type TextProvider = (typeof TEXT_PROVIDERS)[number];
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

interface JsonResponseOptions {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}

interface AIJsonResponseResult<T> {
  data: T;
  provider: TextProvider;
}

interface AIImageResult {
  imageDataUrl: string;
  provider: ImageProvider;
}

function parseProviderList<T extends string>(
  value: string | undefined,
  supportedProviders: readonly T[],
) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is T =>
      supportedProviders.includes(provider as T),
    );
}

function uniqueProviders<T extends string>(providers: T[]) {
  return Array.from(new Set(providers));
}

function getTextProviderOrder() {
  const configuredOrder = parseProviderList(
    process.env.AI_TEXT_PROVIDER_ORDER || process.env.AI_TEXT_PROVIDERS,
    TEXT_PROVIDERS,
  );

  if (configuredOrder.length > 0) {
    return uniqueProviders(configuredOrder);
  }

  const configuredProvider = parseProviderList(
    process.env.AI_TEXT_PROVIDER,
    TEXT_PROVIDERS,
  );
  const availableProviders = TEXT_PROVIDERS.filter(hasTextProviderKey);

  if (configuredProvider.length > 0) {
    return uniqueProviders([
      ...configuredProvider,
      ...availableProviders.filter(
        (provider) => provider !== configuredProvider[0],
      ),
    ]);
  }

  return availableProviders;
}

function getImageProviderOrder() {
  const configuredOrder = parseProviderList(
    process.env.AI_IMAGE_PROVIDER_ORDER || process.env.AI_IMAGE_PROVIDERS,
    IMAGE_PROVIDERS,
  );

  if (configuredOrder.length > 0) {
    return uniqueProviders(configuredOrder);
  }

  const configuredProvider = parseProviderList(
    process.env.AI_IMAGE_PROVIDER,
    IMAGE_PROVIDERS,
  );
  const availableProviders = IMAGE_PROVIDERS.filter(hasImageProviderAccess);

  if (configuredProvider.length > 0) {
    return uniqueProviders([
      ...configuredProvider,
      ...availableProviders.filter(
        (provider) => provider !== configuredProvider[0],
      ),
    ]);
  }

  return availableProviders;
}

function hasTextProviderKey(provider: TextProvider) {
  if (provider === "groq") {
    return Boolean(process.env.GROQ_API_KEY);
  }

  if (provider === "openrouter") {
    return Boolean(process.env.OPENROUTER_API_KEY);
  }

  if (provider === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY);
  }

  return Boolean(process.env.OPENAI_API_KEY);
}

function hasImageProviderAccess(provider: ImageProvider) {
  if (provider === "pollinations") {
    return true;
  }

  if (provider === "together") {
    return Boolean(process.env.TOGETHER_API_KEY);
  }

  return Boolean(process.env.OPENAI_API_KEY);
}

function extractJsonObject(text: string) {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!cleaned) {
    return "";
  }

  const fencedJson = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedJson?.[1]?.trim() || cleaned;

  if (candidate.startsWith("{") && candidate.endsWith("}")) {
    return candidate;
  }

  const start = candidate.indexOf("{");
  if (start === -1) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, index + 1);
      }
    }
  }

  return "";
}

function extractOpenAIResponseText(data: any) {
  if (typeof data?.output_text === "string") {
    return data.output_text.trim();
  }

  const parts: string[] = [];
  for (const item of data?.output || []) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {
      if (typeof content?.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function extractGeminiResponseText(data: any) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseJsonResponse<T>(text: string, providerName: string) {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new Error(`${providerName} response did not include valid JSON.`);
  }

  return JSON.parse(jsonText) as T;
}

export function getOpenAITextModel() {
  return (
    process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-nano"
  );
}

export function getGroqTextModel() {
  return (
    process.env.GROQ_TEXT_MODEL ||
    process.env.GROQ_MODEL ||
    process.env.AI_TEXT_MODEL ||
    DEFAULT_GROQ_TEXT_MODEL
  );
}

export function getOpenRouterTextModel() {
  return (
    process.env.OPENROUTER_TEXT_MODEL ||
    process.env.OPENROUTER_MODEL ||
    process.env.AI_TEXT_MODEL ||
    DEFAULT_OPENROUTER_TEXT_MODEL
  );
}

export function getGeminiTextModel() {
  return (
    process.env.GEMINI_TEXT_MODEL ||
    process.env.GEMINI_MODEL ||
    process.env.AI_TEXT_MODEL ||
    DEFAULT_GEMINI_TEXT_MODEL
  );
}

export function getTogetherImageModel() {
  return (
    process.env.TOGETHER_IMAGE_MODEL ||
    process.env.OPENAI_IMAGE_MODEL ||
    DEFAULT_TOGETHER_IMAGE_MODEL
  );
}

export function getAITextProvider(): TextProvider {
  return getTextProviderOrder()[0] || "groq";
}

export function getAIImageProvider(): ImageProvider {
  return getImageProviderOrder()[0] || "pollinations";
}

function getOpenAIHostedImageModel() {
  const configuredModel =
    process.env.OPENAI_HOSTED_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL;

  if (configuredModel && !configuredModel.startsWith("black-forest-labs/")) {
    return configuredModel;
  }

  return DEFAULT_OPENAI_IMAGE_MODEL;
}

async function createOpenAIJsonResponse<T>({
  instructions,
  input,
  schemaName,
  schema,
  maxOutputTokens = 900,
}: JsonResponseOptions): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAITextModel(),
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI text generation failed.");
  }

  const text = extractOpenAIResponseText(data);
  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return JSON.parse(text) as T;
}

async function createChatCompletionsJsonResponse<T>({
  apiKey,
  url,
  model,
  providerName,
  instructions,
  input,
  schemaName,
  schema,
  maxOutputTokens = 900,
  tokenField,
  extraHeaders = {},
}: JsonResponseOptions & {
  apiKey: string;
  url: string;
  model: string;
  providerName: string;
  tokenField: "max_completion_tokens" | "max_tokens";
  extraHeaders?: Record<string, string>;
}): Promise<T> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "system",
        content: [
          instructions,
          `Return only valid JSON for the "${schemaName}" schema.`,
          "Do not include markdown, code fences, prose, or reasoning text.",
          `JSON schema: ${JSON.stringify(schema)}`,
        ].join("\n\n"),
      },
      {
        role: "user",
        content: input,
      },
    ],
    temperature: 0.7,
    response_format: { type: "json_object" },
  };

  requestBody[tokenField] = maxOutputTokens;

  let response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  let data = await response.json().catch(() => ({}));
  if (
    !response.ok &&
    typeof data?.error?.message === "string" &&
    data.error.message.toLowerCase().includes("response_format")
  ) {
    const retryBody = { ...requestBody };
    delete retryBody.response_format;
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(retryBody),
    });
    data = await response.json().catch(() => ({}));
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `${providerName} text generation failed.`,
    );
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${providerName} returned an empty response.`);
  }

  return parseJsonResponse<T>(content, providerName);
}

async function createGroqJsonResponse<T>(
  options: JsonResponseOptions,
): Promise<T> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  return createChatCompletionsJsonResponse<T>({
    ...options,
    apiKey,
    url: GROQ_CHAT_COMPLETIONS_URL,
    model: getGroqTextModel(),
    providerName: "Groq",
    tokenField: "max_completion_tokens",
  });
}

async function createOpenRouterJsonResponse<T>(
  options: JsonResponseOptions,
): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const extraHeaders: Record<string, string> = {
    "X-Title": process.env.OPENROUTER_APP_NAME || "my-insta-web",
  };
  const referer = process.env.OPENROUTER_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (referer) {
    extraHeaders["HTTP-Referer"] = referer;
  }

  return createChatCompletionsJsonResponse<T>({
    ...options,
    apiKey,
    url: OPENROUTER_CHAT_COMPLETIONS_URL,
    model: getOpenRouterTextModel(),
    providerName: "OpenRouter",
    tokenField: "max_tokens",
    extraHeaders,
  });
}

async function createGeminiJsonResponse<T>({
  instructions,
  input,
  schemaName,
  schema,
  maxOutputTokens = 900,
}: JsonResponseOptions): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const model = getGeminiTextModel().replace(/^models\//, "");
  const url = new URL(
    `${GEMINI_GENERATE_CONTENT_URL}/${encodeURIComponent(model)}:generateContent`,
  );
  url.searchParams.set("key", apiKey);

  const prompt = [
    instructions,
    `Return only valid JSON for the "${schemaName}" schema.`,
    "Do not include markdown, code fences, prose, or reasoning text.",
    `JSON schema: ${JSON.stringify(schema)}`,
    input,
  ].join("\n\n");

  const buildBody = (jsonMode: boolean) => ({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });

  let response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildBody(true)),
  });

  let data = await response.json().catch(() => ({}));
  if (
    !response.ok &&
    typeof data?.error?.message === "string" &&
    data.error.message.toLowerCase().includes("responsemimetype")
  ) {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildBody(false)),
    });
    data = await response.json().catch(() => ({}));
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini text generation failed.");
  }

  const text = extractGeminiResponseText(data);
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return parseJsonResponse<T>(text, "Gemini");
}

async function createJsonResponseForProvider<T>(
  provider: TextProvider,
  options: JsonResponseOptions,
) {
  if (provider === "groq") {
    return createGroqJsonResponse<T>(options);
  }

  if (provider === "openrouter") {
    return createOpenRouterJsonResponse<T>(options);
  }

  if (provider === "gemini") {
    return createGeminiJsonResponse<T>(options);
  }

  return createOpenAIJsonResponse<T>(options);
}

export async function createAIJsonResponseWithSource<T>(
  options: JsonResponseOptions,
): Promise<AIJsonResponseResult<T>> {
  const providers = getTextProviderOrder();
  if (providers.length === 0) {
    throw new Error(
      "No AI text provider configured. Add GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY.",
    );
  }

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      return {
        data: await createJsonResponseForProvider<T>(provider, options),
        provider,
      };
    } catch (error: any) {
      errors.push(`${provider}: ${error?.message || "failed"}`);
    }
  }

  throw new Error(`AI text generation failed. ${errors.join(" | ")}`);
}

export async function createAIJsonResponse<T>(
  options: JsonResponseOptions,
): Promise<T> {
  const result = await createAIJsonResponseWithSource<T>(options);
  return result.data;
}

function getTogetherAspectRatio(size: ImageSize) {
  if (size === "1024x1536") {
    return "2:3";
  }

  if (size === "1536x1024") {
    return "3:2";
  }

  return "1:1";
}

function getImageDimensions(size: ImageSize) {
  const [width, height] = size.split("x").map((value) => Number(value));
  return { width, height };
}

function normalizeImageResponse(data: any, providerName: string) {
  const firstImage = data?.data?.[0];
  if (typeof firstImage?.b64_json === "string") {
    return `data:image/png;base64,${firstImage.b64_json}`;
  }

  if (typeof firstImage?.url === "string") {
    return firstImage.url;
  }

  throw new Error(`${providerName} image response did not include image data.`);
}

async function createPollinationsImage({
  prompt,
  size = "1536x1024",
}: {
  prompt: string;
  size?: ImageSize;
}) {
  const { width, height } = getImageDimensions(size);
  const url = new URL(`${POLLINATIONS_IMAGES_URL}${encodeURIComponent(prompt)}`);
  url.searchParams.set("width", String(width));
  url.searchParams.set("height", String(height));
  url.searchParams.set("nologo", "true");
  url.searchParams.set("private", "true");
  url.searchParams.set("safe", "true");
  url.searchParams.set("enhance", "true");

  const model = process.env.POLLINATIONS_IMAGE_MODEL;
  if (model) {
    url.searchParams.set("model", model);
  }

  const seed = process.env.POLLINATIONS_SEED;
  if (seed) {
    url.searchParams.set("seed", seed);
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Pollinations image generation failed.");
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error("Pollinations response did not include image data.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

async function createOpenAIImage({
  prompt,
  size = "1536x1024",
}: {
  prompt: string;
  size?: ImageSize;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAIHostedImageModel(),
      prompt,
      size,
      quality: "low",
      n: 1,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI image generation failed.");
  }

  return normalizeImageResponse(data, "OpenAI");
}

async function createTogetherImage({
  prompt,
  size = "1536x1024",
}: {
  prompt: string;
  size?: ImageSize;
}) {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error("TOGETHER_API_KEY is not configured.");
  }

  const response = await fetch(TOGETHER_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getTogetherImageModel(),
      prompt,
      aspect_ratio: getTogetherAspectRatio(size),
      steps: 4,
      n: 1,
      response_format: "url",
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Together image generation failed.");
  }

  return normalizeImageResponse(data, "Together");
}

async function createImageForProvider(
  provider: ImageProvider,
  options: {
    prompt: string;
    size?: ImageSize;
  },
) {
  if (provider === "pollinations") {
    return createPollinationsImage(options);
  }

  if (provider === "together") {
    return createTogetherImage(options);
  }

  return createOpenAIImage(options);
}

export async function createAIImageWithSource(options: {
  prompt: string;
  size?: ImageSize;
}): Promise<AIImageResult> {
  const providers = getImageProviderOrder();
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return {
        imageDataUrl: await createImageForProvider(provider, options),
        provider,
      };
    } catch (error: any) {
      errors.push(`${provider}: ${error?.message || "failed"}`);
    }
  }

  throw new Error(`AI image generation failed. ${errors.join(" | ")}`);
}

export async function createAIImage(options: {
  prompt: string;
  size?: ImageSize;
}) {
  const result = await createAIImageWithSource(options);
  return result.imageDataUrl;
}

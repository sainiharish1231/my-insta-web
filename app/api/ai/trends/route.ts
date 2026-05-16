import { NextRequest, NextResponse } from "next/server";
import { createAIJsonResponseWithSource } from "@/lib/openai-response";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TrendIdea {
  title: string;
  angle: string;
  keywords: string[];
  source: string;
}

interface TrendsResponse {
  trends: TrendIdea[];
}

const trendSchema = {
  type: "object",
  additionalProperties: false,
  required: ["trends"],
  properties: {
    trends: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "angle", "keywords", "source"],
        properties: {
          title: { type: "string" },
          angle: { type: "string" },
          keywords: {
            type: "array",
            minItems: 3,
            maxItems: 8,
            items: { type: "string" },
          },
          source: { type: "string" },
        },
      },
    },
  },
};

function fallbackTrends(): TrendIdea[] {
  return [
    {
      title: "AI tools changing creator workflows",
      angle: "Ask whether speed or originality matters more now.",
      keywords: ["AI", "creator", "productivity", "future", "technology"],
      source: "fallback",
    },
    {
      title: "New smartphone features users actually care about",
      angle: "Compare hype features with daily-use value.",
      keywords: ["smartphone", "tech", "india", "gadgets", "review"],
      source: "fallback",
    },
    {
      title: "Viral news pages using bold text posts",
      angle: "Turn a simple news point into a strong visual opinion.",
      keywords: ["news", "viral", "instagram", "headline", "trend"],
      source: "fallback",
    },
    {
      title: "Young Indians building side income online",
      angle: "Make it practical, relatable, and comment-friendly.",
      keywords: ["india", "youth", "income", "online", "creator"],
      source: "fallback",
    },
  ];
}

function normalizeCountry(country: string) {
  return (country || "in").trim().replace(/[^a-zA-Z-]/g, "").toLowerCase();
}

function normalizeGoogleGeo(country: string) {
  return normalizeCountry(country).toUpperCase() || "IN";
}

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .trim();
}

function stripHtml(value = "") {
  return decodeXml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTag(xml: string, tagName: string) {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"),
  );

  return match?.[1] || "";
}

function keywordsFromTitle(title: string) {
  const keywords = title
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((word) => word.length > 2)
    .slice(0, 6);

  return keywords.length >= 3 ? keywords : [...keywords, "trend", "india"].slice(0, 6);
}

function normalizeNewsTitle(title: string) {
  return title.replace(/\s-\s.*$/, "").trim();
}

async function fetchGoogleTrends(country: string): Promise<TrendIdea[]> {
  const url = new URL("https://trends.google.com/trending/rss");
  url.searchParams.set("geo", normalizeGoogleGeo(country));

  const response = await fetch(url, {
    next: { revalidate: 900 },
    headers: {
      "User-Agent": "Mozilla/5.0 my-insta-web trends fetcher",
    },
  });

  if (!response.ok) {
    return [];
  }

  const xml = await response.text();
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];

  return items
    .map((item) => {
      const title = stripHtml(extractTag(item, "title"));
      if (!title) {
        return null;
      }

      const description = stripHtml(extractTag(item, "description"));
      const traffic = stripHtml(extractTag(item, "ht:approx_traffic"));
      const angle = description
        ? `Use the search spike to explain: ${description}`
        : traffic
          ? `Search interest is rising (${traffic}); turn it into a quick opinion post.`
          : "Turn this rising search into a quick opinion post.";

      return {
        title,
        angle,
        keywords: keywordsFromTitle(title),
        source: "google-trends",
      };
    })
    .filter((idea): idea is TrendIdea => Boolean(idea))
    .slice(0, 8);
}

async function fetchGNewsTrends(country: string, language: string) {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL("https://gnews.io/api/v4/top-headlines");
  url.searchParams.set("category", "general");
  url.searchParams.set("country", normalizeCountry(country));
  url.searchParams.set("lang", language.toLowerCase().startsWith("hi") ? "hi" : "en");
  url.searchParams.set("max", "8");
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url, { next: { revalidate: 900 } });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !Array.isArray(data?.articles)) {
    return [];
  }

  return data.articles
    .filter((article: any) => typeof article?.title === "string")
    .slice(0, 8)
    .map((article: any) => {
      const title = normalizeNewsTitle(article.title);
      const sourceName = article.source?.name || "GNews";
      return {
        title,
        angle:
          article.description ||
          "Explain why this headline matters and ask for a real opinion.",
        keywords: keywordsFromTitle(title),
        source: sourceName,
      };
    });
}

async function fetchNewsApiTrends(country: string) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return [];
  }

  const url = new URL("https://newsapi.org/v2/top-headlines");
  url.searchParams.set("country", normalizeCountry(country));
  url.searchParams.set("pageSize", "8");
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url, { next: { revalidate: 900 } });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !Array.isArray(data?.articles)) {
    return [];
  }

  return data.articles
    .filter((article: any) => typeof article?.title === "string")
    .slice(0, 8)
    .map((article: any) => {
      const title = normalizeNewsTitle(article.title);
      const sourceName = article.source?.name || "News API";
      return {
        title,
        angle: "Explain why this story matters and ask for a real opinion.",
        keywords: keywordsFromTitle(title),
        source: sourceName,
      };
    });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const country = typeof body?.country === "string" ? body.country : "in";
  const niche = typeof body?.niche === "string" ? body.niche : "India creators";
  const language = typeof body?.language === "string" ? body.language : "Hinglish";

  try {
    const googleTrends = await fetchGoogleTrends(country);
    if (googleTrends.length > 0) {
      return NextResponse.json({
        trends: googleTrends,
        source: "google-trends",
      });
    }

    const gNewsTrends = await fetchGNewsTrends(country, language);
    if (gNewsTrends.length > 0) {
      return NextResponse.json({
        trends: gNewsTrends,
        source: "gnews",
      });
    }

    const newsTrends = await fetchNewsApiTrends(country);
    if (newsTrends.length > 0) {
      return NextResponse.json({
        trends: newsTrends,
        source: "newsapi",
      });
    }

    const aiResult = await createAIJsonResponseWithSource<TrendsResponse>({
      schemaName: "instagram_trend_ideas",
      schema: trendSchema,
      instructions:
        "Create timely, non-spammy Instagram topic ideas. If you do not have live trend data, make evergreen trend-style ideas and label source as ai-generated.",
      input: JSON.stringify({
        task: "Suggest topic ideas for Instagram captions and text-image posts.",
        niche,
        language,
        country,
        requirements: [
          "Prefer India-friendly pop culture, technology, creator, news, and youth topics.",
          "No false breaking-news claims.",
          "Every idea should invite genuine comments.",
        ],
      }),
      maxOutputTokens: 900,
    });

    return NextResponse.json({
      trends: aiResult.data.trends.slice(0, 8),
      source: aiResult.provider,
    });
  } catch (error: any) {
    return NextResponse.json({
      trends: fallbackTrends(),
      source: "fallback",
      warning: error?.message || "Trend API unavailable.",
    });
  }
}

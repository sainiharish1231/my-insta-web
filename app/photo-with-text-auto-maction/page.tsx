"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  Clock,
  Download,
  Facebook,
  ImageIcon,
  Instagram,
  Loader2,
  Music,
  Pause,
  Play,
  Send,
  Sparkles,
  TrendingUp,
  Upload,
  WandSparkles,
  Youtube,
} from "lucide-react";
import {
  AUTO_PHOTO_DRAFTS_STORAGE_KEY,
  AUTO_PHOTO_SEED_STORAGE_KEY,
  AutoPhotoDraft,
} from "@/lib/auto-maction";
import {
  buildInstagramReadyCloudinaryVideoUrl,
  createMedia,
  publishFacebookPageVideo,
  publishMedia,
  uploadMediaAssetToCloudinary,
} from "@/lib/meta";

interface InstagramAccount {
  id: string;
  username: string;
  profile_picture_url?: string;
  followers_count?: number;
  token?: string;
  pageId?: string;
}

interface YouTubeAccount {
  id: string;
  name?: string;
  username?: string;
  thumbnail?: string;
  accessToken?: string;
  refreshToken?: string;
  token?: string;
}

type Aspect = "landscape" | "square" | "portrait" | "reel";
type OverlayTheme = "cream" | "white" | "pink" | "cyan" | "dark";
type PublishTargetMode = "instagram" | "facebook-youtube" | "all";

interface SeedText {
  headline?: string;
  caption?: string;
  cta?: string;
  hashtags?: string[];
  topic?: string;
  language?: string;
  accountIds?: string[];
  publishTargetMode?: PublishTargetMode;
  youtubeAccountIds?: string[];
}

interface PublishStatus {
  state: "pending" | "uploading" | "success" | "error";
  error?: string;
}

interface CanvasContent {
  aspect: Aspect;
  backgroundImage: string;
  cta: string;
  headline: string;
  overlayTheme: OverlayTheme;
}

interface PublishContent extends CanvasContent {
  caption: string;
  hashtags: string[];
  publishTargetMode?: PublishTargetMode;
}

interface PhotoAutomationSettings {
  enabled: boolean;
  intervalHours: number;
  nextRunAt?: string;
  lastRunAt?: string;
  accountIds: string[];
  publishTargetMode?: PublishTargetMode;
  youtubeAccountIds?: string[];
}

interface PhotoGenerateOverrides {
  aspect?: Aspect;
  backgroundPrompt?: string;
  caption?: string;
  cta?: string;
  headline?: string;
  topic?: string;
}

interface TrendIdea {
  title: string;
  angle: string;
  keywords: string[];
  source: string;
}

const AUTO_PHOTO_SETTINGS_STORAGE_KEY = "auto_photo_text_maction_settings";
const MAX_TOPIC_WORDS = 42;
const MAX_HEADLINE_WORDS = 12;
const DEFAULT_VIDEO_DURATION_SECONDS = 10;
const MAX_MUSIC_VIDEO_SECONDS = 60;

const CANVAS_SIZES: Record<Aspect, { width: number; height: number }> = {
  landscape: { width: 1200, height: 675 },
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  reel: { width: 1080, height: 1920 },
};

const ASPECT_OPTIONS: Array<{ value: Aspect; label: string }> = [
  { value: "portrait", label: "Post 4:5" },
  { value: "square", label: "Square 1:1" },
  { value: "reel", label: "Reel 9:16" },
  { value: "landscape", label: "Landscape" },
];

const OVERLAY_THEMES: Record<
  OverlayTheme,
  { label: string; background: string; text: string; noteBackground: string }
> = {
  cream: {
    label: "Cream",
    background: "#fff2d8",
    text: "#070707",
    noteBackground: "rgba(7, 7, 7, 0.78)",
  },
  white: {
    label: "White",
    background: "#f8fafc",
    text: "#0f172a",
    noteBackground: "rgba(15, 23, 42, 0.82)",
  },
  pink: {
    label: "Pink",
    background: "#fbcfe8",
    text: "#171717",
    noteBackground: "rgba(157, 23, 77, 0.82)",
  },
  cyan: {
    label: "Cyan",
    background: "#a7f3d0",
    text: "#042f2e",
    noteBackground: "rgba(6, 78, 59, 0.82)",
  },
  dark: {
    label: "Dark",
    background: "#0f172a",
    text: "#ffffff",
    noteBackground: "rgba(255, 242, 216, 0.92)",
  },
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

function formatTime(value?: string) {
  if (!value) {
    return "Not set";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not set";
  }

  return parsed.toLocaleString();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  const trimToWidth = (value: string) => {
    if (ctx.measureText(value).width <= maxWidth) {
      return value;
    }

    let trimmed = value.trim();
    while (
      trimmed.length > 3 &&
      ctx.measureText(`${trimmed}...`).width > maxWidth
    ) {
      trimmed = trimmed.slice(0, -1).trimEnd();
    }

    return `${trimmed}...`;
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width <= maxWidth || !currentLine) {
      currentLine = testLine;
      continue;
    }

    lines.push(trimToWidth(currentLine));
    currentLine = word;

    if (lines.length === maxLines - 1) {
      lines.push(trimToWidth([currentLine, ...words.slice(index + 1)].join(" ")));
      return lines;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(trimToWidth(currentLine));
  }

  return lines.length > 0 ? lines : ["Your next post starts here"];
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const canvasRatio = width / height;
  const imageRatio = image.width / image.height;
  let drawWidth = width;
  let drawHeight = height;
  let drawX = 0;
  let drawY = 0;

  if (imageRatio > canvasRatio) {
    drawHeight = height;
    drawWidth = height * imageRatio;
    drawX = (width - drawWidth) / 2;
  } else {
    drawWidth = width;
    drawHeight = width / imageRatio;
    drawY = (height - drawHeight) / 2;
  }

  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Background image load nahi hui."));
    image.src = src;
  });
}

function drawFallbackBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(0.45, "#1f2937");
  gradient.addColorStop(1, "#111827");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(20, 184, 166, 0.22)";
  ctx.fillRect(width * 0.05, height * 0.08, width * 0.32, height * 0.35);
  ctx.fillStyle = "rgba(244, 114, 182, 0.18)";
  ctx.fillRect(width * 0.54, height * 0.04, width * 0.38, height * 0.42);
  ctx.fillStyle = "rgba(251, 191, 36, 0.12)";
  ctx.fillRect(width * 0.2, height * 0.45, width * 0.56, height * 0.18);
}

function buildCaption(caption: string, cta: string, hashtags: string[]) {
  return [caption.trim(), cta.trim(), hashtags.join(" ")]
    .filter(Boolean)
    .join("\n\n");
}

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

function expandPostContext(
  value: string,
  kind: "topic" | "headline",
  context = "",
) {
  const cleanValue = removePromptLeakage(value, kind);
  const maxWords = kind === "topic" ? MAX_TOPIC_WORDS : MAX_HEADLINE_WORDS;

  if (kind === "headline") {
    return limitWords(cleanValue || "Aaj ka real सवाल", maxWords);
  }

  const cleanContext = removePromptLeakage(context, "topic");
  if (!cleanValue && !cleanContext) {
    return "viral social media update ko quick opinion post angle se frame karo";
  }

  if (!cleanContext) {
    return limitWords(cleanValue, maxWords);
  }

  const lowerValue = cleanValue.toLowerCase();
  const lowerContext = cleanContext.toLowerCase();
  if (lowerValue && lowerContext.includes(lowerValue)) {
    return limitWords(cleanContext, maxWords);
  }

  return limitWords(
    `${cleanValue || "viral social media update"}: ${cleanContext}`
      .replace(/\s+/g, " ")
      .trim(),
    maxWords,
  );
}

function buildOpinionCta(value: string) {
  const cleanValue = removePromptLeakage(value, "headline");
  const shortTopic = limitWords(cleanValue || "is topic", 5);
  return `Aapka ${shortTopic} par real take kya hai?`;
}

function buildTrendCaptionContext(title: string, angle = "") {
  const cleanTitle = removePromptLeakage(title, "headline");
  const cleanAngle = cleanTrendContext(angle);
  return [
    cleanTitle ? `${cleanTitle} par public reaction fast move kar raha hai.` : "",
    cleanAngle,
    "Post ka angle simple rakho: kya ye issue sach me important hai ya sirf trend timing ka effect hai?",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function getVideoMimeType(hasAudio: boolean) {
  const candidates = hasAudio
    ? [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

  return (
    candidates.find((candidate) =>
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(candidate),
    ) || "video/webm"
  );
}

function buildYouTubeTitle(headline: string) {
  const cleanTitle = headline.replace(/\s+/g, " ").trim();
  return cleanTitle.length > 92 ? `${cleanTitle.slice(0, 89)}...` : cleanTitle;
}

function buildYouTubeTags(hashtags: string[]) {
  return hashtags
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 15);
}

export default function PhotoWithTextAutoMactionPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const autoRunInProgressRef = useRef(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [youtubeAccounts, setYouTubeAccounts] = useState<YouTubeAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedYouTubeAccountIds, setSelectedYouTubeAccountIds] = useState<
    string[]
  >([]);
  const [drafts, setDrafts] = useState<AutoPhotoDraft[]>([]);
  const [aspect, setAspect] = useState<Aspect>("portrait");
  const [topic, setTopic] = useState(
    "Samay Raina ki latest online discussion par audience reaction creator economy meme culture social media outrage aur Instagram opinion post ka detailed angle",
  );
  const [language, setLanguage] = useState("Hindi");
  const [style, setStyle] = useState(
    "premium Hindi Instagram news card with realistic editorial background",
  );
  const [overlayTheme, setOverlayTheme] = useState<OverlayTheme>("cream");
  const [headline, setHeadline] = useState(
    "Samay Raina ke trend par audience ka reaction isliye important hai kyunki creators fans aur social media pages is moment ko serious discussion bana rahe hain",
  );
  const [headlineIsCustom, setHeadlineIsCustom] = useState(false);
  const [caption, setCaption] = useState(
    "Ek sharp Hindi take jo trend ke context ko simple tarike se explain karta hai aur audience ko apna real opinion share karne ka reason deta hai.",
  );
  const [cta, setCta] = useState("Netizens are already sharing their takes.");
  const [hashtags, setHashtags] = useState<string[]>([
    "#trending",
    "#viral",
    "#explore",
  ]);
  const [backgroundPrompt, setBackgroundPrompt] = useState("");
  const [backgroundPromptIsCustom, setBackgroundPromptIsCustom] =
    useState(false);
  const [backgroundImage, setBackgroundImage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [trendIdeas, setTrendIdeas] = useState<TrendIdea[]>([]);
  const [isLoadingTrends, setIsLoadingTrends] = useState(false);
  const [autoPostEnabled, setAutoPostEnabled] = useState(false);
  const [autoIntervalHours, setAutoIntervalHours] = useState(1);
  const [autoNextRunAt, setAutoNextRunAt] = useState<string>();
  const [autoLastRunAt, setAutoLastRunAt] = useState<string>();
  const [publishTargetMode, setPublishTargetMode] =
    useState<PublishTargetMode>("instagram");
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicFileName, setMusicFileName] = useState("");
  const [publishStatuses, setPublishStatuses] = useState<
    Record<string, PublishStatus>
  >({});

  useEffect(() => {
    const storedAccounts = readJson<InstagramAccount[]>("ig_accounts", []);
    const storedYouTubeAccounts = readJson<YouTubeAccount[]>(
      "youtube_accounts",
      [],
    );
    const storedDrafts = readJson<AutoPhotoDraft[]>(
      AUTO_PHOTO_DRAFTS_STORAGE_KEY,
      [],
    );
    const seed = readJson<SeedText | null>(AUTO_PHOTO_SEED_STORAGE_KEY, null);
    const rawSettings = localStorage.getItem(AUTO_PHOTO_SETTINGS_STORAGE_KEY);
    const settings = rawSettings
      ? readJson<Partial<PhotoAutomationSettings>>(
          AUTO_PHOTO_SETTINGS_STORAGE_KEY,
          {},
        )
      : {};
    const shouldAutoStart = rawSettings ? Boolean(settings.enabled) : true;

    setAccounts(storedAccounts);
    setYouTubeAccounts(storedYouTubeAccounts);
    setDrafts(storedDrafts);
    setAutoPostEnabled(shouldAutoStart);
    setAutoIntervalHours(settings.intervalHours || 1);
    setPublishTargetMode(
      seed?.publishTargetMode || settings.publishTargetMode || "instagram",
    );
    setAutoNextRunAt(
      settings.nextRunAt || (shouldAutoStart ? new Date().toISOString() : undefined),
    );
    setAutoLastRunAt(settings.lastRunAt);

    if (seed) {
      setHeadline((current) => seed.headline || current);
      setCaption((current) => seed.caption || current);
      setCta((current) => seed.cta || current);
      setTopic((current) => seed.topic || current);
      setLanguage((current) => seed.language || current);
      setHashtags((current) => seed.hashtags || current);
      localStorage.removeItem(AUTO_PHOTO_SEED_STORAGE_KEY);
    }

    const seedSelection =
      seed?.accountIds?.filter((id) =>
        storedAccounts.some((account) => account.id === id),
      ) || [];
    const settingsSelection =
      settings.accountIds?.filter((id) =>
        storedAccounts.some((account) => account.id === id),
      ) || [];
    const seedYouTubeSelection =
      seed?.youtubeAccountIds?.filter((id) =>
        storedYouTubeAccounts.some((account) => account.id === id),
      ) || [];
    const settingsYouTubeSelection =
      settings.youtubeAccountIds?.filter((id) =>
        storedYouTubeAccounts.some((account) => account.id === id),
      ) || [];

    setSelectedAccountIds(
      seedSelection.length > 0
        ? seedSelection
        : settingsSelection.length > 0
          ? settingsSelection
        : storedAccounts.map((account) => account.id),
    );
    setSelectedYouTubeAccountIds(
      seedYouTubeSelection.length > 0
        ? seedYouTubeSelection
        : settingsYouTubeSelection.length > 0
          ? settingsYouTubeSelection
          : storedYouTubeAccounts.map((account) => account.id),
    );
    setSettingsLoaded(true);
  }, []);

  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedAccountIds.includes(account.id)),
    [accounts, selectedAccountIds],
  );
  const selectedYouTubeAccounts = useMemo(
    () =>
      youtubeAccounts.filter((account) =>
        selectedYouTubeAccountIds.includes(account.id),
      ),
    [selectedYouTubeAccountIds, youtubeAccounts],
  );
  const selectedFacebookPageCount = useMemo(
    () =>
      selectedAccounts.filter((account) => account.pageId && account.token)
        .length,
    [selectedAccounts],
  );
  const hasPublishTargets =
    (publishTargetMode !== "facebook-youtube" &&
      selectedAccounts.length > 0) ||
    (publishTargetMode !== "instagram" &&
      (selectedFacebookPageCount > 0 || selectedYouTubeAccounts.length > 0));

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    const settings: PhotoAutomationSettings = {
      enabled: autoPostEnabled,
      intervalHours: autoIntervalHours,
      nextRunAt: autoNextRunAt,
      lastRunAt: autoLastRunAt,
      accountIds: selectedAccountIds,
      publishTargetMode,
      youtubeAccountIds: selectedYouTubeAccountIds,
    };

    localStorage.setItem(
      AUTO_PHOTO_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings),
    );
  }, [
    autoIntervalHours,
    autoLastRunAt,
    autoNextRunAt,
    autoPostEnabled,
    publishTargetMode,
    selectedAccountIds,
    selectedYouTubeAccountIds,
    settingsLoaded,
  ]);

  const renderCanvas = useCallback(async (overrides?: Partial<CanvasContent>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    const content: CanvasContent = {
      aspect,
      backgroundImage,
      cta,
      headline,
      overlayTheme,
      ...overrides,
    };
    const { width, height } = CANVAS_SIZES[content.aspect];
    const theme = OVERLAY_THEMES[content.overlayTheme];

    canvas.width = width;
    canvas.height = height;

    if (content.backgroundImage) {
      try {
        const image = await loadImage(content.backgroundImage);
        drawCoverImage(ctx, image, width, height);
      } catch {
        drawFallbackBackground(ctx, width, height);
      }
    } else {
      drawFallbackBackground(ctx, width, height);
    }

    const shade = ctx.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, "rgba(0, 0, 0, 0.08)");
    shade.addColorStop(0.38, "rgba(0, 0, 0, 0.28)");
    shade.addColorStop(0.72, "rgba(0, 0, 0, 0.78)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.96)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);

    const noteSize =
      content.aspect === "reel"
        ? 42
        : content.aspect === "landscape"
          ? 28
          : 34;
    ctx.font = `800 ${noteSize}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center";
    const noteLines = wrapText(ctx, content.cta, width * 0.72, 2);
    const noteLineHeight = noteSize * 1.25;
    const noteWidestLine = Math.max(
      ...noteLines.map((line) => ctx.measureText(line).width),
    );
    const notePaddingX = noteSize * 0.7;
    const notePaddingY = noteSize * 0.42;
    const noteWidth = Math.min(noteWidestLine + notePaddingX * 2, width * 0.82);
    const noteHeight = noteLines.length * noteLineHeight + notePaddingY * 2;
    const noteX = (width - noteWidth) / 2;
    const noteY =
      content.aspect === "reel"
        ? height * 0.78
        : content.aspect === "landscape"
          ? height - noteHeight - height * 0.07
          : height - noteHeight - height * 0.08;

    const maxWidth = width * (content.aspect === "landscape" ? 0.78 : 0.82);
    const baseHeadlineSize =
      content.aspect === "reel"
        ? 76
        : content.aspect === "portrait"
          ? 66
          : content.aspect === "square"
            ? 60
            : 52;
    const maxLines = content.aspect === "landscape" ? 4 : 7;
    const headlineGap =
      content.aspect === "reel"
        ? 52
        : content.aspect === "landscape"
          ? 28
          : 42;
    const safeTop = height * (content.aspect === "landscape" ? 0.12 : 0.13);
    const safeBottom = noteY - headlineGap;
    const maxBlockHeight = Math.max(height * 0.22, safeBottom - safeTop);

    let headlineSize = baseHeadlineSize;
    let lineHeight = headlineSize * 1.16;
    let lines: string[] = [];
    let widestLine = 0;
    let blockPaddingX = headlineSize * 0.42;
    let blockPaddingY = headlineSize * 0.34;
    let blockWidth = width * 0.9;
    let blockHeight = 0;

    while (headlineSize >= 40) {
      lineHeight = headlineSize * 1.16;
      blockPaddingX = headlineSize * 0.42;
      blockPaddingY = headlineSize * 0.34;
      ctx.font = `900 ${headlineSize}px Arial, Helvetica, sans-serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      lines = wrapText(ctx, content.headline, maxWidth, maxLines);
      widestLine = Math.max(
        ...lines.map((line) => ctx.measureText(line).width),
      );
      blockWidth = Math.min(widestLine + blockPaddingX * 2, width * 0.9);
      blockHeight = lines.length * lineHeight + blockPaddingY * 2;
      if (blockHeight <= maxBlockHeight) {
        break;
      }
      headlineSize -= 4;
    }

    const blockX = (width - blockWidth) / 2;
    const blockY = Math.max(safeTop, safeBottom - blockHeight);

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.42)";
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = theme.background;
    drawRoundedRect(ctx, blockX, blockY, blockWidth, blockHeight, 8);
    ctx.fill();
    ctx.restore();

    ctx.font = `900 ${headlineSize}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillStyle = theme.text;
    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        width / 2,
        blockY + blockPaddingY + index * lineHeight,
      );
    });

    ctx.font = `800 ${noteSize}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";

    ctx.fillStyle = theme.noteBackground;
    drawRoundedRect(ctx, noteX, noteY, noteWidth, noteHeight, 8);
    ctx.fill();
    ctx.fillStyle = content.overlayTheme === "dark" ? "#070707" : "#ffffff";
    noteLines.forEach((line, index) => {
      ctx.fillText(
        line,
        width / 2,
        noteY + notePaddingY + index * noteLineHeight,
      );
    });
  }, [aspect, backgroundImage, cta, headline, overlayTheme]);

  useEffect(() => {
    void renderCanvas();
  }, [renderCanvas]);

  const appendDraft = useCallback((draft: AutoPhotoDraft) => {
    const storedDraft: AutoPhotoDraft = {
      ...draft,
      imageDataUrl: undefined,
    };

    setDrafts((current) => {
      const next = [storedDraft, ...current].slice(0, 12);
      try {
        localStorage.setItem(
          AUTO_PHOTO_DRAFTS_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        console.warn("[v0] Photo auto maction draft could not be saved.");
      }
      return next;
    });
  }, []);

  const generatePhotoPost = useCallback(async (
    showLoading = true,
    overrides: PhotoGenerateOverrides = {},
  ) => {
    if (showLoading) {
      setIsGenerating(true);
    }
    setError("");
    setWarning("");

    try {
      const requestCaption = overrides.caption || caption;
      const requestCta = overrides.cta || cta;
      const requestTopic = expandPostContext(
        overrides.topic || topic,
        "topic",
        requestCaption || requestCta,
      );
      const headlineBase =
        overrides.headline || (headlineIsCustom ? headline : overrides.topic || topic);
      const requestHeadline = expandPostContext(
        headlineBase,
        "headline",
      );
      const requestAspect = overrides.aspect || aspect;
      const requestBackgroundPrompt =
        overrides.backgroundPrompt ??
        (backgroundPromptIsCustom ? backgroundPrompt : "");
      setTopic(requestTopic);
      setHeadline(requestHeadline);

      const response = await fetch("/api/ai/photo-text-post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: requestTopic,
          language,
          style,
          headline: requestHeadline,
          caption: requestCaption,
          cta: requestCta,
          aspect: requestAspect,
          accountIds: selectedAccountIds,
          backgroundPrompt: requestBackgroundPrompt,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.draft) {
        throw new Error(data?.error || "Photo text post create nahi ho paya.");
      }

      const draft = data.draft as AutoPhotoDraft;
      setTopic(draft.topic || requestTopic);
      setAspect(draft.aspect as Aspect);
      setHeadline(draft.hook);
      setCaption(draft.caption);
      setCta(draft.cta);
      setHashtags(draft.hashtags);
      setBackgroundPrompt(draft.backgroundPrompt);
      setBackgroundPromptIsCustom(false);
      setHeadlineIsCustom(false);
      setBackgroundImage(draft.imageDataUrl || "");
      appendDraft(draft);

      if (data.warning) {
        setWarning(data.warning);
      }

      return draft;
    } catch (generateError: any) {
      setError(generateError?.message || "Photo text post create nahi ho paya.");
      return null;
    } finally {
      if (showLoading) {
        setIsGenerating(false);
      }
    }
  }, [
    appendDraft,
    aspect,
    backgroundPrompt,
    backgroundPromptIsCustom,
    caption,
    cta,
    headline,
    headlineIsCustom,
    language,
    selectedAccountIds,
    style,
    topic,
  ]);

  const findTrends = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setIsLoadingTrends(true);
    }
    setError("");
    setWarning("");

    try {
      const response = await fetch("/api/ai/trends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          country: "in",
          niche: topic,
          language,
        }),
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data?.trends)) {
        throw new Error(data?.error || "Trends load nahi ho paye.");
      }

      const trends = data.trends as TrendIdea[];
      setTrendIdeas(trends);
      if (trends[0]?.title) {
        setTopic(expandPostContext(trends[0].title, "topic", trends[0].angle));
        setHeadline(
          expandPostContext(trends[0].title, "headline"),
        );
        setHeadlineIsCustom(false);
        setBackgroundPrompt("");
        setBackgroundPromptIsCustom(false);
      }
      if (data.warning) {
        setWarning(data.warning);
      }
      return trends;
    } catch (trendError: any) {
      setError(trendError?.message || "Trends load nahi ho paye.");
      return [];
    } finally {
      if (showLoading) {
        setIsLoadingTrends(false);
      }
    }
  }, [language, topic]);

  const toggleAccount = (accountId: string) => {
    setSelectedAccountIds((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    );
  };

  const toggleYouTubeAccount = (accountId: string) => {
    setSelectedYouTubeAccountIds((current) =>
      current.includes(accountId)
        ? current.filter((id) => id !== accountId)
        : [...current, accountId],
    );
  };

  const handleBackgroundUpload = (file?: File) => {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setBackgroundImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTopicChange = (value: string) => {
    setTopic(value);
    setHeadlineIsCustom(false);
    setBackgroundPrompt("");
    setBackgroundPromptIsCustom(false);
  };

  const handleHeadlineChange = (value: string) => {
    setHeadline(value);
    setHeadlineIsCustom(true);
    setBackgroundPrompt("");
    setBackgroundPromptIsCustom(false);
  };

  const handleCaptionChange = (value: string) => {
    setCaption(value);
    setBackgroundPrompt("");
    setBackgroundPromptIsCustom(false);
  };

  const completeTopicMinimum = () => {
    setTopic((current) => {
      const expandedTopic = expandPostContext(current, "topic", caption || cta);
      if (!headlineIsCustom) {
        setHeadline(expandPostContext(current, "headline"));
      }
      return expandedTopic;
    });
  };

  const completeHeadlineMinimum = () => {
    setHeadline((current) => expandPostContext(current, "headline"));
  };

  const handleMusicUpload = (file?: File) => {
    if (!file) {
      return;
    }

    setMusicFile(file);
    setMusicFileName(file.name);
  };

  const canvasToFile = useCallback(async (content?: Partial<CanvasContent>) => {
    await renderCanvas(content);
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Canvas ready nahi hai.");
    }

    return new Promise<File>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("PNG create nahi ho paya."));
          return;
        }

        resolve(
          new File([blob], `photo-auto-maction-${Date.now()}.png`, {
            type: "image/png",
          }),
        );
      }, "image/png");
    });
  }, [renderCanvas]);

  const canvasToVideoFile = useCallback(async (content?: Partial<CanvasContent>) => {
    await renderCanvas(content);
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Canvas ready nahi hai.");
    }

    if (!canvas.captureStream || typeof MediaRecorder === "undefined") {
      throw new Error("Is browser me canvas video recording supported nahi hai.");
    }

    const canvasStream = canvas.captureStream(30);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    let audioContext: AudioContext | null = null;
    let audioSource: AudioBufferSourceNode | null = null;
    let durationSeconds = DEFAULT_VIDEO_DURATION_SECONDS;

    if (musicFile) {
      const AudioContextCtor =
        window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("Is browser me audio processing supported nahi hai.");
      }

      audioContext = new AudioContextCtor();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const audioBuffer = await audioContext.decodeAudioData(
        await musicFile.arrayBuffer(),
      );
      const destination = audioContext.createMediaStreamDestination();
      audioSource = audioContext.createBufferSource();
      audioSource.buffer = audioBuffer;
      audioSource.connect(destination);
      tracks.push(...destination.stream.getAudioTracks());
      durationSeconds = Math.min(
        MAX_MUSIC_VIDEO_SECONDS,
        Math.max(8, audioBuffer.duration),
      );
    }

    const mimeType = getVideoMimeType(Boolean(musicFile));
    const stream = new MediaStream(tracks);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    const videoTrack = canvasStream.getVideoTracks()[0] as
      | (MediaStreamTrack & { requestFrame?: () => void })
      | undefined;

    let frameInterval = 0;

    return new Promise<File>((resolve, reject) => {
      const cleanup = () => {
        window.clearInterval(frameInterval);
        stream.getTracks().forEach((track) => track.stop());
        canvasStream.getTracks().forEach((track) => track.stop());
        try {
          audioSource?.stop();
        } catch {
          // Source can already be stopped by the recorder timeout.
        }
        void audioContext?.close().catch(() => undefined);
      };

      frameInterval = window.setInterval(() => {
        videoTrack?.requestFrame?.();
      }, 500);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        cleanup();
        reject(new Error("Music video create nahi ho paya."));
      };
      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: mimeType });
        resolve(
          new File([blob], `photo-auto-maction-${Date.now()}.webm`, {
            type: mimeType,
          }),
        );
      };

      audioSource?.start();
      recorder.start(1000);
      window.setTimeout(() => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }, durationSeconds * 1000);
    });
  }, [musicFile, renderCanvas]);

  const downloadPng = async () => {
    setError("");
    try {
      await renderCanvas();
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const link = document.createElement("a");
      link.download = `photo-auto-maction-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (downloadError: any) {
      setError(downloadError?.message || "PNG download nahi ho paya.");
    }
  };

  const publishToInstagram = useCallback(async (content?: Partial<PublishContent>) => {
    const finalMode = content?.publishTargetMode || publishTargetMode;
    const shouldPublishInstagram = finalMode !== "facebook-youtube";
    const shouldPublishFacebookYouTube = finalMode !== "instagram";
    const facebookTargets = selectedAccounts.filter(
      (account) => account.pageId && account.token,
    );
    const hasAnyTarget =
      (shouldPublishInstagram && selectedAccounts.length > 0) ||
      (shouldPublishFacebookYouTube &&
        (facebookTargets.length > 0 || selectedYouTubeAccounts.length > 0));

    if (!hasAnyTarget) {
      setError("Publish ke liye Instagram, Facebook Page, ya YouTube target select karo.");
      return;
    }

    setIsPublishing(true);
    setError("");
    setWarning("");

    const nextStatuses: Record<string, PublishStatus> = {};
    if (shouldPublishInstagram) {
      for (const account of selectedAccounts) {
        nextStatuses[`instagram-${account.id}`] = { state: "pending" };
      }
    }
    if (shouldPublishFacebookYouTube) {
      for (const account of facebookTargets) {
        nextStatuses[`facebook-${account.id}`] = { state: "pending" };
      }
      for (const account of selectedYouTubeAccounts) {
        nextStatuses[`youtube-${account.id}`] = { state: "pending" };
      }
    }
    setPublishStatuses(nextStatuses);

    try {
      const finalContent: PublishContent = {
        aspect,
        backgroundImage,
        caption,
        cta,
        hashtags,
        headline,
        overlayTheme,
        ...content,
      };
      const needsVideo = Boolean(musicFile) || shouldPublishFacebookYouTube;
      const file = needsVideo
        ? await canvasToVideoFile(finalContent)
        : await canvasToFile(finalContent);
      const asset = await uploadMediaAssetToCloudinary(file, {
        folder: `auto-maction/${needsVideo ? "videos" : "photos"}/${new Date().toISOString().slice(0, 10)}`,
      });
      const publishUrl = needsVideo
        ? buildInstagramReadyCloudinaryVideoUrl(asset.publicId) || asset.secureUrl
        : asset.secureUrl;
      const finalCaption = buildCaption(
        finalContent.caption,
        finalContent.cta,
        finalContent.hashtags,
      );

      if (shouldPublishInstagram) {
        for (const account of selectedAccounts) {
          const statusKey = `instagram-${account.id}`;
          setPublishStatuses((current) => ({
            ...current,
            [statusKey]: { state: "uploading" },
          }));

          try {
            if (!account.token) {
              throw new Error("Instagram token missing hai. Account reconnect karo.");
            }

            const creationId = await createMedia({
              igUserId: account.id,
              token: account.token,
              mediaUrl: publishUrl,
              caption: finalCaption,
              isReel: needsVideo,
            });

            await publishMedia({
              igUserId: account.id,
              token: account.token,
              creationId,
            });

            setPublishStatuses((current) => ({
              ...current,
              [statusKey]: { state: "success" },
            }));
          } catch (publishError: any) {
            setPublishStatuses((current) => ({
              ...current,
              [statusKey]: {
                state: "error",
                error: publishError?.message || "Instagram publish failed.",
              },
            }));
          }
        }
      }

      if (shouldPublishFacebookYouTube) {
        for (const account of facebookTargets) {
          const statusKey = `facebook-${account.id}`;
          setPublishStatuses((current) => ({
            ...current,
            [statusKey]: { state: "uploading" },
          }));

          try {
            await publishFacebookPageVideo({
              pageId: account.pageId,
              token: account.token,
              mediaUrl: publishUrl,
              caption: finalCaption,
            });
            setPublishStatuses((current) => ({
              ...current,
              [statusKey]: { state: "success" },
            }));
          } catch (publishError: any) {
            setPublishStatuses((current) => ({
              ...current,
              [statusKey]: {
                state: "error",
                error: publishError?.message || "Facebook Page publish failed.",
              },
            }));
          }
        }

        for (const account of selectedYouTubeAccounts) {
          const statusKey = `youtube-${account.id}`;
          setPublishStatuses((current) => ({
            ...current,
            [statusKey]: { state: "uploading" },
          }));

          try {
            const response = await fetch("/api/youtube/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accessToken: account.accessToken || account.token,
                refreshToken: account.refreshToken,
                videoUrl: publishUrl,
                title: buildYouTubeTitle(finalContent.headline),
                description: finalCaption,
                keywords: buildYouTubeTags(finalContent.hashtags),
                privacy: "public",
                isShort:
                  finalContent.aspect === "reel" ||
                  finalContent.aspect === "portrait",
              }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) {
              throw new Error(data.error || "YouTube upload failed.");
            }
            if (typeof data.accessToken === "string" && data.accessToken) {
              setYouTubeAccounts((current) => {
                const next = current.map((storedAccount) =>
                  storedAccount.id === account.id
                    ? { ...storedAccount, accessToken: data.accessToken }
                    : storedAccount,
                );
                localStorage.setItem("youtube_accounts", JSON.stringify(next));
                return next;
              });
            }
            setPublishStatuses((current) => ({
              ...current,
              [statusKey]: { state: "success" },
            }));
          } catch (publishError: any) {
            setPublishStatuses((current) => ({
              ...current,
              [statusKey]: {
                state: "error",
                error: publishError?.message || "YouTube upload failed.",
              },
            }));
          }
        }
      }
    } catch (publishError: any) {
      setError(publishError?.message || "Instagram publish failed.");
    } finally {
      setIsPublishing(false);
    }
  }, [
    aspect,
    backgroundImage,
    canvasToFile,
    canvasToVideoFile,
    caption,
    cta,
    hashtags,
    headline,
    musicFile,
    overlayTheme,
    publishTargetMode,
    selectedAccounts,
    selectedYouTubeAccounts,
  ]);

  const runAutoPost = useCallback(async () => {
    if (autoRunInProgressRef.current) {
      return;
    }

    const facebookTargetCount = selectedAccounts.filter(
      (account) => account.pageId && account.token,
    ).length;
    const hasPublishTarget =
      (publishTargetMode !== "facebook-youtube" &&
        selectedAccounts.length > 0) ||
      (publishTargetMode !== "instagram" &&
        (facebookTargetCount > 0 || selectedYouTubeAccounts.length > 0));

    if (!hasPublishTarget) {
      setAutoPostEnabled(false);
      setError("Auto post ke liye Instagram, Facebook Page, ya YouTube target select karo.");
      return;
    }

    autoRunInProgressRef.current = true;

    try {
      const trends = await findTrends(false);
      const trendTopic = expandPostContext(
        trends[0]?.title || topic,
        "topic",
        trends[0]?.angle || caption || cta,
      );
      const trendHeadline = expandPostContext(
        trends[0]?.title || headline,
        "headline",
      );
      const trendCaption = buildTrendCaptionContext(
        trends[0]?.title || topic,
        trends[0]?.angle,
      );
      const trendCta = buildOpinionCta(trends[0]?.title || topic);
      const draft = await generatePhotoPost(true, {
        backgroundPrompt: "",
        caption: trendCaption || caption,
        cta: trendCta,
        headline: trendHeadline,
        topic: trendTopic,
      });
      if (!draft) {
        return;
      }

      await publishToInstagram({
        aspect: draft.aspect as Aspect,
        backgroundImage: draft.imageDataUrl || "",
        caption: draft.caption,
        cta: draft.cta,
        hashtags: draft.hashtags,
        headline: draft.hook,
        overlayTheme,
        publishTargetMode,
      });

      const now = new Date();
      setAutoLastRunAt(now.toISOString());
      setAutoNextRunAt(
        new Date(
          now.getTime() + autoIntervalHours * 60 * 60 * 1000,
        ).toISOString(),
      );
    } finally {
      autoRunInProgressRef.current = false;
    }
  }, [
    autoIntervalHours,
    caption,
    cta,
    findTrends,
    generatePhotoPost,
    headline,
    overlayTheme,
    publishToInstagram,
    publishTargetMode,
    selectedAccounts.length,
    selectedAccounts,
    selectedYouTubeAccounts.length,
    topic,
  ]);

  const startAutoPost = () => {
    const facebookTargetCount = selectedAccounts.filter(
      (account) => account.pageId && account.token,
    ).length;
    const hasPublishTarget =
      (publishTargetMode !== "facebook-youtube" &&
        selectedAccounts.length > 0) ||
      (publishTargetMode !== "instagram" &&
        (facebookTargetCount > 0 || selectedYouTubeAccounts.length > 0));

    if (!hasPublishTarget) {
      setError("Auto post ke liye Instagram, Facebook Page, ya YouTube target select karo.");
      return;
    }

    setAutoPostEnabled(true);
    if (!autoNextRunAt || new Date(autoNextRunAt).getTime() <= Date.now()) {
      setAutoNextRunAt(new Date().toISOString());
    }
  };

  useEffect(() => {
    if (
      !settingsLoaded ||
      !autoPostEnabled ||
      isGenerating ||
      isPublishing ||
      autoRunInProgressRef.current
    ) {
      return;
    }

    const nextTime = autoNextRunAt ? new Date(autoNextRunAt).getTime() : 0;
    if (!nextTime || Date.now() >= nextTime) {
      void runAutoPost();
    }
  }, [
    autoNextRunAt,
    autoPostEnabled,
    isGenerating,
    isPublishing,
    runAutoPost,
    settingsLoaded,
  ]);

  useEffect(() => {
    if (!settingsLoaded || !autoPostEnabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (isGenerating || isPublishing || autoRunInProgressRef.current) {
        return;
      }

      const nextTime = autoNextRunAt ? new Date(autoNextRunAt).getTime() : 0;
      if (!nextTime || Date.now() >= nextTime) {
        void runAutoPost();
      }
    }, 20_000);

    return () => window.clearInterval(intervalId);
  }, [
    autoNextRunAt,
    autoPostEnabled,
    isGenerating,
    isPublishing,
    runAutoPost,
    settingsLoaded,
  ]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-900/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-xl p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="rounded-xl bg-gradient-to-br from-pink-500 to-amber-500 p-2.5">
              <Camera className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.25em] text-amber-200/70">
                Automation
              </p>
              <h1 className="truncate text-lg font-semibold">
                Photo With Text Auto Maction
              </h1>
            </div>
          </div>
          <button
            onClick={() => void publishToInstagram()}
            disabled={isPublishing || !hasPublishTargets}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-amber-500 px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPublishing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Publish Now
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-3">
              <WandSparkles className="h-5 w-5 text-amber-300" />
              <div>
                <h2 className="font-semibold">AI Photo Prompt</h2>
                <p className="text-xs text-white/45">
                  Text accurate canvas se render hoga.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Topic / full angle
                </span>
                <textarea
                  value={topic}
                  onChange={(event) => handleTopicChange(event.target.value)}
                  onBlur={completeTopicMinimum}
                  className="mt-2 h-28 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-amber-400/40 transition focus:border-amber-300/50 focus:ring-2"
                />
                <span className="mt-1 block text-xs text-white/40">
                  {countWords(topic)}/{MAX_TOPIC_WORDS} words. Trend context yahan clean brief banega.
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                    Language
                  </span>
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm text-white outline-none ring-amber-400/40 transition focus:border-amber-300/50 focus:ring-2"
                  >
                    <option>Hinglish</option>
                    <option>Hindi</option>
                    <option>Professional Hindi</option>
                    <option>English</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                    Size
                  </span>
                  <select
                    value={aspect}
                    onChange={(event) => setAspect(event.target.value as Aspect)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm text-white outline-none ring-amber-400/40 transition focus:border-amber-300/50 focus:ring-2"
                  >
                    {ASPECT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Visual style
                </span>
                <input
                  value={style}
                  onChange={(event) => setStyle(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-amber-400/40 transition focus:border-amber-300/50 focus:ring-2"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Background prompt
                </span>
                <textarea
                  value={backgroundPrompt}
                  onChange={(event) => {
                    setBackgroundPrompt(event.target.value);
                    setBackgroundPromptIsCustom(Boolean(event.target.value.trim()));
                  }}
                  placeholder="Custom prompt optional, empty rakho to Topic + Caption se auto image banegi"
                  className="mt-2 h-24 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-amber-400/40 transition placeholder:text-white/30 focus:border-amber-300/50 focus:ring-2"
                />
                <span className="mt-1 block text-xs text-white/40">
                  {backgroundPromptIsCustom
                    ? "Custom prompt active"
                    : "Auto prompt Topic, Headline aur Caption se banega"}
                </span>
              </label>

              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Publish target
                </p>
                <div className="mt-3 grid gap-2">
                  {[
                    {
                      value: "instagram",
                      label: "Instagram only",
                      icon: Instagram,
                    },
                    {
                      value: "facebook-youtube",
                      label: "FB + YouTube only",
                      icon: Facebook,
                    },
                    { value: "all", label: "All targets", icon: Send },
                  ].map((option) => {
                    const Icon = option.icon;
                    const selected = publishTargetMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          setPublishTargetMode(option.value as PublishTargetMode)
                        }
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                          selected
                            ? "border-amber-300/40 bg-amber-500/15 text-amber-100"
                            : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                      BG music
                    </p>
                    <p className="mt-1 truncate text-xs text-white/55">
                      {musicFileName || "Local audio file select karo"}
                    </p>
                  </div>
                  <input
                    ref={musicInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(event) =>
                      handleMusicUpload(event.target.files?.[0])
                    }
                  />
                  <button
                    type="button"
                    onClick={() => musicInputRef.current?.click()}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                  >
                    <Music className="h-4 w-4" />
                    Select
                  </button>
                </div>
                {musicFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setMusicFile(null);
                      setMusicFileName("");
                    }}
                    className="mt-2 text-xs text-red-200/80 hover:text-red-100"
                  >
                    Remove music
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => void findTrends()}
                  disabled={isLoadingTrends}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-500/10 px-5 py-3 font-semibold text-amber-100 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingTrends ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <TrendingUp className="h-4 w-4" />
                  )}
                  Find Trends
                </button>
                <button
                  onClick={() => void generatePhotoPost()}
                  disabled={isGenerating}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-amber-500 px-5 py-3 font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate
                </button>
              </div>

              {trendIdeas.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                    Trending ideas
                  </p>
                  <div className="space-y-2">
                    {trendIdeas.slice(0, 5).map((idea) => (
                      <button
                        key={`${idea.source}-${idea.title}`}
                        onClick={() => {
                          setTopic(
                            expandPostContext(idea.title, "topic", idea.angle),
                          );
                          setHeadline(
                            expandPostContext(
                              idea.title,
                              "headline",
                            ),
                          );
                          setCaption(buildTrendCaptionContext(idea.title, idea.angle));
                          setCta(buildOpinionCta(idea.title));
                          setHeadlineIsCustom(false);
                          setBackgroundPrompt("");
                          setBackgroundPromptIsCustom(false);
                        }}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-left text-sm transition-colors hover:border-amber-300/30"
                      >
                        <span className="font-medium text-white">
                          {idea.title}
                        </span>
                        <span className="mt-1 block text-xs text-white/45">
                          {idea.angle}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-3">
              <ImageIcon className="h-5 w-5 text-cyan-300" />
              <div>
                <h2 className="font-semibold">Overlay Text</h2>
                <p className="text-xs text-white/45">
                  Screenshot jaisa bold text layer.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Headline
                </span>
                <textarea
                  value={headline}
                  onChange={(event) => handleHeadlineChange(event.target.value)}
                  onBlur={completeHeadlineMinimum}
                  className="mt-2 h-28 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-cyan-400/40 transition focus:border-cyan-300/50 focus:ring-2"
                />
                <span className="mt-1 block text-xs text-white/40">
                  {countWords(headline)}/{MAX_HEADLINE_WORDS} words. Short overlay headline best rahega.
                </span>
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Bottom line
                </span>
                <input
                  value={cta}
                  onChange={(event) => setCta(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-cyan-400/40 transition focus:border-cyan-300/50 focus:ring-2"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Text bg
                </span>
                <select
                  value={overlayTheme}
                  onChange={(event) =>
                    setOverlayTheme(event.target.value as OverlayTheme)
                  }
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm text-white outline-none ring-cyan-400/40 transition focus:border-cyan-300/50 focus:ring-2"
                >
                  {Object.entries(OVERLAY_THEMES).map(([value, theme]) => (
                    <option key={value} value={value}>
                      {theme.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Caption
                </span>
                <textarea
                  value={caption}
                  onChange={(event) => handleCaptionChange(event.target.value)}
                  className="mt-2 h-24 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-cyan-400/40 transition focus:border-cyan-300/50 focus:ring-2"
                />
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-3">
              <Instagram className="h-5 w-5 text-pink-300" />
              <div>
                <h2 className="font-semibold">Accounts</h2>
                <p className="text-xs text-white/45">
                  Target mode ke hisaab se publish hoga.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                Instagram / Facebook Page
              </p>
              {accounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/50">
                  Instagram account login karo.
                </div>
              ) : (
                accounts.map((account) => {
                  const selected = selectedAccountIds.includes(account.id);
                  const status =
                    publishStatuses[`instagram-${account.id}`] ||
                    publishStatuses[`facebook-${account.id}`];
                  return (
                    <button
                      key={account.id}
                      onClick={() => toggleAccount(account.id)}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all ${
                        selected
                          ? "border-pink-400/40 bg-pink-500/10"
                          : "border-white/10 bg-slate-950/40 hover:border-white/20"
                      }`}
                    >
                      <img
                        src={
                          account.profile_picture_url ||
                          "/placeholder.svg?height=40&width=40&query=instagram profile"
                        }
                        alt={account.username}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">@{account.username}</p>
                        <p className="text-xs text-white/45">
                          {status?.state === "error"
                            ? status.error
                            : status?.state ||
                              (account.pageId ? "instagram + fb page" : "instagram")}
                        </p>
                      </div>
                      {status?.state === "uploading" ? (
                        <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                      ) : status?.state === "success" ? (
                        <CheckCircle className="h-5 w-5 text-emerald-300" />
                      ) : selected ? (
                        <CheckCircle className="h-5 w-5 text-pink-200" />
                      ) : null}
                    </button>
                  );
                })
              )}

              {publishTargetMode !== "instagram" && (
                <div className="pt-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Youtube className="h-4 w-4 text-red-300" />
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                      YouTube
                    </p>
                  </div>
                  {youtubeAccounts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/50">
                      YouTube account connect karo.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {youtubeAccounts.map((account) => {
                        const selected = selectedYouTubeAccountIds.includes(
                          account.id,
                        );
                        const status = publishStatuses[`youtube-${account.id}`];
                        return (
                          <button
                            key={account.id}
                            onClick={() => toggleYouTubeAccount(account.id)}
                            className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all ${
                              selected
                                ? "border-red-400/40 bg-red-500/10"
                                : "border-white/10 bg-slate-950/40 hover:border-white/20"
                            }`}
                          >
                            <img
                              src={
                                account.thumbnail ||
                                "/placeholder.svg?height=40&width=40&query=youtube channel"
                              }
                              alt={account.name || account.username || "YouTube"}
                              className="h-10 w-10 rounded-full object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">
                                {account.name || account.username || "YouTube"}
                              </p>
                              <p className="text-xs text-white/45">
                                {status?.state === "error"
                                  ? status.error
                                  : status?.state || "youtube"}
                              </p>
                            </div>
                            {status?.state === "uploading" ? (
                              <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                            ) : status?.state === "success" ? (
                              <CheckCircle className="h-5 w-5 text-emerald-300" />
                            ) : selected ? (
                              <CheckCircle className="h-5 w-5 text-red-200" />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-emerald-300" />
              <div>
                <h2 className="font-semibold">Auto Post</h2>
                <p className="text-xs text-white/45">
                  Generate ke baad selected accounts par publish hoga.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Hour
                </span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={autoIntervalHours}
                  onChange={(event) =>
                    setAutoIntervalHours(
                      Math.min(
                        24,
                        Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                      ),
                    )
                  }
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-emerald-400/40 transition focus:border-emerald-300/50 focus:ring-2"
                />
              </label>

              <button
                onClick={
                  autoPostEnabled
                    ? () => setAutoPostEnabled(false)
                    : startAutoPost
                }
                className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 font-semibold transition-colors ${
                  autoPostEnabled
                    ? "border border-red-400/30 bg-red-500/15 text-red-100 hover:bg-red-500/25"
                    : "border border-emerald-400/30 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
                }`}
              >
                {autoPostEnabled ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {autoPostEnabled ? "Pause Auto" : "Start Auto"}
              </button>

              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/45">Status</dt>
                  <dd
                    className={
                      autoPostEnabled ? "text-emerald-300" : "text-white/70"
                    }
                  >
                    {autoPostEnabled ? "Running" : "Paused"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/45">Last</dt>
                  <dd className="text-right text-white/70">
                    {formatTime(autoLastRunAt)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/45">Next</dt>
                  <dd className="text-right text-white/70">
                    {formatTime(autoNextRunAt)}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </aside>

        <section className="space-y-5">
          {(error || warning) && (
            <div
              className={`rounded-2xl border p-4 text-sm ${
                error
                  ? "border-red-500/30 bg-red-500/10 text-red-200"
                  : "border-amber-400/30 bg-amber-500/10 text-amber-100"
              }`}
            >
              {error || warning}
            </div>
          )}

          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-amber-200/70">
                  Preview
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  Generated post image
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) =>
                    handleBackgroundUpload(event.target.files?.[0])
                  }
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                >
                  <Upload className="h-4 w-4" />
                  Background
                </button>
                <button
                  onClick={() => void downloadPng()}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                >
                  <Download className="h-4 w-4" />
                  PNG
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black">
              <canvas ref={canvasRef} className="h-auto w-full" />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <h3 className="mb-3 text-lg font-semibold">Caption Ready</h3>
              <p className="whitespace-pre-wrap text-sm leading-6 text-white/75">
                {buildCaption(caption, cta, hashtags)}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {hashtags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-white/8 px-2.5 py-1 text-xs text-white/60"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <h3 className="mb-3 text-lg font-semibold">Recent Drafts</h3>
              {drafts.length === 0 ? (
                <p className="text-sm text-white/45">
                  Generate karte hi drafts yahan save honge.
                </p>
              ) : (
                <div className="space-y-3">
                  {drafts.slice(0, 4).map((draft) => (
                    <button
                      key={draft.id}
                      onClick={() => {
                        setHeadline(draft.hook);
                        setCaption(draft.caption);
                        setCta(draft.cta);
                        setHashtags(draft.hashtags);
                        setBackgroundPrompt(draft.backgroundPrompt);
                        setBackgroundPromptIsCustom(false);
                        setHeadlineIsCustom(false);
                        setBackgroundImage(draft.imageDataUrl || "");
                        setAspect(draft.aspect);
                      }}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-left transition-colors hover:border-amber-300/30"
                    >
                      <p className="line-clamp-2 text-sm font-medium">
                        {draft.hook}
                      </p>
                      <p className="mt-1 text-xs text-white/45">
                        Score {draft.score} - {draft.source}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}

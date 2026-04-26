"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Cloud,
  Clock3,
  Download,
  Instagram,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildCloudinaryVideoDownloadUrl,
  createMedia,
  publishMedia,
} from "@/lib/meta";
import {
  buildBulkVideoSeoDraft,
  buildCaptionFromSeoDraft,
  buildYouTubeDescriptionFromSeoDraft,
  buildYouTubeTagsFromKeywords,
} from "@/lib/bulk-video-seo";
import { uploadMediaToBlob } from "@/lib/media-upload";
import {
  fetchInstagramAccountsFromFacebook,
  mergeInstagramAccounts,
  persistInstagramAccounts,
  readStoredInstagramAccounts,
} from "@/lib/instagram-accounts";
import {
  DEFAULT_SHORTS_COPYRIGHT_TEXT,
  buildGeneratedShortCopy,
  buildHeadlineLinesFromTitle,
  buildShortsPlan,
  formatSeconds,
  normalizeYouTubeUrl,
  SHORTS_FRAMING_MODE_OPTIONS,
  SHORTS_QUALITY_PRESET_OPTIONS,
  type GeneratedShortAsset,
  type ShortsFramingMode,
  type ShortsQualityPreset,
  type ShortsVideoMetadata,
  type ShortsWindow,
} from "@/lib/youtube-shorts";

interface InstagramAccount {
  id: string;
  username: string;
  profile_picture_url?: string;
  token?: string;
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

interface QueueTargetAccount {
  id: string;
  label: string;
  platform: "instagram" | "youtube";
}

interface PublishAccount {
  id: string;
  username: string;
  platform: "instagram" | "youtube";
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  profile_picture_url?: string;
  thumbnail?: string;
}

interface QueueItem extends GeneratedShortAsset {
  sourceUrl: string;
  sourceTitle: string;
  status: "queued" | "uploading" | "error";
  error?: string;
  createdAt: string;
  targetAccounts?: QueueTargetAccount[];
  deleteFromCloudinaryOnRemove?: boolean;
}

interface CloudinarySourceResource {
  assetId: string;
  publicId: string;
  resourceType: string;
  secureUrl: string;
  bytes?: number;
  durationSeconds?: number;
  format?: string;
  createdAt?: string;
  folder?: string;
  originalFilename?: string;
}

interface PersistedState {
  queue: QueueItem[];
  selectedAccountId: string | null;
  selectedTargetAccountKeys?: string[];
  intervalMinutes: number;
  deleteAfterPublish: boolean;
  isRunning: boolean;
  nextRunAt: string | null;
  sourceVideo: ShortsVideoMetadata | null;
  sourceMode?: "youtube" | "file" | "cloudinary";
  cloudinarySourceFolder?: string;
  qualityPreset?: ShortsQualityPreset;
  framingMode?: ShortsFramingMode;
  includeLogoOverlay?: boolean;
  includeHeadlineOverlay?: boolean;
  includeCopyrightOverlay?: boolean;
  copyrightText?: string;
  recentUploads: Array<{
    id: string;
    title: string;
    uploadedAt: string;
    accountUsername: string;
  }>;
}

interface ActiveBuildSession {
  uploadFolder: string | null;
  queueStartIndex: number;
  total: number;
  renderWidth: number;
  renderHeight: number;
  renderLabel: string;
  framingMode: ShortsFramingMode;
  hasLogoOverlay: boolean;
  sourceUrl: string;
  sourceTitle: string;
  sourceDescription: string;
  sourceKeywords: string[];
}

interface SourceDownloadProgressState {
  phase: "idle" | "preparing" | "downloading" | "complete" | "error";
  percent: number;
  loadedBytes: number;
  totalBytes: number | null;
  status: string;
}

interface ShortsCreationProgressState {
  phase: "idle" | "processing" | "complete" | "error";
  percent: number;
  total: number;
  processed: number;
  saved: number;
  status: string;
}

interface ClipBuildProgressState {
  progress: number;
  status: "pending" | "processing" | "ready" | "error";
}

interface GeneratedShortPreviewState {
  title: string;
  description: string;
  keywords: string[];
  partLabel: string;
}

interface PublishAccountProgressState {
  accountKey: string;
  accountLabel: string;
  status: "pending" | "posting" | "posted" | "error";
  error?: string;
}

interface PublishProgressState {
  itemId: string;
  itemTitle: string;
  statuses: PublishAccountProgressState[];
}

type ShortsCreateStreamEvent =
  | {
      type: "ready";
      video: ShortsVideoMetadata;
      plan?: ShortsWindow[];
      uploadFolder?: string;
      renderWidth?: number;
      renderHeight?: number;
      renderLabel?: string;
      framingMode?: ShortsFramingMode;
      hasLogoOverlay?: boolean;
    }
  | {
      type: "clip";
      video?: ShortsVideoMetadata;
      item: GeneratedShortAsset;
      index: number;
      total: number;
    }
  | {
      type: "clip-progress";
      clipIndex: number;
      total: number;
      progress: number;
      stage?: "render" | "upload";
    }
  | {
      type: "complete";
      video?: ShortsVideoMetadata;
      count?: number;
      uploadFolder?: string;
    }
  | {
      type: "error";
      error: string;
    };

const STORAGE_KEY = "youtube_shorts_automation_state";
const TARGET_ACCOUNT_KEY = "youtube_shorts_target_account_id";
const TARGET_ACCOUNT_SELECTIONS_KEY = "youtube_shorts_target_account_keys";
const MOBILE_YOUTUBE_GUIDE_KEY = "youtube_shorts_mobile_youtube_guide_ack";
const SOURCE_FILE_INPUT_ID = "youtube-shorts-source-file-input";
const SHORTS_LIBRARY_ROOT = "shorts-videos";
const DEFAULT_CLOUDINARY_SOURCE_FOLDER = SHORTS_LIBRARY_ROOT;

type PendingYouTubeAction = "analyze" | "generate";
type YouTubeGuideDialogMode = "mobile-guide" | "bot-check";
type PerShortBuildStatus = "ready" | "processing" | "pending" | "error";

function getBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function getStoredString(key: string) {
  const value = getBrowserStorage()?.getItem(key);
  return value?.trim() ? value : null;
}

function isYouTubeBotCheckMessage(message?: string | null) {
  const normalizedMessage = message?.toLowerCase() || "";
  return (
    normalizedMessage.includes("sign in to confirm you're not a bot") ||
    normalizedMessage.includes("sign in to confirm you’re not a bot")
  );
}

function getFriendlyBotCheckStatus() {
  return "YouTube ko is video ke liye extra confirmation chahiye. Popup me next step dekh lo.";
}

function readStoredYouTubeAccounts() {
  try {
    const parsed = JSON.parse(
      getBrowserStorage()?.getItem("youtube_accounts") || "[]",
    );
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((account): account is YouTubeAccount => {
      if (!account || typeof account !== "object") {
        return false;
      }

      const candidate = account as Record<string, unknown>;
      return typeof candidate.id === "string";
    });
  } catch {
    return [];
  }
}

function getPublishAccountKey(
  account: Pick<PublishAccount, "id" | "platform">,
) {
  return `${account.platform}:${account.id}`;
}

function readStoredTargetAccountKeys() {
  try {
    const parsed = JSON.parse(
      getBrowserStorage()?.getItem(TARGET_ACCOUNT_SELECTIONS_KEY) || "[]",
    );
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function areStringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function getInstagramAccountSignature(accounts: InstagramAccount[]) {
  return accounts
    .map((account) =>
      [
        account.id,
        account.username,
        account.profile_picture_url || "",
        account.token || "",
      ].join("|"),
    )
    .join("||");
}

function getYouTubeAccountSignature(accounts: YouTubeAccount[]) {
  return accounts
    .map((account) =>
      [
        account.id,
        account.username || "",
        account.name || "",
        account.thumbnail || "",
        account.accessToken || "",
        account.refreshToken || "",
        account.token || "",
      ].join("|"),
    )
    .join("||");
}

function areInstagramAccountsEqual(
  left: InstagramAccount[],
  right: InstagramAccount[],
) {
  return (
    getInstagramAccountSignature(left) === getInstagramAccountSignature(right)
  );
}

function areYouTubeAccountsEqual(
  left: YouTubeAccount[],
  right: YouTubeAccount[],
) {
  return getYouTubeAccountSignature(left) === getYouTubeAccountSignature(right);
}

function getFriendlyPublishError(
  message: string,
  platform: "instagram" | "youtube",
) {
  if (
    platform === "instagram" &&
    message.includes(
      "The user must be an administrator, editor, or moderator of the page",
    )
  ) {
    return "Instagram page permission missing hai. Facebook Page par admin/editor/moderator access aur 2FA check karo.";
  }

  if (
    platform === "youtube" &&
    message.toLowerCase().includes("access token")
  ) {
    return "YouTube token missing ya expired hai. YouTube account reconnect karo.";
  }

  return message;
}

function getDashboardSelectedInstagramAccountId(accounts: InstagramAccount[]) {
  try {
    const browserStorage = getBrowserStorage();
    if (!browserStorage) {
      return null;
    }

    const storedSelectedAccounts = JSON.parse(
      browserStorage.getItem("selected_accounts") || "[]",
    );

    if (!Array.isArray(storedSelectedAccounts)) {
      return null;
    }

    return (
      storedSelectedAccounts.find(
        (accountId): accountId is string =>
          typeof accountId === "string" &&
          accounts.some((account) => account.id === accountId),
      ) || null
    );
  } catch {
    return null;
  }
}

function resolvePreferredInstagramAccountId(
  accounts: InstagramAccount[],
  persistedSelectedId?: string | null,
) {
  const validAccountIds = new Set(accounts.map((account) => account.id));
  const candidates = [
    getDashboardSelectedInstagramAccountId(accounts),
    getStoredString(TARGET_ACCOUNT_KEY),
    getStoredString("primary_ig_account_id"),
    getStoredString("ig_user_id"),
    persistedSelectedId,
    accounts[0]?.id || null,
  ];

  return (
    candidates.find((candidate): candidate is string =>
      Boolean(candidate && validAccountIds.has(candidate)),
    ) || null
  );
}

function parseKeywords(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFramingMode(
  value?: string | null,
): ShortsFramingMode | undefined {
  return value === "fill" || value === "show-full" ? value : undefined;
}

function parseQualityPreset(
  value?: string | null,
): ShortsQualityPreset | undefined {
  return value === "auto" ||
    value === "1080p" ||
    value === "1440p" ||
    value === "2160p"
    ? value
    : undefined;
}

function stripFileExtension(value: string) {
  return value.replace(/\.[^/.]+$/, "");
}

function deriveKeywordsFromText(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3),
    ),
  ).slice(0, 15);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Not scheduled";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Invalid date";
  }

  return parsed.toLocaleString();
}

function sanitizeFileName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getVideoExtensionFromMimeType(value?: string | null) {
  if (!value) {
    return "mp4";
  }

  if (value.includes("matroska")) {
    return "mkv";
  }

  if (value.includes("webm")) {
    return "webm";
  }

  if (value.includes("ogg")) {
    return "ogv";
  }

  return "mp4";
}

function formatBytes(value: number) {
  if (value <= 0) {
    return "0 MB";
  }

  return `${(value / (1024 * 1024)).toFixed(value >= 1024 * 1024 * 1024 ? 2 : 1)} MB`;
}

function getRemoteFileNameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const pathName = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return pathName || "remote-video.mp4";
  } catch {
    return "remote-video.mp4";
  }
}

function getRemoteContentType(format?: string, secureUrl?: string) {
  const lowerFormat = format?.toLowerCase();

  if (lowerFormat === "mkv" || lowerFormat === "matroska") {
    return "video/x-matroska";
  }

  if (lowerFormat === "webm") {
    return "video/webm";
  }

  if (lowerFormat === "mov" || lowerFormat === "qt") {
    return "video/quicktime";
  }

  if (lowerFormat) {
    return `video/${lowerFormat}`;
  }

  if (secureUrl?.toLowerCase().includes(".webm")) {
    return "video/webm";
  }

  if (secureUrl?.toLowerCase().includes(".mkv")) {
    return "video/x-matroska";
  }

  if (secureUrl?.toLowerCase().includes(".mov")) {
    return "video/quicktime";
  }

  return "video/mp4";
}

function buildCloudinarySourceMetadata(resource: CloudinarySourceResource) {
  const sourceTitle = stripFileExtension(
    resource.originalFilename ||
      resource.publicId.split("/").filter(Boolean).pop() ||
      "Cloudinary Video",
  )
    .replace(/[_-]+/g, " ")
    .trim();
  const sourceDescription = resource.folder
    ? `Cloudinary folder ${resource.folder} se imported source video.`
    : "Cloudinary se imported source video.";
  const keywords = deriveKeywordsFromText(
    `${sourceTitle} ${resource.folder || ""}`,
  );

  return {
    title: sourceTitle || "Cloudinary Video",
    description: sourceDescription,
    keywords,
  };
}

function buildSeoDraftForSource({
  rawName,
  folder,
  descriptionContext,
  extraKeywords = [],
  durationSeconds,
}: {
  rawName: string;
  folder?: string;
  descriptionContext?: string;
  extraKeywords?: string[];
  durationSeconds?: number;
}) {
  return buildBulkVideoSeoDraft({
    rawName,
    folder,
    descriptionContext,
    extraKeywords,
    durationSeconds,
  });
}

function buildQueueTargetAccounts(
  instagramAccounts: InstagramAccount[],
  youtubeAccounts: YouTubeAccount[],
) {
  return [
    ...instagramAccounts.map((account) => ({
      id: account.id,
      label: `IG • @${account.username}`,
      platform: "instagram" as const,
    })),
    ...youtubeAccounts.map((account) => ({
      id: account.id,
      label: `YT • ${account.username || account.name || "YouTube Account"}`,
      platform: "youtube" as const,
    })),
  ];
}

function createQueueItemFromCloudinaryResource({
  resource,
  index,
  targetAccounts,
}: {
  resource: CloudinarySourceResource;
  index: number;
  targetAccounts: QueueTargetAccount[];
}): QueueItem {
  const metadata = buildCloudinarySourceMetadata(resource);
  const seoDraft = buildSeoDraftForSource({
    rawName: metadata.title,
    folder: resource.folder,
    descriptionContext: metadata.description,
    extraKeywords: metadata.keywords,
    durationSeconds: resource.durationSeconds,
  });
  const durationSeconds = Math.max(
    0,
    Math.floor(resource.durationSeconds || 0),
  );
  const headlineLines = buildHeadlineLinesFromTitle(seoDraft.title);
  const detectedPartLabel =
    seoDraft.title.match(/\bpart\s*\d+\b/i)?.[0] || "Imported Clip";

  return {
    id: resource.assetId || resource.publicId,
    index,
    startSeconds: 0,
    endSeconds: durationSeconds,
    durationSeconds,
    label: detectedPartLabel,
    title: seoDraft.title,
    description: seoDraft.description,
    keywords: seoDraft.keywords,
    caption: buildCaptionFromSeoDraft(seoDraft),
    partLabel: detectedPartLabel,
    headlineLines,
    highlightedLineIndex: 0,
    renderWidth: 0,
    renderHeight: 0,
    renderLabel: "Cloudinary Import",
    framingMode: "show-full",
    hasLogoOverlay: false,
    assetUrl: resource.secureUrl,
    cloudinaryPublicId: resource.publicId,
    cloudinaryResourceType: resource.resourceType || "video",
    sourceUrl: resource.secureUrl,
    sourceTitle: seoDraft.title,
    status: "queued",
    createdAt: resource.createdAt || new Date().toISOString(),
    targetAccounts,
    deleteFromCloudinaryOnRemove: false,
  };
}

function buildQueueItemSeoFields(
  item: Pick<
    QueueItem,
    | "title"
    | "description"
    | "keywords"
    | "partLabel"
    | "sourceTitle"
    | "durationSeconds"
  >,
) {
  const seoDraft = buildSeoDraftForSource({
    rawName:
      [item.sourceTitle, item.partLabel].filter(Boolean).join(" ").trim() ||
      item.title ||
      "Short Video",
    folder: SHORTS_LIBRARY_ROOT,
    descriptionContext: item.description,
    extraKeywords: item.keywords,
    durationSeconds: item.durationSeconds,
  });
  const nextTitle =
    item.partLabel &&
    !seoDraft.title.toLowerCase().includes(item.partLabel.toLowerCase())
      ? `${seoDraft.title} | ${item.partLabel}`
      : seoDraft.title;

  return {
    title: nextTitle,
    description: buildYouTubeDescriptionFromSeoDraft(
      {
        ...seoDraft,
        title: nextTitle,
      },
      { isShort: true },
    ),
    caption: buildCaptionFromSeoDraft({
      ...seoDraft,
      title: nextTitle,
    }),
    keywords: seoDraft.keywords,
  };
}

function getShortPublicIdBase(publicId: string) {
  return publicId.split("/").filter(Boolean).pop() || publicId;
}

function parseGeneratedShortSegment(publicId: string): ShortsWindow | null {
  const match = getShortPublicIdBase(publicId).match(/^short-(\d+)-(\d+)-(\d+)$/);
  if (!match) {
    return null;
  }

  const partNumber = Number(match[1]);
  const startSeconds = Number(match[2]);
  const endSeconds = Number(match[3]);

  if (
    !Number.isFinite(partNumber) ||
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(endSeconds) ||
    partNumber <= 0 ||
    startSeconds < 0 ||
    endSeconds <= startSeconds
  ) {
    return null;
  }

  return {
    id: getShortPublicIdBase(publicId),
    index: partNumber - 1,
    startSeconds,
    endSeconds,
    durationSeconds: endSeconds - startSeconds,
    label: `${formatSeconds(startSeconds)}-${formatSeconds(endSeconds)}`,
  };
}

function createQueueItemFromGeneratedCloudinaryResource({
  resource,
  session,
  targetAccounts,
}: {
  resource: CloudinarySourceResource;
  session: ActiveBuildSession;
  targetAccounts: QueueTargetAccount[];
}): QueueItem | null {
  const segment = parseGeneratedShortSegment(resource.publicId);
  if (!segment) {
    return null;
  }

  const totalSegments = Math.max(session.total, segment.index + 1);
  const generatedCopy = buildGeneratedShortCopy({
    originalTitle: session.sourceTitle,
    originalDescription: session.sourceDescription,
    originalKeywords: session.sourceKeywords,
    segment,
    totalSegments,
  });

  return {
    ...segment,
    ...generatedCopy,
    id: resource.publicId,
    index: session.queueStartIndex + segment.index,
    renderWidth: session.renderWidth,
    renderHeight: session.renderHeight,
    renderLabel: session.renderLabel,
    framingMode: session.framingMode,
    hasLogoOverlay: session.hasLogoOverlay,
    assetUrl: resource.secureUrl,
    cloudinaryPublicId: resource.publicId,
    cloudinaryResourceType: resource.resourceType || "video",
    sourceUrl: session.sourceUrl,
    sourceTitle: session.sourceTitle,
    status: "queued",
    createdAt: resource.createdAt || new Date().toISOString(),
    targetAccounts,
    deleteFromCloudinaryOnRemove: true,
  };
}

async function getVideoDurationFromFile(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const durationSeconds = await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        resolve(Number.isFinite(video.duration) ? video.duration : 0);
      };
      video.onerror = () => {
        reject(new Error("Video metadata read nahi hui."));
      };
      video.src = objectUrl;
    });

    return Math.max(0, Math.floor(durationSeconds));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function buildLocalVideoFile(
  blob: Blob,
  title: string,
  contentType?: string | null,
) {
  const mimeType = blob.type || contentType || "video/mp4";
  const safeTitle = sanitizeFileName(title) || `youtube-source-${Date.now()}`;
  const extension = getVideoExtensionFromMimeType(mimeType);

  return new File([blob], `${safeTitle}.${extension}`, {
    type: mimeType,
  });
}

async function downloadSourceVideoBlob(
  url: string,
  onProgress?: (progress: SourceDownloadProgressState) => void,
) {
  onProgress?.({
    phase: "preparing",
    percent: 0,
    loadedBytes: 0,
    totalBytes: null,
    status: "YouTube se source video prepare ho rahi hai...",
  });

  const response = await fetch("/api/youtube/shorts/source", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Source video local download nahi hua.");
  }

  const totalBytesHeader = Number(
    response.headers.get("content-length") || "0",
  );
  const totalBytes =
    Number.isFinite(totalBytesHeader) && totalBytesHeader > 0
      ? totalBytesHeader
      : null;

  if (!response.body) {
    const blob = await response.blob();
    onProgress?.({
      phase: "complete",
      percent: 100,
      loadedBytes: blob.size,
      totalBytes: blob.size,
      status: "Source video download complete.",
    });

    return {
      blob,
      contentType: response.headers.get("content-type"),
    };
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loadedBytes = 0;

  onProgress?.({
    phase: "downloading",
    percent: 0,
    loadedBytes: 0,
    totalBytes,
    status: "Source video browser me transfer ho rahi hai...",
  });

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      chunks.push(value.slice().buffer);
      loadedBytes += value.byteLength;
      const percent = totalBytes
        ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100))
        : 0;

      onProgress?.({
        phase: "downloading",
        percent,
        loadedBytes,
        totalBytes,
        status: totalBytes
          ? `Source video download ho rahi hai... ${percent}%`
          : "Source video download ho rahi hai...",
      });
    }
  }

  const blob = new Blob(chunks, {
    type: response.headers.get("content-type") || "video/mp4",
  });

  onProgress?.({
    phase: "complete",
    percent: 100,
    loadedBytes,
    totalBytes: totalBytes || loadedBytes,
    status: "Source video download complete.",
  });

  return {
    blob,
    contentType: response.headers.get("content-type"),
  };
}

async function readShortsCreateStream(
  response: Response,
  onEvent: (event: ShortsCreateStreamEvent) => Promise<void> | void,
) {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeBufferedLines = async (flushRemainder = false) => {
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    const pendingLines = flushRemainder ? [...lines, buffer] : lines;

    if (flushRemainder) {
      buffer = "";
    }

    for (const line of pendingLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }

      const nextEvent = JSON.parse(trimmedLine) as ShortsCreateStreamEvent;
      await onEvent(nextEvent);
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    await consumeBufferedLines();
  }

  buffer += decoder.decode();
  await consumeBufferedLines(true);
}

function triggerBrowserDownload(url: string, fileName?: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  if (fileName) {
    anchor.download = fileName;
  }
  anchor.click();
}

async function deleteCloudinaryAsset(publicId: string, resourceType: string) {
  const response = await fetch("/api/cloudinary/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      publicId,
      resourceType,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete Cloudinary asset");
  }
}

async function cleanupQueuedAsset(
  item: Pick<
    QueueItem,
    | "cloudinaryPublicId"
    | "cloudinaryResourceType"
    | "deleteFromCloudinaryOnRemove"
  >,
) {
  if (!item.cloudinaryPublicId || item.deleteFromCloudinaryOnRemove === false) {
    return;
  }

  await deleteCloudinaryAsset(
    item.cloudinaryPublicId,
    item.cloudinaryResourceType,
  ).catch((error) => {
    console.error("[v0] Failed to cleanup queued Cloudinary asset:", error);
  });
}

export default function YouTubeShortsPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const buildSyncTimerRef = useRef<NodeJS.Timeout | null>(null);
  const processingRef = useRef(false);
  const selectedPublishAccountsRef = useRef<PublishAccount[]>([]);
  const activeBuildSessionRef = useRef<ActiveBuildSession | null>(null);
  const buildSyncInFlightRef = useRef(false);

  const [instagramAccounts, setInstagramAccounts] = useState<
    InstagramAccount[]
  >([]);
  const [youtubeAccounts, setYouTubeAccounts] = useState<YouTubeAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [selectedTargetAccountKeys, setSelectedTargetAccountKeys] = useState<
    string[]
  >([]);
  const [showAccountSelector, setShowAccountSelector] = useState(false);
  const [sourceMode, setSourceMode] = useState<
    "youtube" | "file" | "cloudinary"
  >("youtube");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [uploadedSourceUrl, setUploadedSourceUrl] = useState<string | null>(
    null,
  );
  const [cloudinarySourceFolder, setCloudinarySourceFolder] = useState(
    DEFAULT_CLOUDINARY_SOURCE_FOLDER,
  );
  const [cloudinarySourceResources, setCloudinarySourceResources] = useState<
    CloudinarySourceResource[]
  >([]);
  const [selectedCloudinarySource, setSelectedCloudinarySource] =
    useState<CloudinarySourceResource | null>(null);
  const [isLoadingCloudinarySources, setIsLoadingCloudinarySources] =
    useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [segmentDurationSeconds, setSegmentDurationSeconds] = useState(60);
  const [overlapSeconds, setOverlapSeconds] = useState(0);
  const [qualityPreset, setQualityPreset] =
    useState<ShortsQualityPreset>("1080p");
  const [framingMode, setFramingMode] =
    useState<ShortsFramingMode>("show-full");
  const [includeLogoOverlay, setIncludeLogoOverlay] = useState(true);
  const [includeHeadlineOverlay, setIncludeHeadlineOverlay] = useState(true);
  const [includeCopyrightOverlay, setIncludeCopyrightOverlay] = useState(true);
  const [copyrightText, setCopyrightText] = useState(
    DEFAULT_SHORTS_COPYRIGHT_TEXT,
  );
  const [intervalMinutes, setIntervalMinutes] = useState(20);
  const [sourceVideo, setSourceVideo] = useState<ShortsVideoMetadata | null>(
    null,
  );
  const [planPreview, setPlanPreview] = useState<ShortsWindow[]>([]);
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [keywordsDraft, setKeywordsDraft] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [recentUploads, setRecentUploads] = useState<
    Array<{
      id: string;
      title: string;
      uploadedAt: string;
      accountUsername: string;
    }>
  >([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCreatingQueue, setIsCreatingQueue] = useState(false);
  const [isDownloadingSource, setIsDownloadingSource] = useState(false);
  const [queueBuildStatus, setQueueBuildStatus] = useState("");
  const [downloadProgress, setDownloadProgress] =
    useState<SourceDownloadProgressState>({
      phase: "idle",
      percent: 0,
      loadedBytes: 0,
      totalBytes: null,
      status: "",
    });
  const [creationProgress, setCreationProgress] =
    useState<ShortsCreationProgressState>({
      phase: "idle",
      percent: 0,
      total: 0,
      processed: 0,
      saved: 0,
      status: "",
    });
  const [clipProgressMap, setClipProgressMap] = useState<
    Record<number, ClipBuildProgressState>
  >({});
  const [generatedShortPreviews, setGeneratedShortPreviews] = useState<
    Record<number, GeneratedShortPreviewState>
  >({});
  const [publishProgress, setPublishProgress] =
    useState<PublishProgressState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [hasAcknowledgedMobileGuide, setHasAcknowledgedMobileGuide] =
    useState(false);
  const [pendingYouTubeAction, setPendingYouTubeAction] =
    useState<PendingYouTubeAction | null>(null);
  const [youtubeGuideDialogOpen, setYouTubeGuideDialogOpen] = useState(false);
  const [youtubeGuideDialogMode, setYouTubeGuideDialogMode] =
    useState<YouTubeGuideDialogMode>("mobile-guide");
  const [autoGenerateAfterFilePick, setAutoGenerateAfterFilePick] =
    useState(false);

  const allPublishAccounts = useMemo<PublishAccount[]>(
    () => [
      ...instagramAccounts.map((account) => ({
        ...account,
        username: account.username,
        platform: "instagram" as const,
      })),
      ...youtubeAccounts.map((account) => ({
        ...account,
        username: account.username || account.name || "YouTube Account",
        platform: "youtube" as const,
      })),
    ],
    [instagramAccounts, youtubeAccounts],
  );
  const selectedPublishAccounts = useMemo(
    () =>
      allPublishAccounts.filter((account) =>
        selectedTargetAccountKeys.includes(getPublishAccountKey(account)),
      ),
    [allPublishAccounts, selectedTargetAccountKeys],
  );
  const defaultQueueTargets = useMemo(
    () =>
      selectedPublishAccounts.length > 0
        ? buildQueueTargetAccounts(
            selectedPublishAccounts
              .filter(
                (
                  account,
                ): account is PublishAccount & {
                  platform: "instagram";
                } => account.platform === "instagram",
              )
              .map((account) => ({
                id: account.id,
                username: account.username,
                profile_picture_url: account.profile_picture_url,
                token: account.token,
              })),
            selectedPublishAccounts
              .filter(
                (
                  account,
                ): account is PublishAccount & {
                  platform: "youtube";
                } => account.platform === "youtube",
              )
              .map((account) => ({
                id: account.id,
                username: account.username,
                name: account.username,
                thumbnail: account.thumbnail,
                accessToken: account.accessToken,
                refreshToken: account.refreshToken,
                token: account.token,
              })),
          )
        : buildQueueTargetAccounts(instagramAccounts, youtubeAccounts),
    [instagramAccounts, selectedPublishAccounts, youtubeAccounts],
  );

  const queueStats = useMemo(
    () => ({
      total: queue.length,
      uploading: queue.filter((item) => item.status === "uploading").length,
      error: queue.filter((item) => item.status === "error").length,
      queued: queue.filter((item) => item.status === "queued").length,
    }),
    [queue],
  );
  const copyrightPreviewText =
    copyrightText.trim() || DEFAULT_SHORTS_COPYRIGHT_TEXT;
  const autoTargetSummary = useMemo(() => {
    const connectedInstagramCount = allPublishAccounts.filter(
      (account) => account.platform === "instagram",
    ).length;
    const connectedYouTubeCount = allPublishAccounts.filter(
      (account) => account.platform === "youtube",
    ).length;

    return {
      instagram:
        connectedInstagramCount > 0
          ? `${selectedPublishAccounts.filter((account) => account.platform === "instagram").length}/${connectedInstagramCount} selected`
          : "No Instagram account",
      youtube:
        connectedYouTubeCount > 0
          ? `${selectedPublishAccounts.filter((account) => account.platform === "youtube").length}/${connectedYouTubeCount} selected`
          : "No YouTube account",
      total:
        selectedPublishAccounts.length > 0
          ? `${selectedPublishAccounts.length} active targets`
          : "Connect accounts for default targets",
    };
  }, [allPublishAccounts, selectedPublishAccounts]);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearBuildSyncTimer = () => {
    if (buildSyncTimerRef.current) {
      clearTimeout(buildSyncTimerRef.current);
      buildSyncTimerRef.current = null;
    }
  };

  useEffect(() => {
    selectedPublishAccountsRef.current = selectedPublishAccounts;
  }, [selectedPublishAccounts]);

  useEffect(() => {
    setHasAcknowledgedMobileGuide(
      localStorage.getItem(MOBILE_YOUTUBE_GUIDE_KEY) === "1",
    );

    let cancelled = false;

    const applyPersistedState = (accounts: InstagramAccount[]) => {
      const storedState = localStorage.getItem(STORAGE_KEY);

      if (!storedState) {
        setSelectedAccountId(resolvePreferredInstagramAccountId(accounts));
        return;
      }

      try {
        const parsed = JSON.parse(storedState) as PersistedState;
        setQueue(Array.isArray(parsed.queue) ? parsed.queue : []);
        setPlanPreview(Array.isArray(parsed.queue) ? parsed.queue : []);
        setSelectedAccountId(
          resolvePreferredInstagramAccountId(
            accounts,
            parsed.selectedAccountId,
          ),
        );
        setSelectedTargetAccountKeys(
          Array.isArray(parsed.selectedTargetAccountKeys)
            ? parsed.selectedTargetAccountKeys.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        );
        setIntervalMinutes(parsed.intervalMinutes || 20);
        setIsRunning(parsed.isRunning ?? false);
        setNextRunAt(parsed.nextRunAt || null);
        setSourceVideo(parsed.sourceVideo || null);
        setSourceMode(
          parsed.sourceMode === "file" || parsed.sourceMode === "cloudinary"
            ? parsed.sourceMode
            : "youtube",
        );
        setCloudinarySourceFolder(
          parsed.cloudinarySourceFolder || DEFAULT_CLOUDINARY_SOURCE_FOLDER,
        );
        setQualityPreset(parseQualityPreset(parsed.qualityPreset) || "1080p");
        setFramingMode(parseFramingMode(parsed.framingMode) || "show-full");
        setIncludeLogoOverlay(parsed.includeLogoOverlay ?? true);
        setIncludeHeadlineOverlay(parsed.includeHeadlineOverlay ?? true);
        setIncludeCopyrightOverlay(parsed.includeCopyrightOverlay ?? true);
        setCopyrightText(
          parsed.copyrightText?.trim() || DEFAULT_SHORTS_COPYRIGHT_TEXT,
        );
        setRecentUploads(parsed.recentUploads || []);

        if (parsed.sourceVideo) {
          setSourceUrl(parsed.sourceVideo.sourceUrl || "");
          setTitleDraft(parsed.sourceVideo.title || "");
          setDescriptionDraft(parsed.sourceVideo.description || "");
          setKeywordsDraft((parsed.sourceVideo.keywords || []).join(", "));
        }
      } catch (error) {
        console.error("[v0] Failed to restore shorts state:", error);
        setSelectedAccountId(resolvePreferredInstagramAccountId(accounts));
      }
    };

    const hydrateAccounts = async () => {
      const storedInstagramAccounts = readStoredInstagramAccounts(localStorage);
      const storedYouTubeAccounts = readStoredYouTubeAccounts();

      if (cancelled) {
        return;
      }

      setInstagramAccounts(storedInstagramAccounts);
      setYouTubeAccounts(storedYouTubeAccounts);
      applyPersistedState(storedInstagramAccounts);

      const fbAccessToken = getStoredString("fb_access_token");
      if (!fbAccessToken) {
        return;
      }

      try {
        const syncedInstagramAccounts =
          await fetchInstagramAccountsFromFacebook(fbAccessToken);

        if (cancelled || syncedInstagramAccounts.length === 0) {
          return;
        }

        const mergedInstagramAccounts = mergeInstagramAccounts(
          storedInstagramAccounts,
          syncedInstagramAccounts,
        );
        persistInstagramAccounts(mergedInstagramAccounts, localStorage);
        setInstagramAccounts(mergedInstagramAccounts);
      } catch (error) {
        console.warn(
          "[v0] Could not refresh Instagram accounts for shorts page:",
          error,
        );
      }
    };

    void hydrateAccounts();

    const syncAccountsFromStorage = () => {
      if (cancelled) {
        return;
      }

      const nextInstagramAccounts = readStoredInstagramAccounts(localStorage);
      const nextYouTubeAccounts = readStoredYouTubeAccounts();

      setInstagramAccounts((current) =>
        areInstagramAccountsEqual(current, nextInstagramAccounts)
          ? current
          : nextInstagramAccounts,
      );
      setYouTubeAccounts((current) =>
        areYouTubeAccountsEqual(current, nextYouTubeAccounts)
          ? current
          : nextYouTubeAccounts,
      );
    };

    window.addEventListener("focus", syncAccountsFromStorage);
    window.addEventListener("storage", syncAccountsFromStorage);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncAccountsFromStorage);
      window.removeEventListener("storage", syncAccountsFromStorage);
    };
  }, []);

  useEffect(() => {
    if (instagramAccounts.length === 0) {
      if (selectedAccountId !== null) {
        setSelectedAccountId(null);
      }
      return;
    }

    if (
      selectedAccountId &&
      instagramAccounts.some((account) => account.id === selectedAccountId)
    ) {
      return;
    }

    setSelectedAccountId(
      resolvePreferredInstagramAccountId(instagramAccounts, selectedAccountId),
    );
  }, [instagramAccounts]);

  useEffect(() => {
    const validKeys = new Set(
      allPublishAccounts.map((account) => getPublishAccountKey(account)),
    );

    if (validKeys.size === 0) {
      if (selectedTargetAccountKeys.length > 0) {
        setSelectedTargetAccountKeys([]);
      }
      return;
    }

    setSelectedTargetAccountKeys((current) => {
      const filteredCurrent = current.filter((key) => validKeys.has(key));
      if (filteredCurrent.length > 0) {
        return areStringArraysEqual(filteredCurrent, current)
          ? current
          : filteredCurrent;
      }

      const storedKeys = readStoredTargetAccountKeys().filter((key) =>
        validKeys.has(key),
      );
      if (storedKeys.length > 0) {
        return areStringArraysEqual(storedKeys, current) ? current : storedKeys;
      }

      const fallbackKeys = Array.from(validKeys);
      return areStringArraysEqual(fallbackKeys, current)
        ? current
        : fallbackKeys;
    });
  }, [allPublishAccounts, selectedTargetAccountKeys.length]);

  useEffect(() => {
    const state: PersistedState = {
      queue,
      selectedAccountId,
      selectedTargetAccountKeys,
      intervalMinutes,
      deleteAfterPublish: true,
      isRunning,
      nextRunAt,
      sourceVideo,
      sourceMode,
      cloudinarySourceFolder,
      qualityPreset,
      framingMode,
      includeLogoOverlay,
      includeHeadlineOverlay,
      includeCopyrightOverlay,
      copyrightText,
      recentUploads,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [
    intervalMinutes,
    isRunning,
    nextRunAt,
    queue,
    recentUploads,
    selectedAccountId,
    selectedTargetAccountKeys,
    sourceVideo,
    sourceMode,
    cloudinarySourceFolder,
    qualityPreset,
    framingMode,
    includeLogoOverlay,
    includeHeadlineOverlay,
    includeCopyrightOverlay,
    copyrightText,
  ]);

  useEffect(() => {
    localStorage.setItem(
      TARGET_ACCOUNT_SELECTIONS_KEY,
      JSON.stringify(selectedTargetAccountKeys),
    );
  }, [selectedTargetAccountKeys]);

  useEffect(() => {
    if (selectedAccountId) {
      localStorage.setItem(TARGET_ACCOUNT_KEY, selectedAccountId);
      localStorage.setItem("ig_user_id", selectedAccountId);
      return;
    }

    localStorage.removeItem(TARGET_ACCOUNT_KEY);
  }, [selectedAccountId]);

  useEffect(() => {
    return () => {
      clearTimer();
      clearBuildSyncTimer();
    };
  }, []);

  useEffect(() => {
    if (!sourceVideo) {
      return;
    }

    if (sourceMode === "file" && !sourceFile) {
      return;
    }

    const nextPlan = buildShortsPlan({
      durationSeconds: sourceVideo.durationSeconds,
      segmentDurationSeconds,
      overlapSeconds,
    });

    setPlanPreview(nextPlan);
  }, [
    overlapSeconds,
    segmentDurationSeconds,
    sourceFile,
    sourceMode,
    sourceVideo,
  ]);

  useEffect(() => {
    if (
      !autoGenerateAfterFilePick ||
      sourceMode !== "file" ||
      !sourceFile ||
      !sourceVideo
    ) {
      return;
    }

    setAutoGenerateAfterFilePick(false);
    void handleGenerateQueue();
  }, [autoGenerateAfterFilePick, sourceFile, sourceMode, sourceVideo]);

  const openYouTubeGuideDialog = useEffectEvent(
    (
      mode: YouTubeGuideDialogMode,
      pendingAction?: PendingYouTubeAction | null,
    ) => {
      setYouTubeGuideDialogMode(mode);
      setPendingYouTubeAction(pendingAction ?? null);
      setYouTubeGuideDialogOpen(true);
    },
  );

  const rememberMobileGuideAcknowledgement = () => {
    localStorage.setItem(MOBILE_YOUTUBE_GUIDE_KEY, "1");
    setHasAcknowledgedMobileGuide(true);
  };

  const completePendingYouTubeAction = useEffectEvent(() => {
    const nextAction = pendingYouTubeAction;
    setPendingYouTubeAction(null);
    setYouTubeGuideDialogOpen(false);
    rememberMobileGuideAcknowledgement();

    if (nextAction === "analyze") {
      void handleAnalyze();
      return;
    }

    if (nextAction === "generate") {
      void handleGenerateQueue();
    }
  });

  const togglePublishAccount = useEffectEvent((account: PublishAccount) => {
    const targetKey = getPublishAccountKey(account);
    setSelectedTargetAccountKeys((current) =>
      current.includes(targetKey)
        ? current.filter((key) => key !== targetKey)
        : [...current, targetKey],
    );
  });

  const selectAllPublishAccounts = useEffectEvent(() => {
    setSelectedTargetAccountKeys(
      allPublishAccounts.map((account) => getPublishAccountKey(account)),
    );
  });

  const clearSelectedPublishAccounts = useEffectEvent(() => {
    setSelectedTargetAccountKeys([]);
  });

  const persistUpdatedYouTubeAccessToken = useEffectEvent(
    (accountId: string, nextAccessToken: string) => {
      if (!nextAccessToken.trim()) {
        return;
      }

      setYouTubeAccounts((current) =>
        current.map((account) =>
          account.id === accountId
            ? {
                ...account,
                accessToken: nextAccessToken,
                token: nextAccessToken,
              }
            : account,
        ),
      );

      try {
        const parsed = JSON.parse(
          localStorage.getItem("youtube_accounts") || "[]",
        );
        if (!Array.isArray(parsed)) {
          return;
        }

        const nextAccounts = parsed.map((account) =>
          account && typeof account === "object" && account.id === accountId
            ? {
                ...account,
                accessToken: nextAccessToken,
                token: nextAccessToken,
              }
            : account,
        );
        localStorage.setItem("youtube_accounts", JSON.stringify(nextAccounts));
      } catch (error) {
        console.warn("[v0] Failed to persist refreshed YouTube token:", error);
      }
    },
  );

  const publishQueueItemToSelectedAccounts = useEffectEvent(
    async (nextItem: QueueItem) => {
      const activeAccounts = selectedPublishAccountsRef.current;
      if (activeAccounts.length === 0) {
        throw new Error("Pehle kam se kam ek target account select karo.");
      }

      let successCount = 0;
      const publishedOn: string[] = [];
      const youtubeDescription = buildYouTubeDescriptionFromSeoDraft(
        {
          title: nextItem.title,
          description: nextItem.description,
          keywords: nextItem.keywords,
        },
        { isShort: true },
      );
      const youtubeTags = buildYouTubeTagsFromKeywords(nextItem.keywords);

      setPublishProgress({
        itemId: nextItem.id,
        itemTitle: nextItem.title,
        statuses: activeAccounts.map((account) => ({
          accountKey: getPublishAccountKey(account),
          accountLabel:
            account.platform === "instagram"
              ? `IG • @${account.username}`
              : `YT • ${account.username}`,
          status: "pending",
        })),
      });

      for (const account of activeAccounts) {
        const accountKey = getPublishAccountKey(account);

        setPublishProgress((current) =>
          current?.itemId === nextItem.id
            ? {
                ...current,
                statuses: current.statuses.map((statusItem) =>
                  statusItem.accountKey === accountKey
                    ? {
                        ...statusItem,
                        status: "posting",
                        error: undefined,
                      }
                    : statusItem,
                ),
              }
            : current,
        );

        try {
          if (account.platform === "instagram") {
            if (!account.token) {
              throw new Error("Instagram token missing hai.");
            }

            const creationId = await createMedia({
              igUserId: account.id,
              token: account.token,
              mediaUrl: nextItem.assetUrl,
              caption: nextItem.caption,
              isReel: true,
            });

            await publishMedia({
              igUserId: account.id,
              token: account.token,
              creationId,
            });
          } else {
            const response = await fetch("/api/youtube/upload", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                accessToken: account.accessToken || account.token,
                refreshToken: account.refreshToken,
                videoUrl: nextItem.assetUrl,
                title: nextItem.title,
                description: youtubeDescription,
                keywords: youtubeTags,
                privacy: "public",
                isShort: true,
              }),
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(data.error || "YouTube upload failed");
            }

            if (typeof data.accessToken === "string" && data.accessToken) {
              persistUpdatedYouTubeAccessToken(account.id, data.accessToken);
            }
          }

          successCount += 1;
          publishedOn.push(account.username);
          setPublishProgress((current) =>
            current?.itemId === nextItem.id
              ? {
                  ...current,
                  statuses: current.statuses.map((statusItem) =>
                    statusItem.accountKey === accountKey
                      ? {
                          ...statusItem,
                          status: "posted",
                          error: undefined,
                        }
                      : statusItem,
                  ),
                }
              : current,
          );
        } catch (accountError: any) {
          const friendlyError = getFriendlyPublishError(
            accountError?.message || "Publish failed",
            account.platform,
          );
          setPublishProgress((current) =>
            current?.itemId === nextItem.id
              ? {
                  ...current,
                  statuses: current.statuses.map((statusItem) =>
                    statusItem.accountKey === accountKey
                      ? {
                          ...statusItem,
                          status: "error",
                          error: friendlyError,
                        }
                      : statusItem,
                  ),
                }
              : current,
          );
          toast.error(
            `${account.username}: ${friendlyError}`,
          );
        }
      }

      if (successCount === 0) {
        throw new Error("Selected accounts par publish nahi ho paya.");
      }

      return {
        successCount,
        totalTargets: activeAccounts.length,
        publishedOn,
        allSelectedSucceeded: successCount === activeAccounts.length,
      };
    },
  );

  const processNextQueueItem = useEffectEvent(async () => {
    if (processingRef.current || !isRunning) {
      return;
    }

    const activeAccounts = selectedPublishAccountsRef.current;
    if (activeAccounts.length === 0) {
      setIsRunning(false);
      setNextRunAt(null);
      toast.error("Pehle kam se kam ek target account select karo.");
      return;
    }

    const nextItem = queue[0];
    if (!nextItem) {
      setIsRunning(false);
      setNextRunAt(null);
      return;
    }

    clearTimer();
    processingRef.current = true;

    setQueue((prev) =>
      prev.map((item, index) =>
        index === 0 ? { ...item, status: "uploading", error: undefined } : item,
      ),
    );

    try {
      const { successCount, totalTargets, publishedOn, allSelectedSucceeded } =
        await publishQueueItemToSelectedAccounts(nextItem);

      if (
        nextItem.cloudinaryPublicId &&
        nextItem.deleteFromCloudinaryOnRemove !== false &&
        allSelectedSucceeded
      ) {
        await deleteCloudinaryAsset(
          nextItem.cloudinaryPublicId,
          nextItem.cloudinaryResourceType,
        ).catch((error) => {
          console.error("[v0] Failed to delete processed clip:", error);
        });
      }

      let remainingQueue: QueueItem[] = [];
      setQueue((prev) => {
        remainingQueue = prev.filter((item) => item.id !== nextItem.id);
        return remainingQueue;
      });

      setRecentUploads((prev) =>
        [
          {
            id: `${nextItem.id}-${Date.now()}`,
            title: nextItem.title,
            uploadedAt: new Date().toISOString(),
            accountUsername: publishedOn.join(", "),
          },
          ...prev,
        ].slice(0, 8),
      );

      if (remainingQueue.length > 0) {
        const scheduledTime = new Date(
          Date.now() + intervalMinutes * 60 * 1000,
        ).toISOString();
        setNextRunAt(scheduledTime);
        toast.success(
          `1 short ${successCount}/${totalTargets} selected account${totalTargets > 1 ? "s" : ""} par publish ho gaya. Next short ${intervalMinutes} minute baad jayega.`,
        );
      } else {
        setIsRunning(false);
        setNextRunAt(null);
        toast.success(
          "Queue complete ho gayi. Selected accounts par shorts publish ho gaye.",
        );
      }
    } catch (error: any) {
      setQueue((prev) =>
        prev.map((item) =>
          item.id === nextItem.id
            ? {
                ...item,
                status: "error",
                error: error.message || "Upload failed",
              }
            : item,
        ),
      );
      setIsRunning(false);
      setNextRunAt(null);
      toast.error(error.message || "Queue publish fail ho gaya.");
    } finally {
      processingRef.current = false;
    }
  });

  const syncQueueTimer = useEffectEvent(() => {
    clearTimer();

    if (!isRunning || queue.length === 0) {
      return;
    }

    if (!nextRunAt) {
      void processNextQueueItem();
      return;
    }

    const delay = new Date(nextRunAt).getTime() - Date.now();
    if (delay <= 0) {
      void processNextQueueItem();
      return;
    }

    timerRef.current = setTimeout(() => {
      void processNextQueueItem();
    }, delay);
  });

  useEffect(() => {
    syncQueueTimer();
  }, [isRunning, nextRunAt, queue.length, syncQueueTimer]);

  const startQueuePublish = useEffectEvent(() => {
    if (processingRef.current) {
      toast.info("Current publish finish hone do, phir queue start karo.");
      return;
    }

    if (queue.length === 0) {
      toast.error("Pehle queue me kam se kam ek short add karo.");
      return;
    }

    if (selectedPublishAccounts.length === 0) {
      toast.error("Pehle target accounts select karo.");
      return;
    }

    setQueue((current) =>
      current.map((item) =>
        item.status === "error"
          ? { ...item, status: "queued", error: undefined }
          : item,
      ),
    );
    setIsRunning(true);
    setNextRunAt(null);
    toast.success(
      `${queue.length} queued shorts ${selectedPublishAccounts.length} selected account${selectedPublishAccounts.length > 1 ? "s" : ""} ke liye start ho gayi.`,
    );
  });

  const stopQueuePublish = useEffectEvent(() => {
    clearTimer();
    setIsRunning(false);
    setNextRunAt(null);

    if (processingRef.current) {
      toast.info("Current upload finish hote hi queue stop ho jayegi.");
      return;
    }

    toast.info("Direct publish queue stop kar di gayi.");
  });

  const refreshQueueItemMetadata = useEffectEvent((id: string) => {
    const targetItem = queue.find((item) => item.id === id);
    if (!targetItem) {
      return;
    }

    const nextMetadata = buildQueueItemSeoFields(targetItem);
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              ...nextMetadata,
              status: item.status === "error" ? "queued" : item.status,
              error: undefined,
            }
          : item,
      ),
    );
    toast.success("Queue item metadata refresh ho gayi.");
  });

  const publishQueueItemNow = useEffectEvent(async (id: string) => {
    if (isRunning) {
      toast.error(
        "Auto queue live hai. Pehle usse stop karo, phir single short post karo.",
      );
      return;
    }

    if (processingRef.current) {
      toast.info("Ek publish already chal raha hai. Thoda wait karo.");
      return;
    }

    const nextItem = queue.find((item) => item.id === id);
    if (!nextItem) {
      return;
    }

    processingRef.current = true;
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: "uploading", error: undefined }
          : item,
      ),
    );

    try {
      const { successCount, totalTargets, publishedOn, allSelectedSucceeded } =
        await publishQueueItemToSelectedAccounts(nextItem);

      if (
        nextItem.cloudinaryPublicId &&
        nextItem.deleteFromCloudinaryOnRemove !== false &&
        allSelectedSucceeded
      ) {
        await deleteCloudinaryAsset(
          nextItem.cloudinaryPublicId,
          nextItem.cloudinaryResourceType,
        ).catch((error) => {
          console.error("[v0] Failed to delete processed clip:", error);
        });
      }

      setQueue((prev) => prev.filter((item) => item.id !== id));
      setRecentUploads((prev) =>
        [
          {
            id: `${nextItem.id}-${Date.now()}`,
            title: nextItem.title,
            uploadedAt: new Date().toISOString(),
            accountUsername: publishedOn.join(", "),
          },
          ...prev,
        ].slice(0, 8),
      );
      toast.success(
        `${nextItem.partLabel || "Short"} ${successCount}/${totalTargets} selected account${totalTargets > 1 ? "s" : ""} par publish ho gaya.`,
      );
    } catch (error: any) {
      setQueue((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "error",
                error: error.message || "Upload failed",
              }
            : item,
        ),
      );
      toast.error(error.message || "Short publish fail ho gaya.");
    } finally {
      processingRef.current = false;
    }
  });

  const clearSelectedSourceFile = () => {
    setAutoGenerateAfterFilePick(false);
    setUploadedSourceUrl(null);
    setSourceFile(null);
    setSelectedCloudinarySource(null);
    setSourceMode("youtube");
    setSourceVideo(null);
    setPlanPreview([]);
    setSourceUrl("");
    setTitleDraft("");
    setDescriptionDraft("");
    setKeywordsDraft("");
  };

  const applySourceSeoDraft = useEffectEvent(
    ({
      rawName,
      folder,
      descriptionContext,
      extraKeywords = [],
      durationSeconds,
    }: {
      rawName: string;
      folder?: string;
      descriptionContext?: string;
      extraKeywords?: string[];
      durationSeconds?: number;
    }) => {
      const seoDraft = buildSeoDraftForSource({
        rawName,
        folder,
        descriptionContext,
        extraKeywords,
        durationSeconds,
      });

      setTitleDraft(seoDraft.title);
      setDescriptionDraft(seoDraft.description);
      setKeywordsDraft(seoDraft.keywords.join(", "));
    },
  );

  const handleRefreshMetadata = useEffectEvent(() => {
    if (!sourceVideo) {
      toast.error("Pehle source metadata load karo.");
      return;
    }

    applySourceSeoDraft({
      rawName: sourceVideo.title,
      folder:
        selectedCloudinarySource?.folder ||
        (sourceMode === "cloudinary" ? cloudinarySourceFolder : undefined),
      descriptionContext: sourceVideo.description,
      extraKeywords: sourceVideo.keywords,
      durationSeconds: sourceVideo.durationSeconds,
    });

    toast.success("Metadata drafts refresh ho gayi.");
  });

  const handleSourceFileSelected = useEffectEvent(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      event.target.value = "";

      if (!nextFile) {
        return;
      }

      setIsAnalyzing(true);
      setUploadedSourceUrl(null);
      setSelectedCloudinarySource(null);
      setDownloadProgress({
        phase: "idle",
        percent: 0,
        loadedBytes: 0,
        totalBytes: null,
        status: "",
      });
      setCreationProgress({
        phase: "idle",
        percent: 0,
        total: 0,
        processed: 0,
        saved: 0,
        status: "",
      });

      try {
        const durationSeconds = await getVideoDurationFromFile(nextFile);
        if (durationSeconds <= 0) {
          throw new Error("Selected video ka duration read nahi hua.");
        }

        const sourceTitle =
          stripFileExtension(nextFile.name).replace(/[_-]+/g, " ").trim() ||
          "Uploaded Video";
        const sourceDescription = "Device se selected source video.";
        const sourceKeywords = deriveKeywordsFromText(sourceTitle);
        const nextPlan = buildShortsPlan({
          durationSeconds,
          segmentDurationSeconds,
          overlapSeconds,
        });

        setSourceMode("file");
        setSourceFile(nextFile);
        setSourceUrl("");
        setSourceVideo({
          sourceUrl: `uploaded-file:${nextFile.name}`,
          title: sourceTitle,
          description: sourceDescription,
          keywords: sourceKeywords,
          durationSeconds,
          authorName: "Device Upload",
        });
        setPlanPreview(nextPlan);
        applySourceSeoDraft({
          rawName: sourceTitle,
          folder: "device-upload",
          descriptionContext: sourceDescription,
          extraKeywords: sourceKeywords,
          durationSeconds,
        });
        setQueueBuildStatus("");
        setYouTubeGuideDialogOpen(false);
        setPendingYouTubeAction(null);
        toast.success("Video file ready hai. Ab shorts generate kar sakte ho.");
      } catch (error: any) {
        toast.error(error.message || "Video file read nahi hui.");
      } finally {
        setIsAnalyzing(false);
      }
    },
  );

  const addCloudinaryResourcesToQueue = useEffectEvent(
    (resources: CloudinarySourceResource[]) => {
      if (resources.length === 0) {
        toast.error(
          "Queue me add karne ke liye koi Cloudinary video nahi mili.",
        );
        return 0;
      }

      const existingIds = new Set(
        queue
          .map((item) => item.cloudinaryPublicId)
          .filter((value): value is string => Boolean(value)),
      );
      const nextStartIndex =
        queue.reduce((maxIndex, item) => Math.max(maxIndex, item.index), -1) +
        1;
      const nextItems = resources
        .filter((resource) => !existingIds.has(resource.publicId))
        .map((resource, offset) =>
          createQueueItemFromCloudinaryResource({
            resource,
            index: nextStartIndex + offset,
            targetAccounts: defaultQueueTargets,
          }),
        );

      if (nextItems.length === 0) {
        toast.error("Selected Cloudinary videos pehle se queue me hain.");
        return 0;
      }

      setQueue((current) =>
        [...nextItems, ...current].sort(
          (left, right) => left.index - right.index,
        ),
      );
      setQueueBuildStatus(
        `${nextItems.length} Cloudinary video${nextItems.length > 1 ? "s" : ""} seedha queue me add ho gayi.`,
      );
      toast.success(
        `${nextItems.length} Cloudinary video${nextItems.length > 1 ? "s" : ""} queue me add ho gayi.`,
      );

      return nextItems.length;
    },
  );

  const loadCloudinarySources = useEffectEvent(
    async ({
      overrideFolder,
      addToQueue = false,
    }: {
      overrideFolder?: string;
      addToQueue?: boolean;
    } = {}) => {
      const targetFolder =
        overrideFolder?.trim() || cloudinarySourceFolder.trim();

      if (!targetFolder) {
        toast.error("Cloudinary folder dalo.");
        return;
      }

      setIsLoadingCloudinarySources(true);

      try {
        const response = await fetch(
          `/api/cloudinary/videos?folder=${encodeURIComponent(targetFolder)}`,
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Cloudinary videos load nahi hui");
        }

        const resources = Array.isArray(data.resources)
          ? (data.resources as CloudinarySourceResource[])
          : [];

        setCloudinarySourceResources(resources);
        setCloudinarySourceFolder(targetFolder);

        if (resources.length === 0) {
          toast.error("Is folder me koi video nahi mili.");
          return;
        }

        if (addToQueue) {
          addCloudinaryResourcesToQueue(resources);
          return;
        }

        toast.success(`${resources.length} Cloudinary videos mil gayi.`);
      } catch (error: any) {
        toast.error(error.message || "Cloudinary videos load nahi hui.");
      } finally {
        setIsLoadingCloudinarySources(false);
      }
    },
  );

  const handleCloudinarySourceSelected = useEffectEvent(
    (resource: CloudinarySourceResource) => {
      const durationSeconds = Math.max(
        0,
        Math.floor(resource.durationSeconds || 0),
      );

      if (durationSeconds <= 0) {
        toast.error(
          "Selected Cloudinary video ka duration missing hai. Dusri video choose karo.",
        );
        return;
      }

      const metadata = buildCloudinarySourceMetadata(resource);
      const nextPlan = buildShortsPlan({
        durationSeconds,
        segmentDurationSeconds,
        overlapSeconds,
      });

      setAutoGenerateAfterFilePick(false);
      setUploadedSourceUrl(resource.secureUrl);
      setSourceFile(null);
      setSourceMode("cloudinary");
      setSelectedCloudinarySource(resource);
      setSourceUrl(resource.secureUrl);
      setSourceVideo({
        sourceUrl: resource.secureUrl,
        title: metadata.title,
        description: metadata.description,
        keywords: metadata.keywords,
        durationSeconds,
        authorName: resource.folder
          ? `Cloudinary • ${resource.folder}`
          : "Cloudinary",
      });
      setPlanPreview(nextPlan);
      applySourceSeoDraft({
        rawName: metadata.title,
        folder: resource.folder,
        descriptionContext: metadata.description,
        extraKeywords: metadata.keywords,
        durationSeconds,
      });
      setQueueBuildStatus("");
      setYouTubeGuideDialogOpen(false);
      setPendingYouTubeAction(null);
      toast.success("Cloudinary source ready hai. Ab shorts generate karo.");
    },
  );

  const handleAnalyze = useEffectEvent(async () => {
    if (sourceMode === "file" && !sourceFile) {
      toast.error("Pehle video file select karo.");
      return;
    }

    if (sourceMode === "cloudinary" && !sourceVideo) {
      toast.error("Pehle Cloudinary source video select karo.");
      return;
    }

    if (
      (sourceMode === "file" && sourceFile && sourceVideo) ||
      (sourceMode === "cloudinary" && sourceVideo)
    ) {
      const nextPlan = buildShortsPlan({
        durationSeconds: sourceVideo.durationSeconds,
        segmentDurationSeconds,
        overlapSeconds,
      });
      setPlanPreview(nextPlan);
      toast.success(
        sourceMode === "file"
          ? "Selected video file ready hai."
          : "Selected Cloudinary source ready hai.",
      );
      return;
    }

    const normalizedSourceUrl = normalizeYouTubeUrl(sourceUrl);

    if (!normalizedSourceUrl.trim()) {
      toast.error("YouTube long video URL dalo.");
      return;
    }

    if (isMobile && !hasAcknowledgedMobileGuide) {
      setSourceUrl(normalizedSourceUrl);
      openYouTubeGuideDialog("mobile-guide", "analyze");
      return;
    }

    setIsAnalyzing(true);
    setSourceUrl(normalizedSourceUrl);

    try {
      const response = await fetch("/api/youtube/shorts/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: normalizedSourceUrl,
          segmentDurationSeconds,
          overlapSeconds,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Video details fetch failed");
      }

      setSourceVideo(data.video);
      setPlanPreview(data.plan || []);
      setSourceUrl(data.video?.sourceUrl || normalizedSourceUrl);
      applySourceSeoDraft({
        rawName: data.video.title || "",
        descriptionContext: data.video.description || "",
        extraKeywords: data.video.keywords || [],
        durationSeconds: data.video.durationSeconds,
      });
      toast.success("Video details fetch ho gaye.");
    } catch (error: any) {
      if (isYouTubeBotCheckMessage(error?.message)) {
        openYouTubeGuideDialog("bot-check", "analyze");
        return;
      }

      toast.error(error.message || "YouTube video analyze nahi hua.");
    } finally {
      setIsAnalyzing(false);
    }
  });

  const handleDownloadSourceVideo = useEffectEvent(async () => {
    const normalizedSourceUrl = normalizeYouTubeUrl(sourceUrl);

    if (!normalizedSourceUrl.trim()) {
      toast.error("Pehle YouTube source URL dalo.");
      return;
    }

    setIsDownloadingSource(true);
    setQueueBuildStatus(
      "Best available source video browser me download ho rahi hai...",
    );

    try {
      const { blob, contentType } = await downloadSourceVideoBlob(
        normalizedSourceUrl,
        (progress) => {
          setDownloadProgress(progress);
        },
      );
      const file = await buildLocalVideoFile(
        blob,
        sourceVideo?.title || "youtube-source",
        contentType,
      );
      const objectUrl = URL.createObjectURL(file);

      triggerBrowserDownload(objectUrl, file.name);
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1000);

      setQueueBuildStatus("Best available source download complete.");
      toast.success("Source download start ho gaya.");
    } catch (error: any) {
      setDownloadProgress((prev) => ({
        ...prev,
        phase: "error",
        status: error.message || "Source download fail ho gayi.",
      }));
      toast.error(error.message || "Source download fail ho gayi.");
    } finally {
      setIsDownloadingSource(false);
    }
  });

  const syncGeneratedFolderToQueue = useEffectEvent(
    async ({ markComplete = false }: { markComplete?: boolean } = {}) => {
      const session = activeBuildSessionRef.current;
      if (!session?.uploadFolder || buildSyncInFlightRef.current) {
        return 0;
      }
      const uploadFolder = session.uploadFolder;

      buildSyncInFlightRef.current = true;

      try {
        const loadGeneratedQueueItems = async () => {
          const response = await fetch(
            `/api/cloudinary/videos?folder=${encodeURIComponent(uploadFolder)}&maxResults=100`,
          );
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.error || "Generated shorts sync nahi hui.");
          }

          const resources = Array.isArray(data.resources)
            ? (data.resources as CloudinarySourceResource[])
            : [];

          return resources
            .map((resource) =>
              createQueueItemFromGeneratedCloudinaryResource({
                resource,
                session,
                targetAccounts: defaultQueueTargets,
              }),
            )
            .filter((item): item is QueueItem => Boolean(item))
            .sort((left, right) => left.index - right.index);
        };

        let nextItems = await loadGeneratedQueueItems();
        const total = Math.max(session.total, nextItems.length);

        if (markComplete && nextItems.length < total) {
          await new Promise((resolve) => setTimeout(resolve, 900));
          nextItems = await loadGeneratedQueueItems();
        }

        const syncedCount = nextItems.length;
        let addedCount = 0;

        setQueue((prev) => {
          const existingPublicIds = new Set(
            prev.map((item) => item.cloudinaryPublicId || item.id),
          );
          const merged = [...prev];

          nextItems.forEach((item) => {
            if (existingPublicIds.has(item.cloudinaryPublicId || item.id)) {
              return;
            }

            existingPublicIds.add(item.cloudinaryPublicId || item.id);
            merged.push(item);
            addedCount += 1;
          });

          return addedCount > 0
            ? merged.sort((left, right) => left.index - right.index)
            : prev;
        });

        if (nextItems.length > 0) {
          setGeneratedShortPreviews((prev) => {
            const nextPreviewState = { ...prev };

            nextItems.forEach((item) => {
              nextPreviewState[item.index - session.queueStartIndex] = {
                title: item.title,
                description: item.description,
                keywords: item.keywords,
                partLabel: item.partLabel,
              };
            });

            return nextPreviewState;
          });

          setClipProgressMap((prev) => {
            const nextProgressState = { ...prev };

            nextItems.forEach((item) => {
              nextProgressState[item.index - session.queueStartIndex] = {
                progress: 100,
                status: "ready",
              };
            });

            return nextProgressState;
          });
        }

        if (syncedCount > 0) {
          setCreationProgress((prev) => ({
            ...prev,
            phase:
              prev.phase === "error"
                ? prev.phase
                : markComplete
                  ? "complete"
                  : "processing",
            percent:
              total > 0
                ? Math.min(100, Math.round((syncedCount / total) * 100))
                : prev.percent,
            total,
            processed: Math.max(prev.processed, syncedCount),
            saved: Math.max(prev.saved, syncedCount),
            status:
              prev.phase === "error"
                ? prev.status
                : markComplete
                  ? `Sab ${total} shorts ready ho gayi.`
                  : `${syncedCount}/${total} shorts Cloudinary me mil gayi aur queue me sync ho rahi hain.`,
          }));
        }

        if (addedCount > 0 || (markComplete && syncedCount > 0)) {
          setQueueBuildStatus(
            markComplete
              ? `${Math.max(total, syncedCount)} shorts Cloudinary queue me synced hain.`
              : `${syncedCount}/${total} shorts Cloudinary se queue me aa chuki hain.`,
          );
        }

        return addedCount;
      } catch (error) {
        console.error("[v0] Failed to sync generated shorts from Cloudinary:", error);
        return 0;
      } finally {
        buildSyncInFlightRef.current = false;
      }
    },
  );

  const scheduleGeneratedFolderSync = useEffectEvent(
    (delayMs = 15000, options?: { markComplete?: boolean }) => {
      if (!activeBuildSessionRef.current?.uploadFolder) {
        return;
      }

      clearBuildSyncTimer();
      buildSyncTimerRef.current = setTimeout(() => {
        void syncGeneratedFolderToQueue(options);
      }, delayMs);
    },
  );

  const updateOverallCreationProgress = useEffectEvent(
    (total: number, nextClipProgressMap: Record<number, ClipBuildProgressState>) => {
      if (total <= 0) {
        return;
      }

      const progressValues = Array.from({ length: total }, (_, index) => {
        const current = nextClipProgressMap[index];
        return current ? current.progress : 0;
      });
      const averageProgress = Math.round(
        progressValues.reduce((sum, value) => sum + value, 0) / total,
      );
      const readyCount = progressValues.filter((value) => value >= 100).length;

      setCreationProgress((prev) => {
        const nextPhase = prev.phase === "error" ? prev.phase : "processing";
        const nextPercent = Math.min(100, Math.max(prev.percent, averageProgress));
        const nextProcessed = Math.max(prev.processed, readyCount);
        const nextSaved = Math.max(prev.saved, readyCount);

        if (
          prev.phase === nextPhase &&
          prev.percent === nextPercent &&
          prev.total === total &&
          prev.processed === nextProcessed &&
          prev.saved === nextSaved
        ) {
          return prev;
        }

        return {
          ...prev,
          phase: nextPhase,
          percent: nextPercent,
          total,
          processed: nextProcessed,
          saved: nextSaved,
        };
      });
    },
  );

  const setClipBuildProgress = useEffectEvent(
    (
      clipIndex: number,
      progress: number,
      status: ClipBuildProgressState["status"],
    ) => {
      setClipProgressMap((prev) => {
        return {
          ...prev,
          [clipIndex]: {
            progress,
            status,
          },
        };
      });
    },
  );

  const storeGeneratedShortPreview = useEffectEvent(
    (clipIndex: number, item: QueueItem) => {
      setGeneratedShortPreviews((prev) => ({
        ...prev,
        [clipIndex]: {
          title: item.title,
          description: item.description,
          keywords: item.keywords,
          partLabel: item.partLabel,
        },
      }));
    },
  );

  const resetBuildTracking = useEffectEvent(() => {
    setClipProgressMap({});
    setGeneratedShortPreviews({});
  });

  useEffect(() => {
    const total = creationProgress.total || planPreview.length;

    if (creationProgress.phase !== "processing" || total <= 0) {
      return;
    }

    updateOverallCreationProgress(total, clipProgressMap);
  }, [
    clipProgressMap,
    creationProgress.phase,
    creationProgress.total,
    planPreview.length,
  ]);

  const handleGenerateQueue = useEffectEvent(async () => {
    const normalizedSourceUrl = normalizeYouTubeUrl(sourceUrl);
    const sourceKeywords =
      parseKeywords(keywordsDraft).length > 0
        ? parseKeywords(keywordsDraft)
        : sourceVideo?.keywords || [];
    const baseSourceTitle =
      titleDraft.trim() ||
      sourceVideo?.title ||
      selectedCloudinarySource?.originalFilename ||
      sourceFile?.name ||
      "YouTube Video";
    const baseSourceDescription =
      descriptionDraft.trim() || sourceVideo?.description || "";
    const isFileSource =
      sourceMode === "file" && Boolean(sourceFile && sourceVideo);
    const cloudinarySourceUrl =
      selectedCloudinarySource?.secureUrl || sourceVideo?.sourceUrl || "";
    const isCloudinarySource =
      sourceMode === "cloudinary" &&
      Boolean(sourceVideo && cloudinarySourceUrl);
    const expectedShortCount = planPreview.length;
    const renderSettings = {
      framingMode,
      qualityPreset,
      includeLogoOverlay,
      includeHeadlineOverlay,
      includeCopyrightOverlay,
      copyrightText: copyrightText.trim() || DEFAULT_SHORTS_COPYRIGHT_TEXT,
    };
    const renderSummaryLabel =
      qualityPreset === "auto" ? "Auto up to 4K" : qualityPreset;
    const queueStartIndex =
      queue.reduce((maxIndex, item) => Math.max(maxIndex, item.index), -1) + 1;

    if (sourceMode === "cloudinary" && !isCloudinarySource) {
      toast.error("Pehle Cloudinary source video select karo.");
      return;
    }

    if (!isFileSource && !isCloudinarySource && !normalizedSourceUrl.trim()) {
      toast.error("YouTube URL missing hai.");
      return;
    }

    if (
      !isFileSource &&
      !isCloudinarySource &&
      isMobile &&
      !hasAcknowledgedMobileGuide
    ) {
      setSourceUrl(normalizedSourceUrl);
      openYouTubeGuideDialog("mobile-guide", "generate");
      return;
    }

    setIsCreatingQueue(true);
    clearBuildSyncTimer();
    resetBuildTracking();
    setPublishProgress(null);
    activeBuildSessionRef.current = {
      uploadFolder: null,
      queueStartIndex,
      total: expectedShortCount,
      renderWidth: 0,
      renderHeight: 0,
      renderLabel: renderSummaryLabel,
      framingMode: renderSettings.framingMode,
      hasLogoOverlay: renderSettings.includeLogoOverlay,
      sourceUrl:
        sourceVideo?.sourceUrl ||
        cloudinarySourceUrl ||
        normalizedSourceUrl ||
        "",
      sourceTitle: baseSourceTitle,
      sourceDescription: baseSourceDescription,
      sourceKeywords,
    };
    setQueueBuildStatus(
      isFileSource
        ? `Selected file se ${renderSummaryLabel} shorts create ho rahi hain...`
        : isCloudinarySource
          ? `Cloudinary source se ${renderSummaryLabel} shorts create ho rahi hain...`
          : `Server par ${renderSummaryLabel} shorts prepare ho rahi hain...`,
    );
    setDownloadProgress({
      phase: "preparing",
      percent: 0,
      loadedBytes: 0,
      totalBytes: null,
      status: isFileSource
        ? "Selected file source prepare ho rahi hai..."
        : isCloudinarySource
          ? "Cloudinary source prepare ho rahi hai..."
          : "YouTube source best available quality me prepare ho rahi hai...",
    });
    setCreationProgress({
      phase: "processing",
      percent: 0,
      total: expectedShortCount,
      processed: 0,
      saved: 0,
      status:
        expectedShortCount > 0
          ? `${expectedShortCount} planned shorts ke liye ${renderSummaryLabel} render start ho raha hai...`
          : "Metadata ka wait ho raha hai...",
    });
    if (expectedShortCount > 0) {
      setClipProgressMap(
        Object.fromEntries(
          Array.from({ length: expectedShortCount }, (_, index) => [
            index,
            {
              progress: 0,
              status: "pending",
            } satisfies ClipBuildProgressState,
          ]),
        ),
      );
    }
    setSourceUrl(
      isCloudinarySource ? cloudinarySourceUrl : normalizedSourceUrl,
    );

    try {
      let streamedCount = 0;
      let latestVideo = sourceVideo;
      let uploadedSourceUrlForQueue = isCloudinarySource
        ? cloudinarySourceUrl
        : uploadedSourceUrl;

      if (isFileSource && !uploadedSourceUrlForQueue) {
        setQueueBuildStatus("Selected file secure upload ho rahi hai...");
        setDownloadProgress({
          phase: "downloading",
          percent: 0,
          loadedBytes: 0,
          totalBytes: null,
          status: "Selected file secure upload start ho rahi hai...",
        });

        uploadedSourceUrlForQueue = await uploadMediaToBlob(
          sourceFile as File,
          (percent) => {
            setDownloadProgress({
              phase: percent >= 100 ? "preparing" : "downloading",
              percent,
              loadedBytes: 0,
              totalBytes: null,
              status:
                percent >= 100
                  ? "Source file upload complete. Server shorts bana raha hai..."
                  : `Selected file secure upload ho rahi hai... ${percent}%`,
            });
          },
        );

        setUploadedSourceUrl(uploadedSourceUrlForQueue);
        if (activeBuildSessionRef.current) {
          activeBuildSessionRef.current.sourceUrl =
            uploadedSourceUrlForQueue || activeBuildSessionRef.current.sourceUrl;
        }
        setQueueBuildStatus(
          "Uploaded source file server par shorts me convert ho rahi hai...",
        );
      }

      const response =
        isFileSource || isCloudinarySource
          ? await (async () => {
              const formData = new FormData();
              formData.append("sourceUrl", uploadedSourceUrlForQueue || "");
              formData.append(
                "fileName",
                isCloudinarySource
                  ? selectedCloudinarySource?.originalFilename ||
                      getRemoteFileNameFromUrl(cloudinarySourceUrl)
                  : sourceFile?.name || "uploaded-video.mp4",
              );
              formData.append(
                "contentType",
                isCloudinarySource
                  ? getRemoteContentType(
                      selectedCloudinarySource?.format,
                      cloudinarySourceUrl,
                    )
                  : sourceFile?.type || "video/mp4",
              );
              formData.append(
                "durationSeconds",
                String(sourceVideo?.durationSeconds || 0),
              );
              formData.append(
                "segmentDurationSeconds",
                String(segmentDurationSeconds),
              );
              formData.append("overlapSeconds", String(overlapSeconds));
              formData.append("title", titleDraft);
              formData.append("description", descriptionDraft);
              formData.append(
                "keywords",
                JSON.stringify(parseKeywords(keywordsDraft)),
              );
              formData.append("framingMode", renderSettings.framingMode);
              formData.append("qualityPreset", renderSettings.qualityPreset);
              formData.append(
                "includeLogoOverlay",
                String(renderSettings.includeLogoOverlay),
              );
              formData.append(
                "includeHeadlineOverlay",
                String(renderSettings.includeHeadlineOverlay),
              );
              formData.append(
                "includeCopyrightOverlay",
                String(renderSettings.includeCopyrightOverlay),
              );
              formData.append("copyrightText", renderSettings.copyrightText);

              return fetch("/api/youtube/shorts/create-upload-stream", {
                method: "POST",
                body: formData,
              });
            })()
          : await fetch("/api/youtube/shorts/create-stream", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                url: normalizedSourceUrl,
                segmentDurationSeconds,
                overlapSeconds,
                title: titleDraft,
                description: descriptionDraft,
                keywords: parseKeywords(keywordsDraft),
                ...renderSettings,
              }),
            });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Shorts queue create nahi hui");
      }

      await readShortsCreateStream(response, async (event) => {
        if (event.type === "error") {
          throw new Error(event.error || "Shorts queue create nahi hui");
        }

        if (event.type === "ready") {
          latestVideo = event.video;
          const total = event.plan?.length || expectedShortCount;
          if (activeBuildSessionRef.current) {
            activeBuildSessionRef.current = {
              ...activeBuildSessionRef.current,
              uploadFolder:
                event.uploadFolder || activeBuildSessionRef.current.uploadFolder,
              total,
              renderWidth: event.renderWidth || 0,
              renderHeight: event.renderHeight || 0,
              renderLabel: event.renderLabel || renderSummaryLabel,
              framingMode:
                event.framingMode || activeBuildSessionRef.current.framingMode,
              hasLogoOverlay:
                event.hasLogoOverlay ??
                activeBuildSessionRef.current.hasLogoOverlay,
              sourceUrl:
                event.video?.sourceUrl ||
                activeBuildSessionRef.current.sourceUrl,
              sourceTitle:
                event.video?.title || activeBuildSessionRef.current.sourceTitle,
              sourceDescription:
                event.video?.description ||
                activeBuildSessionRef.current.sourceDescription,
              sourceKeywords:
                event.video?.keywords?.length
                  ? event.video.keywords
                  : activeBuildSessionRef.current.sourceKeywords,
            };
          }

          setSourceVideo(event.video);
          setPlanPreview(event.plan || []);
          setSourceUrl(
            isFileSource || isCloudinarySource
              ? ""
              : event.video?.sourceUrl || normalizedSourceUrl,
          );
          setDownloadProgress({
            phase: "complete",
            percent: 100,
            loadedBytes: 0,
            totalBytes: null,
            status: isFileSource
              ? "Selected file upload complete. HQ render start ho gaya."
              : isCloudinarySource
                ? "Cloudinary source ready. HQ render start ho gaya."
                : "YouTube source ready. HQ render start ho gaya.",
          });
          setCreationProgress({
            phase: "processing",
            percent: 0,
            total,
            processed: streamedCount,
            saved: streamedCount,
            status:
              total > 0
                ? `0/${total} shorts create hui hain. ${event.renderLabel || renderSummaryLabel} render chal raha hai.`
                : `${event.renderLabel || renderSummaryLabel} render start ho gaya.`,
          });
          if (event.plan?.length) {
            const previewVideo = event.video || latestVideo;
            const previewTitle = previewVideo?.title || baseSourceTitle || "YouTube Video";
            const previewDescription =
              previewVideo?.description || baseSourceDescription;
            const previewKeywords =
              previewVideo?.keywords?.length
                ? previewVideo.keywords
                : sourceKeywords;

            setGeneratedShortPreviews(
              Object.fromEntries(
                event.plan.map((segment, index) => [
                  index,
                  buildGeneratedShortCopy({
                    originalTitle: previewTitle,
                    originalDescription: previewDescription,
                    originalKeywords: previewKeywords,
                    segment,
                    totalSegments: total,
                  }),
                ]),
              ),
            );
          }
          setClipProgressMap(
            Object.fromEntries(
              Array.from({ length: total }, (_, index) => [
                index,
                {
                  progress: 0,
                  status: index === 0 ? "processing" : "pending",
                } satisfies ClipBuildProgressState,
              ]),
            ),
          );
          setQueueBuildStatus(
            total > 0
              ? `${total} shorts ${event.renderLabel || renderSummaryLabel} me process ho rahi hain.`
              : "Shorts process me hain.",
          );
          scheduleGeneratedFolderSync(15000);
          return;
        }

        if (event.type === "clip-progress") {
          const total = event.total || expectedShortCount || 0;
          const clipIndex = Math.max(0, event.clipIndex - 1);
          const nextProgress = Math.max(
            0,
            Math.min(100, Math.round(event.progress)),
          );

          setClipBuildProgress(
            clipIndex,
            nextProgress,
            nextProgress >= 100 ? "ready" : "processing",
          );
          setCreationProgress((prev) => ({
            ...prev,
            phase: prev.phase === "error" ? prev.phase : "processing",
            total,
            status:
              total > 0
                ? `${prev.saved}/${total} ready • Short ${clipIndex + 1}/${total} ${
                    event.stage === "upload" ? "upload" : "render"
                  } ${nextProgress}%`
                : `Short ${clipIndex + 1} ${
                    event.stage === "upload" ? "upload" : "render"
                  } ${nextProgress}%`,
          }));
          scheduleGeneratedFolderSync(
            event.stage === "upload" && nextProgress >= 97 ? 2500 : 15000,
          );
          return;
        }

        if (event.type === "clip") {
          const streamVideo = event.video || latestVideo;
          const completedCount =
            event.index || Math.max(streamedCount, event.item.index + 1);
          const nextItem: QueueItem = {
            ...event.item,
            id: event.item.cloudinaryPublicId || event.item.id,
            index: queueStartIndex + event.item.index,
            sourceUrl: streamVideo?.sourceUrl || normalizedSourceUrl,
            sourceTitle: streamVideo?.title || titleDraft || "YouTube Video",
            status: "queued",
            createdAt: new Date().toISOString(),
            targetAccounts: defaultQueueTargets,
            deleteFromCloudinaryOnRemove: true,
          };
          const total = event.total || expectedShortCount || completedCount;

          latestVideo = streamVideo || latestVideo;
          streamedCount = completedCount;
          storeGeneratedShortPreview(event.item.index, nextItem);
          setClipBuildProgress(event.item.index, 100, "ready");
          setQueue((prev) =>
            prev.some(
              (item) =>
                item.cloudinaryPublicId === nextItem.cloudinaryPublicId ||
                item.id === nextItem.id,
            )
              ? prev
              : [...prev, nextItem].sort(
                  (left, right) => left.index - right.index,
                ),
          );
          setCreationProgress({
            phase: "processing",
            percent: Math.min(
              100,
              Math.round((completedCount / Math.max(total, 1)) * 100),
            ),
            total,
            processed: completedCount,
            saved: completedCount,
            status: `${completedCount}/${total} shorts create ho chuki hain aur metadata ke saath queue me ready hain.`,
          });
          setQueueBuildStatus(
            `Part ${event.item.index + 1}/${total} ready hai. Queue live update ho rahi hai.`,
          );
          if (completedCount < total) {
            setClipBuildProgress(
              event.item.index + 1,
              0,
              "processing",
            );
            scheduleGeneratedFolderSync(15000);
          } else {
            clearBuildSyncTimer();
          }
          return;
        }

        if (event.type === "complete") {
          latestVideo = event.video || latestVideo;
          const total = event.count || streamedCount || expectedShortCount;
          if (activeBuildSessionRef.current) {
            activeBuildSessionRef.current = {
              ...activeBuildSessionRef.current,
              uploadFolder:
                event.uploadFolder || activeBuildSessionRef.current.uploadFolder,
              total,
              sourceUrl:
                event.video?.sourceUrl ||
                activeBuildSessionRef.current.sourceUrl,
              sourceTitle:
                event.video?.title || activeBuildSessionRef.current.sourceTitle,
              sourceDescription:
                event.video?.description ||
                activeBuildSessionRef.current.sourceDescription,
              sourceKeywords:
                event.video?.keywords?.length
                  ? event.video.keywords
                  : activeBuildSessionRef.current.sourceKeywords,
            };
          }

          if (event.video) {
            setSourceVideo(event.video);
            setSourceUrl(
              isFileSource || isCloudinarySource
                ? ""
                : event.video.sourceUrl || normalizedSourceUrl,
            );
          }

          setDownloadProgress({
            phase: "complete",
            percent: 100,
            loadedBytes: 0,
            totalBytes: null,
            status: isFileSource
              ? "Selected source file process complete."
              : isCloudinarySource
                ? "Cloudinary source process complete."
                : "Source video HQ prepare complete.",
          });
          if (streamedCount < total) {
            await syncGeneratedFolderToQueue({ markComplete: true });
          }
          setClipProgressMap((prev) =>
            Object.fromEntries(
              Array.from({ length: total }, (_, index) => [
                index,
                {
                  progress: 100,
                  status: "ready",
                } satisfies ClipBuildProgressState,
              ]),
            ),
          );
          setCreationProgress({
            phase: "complete",
            percent: 100,
            total,
            processed: total,
            saved: total,
            status: `Sab ${total} shorts ready ho gayi.`,
          });
          setQueueBuildStatus("High-quality shorts ready hain aur queue synced hai.");
          toast.success(`${total} shorts queue me add ho gayi.`);
        }
      });
    } catch (error: any) {
      setDownloadProgress((prev) => ({
        ...prev,
        phase: "error",
        status: error.message || "Source video download fail ho gaya.",
      }));
      setCreationProgress((prev) => ({
        ...prev,
        phase: "error",
        total: prev.total || expectedShortCount,
        status: isYouTubeBotCheckMessage(error?.message)
          ? getFriendlyBotCheckStatus()
          : error.message || "Shorts creation fail ho gayi.",
      }));
      setClipProgressMap((prev) => {
        const nextProgressMap = { ...prev };
        const targetEntry = Object.entries(nextProgressMap).find(
          ([, value]) => value.status === "processing" || value.status === "pending",
        );

        if (targetEntry) {
          nextProgressMap[Number(targetEntry[0])] = {
            ...targetEntry[1],
            status: "error",
          };
        }

        return nextProgressMap;
      });

      if (isYouTubeBotCheckMessage(error?.message)) {
        setDownloadProgress((prev) => ({
          ...prev,
          phase: "error",
          status: getFriendlyBotCheckStatus(),
        }));
        setQueueBuildStatus(getFriendlyBotCheckStatus());
        openYouTubeGuideDialog("bot-check", "generate");
        return;
      }

      setQueueBuildStatus(error.message || "Queue create nahi hui.");
      toast.error(error.message || "Queue create nahi hui.");
    } finally {
      clearBuildSyncTimer();
      activeBuildSessionRef.current = null;
      setIsCreatingQueue(false);
    }
  });

  const handleClearQueue = async () => {
    if (processingRef.current) {
      toast.error("Current upload complete hone do, phir queue clear karo.");
      return;
    }

    const removableItems = [...queue];
    clearTimer();
    setIsRunning(false);
    setNextRunAt(null);
    setQueue([]);

    await Promise.allSettled(
      removableItems.map((item) => cleanupQueuedAsset(item)),
    );
    toast.success("Queue clear ho gayi.");
  };

  const updateQueueItem = (
    id: string,
    changes: Partial<
      Pick<QueueItem, "title" | "description" | "caption" | "keywords">
    >,
  ) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  };

  const removeQueueItem = async (id: string) => {
    const targetItem = queue.find((item) => item.id === id);
    if (targetItem?.status === "uploading") {
      toast.error("Current uploading short ko abhi remove nahi kar sakte.");
      return;
    }

    setQueue((prev) => prev.filter((item) => item.id !== id));

    if (targetItem) {
      await cleanupQueuedAsset(targetItem);
    }
  };

  const downloadQueueItem = (item: QueueItem) => {
    const downloadUrl =
      buildCloudinaryVideoDownloadUrl(item.cloudinaryPublicId) || item.assetUrl;
    const fileName = `${sanitizeFileName(item.title || item.id) || item.id}.mp4`;

    triggerBrowserDownload(downloadUrl, fileName);
  };

  const showBuildProgress =
    isCreatingQueue ||
    downloadProgress.phase !== "idle" ||
    creationProgress.phase !== "idle" ||
    Boolean(publishProgress);
  const sourceTransferPercent =
    downloadProgress.phase === "idle"
      ? 0
      : Math.max(0, Math.min(100, Math.round(downloadProgress.percent)));
  const plannedShortsCount = creationProgress.total || planPreview.length;
  const createdShortsCount = creationProgress.saved;
  const remainingShortsCount = Math.max(
    0,
    plannedShortsCount - createdShortsCount,
  );
  const perShortBuildProgress = useMemo(() => {
    if (plannedShortsCount <= 0) {
      return [];
    }

    return Array.from({ length: plannedShortsCount }, (_, index) => {
      const segment = planPreview[index];
      const currentProgress = clipProgressMap[index];
      const preview = generatedShortPreviews[index];
      const status: PerShortBuildStatus =
        currentProgress?.status ||
        (creationProgress.phase === "complete" ? "ready" : "pending");

      return {
        id: segment?.id || `build-short-${index + 1}`,
        title: preview?.title || `Short ${index + 1}`,
        label: segment?.label || `Part ${index + 1}`,
        status,
        progress:
          creationProgress.phase === "complete"
            ? 100
            : Math.max(
                0,
                Math.min(
                  100,
                  currentProgress?.progress ||
                    (status === "ready" ? 100 : 0),
                ),
              ),
        description: preview?.description || "",
        keywords: preview?.keywords || [],
        partLabel: preview?.partLabel || `Part ${index + 1}`,
      };
    });
  }, [
    clipProgressMap,
    creationProgress.phase,
    generatedShortPreviews,
    planPreview,
    plannedShortsCount,
  ]);
  const selectedInstagramCount = selectedPublishAccounts.filter(
    (account) => account.platform === "instagram",
  ).length;
  const selectedYouTubeCount = selectedPublishAccounts.filter(
    (account) => account.platform === "youtube",
  ).length;
  const allTargetsSelected =
    allPublishAccounts.length > 0 &&
    selectedTargetAccountKeys.length === allPublishAccounts.length;
  const nextRunLabel = nextRunAt
    ? formatDateTime(nextRunAt)
    : "Starts immediately";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#155e75_0%,#0f172a_26%,#111827_58%,#020617_100%)] text-white">
      <Dialog
        open={youtubeGuideDialogOpen}
        onOpenChange={setYouTubeGuideDialogOpen}
      >
        <DialogContent className="max-w-[calc(100%-1.5rem)] border-violet-300/20 bg-[#120622] p-0 text-white sm:max-w-lg">
          <div className="rounded-3xl bg-[radial-gradient(circle_at_top,#4c1d95_0%,#1d0f35_48%,#0b0617_100%)] p-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl text-white">
                <AlertCircle className="h-5 w-5 text-amber-300" />
                {youtubeGuideDialogMode === "mobile-guide"
                  ? "Mobile Confirm Required"
                  : "YouTube Confirmation Needed"}
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-white/70">
                {youtubeGuideDialogMode === "mobile-guide"
                  ? "Mobile/shared links auto-normalize ho jayenge. Agar YouTube block kare to direct phone video file se bhi shorts bana sakte ho."
                  : "Is video par YouTube ne extra verification maangi hai. Raw error ki jagah yahan clean steps aur direct file fallback diya gaya hai."}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 rounded-2xl border border-violet-300/15 bg-white/5 p-4 text-sm text-white/80">
              <p className="font-medium text-white">
                {youtubeGuideDialogMode === "mobile-guide"
                  ? "Continue ke baad ye hoga:"
                  : "Next step ye rakho:"}
              </p>
              <div className="mt-3 space-y-2">
                <p>
                  1. Link ko app automatically normal YouTube watch URL me clean
                  karega.
                </p>
                <p>
                  2. Agar YouTube allow kare to shorts normally create ho
                  jayengi.
                </p>
                <p>
                  3. Agar block repeat ho to direct phone se video file select
                  karke secure upload ke through bina cookies ke bhi continue
                  kar sakte ho.
                </p>
                <p>
                  4. Agar fir bhi URL mode hi use karna hai to desktop/browser
                  cookies ko
                  <span className="mx-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-violet-100">
                    YOUTUBE_COOKIES_FILE
                  </span>
                  ya
                  <span className="mx-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-violet-100">
                    YOUTUBE_COOKIES_BASE64
                  </span>
                  me set karna padega.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-400/10 p-4 text-xs leading-6 text-amber-100">
              Mobile par direct cookie setup possible nahi hota. Agar same video
              baar-baar block ho to ek baar desktop browser se YouTube login
              karke cookies export karni padengi.
            </div>

            <DialogFooter className="mt-6">
              {youtubeGuideDialogMode === "mobile-guide" ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingYouTubeAction(null);
                      setYouTubeGuideDialogOpen(false);
                    }}
                    className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <label
                    htmlFor={SOURCE_FILE_INPUT_ID}
                    onClick={() => {
                      setAutoGenerateAfterFilePick(
                        pendingYouTubeAction === "generate",
                      );
                      rememberMobileGuideAcknowledgement();
                      setSourceMode("file");
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-violet-300/20 bg-white/5 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
                  >
                    <Upload className="h-4 w-4" />
                    Use Video File
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      completePendingYouTubeAction();
                    }}
                    className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Continue
                  </button>
                </>
              ) : (
                <>
                  <label
                    htmlFor={SOURCE_FILE_INPUT_ID}
                    onClick={() => {
                      setAutoGenerateAfterFilePick(
                        pendingYouTubeAction === "generate",
                      );
                      rememberMobileGuideAcknowledgement();
                      setSourceMode("file");
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-violet-300/20 bg-white/5 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
                  >
                    <Upload className="h-4 w-4" />
                    Select Video File
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      rememberMobileGuideAcknowledgement();
                      setYouTubeGuideDialogOpen(false);
                      setPendingYouTubeAction(null);
                    }}
                    className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    Theek Hai
                  </button>
                </>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-2xl p-2 transition-colors hover:bg-white/10"
            >
              <ArrowLeft className="h-5 w-5 text-white/70" />
            </button>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-emerald-400 shadow-lg shadow-cyan-950/30">
              <Scissors className="h-7 w-7 text-white" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">
                YouTube to Cloudinary
              </p>
              <h1 className="text-2xl font-semibold">Shorts Creation Studio</h1>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <div className="rounded-2xl border border-cyan-300/15 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
              Output folder: {SHORTS_LIBRARY_ROOT}
            </div>
            <button
              onClick={() =>
                router.push(
                  `/bulk-upload?source=cloudinary&folder=${encodeURIComponent(SHORTS_LIBRARY_ROOT)}`,
                )
              }
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90 sm:w-auto"
            >
              <Upload className="h-4 w-4" />
              Open Bulk Upload
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-slate-950/45 p-5 backdrop-blur">
            <div className="text-3xl font-semibold text-white">
              {queueStats.total}
            </div>
            <p className="mt-2 text-sm text-white/55">Shorts in queue</p>
          </div>
          <div className="rounded-3xl border border-cyan-300/20 bg-cyan-400/10 p-5 backdrop-blur">
            <div className="text-3xl font-semibold text-cyan-100">
              {selectedPublishAccounts.length}
            </div>
            <p className="mt-2 text-sm text-cyan-100/80">Selected targets</p>
          </div>
          <div className="rounded-3xl border border-emerald-300/20 bg-emerald-500/10 p-5 backdrop-blur">
            <div className="text-3xl font-semibold text-emerald-100">
              {planPreview.length}
            </div>
            <p className="mt-2 text-sm text-emerald-100/80">Planned clips</p>
          </div>
          <div className="rounded-3xl border border-sky-300/20 bg-sky-500/10 p-5 backdrop-blur">
            <div className="text-lg font-semibold text-sky-100">
              {isRunning
                ? "Running"
                : queueStats.uploading > 0
                  ? "Posting"
                  : "Idle"}
            </div>
            <p className="mt-2 text-sm text-sky-100/80">
              {isRunning || queueStats.uploading > 0
                ? `Next: ${nextRunLabel}`
                : "Direct publish status"}
            </p>
          </div>
        </div>

        <section className="mb-6 rounded-3xl border border-white/10 bg-slate-950/45 p-5 shadow-[0_20px_50px_rgba(8,145,178,0.12)] backdrop-blur-xl">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.28em] text-fuchsia-200/70">
                Direct Publish
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                Queue se isi page par Insta + YouTube upload chalao
              </h2>
              <p className="mt-2 text-sm text-white/55">
                Global target selection yahin rahegi. Har post card par accounts
                repeat nahi honge. Select/deselect karo, phir queue ko direct
                publish chala do. Bulk-upload optional fallback ke liye
                available rahega.
              </p>
            </div>

            <div className="grid gap-2 rounded-2xl border border-violet-300/15 bg-violet-500/10 px-4 py-3 text-sm text-violet-100 sm:min-w-[320px]">
              <span>IG selected: {selectedInstagramCount}</span>
              <span>YT selected: {selectedYouTubeCount}</span>
              <span>{autoTargetSummary.total}</span>
              <span>
                {isRunning
                  ? `Queue live. Next run ${nextRunLabel}`
                  : queue.length > 0
                    ? `${queue.length} clips ready for direct publish`
                    : "Queue create karo, phir yahin se publish karo"}
              </span>
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-3xl border border-white/10 bg-slate-950/35 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.22em] text-cyan-200/70">
                    Target Accounts
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-white">
                    Select / Deselect once
                  </h3>
                </div>
                <button
                  onClick={() => setShowAccountSelector((current) => !current)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-cyan-200 transition-colors hover:bg-white/10"
                >
                  {showAccountSelector ? "Hide" : "Manage"}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    allTargetsSelected
                      ? clearSelectedPublishAccounts()
                      : selectAllPublishAccounts()
                  }
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/10"
                >
                  {allTargetsSelected ? "Clear All" : "Select All"}
                </button>
                <button
                  onClick={clearSelectedPublishAccounts}
                  disabled={selectedTargetAccountKeys.length === 0}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  Deselect All
                </button>
              </div>

              {showAccountSelector ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {allPublishAccounts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-white/55">
                      Connected Instagram ya YouTube account abhi nahi mila.
                    </div>
                  ) : (
                    allPublishAccounts.map((account) => {
                      const accountKey = getPublishAccountKey(account);
                      const isSelected =
                        selectedTargetAccountKeys.includes(accountKey);

                      return (
                        <button
                          key={accountKey}
                          onClick={() => togglePublishAccount(account)}
                          className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                            isSelected
                              ? "border-cyan-400/30 bg-cyan-400/10"
                              : "border-white/10 bg-black/20 hover:bg-white/5"
                          }`}
                        >
                          {account.platform === "instagram" ? (
                            <Instagram className="h-5 w-5 text-pink-400" />
                          ) : (
                            <Youtube className="h-5 w-5 text-red-400" />
                          )}
                          <div className="flex-1">
                            <p className="font-medium text-white">
                              {account.username}
                            </p>
                            <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                              {account.platform}
                            </p>
                          </div>
                          {isSelected ? (
                            <CheckCircle2 className="h-4 w-4 text-cyan-300" />
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedPublishAccounts.length > 0 ? (
                    selectedPublishAccounts.map((account) => (
                      <span
                        key={getPublishAccountKey(account)}
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
                          account.platform === "instagram"
                            ? "border border-pink-300/20 bg-pink-500/10 text-pink-100"
                            : "border border-red-300/20 bg-red-500/10 text-red-100"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {account.username}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-white/55">
                      Abhi koi target selected nahi hai.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-950/35 p-4">
              <div className="mb-4">
                <p className="text-sm uppercase tracking-[0.22em] text-emerald-200/70">
                  Queue Publish
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">
                  Direct upload controls
                </h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/45">
                    Gap Minutes
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    value={intervalMinutes}
                    onChange={(event) =>
                      setIntervalMinutes(
                        Math.max(
                          0,
                          Math.min(
                            180,
                            Number.parseInt(event.target.value, 10) || 0,
                          ),
                        ),
                      )
                    }
                    className="mt-3 w-full bg-transparent text-2xl font-semibold text-white outline-none"
                  />
                </label>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/45">
                    Queue Status
                  </div>
                  <div className="mt-3 text-lg font-semibold text-white">
                    {isRunning
                      ? "Running"
                      : queueStats.uploading > 0
                        ? "Uploading now"
                        : "Ready"}
                  </div>
                  <p className="mt-2 text-sm text-white/55">
                    {isRunning || queueStats.uploading > 0
                      ? `Next run: ${nextRunLabel}`
                      : "Start karo to queue isi page se post hogi."}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                {isRunning ? (
                  <button
                    onClick={stopQueuePublish}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                  >
                    <PauseCircle className="h-4 w-4" />
                    Stop Queue
                  </button>
                ) : (
                  <button
                    onClick={startQueuePublish}
                    disabled={
                      queue.length === 0 || selectedPublishAccounts.length === 0
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 via-cyan-500 to-sky-500 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <PlayCircle className="h-4 w-4" />
                    Post Queue Now
                  </button>
                )}
                <button
                  onClick={handleClearQueue}
                  disabled={queue.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear Queue
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-emerald-300/15 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                {selectedPublishAccounts.length > 0
                  ? `Queue ka har short ${selectedPublishAccounts.length} selected account${selectedPublishAccounts.length > 1 ? "s" : ""} par publish hoga.`
                  : "Pehle accounts select karo, tabhi direct publish enable hoga."}
              </div>

              {recentUploads.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                    Recent Uploads
                  </p>
                  {recentUploads.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70"
                    >
                      <div className="font-medium text-white">{item.title}</div>
                      <div className="mt-1 text-xs text-white/45">
                        {item.accountUsername || "Selected accounts"} •{" "}
                        {formatDateTime(item.uploadedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {showBuildProgress ? (
          <div className="mb-6 grid gap-4 xl:grid-cols-[0.7fr_1.2fr_0.9fr]">
            <div className="rounded-[24px] border border-cyan-400/15 bg-slate-950/55 p-4 shadow-[0_18px_60px_rgba(8,145,178,0.12)] backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">
                    Source Transfer
                  </p>
                  <h3 className="mt-2 text-base font-semibold text-white sm:text-lg">
                    {sourceMode === "file"
                      ? "Secure upload + render prep"
                      : sourceMode === "cloudinary"
                        ? "Cloudinary source handoff"
                        : "Source fetch + prep"}
                  </h3>
                  <p className="mt-2 line-clamp-3 text-sm text-white/55">
                    {downloadProgress.status ||
                      (sourceMode === "file"
                        ? "Abhi source file upload start nahi hui."
                        : sourceMode === "cloudinary"
                          ? "Abhi Cloudinary source select nahi hui."
                          : "Abhi download start nahi hui.")}
                  </p>
                </div>
                <div className="rounded-2xl border border-cyan-300/15 bg-cyan-400/10 px-3 py-2 text-right text-sm font-semibold text-cyan-100">
                  <div>{sourceTransferPercent}%</div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-100/70">
                    {downloadProgress.phase === "complete"
                      ? "Ready"
                      : downloadProgress.phase === "error"
                        ? "Error"
                        : downloadProgress.phase === "preparing"
                          ? "Prep"
                          : "Transfer"}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <Progress
                  value={sourceTransferPercent}
                  className="h-3 bg-slate-900/70 [&>[data-slot=progress-indicator]]:bg-gradient-to-r [&>[data-slot=progress-indicator]]:from-cyan-300 [&>[data-slot=progress-indicator]]:via-sky-400 [&>[data-slot=progress-indicator]]:to-blue-400"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/65">
                {downloadProgress.totalBytes ? (
                  <>
                    <span>
                      {formatBytes(downloadProgress.loadedBytes)}{" "}
                      {sourceMode === "file" ? "uploaded" : "transferred"}
                    </span>
                    <span>of {formatBytes(downloadProgress.totalBytes)}</span>
                  </>
                ) : (
                  <span>
                    {sourceMode === "file"
                      ? "Live site par source file pehle secure cloud upload hoti hai."
                      : sourceMode === "cloudinary"
                        ? "Cloudinary source already online hai, isliye yahan transfer size nahi dikhegi."
                        : "YouTube source analyze/download ho rahi hai. Size milte hi yahan show hoga."}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-emerald-400/15 bg-slate-950/55 p-5 shadow-[0_18px_60px_rgba(16,185,129,0.12)] backdrop-blur-xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-emerald-200/70">
                    Shorts Build
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    Live batch progress
                  </h3>
                  <p className="mt-2 text-sm text-white/55">
                    {creationProgress.status ||
                      "Abhi shorts creation start nahi hui."}
                  </p>
                </div>
                <div className="rounded-2xl border border-emerald-300/15 bg-emerald-400/10 px-3 py-2 text-right text-sm font-semibold text-emerald-100">
                  <div>{creationProgress.percent}%</div>
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-100/70">
                    {plannedShortsCount > 0
                      ? `${createdShortsCount}/${plannedShortsCount} ready`
                      : creationProgress.phase === "error"
                        ? "0 ready"
                        : "0/0"}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="font-medium text-white">
                  Ready {createdShortsCount} of {plannedShortsCount || 0} shorts
                </span>
                <span className="text-white/55">
                  {remainingShortsCount > 0
                    ? `${remainingShortsCount} remaining`
                    : "All shorts ready"}
                </span>
              </div>

              <div className="mt-4">
                <Progress
                  value={creationProgress.percent}
                  className="h-3 bg-slate-900/70 [&>[data-slot=progress-indicator]]:bg-gradient-to-r [&>[data-slot=progress-indicator]]:from-emerald-300 [&>[data-slot=progress-indicator]]:via-teal-400 [&>[data-slot=progress-indicator]]:to-cyan-400"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/65">
                <span>Created: {creationProgress.saved}</span>
                <span>Processed: {creationProgress.processed}</span>
                <span>Planned: {plannedShortsCount}</span>
              </div>

              {perShortBuildProgress.length > 0 ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {perShortBuildProgress.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-2xl border p-4 ${
                        item.status === "ready"
                          ? "border-emerald-300/20 bg-emerald-400/10"
                          : item.status === "processing"
                            ? "border-cyan-300/20 bg-cyan-400/10"
                            : item.status === "error"
                              ? "border-red-300/20 bg-red-500/10"
                              : "border-white/10 bg-black/20"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {item.title}
                          </p>
                          <p className="mt-1 text-xs text-white/55">
                            {item.partLabel} • {item.label}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                              item.status === "ready"
                                ? "bg-emerald-300/15 text-emerald-100"
                                : item.status === "processing"
                                  ? "bg-cyan-300/15 text-cyan-100"
                                  : item.status === "error"
                                    ? "bg-red-300/15 text-red-100"
                                    : "bg-white/10 text-white/60"
                            }`}
                          >
                            {item.status}
                          </span>
                          <span className="text-xs font-medium text-white/65">
                            {item.progress}%
                          </span>
                        </div>
                      </div>

                      <div className="mt-3">
                        <Progress
                          value={item.progress}
                          className={`h-2.5 bg-slate-900/70 ${
                            item.status === "ready"
                              ? "[&>[data-slot=progress-indicator]]:bg-emerald-400"
                              : item.status === "processing"
                                ? "[&>[data-slot=progress-indicator]]:bg-cyan-400"
                                : item.status === "error"
                                  ? "[&>[data-slot=progress-indicator]]:bg-red-400"
                                  : "[&>[data-slot=progress-indicator]]:bg-white/25"
                          }`}
                        />
                      </div>

                      {item.description ? (
                        <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/55">
                          {item.description}
                        </p>
                      ) : null}

                      {item.keywords.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.keywords.slice(0, 4).map((keyword) => (
                            <span
                              key={`${item.id}-${keyword}`}
                              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/65"
                            >
                              {keyword}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-sky-400/15 bg-slate-950/55 p-4 shadow-[0_18px_60px_rgba(14,165,233,0.12)] backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-sky-200/70">
                    Publish Accounts
                  </p>
                  <h3 className="mt-2 text-base font-semibold text-white sm:text-lg">
                    Account-wise posting
                  </h3>
                  <p className="mt-2 text-sm text-white/55">
                    {publishProgress
                      ? publishProgress.itemTitle
                      : "Jab short post hoga tab yahan har account ka live status dikhega."}
                  </p>
                </div>
                <div className="rounded-2xl border border-sky-300/15 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100">
                  {publishProgress
                    ? `${publishProgress.statuses.filter((item) => item.status === "posted").length}/${publishProgress.statuses.length}`
                    : "Idle"}
                </div>
              </div>

              {publishProgress ? (
                <div className="mt-4 space-y-3">
                  {publishProgress.statuses.map((account) => (
                    <div
                      key={account.accountKey}
                      className={`rounded-2xl border p-3 ${
                        account.status === "posted"
                          ? "border-emerald-300/20 bg-emerald-500/10"
                          : account.status === "posting"
                            ? "border-cyan-300/20 bg-cyan-400/10"
                            : account.status === "error"
                              ? "border-red-300/20 bg-red-500/10"
                              : "border-white/10 bg-black/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-white">
                          {account.accountLabel}
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
                          {account.status}
                        </span>
                      </div>
                      {account.error ? (
                        <p className="mt-2 text-xs text-red-100/85">
                          {account.error}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/55">
                  Pending, posting, posted, aur error accounts yahin track honge.
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-slate-950/45 p-5 shadow-[0_24px_70px_rgba(8,145,178,0.1)] backdrop-blur-xl sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                {sourceMode === "cloudinary" ? (
                  <Cloud className="h-6 w-6 text-cyan-300" />
                ) : (
                  <Youtube className="h-6 w-6 text-fuchsia-300" />
                )}
                <div>
                  <h2 className="text-lg font-semibold">1. Source + Render</h2>
                  <p className="text-sm text-white/55">
                    YouTube link, local file, ya Cloudinary source choose karo.
                    Agar Cloudinary me ready shorts hain to unhe seedha queue me
                    add bhi kar sakte ho. Baaki cases me full-frame vertical
                    style, quality tier, aur optional logo ke saath shorts queue
                    banao.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <input
                  id={SOURCE_FILE_INPUT_ID}
                  type="file"
                  accept="video/*"
                  onChange={(event) => {
                    void handleSourceFileSelected(event);
                  }}
                  className="sr-only"
                />

                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode("youtube");
                    }}
                    className={`inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                      sourceMode === "youtube"
                        ? "bg-cyan-400 text-slate-950"
                        : "border border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                    }`}
                  >
                    Use YouTube Link
                  </button>
                  <label
                    htmlFor={SOURCE_FILE_INPUT_ID}
                    onClick={() => {
                      setAutoGenerateAfterFilePick(false);
                      setSourceMode("file");
                    }}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                      sourceMode === "file"
                        ? "bg-cyan-400 text-slate-950"
                        : "border border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                    }`}
                  >
                    <Upload className="h-4 w-4" />
                    Use Video File
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode("cloudinary");
                    }}
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                      sourceMode === "cloudinary"
                        ? "bg-cyan-400 text-slate-950"
                        : "border border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                    }`}
                  >
                    <Cloud className="h-4 w-4" />
                    Import From Cloudinary
                  </button>
                </div>

                {sourceMode === "youtube" ? (
                  <>
                    <input
                      type="url"
                      value={sourceUrl}
                      onChange={(event) => {
                        setSourceMode("youtube");
                        setSourceUrl(event.target.value);
                      }}
                      placeholder="https://youtu.be/... ya https://youtube.com/shorts/..."
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                    />

                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/55">
                      Mobile share links auto-clean ho jayenge. Agar YouTube
                      block kare to phone gallery/files ya Cloudinary source se
                      seedha continue kar sakte ho.
                    </div>
                  </>
                ) : null}

                {sourceMode === "file" ? (
                  sourceFile ? (
                    <div className="rounded-2xl border border-violet-300/20 bg-violet-500/10 p-4 text-sm text-violet-100">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-white">
                            {sourceFile.name}
                          </p>
                          <p className="mt-1 text-xs text-violet-100/80">
                            {formatBytes(sourceFile.size)} • Active source:
                            phone video file
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSourceMode("file");
                            }}
                            className="rounded-xl border border-violet-300/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                          >
                            Use This File
                          </button>
                          <button
                            type="button"
                            onClick={clearSelectedSourceFile}
                            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10"
                          >
                            Remove File
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/55">
                      Phone gallery/files se ek long video select karo. File
                      pehle secure upload hogi, phir server usko shorts me
                      convert karega.
                    </div>
                  )
                ) : null}

                {sourceMode === "cloudinary" ? (
                  <div className="space-y-3 rounded-2xl border border-cyan-300/20 bg-cyan-500/10 p-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                      <input
                        type="text"
                        value={cloudinarySourceFolder}
                        onChange={(event) =>
                          setCloudinarySourceFolder(event.target.value)
                        }
                        placeholder="Cloudinary source folder"
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 outline-none transition-colors focus:border-cyan-400/40"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void loadCloudinarySources({
                            addToQueue: true,
                          })
                        }
                        disabled={isLoadingCloudinarySources}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:opacity-60 sm:w-auto"
                      >
                        {isLoadingCloudinarySources ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Cloud className="h-4 w-4" />
                        )}
                        Import + Queue
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void loadCloudinarySources({
                            addToQueue: false,
                          })
                        }
                        disabled={isLoadingCloudinarySources}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/20 bg-white/5 px-4 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-white/10 disabled:opacity-60 sm:w-auto"
                      >
                        <Cloud className="h-4 w-4" />
                        Browse Only
                      </button>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-xs text-cyan-100/80">
                      `Import + Queue` se selected folder ki videos seedha queue
                      me aa jayengi. `Browse Only` se aap kisi clip ko source ki
                      tarah bhi use kar sakte ho. Default folder:
                      `shorts-videos`.
                    </div>

                    {selectedCloudinarySource ? (
                      <div className="rounded-2xl border border-cyan-300/25 bg-slate-950/40 p-4 text-sm text-cyan-100">
                        <p className="font-medium text-white">
                          Selected:{" "}
                          {selectedCloudinarySource.originalFilename ||
                            selectedCloudinarySource.publicId}
                        </p>
                        <p className="mt-1 text-xs text-cyan-100/75">
                          {selectedCloudinarySource.folder || "No folder"} •{" "}
                          {formatSeconds(
                            Math.floor(
                              selectedCloudinarySource.durationSeconds || 0,
                            ),
                          )}{" "}
                          • {formatBytes(selectedCloudinarySource.bytes || 0)}
                        </p>
                      </div>
                    ) : null}

                    {cloudinarySourceResources.length > 0 ? (
                      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                        {cloudinarySourceResources.map((resource) => {
                          const metadata =
                            buildCloudinarySourceMetadata(resource);
                          const isSelected =
                            selectedCloudinarySource?.publicId ===
                            resource.publicId;

                          return (
                            <div
                              key={resource.assetId || resource.publicId}
                              className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                                isSelected
                                  ? "border-cyan-300/35 bg-cyan-400/10"
                                  : "border-white/10 bg-slate-950/40 hover:bg-white/5"
                              }`}
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-white">
                                    {metadata.title}
                                  </p>
                                  <p className="mt-1 text-xs text-white/55">
                                    {resource.folder || "No folder"} •{" "}
                                    {formatSeconds(
                                      Math.floor(resource.durationSeconds || 0),
                                    )}{" "}
                                    • {formatBytes(resource.bytes || 0)}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      addCloudinaryResourcesToQueue([resource])
                                    }
                                    className="rounded-full bg-cyan-400 px-3 py-1 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-300"
                                  >
                                    Add To Queue
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleCloudinarySourceSelected(resource)
                                    }
                                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-cyan-100 transition-colors hover:bg-white/10"
                                  >
                                    {isSelected
                                      ? "Selected As Source"
                                      : "Use As Source"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/55">
                        Queue ke liye `Import + Queue` dabao, ya pehle browse
                        karke kisi Cloudinary video ko source ke liye select
                        karo.
                      </div>
                    )}
                  </div>
                ) : null}

                <div
                  className={`grid gap-3 ${isMobile ? "grid-cols-1" : "sm:grid-cols-2"}`}
                >
                  <label className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                      Clip Seconds
                    </div>
                    <input
                      type="number"
                      min="10"
                      max="60"
                      value={segmentDurationSeconds}
                      onChange={(event) =>
                        setSegmentDurationSeconds(
                          Math.max(
                            10,
                            Math.min(
                              60,
                              Number.parseInt(event.target.value) || 30,
                            ),
                          ),
                        )
                      }
                      className="mt-3 w-full bg-transparent text-2xl font-semibold text-white outline-none"
                    />
                  </label>

                  <label className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                      Overlap
                    </div>
                    <input
                      type="number"
                      min="0"
                      max="15"
                      value={overlapSeconds}
                      onChange={(event) =>
                        setOverlapSeconds(
                          Math.max(
                            0,
                            Math.min(
                              15,
                              Number.parseInt(event.target.value) || 0,
                            ),
                          ),
                        )
                      }
                      className="mt-3 w-full bg-transparent text-2xl font-semibold text-white outline-none"
                    />
                  </label>
                </div>

                  <div className="grid gap-3">
                    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                        Copyright Overlay
                      </div>
                      <label className="mt-3 flex items-start gap-3 text-sm text-white/70">
                        <input
                          type="checkbox"
                          checked={includeCopyrightOverlay}
                          onChange={(event) =>
                            setIncludeCopyrightOverlay(event.target.checked)
                          }
                          className="mt-1 h-4 w-4 rounded"
                        />
                        <span>
                          Copyright watermark top-right safe area me show hoga.
                        </span>
                      </label>

                      <div className="mt-4 grid gap-2">
                        <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                          Copyright Text
                        </span>
                        <input
                          type="text"
                          value={copyrightText}
                          onChange={(event) =>
                            setCopyrightText(event.target.value)
                          }
                          placeholder={DEFAULT_SHORTS_COPYRIGHT_TEXT}
                          className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                        />
                        <p className="text-xs text-white/45">
                          Preview: {copyrightPreviewText}
                        </p>
                      </div>
                    </div>

                  <label className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                      Output Quality
                    </div>
                    <select
                      value={qualityPreset}
                      onChange={(event) =>
                        setQualityPreset(
                          parseQualityPreset(event.target.value) || "auto",
                        )
                      }
                      className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-3 text-white outline-none"
                    >
                      {SHORTS_QUALITY_PRESET_OPTIONS.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          className="bg-slate-950"
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-white/45">
                      {
                        SHORTS_QUALITY_PRESET_OPTIONS.find(
                          (option) => option.value === qualityPreset,
                        )?.description
                      }
                    </p>
                  </label>

                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                      Framing Style
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {SHORTS_FRAMING_MODE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFramingMode(option.value)}
                          className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                            framingMode === option.value
                              ? "border-cyan-300/30 bg-cyan-400/10 text-white"
                              : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                          }`}
                        >
                          <div className="text-sm font-semibold">
                            {option.label}
                          </div>
                          <div className="mt-1 text-xs text-white/55">
                            {option.description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={includeLogoOverlay}
                      onChange={(event) =>
                        setIncludeLogoOverlay(event.target.checked)
                      }
                      className="mt-1 h-4 w-4 rounded"
                    />
                    <span>
                      Logo overlay enable rakho. Agar `public/logo-overlay.png`
                      ya `YOUTUBE_SHORTS_LOGO_PATH` par real logo file milegi to
                      woh safe area me auto add ho jayegi.
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={includeHeadlineOverlay}
                      onChange={(event) =>
                        setIncludeHeadlineOverlay(event.target.checked)
                      }
                      className="mt-1 h-4 w-4 rounded"
                    />
                    <span>
                      Headline text overlay enable rakho. Video ke upar title
                      text auto-generate hoke highlight box ke saath show hoga.
                    </span>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-50 transition-colors hover:bg-cyan-400/15 disabled:opacity-60"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {sourceMode === "file"
                      ? "Use Selected File"
                      : sourceMode === "cloudinary"
                        ? "Use Selected Cloudinary Video"
                        : "Fetch Video Details"}
                  </button>
                  {sourceMode === "youtube" ? (
                    <button
                      onClick={handleDownloadSourceVideo}
                      disabled={isDownloadingSource}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                    >
                      {isDownloadingSource ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Download Source
                    </button>
                  ) : null}
                  <button
                    onClick={handleGenerateQueue}
                    disabled={isCreatingQueue}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {isCreatingQueue ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Scissors className="h-4 w-4" />
                    )}
                    {sourceMode === "file"
                      ? "Create Shorts From File"
                      : sourceMode === "cloudinary"
                        ? "Create Shorts From Cloudinary"
                        : "Generate Shorts Queue"}
                  </button>
                </div>

                {queueBuildStatus ? (
                  <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                    {queueBuildStatus}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_24px_70px_rgba(76,29,149,0.22)] backdrop-blur-xl sm:p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">2. Metadata + Plan</h2>
                  <p className="text-sm text-white/55">
                    Title, description, keywords edit kar sakte ho. Har clip ka
                    caption inhi se regenerate hota hai.
                  </p>
                </div>
                <button
                  onClick={handleRefreshMetadata}
                  disabled={!sourceVideo}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh Metadata
                </button>
              </div>

              {!sourceVideo ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 text-sm text-white/45">
                  Abhi tak source analyze nahi hua.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 sm:flex-row">
                    {sourceVideo.thumbnailUrl ? (
                      <img
                        src={sourceVideo.thumbnailUrl}
                        alt={sourceVideo.title}
                        className="h-32 w-full rounded-2xl object-cover sm:w-48"
                      />
                    ) : null}
                    <div className="flex-1">
                      <p className="text-xs uppercase tracking-[0.25em] text-fuchsia-200/70">
                        Source video
                      </p>
                      <h3 className="mt-2 text-lg font-semibold text-white">
                        {sourceVideo.title}
                      </h3>
                      <p className="mt-2 text-sm text-white/55">
                        Duration: {formatSeconds(sourceVideo.durationSeconds)} |
                        Shorts planned: {planPreview.length}
                      </p>
                      <p className="mt-2 text-sm text-white/45">
                        Source:{" "}
                        {sourceMode === "file"
                          ? "Uploaded video file"
                          : sourceMode === "cloudinary"
                            ? "Cloudinary video"
                            : sourceVideo.authorName || "Unknown"}
                      </p>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    placeholder="Shorts title base"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />

                  <textarea
                    value={descriptionDraft}
                    onChange={(event) =>
                      setDescriptionDraft(event.target.value)
                    }
                    rows={5}
                    placeholder="Shorts description base"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />

                  <textarea
                    value={keywordsDraft}
                    onChange={(event) => setKeywordsDraft(event.target.value)}
                    rows={3}
                    placeholder="keyword1, keyword2, keyword3"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />

                  <div className="rounded-2xl border border-violet-300/15 bg-violet-500/10 p-4">
                    <div className="mb-3 flex items-center gap-2 text-violet-100">
                      <Clock3 className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        Overlap preview
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {planPreview.slice(0, 10).map((segment) => (
                        <span
                          key={segment.id}
                          className="rounded-full border border-violet-300/20 bg-slate-950/50 px-3 py-1 text-xs text-violet-100"
                        >
                          {segment.label}
                        </span>
                      ))}
                      {planPreview.length > 10 && (
                        <span className="rounded-full border border-white/10 bg-slate-950/50 px-3 py-1 text-xs text-white/60">
                          +{planPreview.length - 10} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_24px_70px_rgba(76,29,149,0.22)] backdrop-blur-xl sm:p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">3. Cloudinary Queue</h2>
                  <p className="text-sm text-white/55">
                    Yahan bani hui shorts ready dikhengi. Direct publish upar se
                    chala sakte ho, ya optional fallback ke liye bulk-upload
                    page use kar sakte ho.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-xs text-white/60">
                  Library folder: {SHORTS_LIBRARY_ROOT}
                </div>
              </div>

              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  onClick={() =>
                    router.push(
                      `/bulk-upload?source=cloudinary&folder=${encodeURIComponent(SHORTS_LIBRARY_ROOT)}`,
                    )
                  }
                  disabled={queue.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
                >
                  <Upload className="h-4 w-4" />
                  Open Bulk Upload Fallback
                </button>
              </div>

              {queue.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-12 text-center">
                  <p className="text-lg font-medium text-white/70">
                    Queue empty hai
                  </p>
                  <p className="mt-2 text-sm text-white/45">
                    YouTube, local file, ya Cloudinary source choose karke
                    shorts generate ya import karo, phir isi page se direct post
                    chalao.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {queue.map((item, index) => (
                    <article
                      key={item.id}
                      className={`rounded-3xl border p-4 ${
                        item.status === "uploading"
                          ? "border-blue-400/25 bg-blue-500/10"
                          : item.status === "error"
                            ? "border-red-400/25 bg-red-500/10"
                            : "border-white/10 bg-slate-950/40"
                      }`}
                    >
                      <div className="flex flex-col gap-4 xl:flex-row">
                        <div className="w-full xl:w-56">
                          <video
                            src={item.assetUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="aspect-[9/16] w-full rounded-2xl bg-black object-cover"
                          />
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full border border-violet-300/20 bg-violet-500/10 px-3 py-1 text-violet-100">
                              {item.renderLabel || "Rendered"}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
                              {(item.framingMode || "show-full") === "show-full"
                                ? "Show Full"
                                : "Fill Frame"}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
                              {item.hasLogoOverlay ? "Logo On" : "Logo Off"}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
                              {item.partLabel || `Part ${index + 1}`}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
                              {item.label}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
                              {formatDateTime(item.createdAt)}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => downloadQueueItem(item)}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                            >
                              <Download className="h-4 w-4" />
                              Download HQ
                            </button>
                            <button
                              onClick={() => publishQueueItemNow(item.id)}
                              disabled={
                                isRunning ||
                                selectedPublishAccounts.length === 0 ||
                                item.status === "uploading"
                              }
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 via-cyan-500 to-sky-500 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              {item.status === "uploading" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                              {item.status === "uploading"
                                ? "Posting..."
                                : "Post Now"}
                            </button>
                            <button
                              onClick={() => refreshQueueItemMetadata(item.id)}
                              disabled={item.status === "uploading"}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-violet-300/20 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-100 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
                            >
                              <RefreshCw className="h-4 w-4" />
                              Refresh SEO
                            </button>
                          </div>
                        </div>

                        <div className="flex-1 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.25em] text-fuchsia-200/70">
                                #{index + 1} • {item.partLabel || item.label}
                              </p>
                              <h3 className="mt-2 text-lg font-semibold text-white">
                                {item.title}
                              </h3>
                              <p className="mt-2 text-sm text-white/50">
                                Duration {item.durationSeconds}s | Source{" "}
                                {item.sourceTitle}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              {item.status === "uploading" && (
                                <div className="rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-100">
                                  Uploading
                                </div>
                              )}
                              {item.status === "error" && (
                                <div className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1 text-xs text-red-100">
                                  Error
                                </div>
                              )}
                              {item.status === "queued" && (
                                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                                  Queued
                                </div>
                              )}
                              <button
                                onClick={() => removeQueueItem(item.id)}
                                className="rounded-xl p-2 transition-colors hover:bg-white/10"
                              >
                                <Trash2 className="h-4 w-4 text-white/60" />
                              </button>
                            </div>
                          </div>

                          <div className="grid gap-3">
                            <label className="grid gap-2">
                              <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                                Title
                              </span>
                              <input
                                type="text"
                                value={item.title}
                                onChange={(event) =>
                                  updateQueueItem(item.id, {
                                    title: event.target.value,
                                  })
                                }
                                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
                              />
                            </label>

                            <label className="grid gap-2">
                              <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                                Description
                              </span>
                              <textarea
                                value={item.description}
                                onChange={(event) =>
                                  updateQueueItem(item.id, {
                                    description: event.target.value,
                                  })
                                }
                                rows={4}
                                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
                              />
                            </label>

                            <label className="grid gap-2">
                              <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                                Caption
                              </span>
                              <textarea
                                value={item.caption}
                                onChange={(event) =>
                                  updateQueueItem(item.id, {
                                    caption: event.target.value,
                                  })
                                }
                                rows={4}
                                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
                              />
                            </label>

                            <label className="grid gap-2">
                              <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                                Keywords
                              </span>
                              <input
                                type="text"
                                value={item.keywords.join(", ")}
                                onChange={(event) =>
                                  updateQueueItem(item.id, {
                                    keywords: parseKeywords(event.target.value),
                                  })
                                }
                                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-violet-400"
                              />
                            </label>

                            {item.error ? (
                              <div className="flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100">
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{item.error}</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

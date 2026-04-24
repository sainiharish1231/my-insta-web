"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
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
  buildInstagramReadyCloudinaryVideoUrl,
  createMedia,
  publishMedia,
} from "@/lib/meta";
import { uploadMediaToBlob } from "@/lib/media-upload";
import {
  fetchInstagramAccountsFromFacebook,
  mergeInstagramAccounts,
  persistInstagramAccounts,
  readStoredInstagramAccounts,
} from "@/lib/instagram-accounts";
import {
  buildShortsPlan,
  formatSeconds,
  normalizeYouTubeUrl,
  type GeneratedShortAsset,
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
}

interface QueueItem extends GeneratedShortAsset {
  sourceUrl: string;
  sourceTitle: string;
  status: "queued" | "uploading" | "error";
  error?: string;
  createdAt: string;
}

interface PersistedState {
  queue: QueueItem[];
  selectedAccountId: string | null;
  intervalMinutes: number;
  deleteAfterPublish: boolean;
  isRunning: boolean;
  nextRunAt: string | null;
  sourceVideo: ShortsVideoMetadata | null;
  recentUploads: Array<{
    id: string;
    title: string;
    uploadedAt: string;
    accountUsername: string;
  }>;
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

const STORAGE_KEY = "youtube_shorts_automation_state";
const TARGET_ACCOUNT_KEY = "youtube_shorts_target_account_id";
const MOBILE_YOUTUBE_GUIDE_KEY = "youtube_shorts_mobile_youtube_guide_ack";
const SOURCE_FILE_INPUT_ID = "youtube-shorts-source-file-input";

type PendingYouTubeAction = "analyze" | "generate";
type YouTubeGuideDialogMode = "mobile-guide" | "bot-check";

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

    return parsed.filter((account): account is YouTubeAccount =>
      Boolean(account && typeof account.id === "string"),
    );
  } catch {
    return [];
  }
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
  item: Pick<QueueItem, "cloudinaryPublicId" | "cloudinaryResourceType">,
) {
  if (!item.cloudinaryPublicId) {
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
  const processingRef = useRef(false);

  const [instagramAccounts, setInstagramAccounts] = useState<
    InstagramAccount[]
  >([]);
  const [youtubeAccounts, setYouTubeAccounts] = useState<YouTubeAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [sourceMode, setSourceMode] = useState<"youtube" | "file">("youtube");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [uploadedSourceUrl, setUploadedSourceUrl] = useState<string | null>(
    null,
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [segmentDurationSeconds, setSegmentDurationSeconds] = useState(60);
  const [overlapSeconds, setOverlapSeconds] = useState(0);
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
  const [isRunning, setIsRunning] = useState(false);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [isRefreshingAccounts, setIsRefreshingAccounts] = useState(false);
  const [hasAcknowledgedMobileGuide, setHasAcknowledgedMobileGuide] =
    useState(false);
  const [pendingYouTubeAction, setPendingYouTubeAction] =
    useState<PendingYouTubeAction | null>(null);
  const [youtubeGuideDialogOpen, setYouTubeGuideDialogOpen] = useState(false);
  const [youtubeGuideDialogMode, setYouTubeGuideDialogMode] =
    useState<YouTubeGuideDialogMode>("mobile-guide");
  const [autoGenerateAfterFilePick, setAutoGenerateAfterFilePick] =
    useState(false);

  const selectedAccount = useMemo(
    () =>
      instagramAccounts.find((account) => account.id === selectedAccountId) ||
      null,
    [instagramAccounts, selectedAccountId],
  );

  const allConnectedAccounts = useMemo(
    () => [
      ...instagramAccounts.map((account) => ({
        id: `instagram-${account.id}`,
        label: `@${account.username}`,
        platform: "instagram" as const,
        imageUrl: account.profile_picture_url,
      })),
      ...youtubeAccounts.map((account) => ({
        id: `youtube-${account.id}`,
        label: account.username || account.name || "YouTube Account",
        platform: "youtube" as const,
        imageUrl: account.thumbnail,
      })),
    ],
    [instagramAccounts, youtubeAccounts],
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
  const defaultInstagramAccountId = useMemo(
    () => resolvePreferredInstagramAccountId(instagramAccounts),
    [instagramAccounts],
  );
  const compactConnectedAccountSummary = useMemo(
    () => ({
      instagram: instagramAccounts.length,
      youtube: youtubeAccounts.length,
      total: instagramAccounts.length + youtubeAccounts.length,
    }),
    [instagramAccounts, youtubeAccounts],
  );

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

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
        setIntervalMinutes(parsed.intervalMinutes || 20);
        setIsRunning(parsed.isRunning ?? false);
        setNextRunAt(parsed.nextRunAt || null);
        setSourceVideo(parsed.sourceVideo || null);
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

      setInstagramAccounts(readStoredInstagramAccounts(localStorage));
      setYouTubeAccounts(readStoredYouTubeAccounts());
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
    const state: PersistedState = {
      queue,
      selectedAccountId,
      intervalMinutes,
      deleteAfterPublish: true,
      isRunning,
      nextRunAt,
      sourceVideo,
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
    sourceVideo,
  ]);

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
    };
  }, []);

  useEffect(() => {
    if (sourceMode !== "file" || !sourceFile || !sourceVideo) {
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

  const refreshInstagramAccounts = useEffectEvent(
    async (options?: { showToast?: boolean }) => {
      const showToast = options?.showToast ?? false;
      const fbAccessToken = getStoredString("fb_access_token");

      if (!fbAccessToken) {
        if (showToast) {
          toast.error(
            "Instagram ko dubara connect karo, tab sab accounts sync honge.",
          );
        }
        return;
      }

      setIsRefreshingAccounts(true);

      try {
        const syncedInstagramAccounts =
          await fetchInstagramAccountsFromFacebook(fbAccessToken);

        if (syncedInstagramAccounts.length === 0) {
          if (showToast) {
            toast.error("Koi extra Instagram account sync nahi hua.");
          }
          return;
        }

        const mergedInstagramAccounts = mergeInstagramAccounts(
          readStoredInstagramAccounts(localStorage),
          syncedInstagramAccounts,
        );

        persistInstagramAccounts(mergedInstagramAccounts, localStorage);
        setInstagramAccounts(mergedInstagramAccounts);

        if (showToast) {
          toast.success(
            `${mergedInstagramAccounts.length} Instagram target account sync ho gaye.`,
          );
        }
      } catch (error) {
        console.warn("[v0] Manual Instagram account refresh failed:", error);

        if (showToast) {
          toast.error(
            "Instagram accounts refresh nahi huye. Ek baar Instagram reconnect karke try karo.",
          );
        }
      } finally {
        setIsRefreshingAccounts(false);
      }
    },
  );

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

  const processNextQueueItem = useEffectEvent(async () => {
    if (processingRef.current || !isRunning) {
      return;
    }

    if (!selectedAccount || !selectedAccount.token) {
      setIsRunning(false);
      setNextRunAt(null);
      toast.error(
        "Instagram account token missing hai. Account reconnect karo.",
      );
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
      const creationId = await createMedia({
        igUserId: selectedAccount.id,
        token: selectedAccount.token,
        mediaUrl: nextItem.assetUrl,
        caption: nextItem.caption,
        isReel: true,
      });

      await publishMedia({
        igUserId: selectedAccount.id,
        token: selectedAccount.token,
        creationId,
      });

      if (nextItem.cloudinaryPublicId) {
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
            accountUsername: selectedAccount.username,
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
          `1 short upload ho gaya. Next short ${intervalMinutes} minute baad jayega.`,
        );
      } else {
        setIsRunning(false);
        setNextRunAt(null);
        toast.success("Queue complete ho gayi. Sab shorts upload ho gaye.");
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
      toast.error(error.message || "Instagram upload fail ho gaya.");
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

  const handleToggleTargetAccount = (accountId: string) => {
    setSelectedAccountId((currentAccountId) =>
      currentAccountId === accountId ? null : accountId,
    );
  };

  const handleSelectDefaultTargetAccount = () => {
    setSelectedAccountId(defaultInstagramAccountId);
  };

  const clearSelectedSourceFile = () => {
    setAutoGenerateAfterFilePick(false);
    setUploadedSourceUrl(null);
    setSourceFile(null);
    setSourceMode("youtube");
    setSourceVideo((currentVideo) =>
      currentVideo?.sourceUrl?.startsWith("uploaded-file:")
        ? null
        : currentVideo,
    );
    setPlanPreview((currentPlan) =>
      sourceVideo?.sourceUrl?.startsWith("uploaded-file:") ? [] : currentPlan,
    );
  };

  const handleSourceFileSelected = useEffectEvent(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      event.target.value = "";

      if (!nextFile) {
        return;
      }

      setIsAnalyzing(true);
      setUploadedSourceUrl(null);
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
        setSourceVideo({
          sourceUrl: `uploaded-file:${nextFile.name}`,
          title: sourceTitle,
          description: sourceDescription,
          keywords: sourceKeywords,
          durationSeconds,
          authorName: "Device Upload",
        });
        setPlanPreview(nextPlan);
        setTitleDraft(sourceTitle);
        setDescriptionDraft(sourceDescription);
        setKeywordsDraft(sourceKeywords.join(", "));
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

  const handleAnalyze = useEffectEvent(async () => {
    if (sourceMode === "file" && sourceFile && sourceVideo) {
      const nextPlan = buildShortsPlan({
        durationSeconds: sourceVideo.durationSeconds,
        segmentDurationSeconds,
        overlapSeconds,
      });
      setPlanPreview(nextPlan);
      toast.success("Selected video file ready hai.");
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
      setTitleDraft(data.video.title || "");
      setDescriptionDraft(data.video.description || "");
      setKeywordsDraft((data.video.keywords || []).join(", "));
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

  const handleGenerateQueue = useEffectEvent(async () => {
    const normalizedSourceUrl = normalizeYouTubeUrl(sourceUrl);
    const isFileSource =
      sourceMode === "file" && Boolean(sourceFile && sourceVideo);
    const expectedShortCount = planPreview.length;

    if (!isFileSource && !normalizedSourceUrl.trim()) {
      toast.error("YouTube URL missing hai.");
      return;
    }

    if (instagramAccounts.length === 0) {
      toast.error("Pehle Instagram account connect karo.");
      return;
    }

    if (!isFileSource && isMobile && !hasAcknowledgedMobileGuide) {
      setSourceUrl(normalizedSourceUrl);
      openYouTubeGuideDialog("mobile-guide", "generate");
      return;
    }

    setIsCreatingQueue(true);
    setQueueBuildStatus(
      isFileSource
        ? "Selected file process start ho rahi hai..."
        : "Server par source video temp process ho rahi hai...",
    );
    setDownloadProgress({
      phase: "preparing",
      percent: 0,
      loadedBytes: 0,
      totalBytes: null,
      status: isFileSource
        ? "Selected file source prepare ho rahi hai..."
        : "Server temp source prepare ho rahi hai...",
    });
    setCreationProgress({
      phase: "processing",
      percent: 0,
      total: expectedShortCount,
      processed: 0,
      saved: 0,
      status:
        expectedShortCount > 0
          ? `${expectedShortCount} planned shorts ke liye server response ka wait ho raha hai...`
          : "Metadata ka wait ho raha hai...",
    });
    setSourceUrl(normalizedSourceUrl);

    try {
      let uploadedSourceUrlForQueue = uploadedSourceUrl;

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
        setQueueBuildStatus(
          "Uploaded source file server par shorts me convert ho rahi hai...",
        );
      }

      const response = isFileSource
        ? await (async () => {
            const formData = new FormData();
            formData.append("sourceUrl", uploadedSourceUrlForQueue || "");
            formData.append(
              "fileName",
              sourceFile?.name || "uploaded-video.mp4",
            );
            formData.append("contentType", sourceFile?.type || "video/mp4");
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

            return fetch("/api/youtube/shorts/create-upload", {
              method: "POST",
              body: formData,
            });
          })()
        : await fetch("/api/youtube/shorts/create", {
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
            }),
          });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Shorts queue create nahi hui");
      }

      const createdAt = new Date().toISOString();
      const nextItems: QueueItem[] = (data.queue || []).map(
        (item: GeneratedShortAsset) => ({
          ...item,
          assetUrl:
            buildInstagramReadyCloudinaryVideoUrl(item.cloudinaryPublicId) ||
            item.assetUrl,
          sourceUrl: data.video?.sourceUrl || normalizedSourceUrl,
          sourceTitle: data.video.title,
          status: "queued",
          createdAt,
        }),
      );

      setSourceVideo(data.video);
      setPlanPreview(data.queue || []);
      setSourceUrl(
        isFileSource ? "" : data.video?.sourceUrl || normalizedSourceUrl,
      );
      setQueue((prev) => [...prev, ...nextItems]);
      setQueueBuildStatus("Server-side audio-safe shorts ready hain.");
      setDownloadProgress({
        phase: "complete",
        percent: 100,
        loadedBytes: 0,
        totalBytes: null,
        status: isFileSource
          ? "Selected source file process complete."
          : "Source video temp process complete.",
      });
      setCreationProgress({
        phase: "complete",
        percent: 100,
        total: nextItems.length,
        processed: nextItems.length,
        saved: nextItems.length,
        status: `Sab ${nextItems.length} shorts server par create ho gayi.`,
      });
      toast.success(`${nextItems.length} shorts queue me add ho gaye.`);
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

      toast.error(error.message || "Queue create nahi hui.");
    } finally {
      setQueueBuildStatus("");
      setIsCreatingQueue(false);
    }
  });

  const handleStartQueue = () => {
    if (queue.length === 0) {
      toast.error("Queue empty hai. Pehle shorts generate karo.");
      return;
    }

    if (!selectedAccount || !selectedAccount.token) {
      toast.error("Upload ke liye ek valid Instagram account select karo.");
      return;
    }

    setIsRunning(true);
    setNextRunAt(null);
  };

  const handlePauseQueue = () => {
    clearTimer();
    setIsRunning(false);
    setNextRunAt(null);
  };

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
    if (processingRef.current && queue[0]?.id === id) {
      toast.error("Current uploading short ko abhi remove nahi kar sakte.");
      return;
    }

    const targetItem = queue.find((item) => item.id === id);
    setQueue((prev) => prev.filter((item) => item.id !== id));

    if (targetItem) {
      await cleanupQueuedAsset(targetItem);
    }
  };

  const suggestedFinishTime =
    queue.length > 0
      ? new Date(
          Date.now() +
            Math.max(queue.length - 1, 0) * intervalMinutes * 60 * 1000,
        )
      : null;
  const showBuildProgress =
    isCreatingQueue ||
    downloadProgress.phase !== "idle" ||
    creationProgress.phase !== "idle";
  const plannedShortsCount = creationProgress.total || planPreview.length;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#43237a_0%,#1f1147_34%,#120622_68%,#090014_100%)] text-white">
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

      <header className="sticky top-0 z-40 border-b border-violet-300/10 bg-[#140824]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-2xl p-2 transition-colors hover:bg-white/10"
            >
              <ArrowLeft className="h-5 w-5 text-white/70" />
            </button>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-400 shadow-lg shadow-fuchsia-900/30">
              <Scissors className="h-7 w-7 text-white" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-fuchsia-200/70">
                YouTube to Instagram
              </p>
              <h1 className="text-2xl font-semibold">
                Shorts Automation Studio
              </h1>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <div className="rounded-2xl border border-violet-300/15 bg-violet-400/10 px-4 py-2 text-sm text-violet-100">
              {selectedAccount
                ? `Target: @${selectedAccount.username}`
                : "Instagram account select karo"}
            </div>
            {isRunning ? (
              <button
                onClick={handlePauseQueue}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-fuchsia-500 sm:w-auto"
              >
                <PauseCircle className="h-4 w-4" />
                Stop Queue
              </button>
            ) : (
              <button
                onClick={handleStartQueue}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto"
              >
                <PlayCircle className="h-4 w-4" />
                Upload Queue Start
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        {isMobile ? (
          <div className="mb-4 grid gap-3 grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-semibold text-white">
                {queueStats.total}
              </div>
              <p className="mt-1 text-xs text-white/55">Queue</p>
            </div>
            <div className="rounded-3xl border border-violet-300/20 bg-violet-400/10 p-4">
              <div className="text-sm font-semibold text-violet-100">
                {selectedAccount ? `@${selectedAccount.username}` : "No target"}
              </div>
              <p className="mt-1 text-xs text-violet-100/80">Selected target</p>
            </div>
            {allConnectedAccounts.length > 0 ? (
              <div className="col-span-2 rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3 text-sm text-white/80">
                  <span className="font-medium">My Accounts</span>
                  <span className="text-xs text-white/45">
                    IG {compactConnectedAccountSummary.instagram} • YT{" "}
                    {compactConnectedAccountSummary.youtube}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {allConnectedAccounts.map((account) => (
                    <div
                      key={account.id}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-white/75"
                    >
                      {account.imageUrl ? (
                        <img
                          src={account.imageUrl}
                          alt={account.label}
                          className="h-5 w-5 rounded-full object-cover"
                        />
                      ) : null}
                      {account.platform === "instagram" ? (
                        <Instagram className="h-3.5 w-3.5 text-pink-300" />
                      ) : (
                        <Youtube className="h-3.5 w-3.5 text-red-300" />
                      )}
                      <span>{account.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="text-3xl font-semibold text-white">
                  {queueStats.total}
                </div>
                <p className="mt-2 text-sm text-white/55">Shorts in queue</p>
              </div>
              <div className="rounded-3xl border border-violet-300/20 bg-violet-400/10 p-5">
                <div className="text-3xl font-semibold text-violet-100">
                  {queueStats.queued}
                </div>
                <p className="mt-2 text-sm text-violet-100/80">
                  Ready to upload
                </p>
              </div>
              <div className="rounded-3xl border border-fuchsia-300/20 bg-fuchsia-500/10 p-5">
                <div className="text-3xl font-semibold text-fuchsia-100">
                  {intervalMinutes}m
                </div>
                <p className="mt-2 text-sm text-fuchsia-100/80">
                  Gap after success
                </p>
              </div>
              <div className="rounded-3xl border border-indigo-300/20 bg-indigo-500/10 p-5">
                <div className="text-lg font-semibold text-indigo-100">
                  {formatDateTime(nextRunAt)}
                </div>
                <p className="mt-2 text-sm text-indigo-100/80">
                  Next scheduled upload
                </p>
              </div>
            </div>

            <div className="mb-6 rounded-3xl border border-violet-300/20 bg-violet-400/10 p-4 text-sm text-violet-100">
              Queue automation browser tab me run hoti hai. Best result ke liye
              page open rakho jab tak last short upload na ho jaye.
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-violet-300/20 bg-white/5 p-5 shadow-[0_20px_50px_rgba(91,33,182,0.2)]">
                <p className="text-xs uppercase tracking-[0.28em] text-fuchsia-200/70">
                  Local Source
                </p>
                <h2 className="mt-2 text-lg font-semibold text-white">
                  YouTube video local me
                </h2>
                <p className="mt-2 text-sm text-white/55">
                  Source video browser ke liye direct download hota hai, storage
                  me park nahi hota.
                </p>
              </div>
              <div className="rounded-3xl border border-violet-300/20 bg-white/5 p-5 shadow-[0_20px_50px_rgba(91,33,182,0.2)]">
                <p className="text-xs uppercase tracking-[0.28em] text-fuchsia-200/70">
                  Shorts Storage
                </p>
                <h2 className="mt-2 text-lg font-semibold text-white">
                  Sirf shorts save honge
                </h2>
                <p className="mt-2 text-sm text-white/55">
                  Har created short Cloudinary par save hokar queue me turant
                  add hota chala jayega.
                </p>
              </div>
              <div className="rounded-3xl border border-violet-300/20 bg-white/5 p-5 shadow-[0_20px_50px_rgba(91,33,182,0.2)]">
                <p className="text-xs uppercase tracking-[0.28em] text-fuchsia-200/70">
                  Auto Cleanup
                </p>
                <h2 className="mt-2 text-lg font-semibold text-white">
                  Upload ke baad delete
                </h2>
                <p className="mt-2 text-sm text-white/55">
                  Instagram publish success hote hi short Cloudinary se auto
                  remove ho jayega.
                </p>
              </div>
            </div>
          </>
        )}

        {showBuildProgress ? (
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-violet-300/20 bg-white/5 p-5 shadow-[0_20px_50px_rgba(91,33,182,0.2)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-fuchsia-200/70">
                    Source Progress
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    {sourceMode === "file"
                      ? "Selected file secure upload + processing"
                      : "Source video local download"}
                  </h3>
                  <p className="mt-2 text-sm text-white/55">
                    {downloadProgress.status ||
                      (sourceMode === "file"
                        ? "Abhi source file upload start nahi hui."
                        : "Abhi download start nahi hui.")}
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-300/15 bg-violet-400/10 px-3 py-2 text-sm font-semibold text-violet-100">
                  {downloadProgress.phase === "preparing"
                    ? "Preparing"
                    : `${downloadProgress.percent}%`}
                </div>
              </div>

              <div className="mt-4">
                {downloadProgress.phase === "preparing" ? (
                  <div className="h-2 overflow-hidden rounded-full bg-violet-400/15">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-400" />
                  </div>
                ) : (
                  <Progress
                    value={downloadProgress.percent}
                    className="h-3 bg-violet-950/60"
                  />
                )}
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
                      : "total size calculating..."}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-violet-300/20 bg-white/5 p-5 shadow-[0_20px_50px_rgba(91,33,182,0.2)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-fuchsia-200/70">
                    Shorts Progress
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    Shorts kitni create hui
                  </h3>
                  <p className="mt-2 text-sm text-white/55">
                    {creationProgress.status ||
                      "Abhi shorts creation start nahi hui."}
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-300/15 bg-violet-400/10 px-3 py-2 text-sm font-semibold text-violet-100">
                  {plannedShortsCount > 0
                    ? `${creationProgress.saved}/${plannedShortsCount}`
                    : creationProgress.phase === "error"
                      ? "0 created"
                      : "0/0"}
                </div>
              </div>

              <div className="mt-4">
                <Progress
                  value={creationProgress.percent}
                  className="h-3 bg-violet-950/60"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-white/65">
                <span>Created: {creationProgress.saved}</span>
                <span>Processed: {creationProgress.processed}</span>
                <span>Planned: {plannedShortsCount}</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_24px_70px_rgba(76,29,149,0.22)] backdrop-blur-xl sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <Youtube className="h-6 w-6 text-fuchsia-300" />
                <div>
                  <h2 className="text-lg font-semibold">1. YouTube Source</h2>
                  <p className="text-sm text-white/55">
                    Long video URL dalo, metadata fetch karo, phir local source
                    video ko split karke shorts queue banao. Mobile share links
                    bhi auto-clean ho jayenge.
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

                {!isMobile && allConnectedAccounts.length > 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-white/80">
                      <Youtube className="h-4 w-4 text-fuchsia-300" />
                      <span>
                        All connected accounts ({allConnectedAccounts.length})
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {allConnectedAccounts.map((account) => (
                        <div
                          key={account.id}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70"
                        >
                          {account.imageUrl ? (
                            <img
                              src={account.imageUrl}
                              alt={account.label}
                              className="h-5 w-5 rounded-full object-cover"
                            />
                          ) : null}
                          {account.platform === "instagram" ? (
                            <Instagram className="h-3.5 w-3.5 text-pink-300" />
                          ) : (
                            <Youtube className="h-3.5 w-3.5 text-red-300" />
                          )}
                          <span>{account.label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-white/45">
                      Instagram + YouTube dono yahan visible hain. Actual upload
                      target neeche Instagram section me select hota hai.
                    </p>
                  </div>
                ) : null}

                <input
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => {
                    setSourceMode("youtube");
                    setSourceUrl(event.target.value);
                  }}
                  placeholder="https://youtu.be/... ya https://youtube.com/shorts/..."
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-violet-400"
                />

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode("youtube");
                    }}
                    className={`inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold transition-colors ${
                      sourceMode === "youtube"
                        ? "bg-violet-500 text-white"
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
                    className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold transition-colors ${
                      sourceMode === "file"
                        ? "bg-violet-500 text-white"
                        : "border border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                    }`}
                  >
                    <Upload className="h-4 w-4" />
                    Use Video File
                  </label>
                </div>

                {sourceFile ? (
                  <div className="rounded-2xl border border-violet-300/20 bg-violet-500/10 p-4 text-sm text-violet-100">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-white">
                          {sourceFile.name}
                        </p>
                        <p className="mt-1 text-xs text-violet-100/80">
                          {formatBytes(sourceFile.size)} •{" "}
                          {sourceMode === "file"
                            ? "Active source: phone video file (live par secure upload)"
                            : "Saved file fallback ready"}
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
                    YouTube block aaye to phone gallery/files se direct video
                    select karke bina cookies ke continue kar sakte ho.
                  </div>
                )}

                <div
                  className={`grid gap-3 ${isMobile ? "grid-cols-1" : "sm:grid-cols-3"}`}
                >
                  <label className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                      Clip Seconds
                    </div>
                    <input
                      type="number"
                      min="10"
                      max="30"
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

                  <label className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-white/45">
                      Upload Gap
                    </div>
                    <input
                      type="number"
                      min="1"
                      value={intervalMinutes}
                      onChange={(event) =>
                        setIntervalMinutes(
                          Math.max(
                            1,
                            Number.parseInt(event.target.value) || 20,
                          ),
                        )
                      }
                      className="mt-3 w-full bg-transparent text-2xl font-semibold text-white outline-none"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-400/15 disabled:opacity-60 sm:w-auto"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {sourceMode === "file"
                      ? "Use Selected File"
                      : "Fetch Video Details"}
                  </button>
                  <button
                    onClick={handleGenerateQueue}
                    disabled={isCreatingQueue}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-auto"
                  >
                    {isCreatingQueue ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Scissors className="h-4 w-4" />
                    )}
                    {sourceMode === "file"
                      ? "Create Shorts From File"
                      : "Generate Shorts Queue"}
                  </button>
                </div>

                {queueBuildStatus ? (
                  <div className="rounded-2xl border border-violet-300/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-100">
                    {queueBuildStatus}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_24px_70px_rgba(76,29,149,0.22)] backdrop-blur-xl sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <Instagram className="h-6 w-6 text-violet-300" />
                <div>
                  <h2 className="text-lg font-semibold">2. Instagram Target</h2>
                  <p className="text-sm text-white/55">
                    Primary ya last-used account by default aayega. Kisi card ko
                    tap karke select karo, aur dubara tap karke unselect bhi kar
                    sakte ho.
                  </p>
                </div>
              </div>

              <div className="mb-4 rounded-2xl border border-violet-300/15 bg-violet-400/10 px-4 py-3 text-sm text-violet-100">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    {instagramAccounts.length} Instagram target account
                    {instagramAccounts.length === 1 ? "" : "s"} synced. Default
                    target dashboard ya primary account se pick hota hai.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSelectDefaultTargetAccount}
                      disabled={!defaultInstagramAccountId}
                      className="inline-flex items-center justify-center rounded-2xl border border-violet-300/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                    >
                      Use Default
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void refreshInstagramAccounts({ showToast: true });
                      }}
                      disabled={isRefreshingAccounts}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-violet-300/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${isRefreshingAccounts ? "animate-spin" : ""}`}
                      />
                      Refresh
                    </button>
                  </div>
                </div>
              </div>

              {instagramAccounts.length === 0 ? (
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
                  Instagram account connected nahi hai. Localhost aur live
                  domain alag browser storage use karte hain, isliye local login
                  live site par auto-show nahi hota. Dashboard ya login page se
                  live domain par dubara connect karo.
                </div>
              ) : (
                <div className="space-y-3">
                  {instagramAccounts.map((account) => (
                    <div
                      key={account.id}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${
                        selectedAccountId === account.id
                          ? "border-violet-300/30 bg-violet-400/10"
                          : "border-white/10 bg-slate-950/40 hover:bg-white/5"
                      }`}
                    >
                      <img
                        src={
                          account.profile_picture_url || "/placeholder-user.jpg"
                        }
                        alt={account.username}
                        className="h-12 w-12 rounded-full object-cover"
                      />
                      <div className="flex-1">
                        <p className="font-medium text-white">
                          @{account.username}
                        </p>
                        <p className="text-xs text-white/45">
                          {selectedAccountId === account.id
                            ? "Ye account abhi upload target hai."
                            : "Is account par shorts upload ho sakti hain."}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedAccountId === account.id && (
                          <CheckCircle2 className="h-5 w-5 text-violet-200" />
                        )}
                        <button
                          type="button"
                          onClick={() => handleToggleTargetAccount(account.id)}
                          className={`min-w-[82px] rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                            selectedAccountId === account.id
                              ? "bg-white/10 text-white hover:bg-white/15"
                              : "bg-violet-500 text-white hover:bg-violet-400"
                          }`}
                        >
                          {selectedAccountId === account.id
                            ? "Deselect"
                            : "Select"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4 text-sm text-violet-100">
                Successful upload ke turant baad Cloudinary short auto-delete ho
                jayega.
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_24px_70px_rgba(76,29,149,0.22)] backdrop-blur-xl sm:p-6">
              <div className="mb-5">
                <h2 className="text-lg font-semibold">3. Metadata + Plan</h2>
                <p className="text-sm text-white/55">
                  Title, description, keywords edit kar sakte ho. Har clip ka
                  caption inhi se regenerate hota hai.
                </p>
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
                  <h2 className="text-lg font-semibold">4. Upload Queue</h2>
                  <p className="text-sm text-white/55">
                    First short abhi jayega. Har next short previous success ke{" "}
                    {intervalMinutes} minute baad जाएगा.
                  </p>
                </div>
                {!isMobile && suggestedFinishTime ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-xs text-white/60">
                    Estimated finish:{" "}
                    {formatDateTime(suggestedFinishTime.toISOString())}
                  </div>
                ) : null}
              </div>

              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  onClick={handleStartQueue}
                  disabled={isRunning || queue.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 sm:w-auto"
                >
                  <PlayCircle className="h-4 w-4" />
                  Start Automation
                </button>
                <button
                  onClick={handlePauseQueue}
                  disabled={!isRunning}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-300/15 bg-violet-400/10 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-400/15 disabled:opacity-50 sm:w-auto"
                >
                  <PauseCircle className="h-4 w-4" />
                  Pause
                </button>
                <button
                  onClick={handleClearQueue}
                  disabled={queue.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-3 text-sm font-semibold text-fuchsia-50 transition-colors hover:bg-fuchsia-500/20 disabled:opacity-50 sm:w-auto"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear Queue
                </button>
              </div>

              {queue.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-12 text-center">
                  <p className="text-lg font-medium text-white/70">
                    Queue empty hai
                  </p>
                  <p className="mt-2 text-sm text-white/45">
                    YouTube URL analyze karke shorts generate karo.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {queue.map((item, index) => (
                    <div
                      key={item.id}
                      className={`rounded-3xl border p-4 ${
                        item.status === "uploading"
                          ? "border-blue-400/25 bg-blue-500/10"
                          : item.status === "error"
                            ? "border-red-400/25 bg-red-500/10"
                            : "border-white/10 bg-slate-950/40"
                      }`}
                    >
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.25em] text-fuchsia-200/70">
                            #{index + 1} • {item.label}
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

                      <div className="space-y-3">
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

                        {item.error ? (
                          <div className="flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-100">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{item.error}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {!isMobile || recentUploads.length > 0 ? (
              <section className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_24px_70px_rgba(76,29,149,0.22)] backdrop-blur-xl sm:p-6">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold">Recent Uploads</h2>
                  <p className="text-sm text-white/55">
                    Success hone par item queue se remove ho jayega aur yahan
                    history me dikhega.
                  </p>
                </div>

                {recentUploads.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 text-sm text-white/45">
                    Abhi tak koi short upload nahi hua.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentUploads.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-violet-300/20 bg-violet-500/10 p-4"
                      >
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 text-violet-200" />
                          <div>
                            <p className="font-medium text-violet-50">
                              {item.title}
                            </p>
                            <p className="mt-1 text-sm text-violet-100/80">
                              @{item.accountUsername} •{" "}
                              {formatDateTime(item.uploadedAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

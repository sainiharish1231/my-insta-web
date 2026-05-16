"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  CheckCircle,
  Clock,
  Copy,
  Facebook,
  ImageIcon,
  Instagram,
  Loader2,
  Music,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Youtube,
} from "lucide-react";
import {
  AUTO_PHOTO_SEED_STORAGE_KEY,
  AUTO_TEXT_DRAFTS_STORAGE_KEY,
  AUTO_TEXT_SETTINGS_STORAGE_KEY,
  AutoTextDraft,
} from "@/lib/auto-maction";
import {
  publishFacebookPageText,
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

type PublishTargetMode = "instagram" | "facebook-youtube" | "all";

interface TrendIdea {
  title: string;
  angle: string;
  keywords: string[];
  source: string;
}

interface TextAutomationSettings {
  enabled: boolean;
  intervalHours: number;
  nextRunAt?: string;
  lastRunAt?: string;
  topic: string;
  language: string;
  tone: string;
  accountIds: string[];
  publishTargetMode?: PublishTargetMode;
  youtubeAccountIds?: string[];
}

interface PublishStatus {
  state: "pending" | "uploading" | "success" | "error";
  error?: string;
}

const TEXT_CARD_SIZE = { width: 1080, height: 1920 };
const DEFAULT_TEXT_VIDEO_SECONDS = 10;
const MAX_MUSIC_VIDEO_SECONDS = 60;

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

function buildDraftText(draft: AutoTextDraft) {
  return [draft.caption, draft.cta, draft.hashtags.join(" ")]
    .filter(Boolean)
    .join("\n\n");
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

function wrapCanvasText(
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

  return lines.length > 0 ? lines : ["Text Auto Maction"];
}

function getVideoMimeType(hasAudio: boolean) {
  const candidates = hasAudio
    ? [
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp9,opus",
        "video/webm",
      ]
    : ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];

  return (
    candidates.find((candidate) =>
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(candidate),
    ) || "video/webm"
  );
}

function buildYouTubeTitle(draft: AutoTextDraft) {
  const cleanTitle = draft.hook.replace(/\s+/g, " ").trim() || draft.topic;
  return cleanTitle.length > 92 ? `${cleanTitle.slice(0, 89)}...` : cleanTitle;
}

function buildYouTubeTags(hashtags: string[]) {
  return hashtags
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 15);
}

export default function TextAutoMactionPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const autoRunInProgressRef = useRef(false);
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [youtubeAccounts, setYouTubeAccounts] = useState<YouTubeAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedYouTubeAccountIds, setSelectedYouTubeAccountIds] = useState<
    string[]
  >([]);
  const [drafts, setDrafts] = useState<AutoTextDraft[]>([]);
  const [topic, setTopic] = useState("trending creator growth");
  const [language, setLanguage] = useState("Hinglish");
  const [tone, setTone] = useState("curious, sharp, and easy to comment on");
  const [intervalHours, setIntervalHours] = useState(1);
  const [workerEnabled, setWorkerEnabled] = useState(false);
  const [publishTargetMode, setPublishTargetMode] =
    useState<PublishTargetMode>("instagram");
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicFileName, setMusicFileName] = useState("");
  const [nextRunAt, setNextRunAt] = useState<string>();
  const [lastRunAt, setLastRunAt] = useState<string>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [copiedDraftId, setCopiedDraftId] = useState("");
  const [trendIdeas, setTrendIdeas] = useState<TrendIdea[]>([]);
  const [isLoadingTrends, setIsLoadingTrends] = useState(false);
  const [publishStatuses, setPublishStatuses] = useState<
    Record<string, PublishStatus>
  >({});

  useEffect(() => {
    const storedAccounts = readJson<InstagramAccount[]>("ig_accounts", []);
    const storedYouTubeAccounts = readJson<YouTubeAccount[]>(
      "youtube_accounts",
      [],
    );
    const storedDrafts = readJson<AutoTextDraft[]>(
      AUTO_TEXT_DRAFTS_STORAGE_KEY,
      [],
    );
    const settings = readJson<Partial<TextAutomationSettings>>(
      AUTO_TEXT_SETTINGS_STORAGE_KEY,
      {},
    );

    setAccounts(storedAccounts);
    setYouTubeAccounts(storedYouTubeAccounts);
    setDrafts(storedDrafts);
    setTopic(settings.topic || "trending creator growth");
    setLanguage(settings.language || "Hinglish");
    setTone(settings.tone || "curious, sharp, and easy to comment on");
    setIntervalHours(settings.intervalHours || 1);
    setWorkerEnabled(Boolean(settings.enabled));
    setPublishTargetMode(settings.publishTargetMode || "instagram");
    setNextRunAt(settings.nextRunAt);
    setLastRunAt(settings.lastRunAt);

    const savedSelection =
      settings.accountIds?.filter((id) =>
        storedAccounts.some((account) => account.id === id),
      ) || [];
    setSelectedAccountIds(
      savedSelection.length > 0 ? savedSelection : [],
    );
    const savedYouTubeSelection =
      settings.youtubeAccountIds?.filter((id) =>
        storedYouTubeAccounts.some((account) => account.id === id),
      ) || [];
    setSelectedYouTubeAccountIds(
      savedYouTubeSelection.length > 0 ? savedYouTubeSelection : [],
    );
  }, []);

  useEffect(() => {
    const settings: TextAutomationSettings = {
      enabled: workerEnabled,
      intervalHours,
      nextRunAt,
      lastRunAt,
      topic,
      language,
      tone,
      accountIds: selectedAccountIds,
      publishTargetMode,
      youtubeAccountIds: selectedYouTubeAccountIds,
    };

    localStorage.setItem(AUTO_TEXT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [
    intervalHours,
    language,
    lastRunAt,
    nextRunAt,
    publishTargetMode,
    selectedAccountIds,
    selectedYouTubeAccountIds,
    tone,
    topic,
    workerEnabled,
  ]);

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

  const appendDraft = useCallback((draft: AutoTextDraft) => {
    setDrafts((current) => {
      const next = [draft, ...current].slice(0, 40);
      localStorage.setItem(AUTO_TEXT_DRAFTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const generateDraft = useCallback(async () => {
    setIsGenerating(true);
    setError("");
    setWarning("");

    try {
      const response = await fetch("/api/ai/text-post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic,
          language,
          tone,
          accountIds: selectedAccountIds,
          accountUsername: selectedAccounts[0]?.username,
          recentCaptions: drafts.slice(0, 5).map((draft) => draft.caption),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data?.draft) {
        throw new Error(data?.error || "Text draft create nahi ho paya.");
      }

      const draft = data.draft as AutoTextDraft;
      appendDraft(draft);
      if (data.warning) {
        setWarning(data.warning);
      }

      const now = new Date();
      setLastRunAt(now.toISOString());
      setNextRunAt(
        new Date(now.getTime() + intervalHours * 60 * 60 * 1000).toISOString(),
      );
      return draft;
    } catch (generateError: any) {
      setError(generateError?.message || "Text draft create nahi ho paya.");
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, [
    appendDraft,
    drafts,
    intervalHours,
    language,
    selectedAccountIds,
    selectedAccounts,
    tone,
    topic,
  ]);

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

  const findTrends = async () => {
    setIsLoadingTrends(true);
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

      setTrendIdeas(data.trends);
      if (data.trends[0]?.title) {
        setTopic(data.trends[0].title);
      }
      if (data.warning) {
        setWarning(data.warning);
      }
    } catch (trendError: any) {
      setError(trendError?.message || "Trends load nahi ho paye.");
    } finally {
      setIsLoadingTrends(false);
    }
  };

  const clearDraft = (draftId: string) => {
    setDrafts((current) => {
      const next = current.filter((draft) => draft.id !== draftId);
      localStorage.setItem(AUTO_TEXT_DRAFTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const copyDraft = async (draft: AutoTextDraft) => {
    await navigator.clipboard.writeText(buildDraftText(draft));
    setCopiedDraftId(draft.id);
    window.setTimeout(() => setCopiedDraftId(""), 1800);
  };

  const handleMusicUpload = (file?: File) => {
    if (!file) {
      return;
    }

    setMusicFile(file);
    setMusicFileName(file.name);
  };

  const renderTextCanvas = useCallback((draft: AutoTextDraft) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      throw new Error("Text canvas ready nahi hai.");
    }

    const { width, height } = TEXT_CARD_SIZE;
    canvas.width = width;
    canvas.height = height;

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#020617");
    gradient.addColorStop(0.5, "#0f766e");
    gradient.addColorStop(1, "#111827");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(width * 0.08, height * 0.08, width * 0.34, height * 0.18);
    ctx.fillStyle = "rgba(34, 211, 238, 0.12)";
    ctx.fillRect(width * 0.58, height * 0.16, width * 0.28, height * 0.24);

    const panelX = width * 0.08;
    const panelY = height * 0.18;
    const panelWidth = width * 0.84;
    const panelHeight = height * 0.64;
    ctx.fillStyle = "rgba(2, 6, 23, 0.76)";
    drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 8);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#67e8f9";
    ctx.font = "800 34px Arial, Helvetica, sans-serif";
    ctx.fillText("TEXT AUTO MACTION", width / 2, panelY + 64);

    ctx.fillStyle = "#ffffff";
    ctx.font = "900 72px Arial, Helvetica, sans-serif";
    const hookLines = wrapCanvasText(ctx, draft.hook, panelWidth * 0.78, 6);
    const hookLineHeight = 86;
    const hookY =
      panelY + panelHeight * 0.26 - (hookLines.length * hookLineHeight) / 2;
    hookLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, hookY + index * hookLineHeight);
    });

    ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
    ctx.font = "700 36px Arial, Helvetica, sans-serif";
    const captionLines = wrapCanvasText(
      ctx,
      draft.caption.replace(/\n+/g, " "),
      panelWidth * 0.76,
      7,
    );
    const captionLineHeight = 50;
    const captionY = panelY + panelHeight * 0.55;
    captionLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, captionY + index * captionLineHeight);
    });

    ctx.font = "800 34px Arial, Helvetica, sans-serif";
    const ctaLines = wrapCanvasText(ctx, draft.cta, panelWidth * 0.72, 2);
    const ctaHeight = ctaLines.length * 48 + 42;
    const ctaY = panelY + panelHeight - ctaHeight - 62;
    ctx.fillStyle = "#ecfeff";
    drawRoundedRect(ctx, width * 0.17, ctaY, width * 0.66, ctaHeight, 8);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctaLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, ctaY + 22 + index * 48);
    });
  }, []);

  const canvasToImageFile = useCallback(async (draft: AutoTextDraft) => {
    renderTextCanvas(draft);
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Text canvas ready nahi hai.");
    }

    return new Promise<File>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Text image create nahi ho payi."));
          return;
        }

        resolve(
          new File([blob], `text-auto-maction-${Date.now()}.png`, {
            type: "image/png",
          }),
        );
      }, "image/png");
    });
  }, [renderTextCanvas]);

  const canvasToVideoFile = useCallback(async (draft: AutoTextDraft) => {
    renderTextCanvas(draft);
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Text canvas ready nahi hai.");
    }

    if (!canvas.captureStream || typeof MediaRecorder === "undefined") {
      throw new Error("Is browser me text video recording supported nahi hai.");
    }

    const canvasStream = canvas.captureStream(30);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
    let audioContext: AudioContext | null = null;
    let audioSource: AudioBufferSourceNode | null = null;
    let durationSeconds = DEFAULT_TEXT_VIDEO_SECONDS;

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
          // Audio source may already be stopped by the recorder timeout.
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
        reject(new Error("Text music video create nahi ho paya."));
      };
      recorder.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: "video/webm" });
        if (blob.size < 1024) {
          reject(new Error("Text video empty create hua. Dobara try karo."));
          return;
        }

        resolve(
          new File([blob], `text-auto-maction-${Date.now()}.webm`, {
            type: "video/webm",
          }),
        );
      };

      audioSource?.start();
      recorder.start(250);
      renderTextCanvas(draft);
      videoTrack?.requestFrame?.();
      window.setTimeout(() => {
        if (recorder.state !== "inactive") {
          try {
            recorder.requestData();
          } catch {
            // Some browsers auto-flush the final data chunk on stop.
          }
          recorder.stop();
        }
      }, durationSeconds * 1000);
    });
  }, [musicFile, renderTextCanvas]);

  const publishDraft = useCallback(async (draft: AutoTextDraft) => {
    const shouldPublishInstagram = publishTargetMode !== "facebook-youtube";
    const shouldPublishFacebookYouTube = publishTargetMode !== "instagram";
    const facebookTargets = selectedAccounts.filter(
      (account) => account.pageId && account.token,
    );
    const hasAnyTarget =
      (shouldPublishInstagram && selectedAccounts.length > 0) ||
      (shouldPublishFacebookYouTube &&
        (facebookTargets.length > 0 || selectedYouTubeAccounts.length > 0));

    if (!hasAnyTarget) {
      setError("Post ke liye Instagram, Facebook Page, ya YouTube target select karo.");
      return false;
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
      const finalText = buildDraftText(draft);

      if (shouldPublishInstagram) {
        for (const account of selectedAccounts) {
          const statusKey = `instagram-${account.id}`;
          setPublishStatuses((current) => ({
            ...current,
            [statusKey]: { state: "uploading" },
          }));

          try {
            throw new Error(
              "Instagram direct text post support nahi karta. Photo page se image/reel bana ke post karo.",
            );
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
            await publishFacebookPageText({
              pageId: account.pageId,
              token: account.token,
              message: finalText,
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
            const accessToken = account.accessToken || account.token;
            if (!accessToken) {
              throw new Error("YouTube token missing hai. Account reconnect karo.");
            }
            throw new Error(
              "YouTube direct text post support nahi karta. Photo page se video bana ke upload karo.",
            );
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

      if (
        shouldPublishInstagram ||
        (shouldPublishFacebookYouTube && selectedYouTubeAccounts.length > 0)
      ) {
        setWarning(
          "Text page Cloudinary upload nahi karega. FB Page direct text post hota hai; Instagram/YouTube ke liye Make Photo use karo.",
        );
      }

      return true;
    } catch (publishError: any) {
      setError(publishError?.message || "Text post publish nahi ho paya.");
      return false;
    } finally {
      setIsPublishing(false);
    }
  }, [
    canvasToImageFile,
    canvasToVideoFile,
    musicFile,
    publishTargetMode,
    selectedAccounts,
    selectedYouTubeAccounts,
  ]);

  const postNow = useCallback(async () => {
    const draft = drafts[0] || (await generateDraft());
    if (!draft) {
      return;
    }

    await publishDraft(draft);
  }, [drafts, generateDraft, publishDraft]);

  const runAutoTextPost = useCallback(async () => {
    if (autoRunInProgressRef.current) {
      return;
    }

    if (!hasPublishTargets) {
      setWorkerEnabled(false);
      setError("Auto post ke liye Instagram, Facebook Page, ya YouTube target select karo.");
      return;
    }

    autoRunInProgressRef.current = true;
    try {
      const draft = await generateDraft();
      if (draft) {
        await publishDraft(draft);
      }
    } finally {
      autoRunInProgressRef.current = false;
    }
  }, [generateDraft, hasPublishTargets, publishDraft]);

  const openInPhotoPage = (draft: AutoTextDraft) => {
    localStorage.setItem(
      AUTO_PHOTO_SEED_STORAGE_KEY,
      JSON.stringify({
        headline: draft.hook,
        caption: draft.caption,
        cta: draft.cta,
        hashtags: draft.hashtags,
        topic: draft.topic,
        language: draft.language,
        accountIds: selectedAccountIds,
        publishTargetMode,
        youtubeAccountIds: selectedYouTubeAccountIds,
      }),
    );
    router.push("/photo-with-text-auto-maction");
  };

  const startAutomation = () => {
    if (!hasPublishTargets) {
      setError("Auto post ke liye Instagram, Facebook Page, ya YouTube target select karo.");
      return;
    }

    setWorkerEnabled(true);
    if (!nextRunAt || new Date(nextRunAt).getTime() <= Date.now()) {
      setNextRunAt(new Date().toISOString());
    }
  };

  useEffect(() => {
    if (
      !workerEnabled ||
      isGenerating ||
      isPublishing ||
      autoRunInProgressRef.current
    ) {
      return;
    }

    const nextTime = nextRunAt ? new Date(nextRunAt).getTime() : 0;
    if (!nextTime || Date.now() >= nextTime) {
      void runAutoTextPost();
    }
  }, [
    isGenerating,
    isPublishing,
    nextRunAt,
    runAutoTextPost,
    workerEnabled,
  ]);

  useEffect(() => {
    if (!workerEnabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (isGenerating || isPublishing || autoRunInProgressRef.current) {
        return;
      }

      const nextTime = nextRunAt ? new Date(nextRunAt).getTime() : 0;
      if (!nextTime || Date.now() >= nextTime) {
        void runAutoTextPost();
      }
    }, 20_000);

    return () => window.clearInterval(intervalId);
  }, [
    isGenerating,
    isPublishing,
    nextRunAt,
    runAutoTextPost,
    workerEnabled,
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
            <div className="rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 p-2.5">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/70">
                Automation
              </p>
              <h1 className="truncate text-lg font-semibold">
                Text Auto Maction
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => void postNow()}
              disabled={isGenerating || isPublishing || !hasPublishTargets}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPublishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Post Now
            </button>
            <button
              onClick={
                workerEnabled ? () => setWorkerEnabled(false) : startAutomation
              }
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                workerEnabled
                  ? "border border-red-400/30 bg-red-500/15 text-red-200 hover:bg-red-500/25"
                  : "border border-emerald-400/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
              }`}
            >
              {workerEnabled ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {workerEnabled ? "Pause Hourly" : "Start Hourly"}
            </button>
          </div>
        </div>
      </header>

      <canvas ref={canvasRef} className="hidden" />

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-cyan-300" />
              <div>
                <h2 className="font-semibold">Prompt Control</h2>
                <p className="text-xs text-white/45">
                  Har hour new text draft publish hoga.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Topic / niche
                </span>
                <input
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-cyan-400/40 transition focus:border-cyan-300/50 focus:ring-2"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                    Language
                  </span>
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm text-white outline-none ring-cyan-400/40 transition focus:border-cyan-300/50 focus:ring-2"
                  >
                    <option>Hinglish</option>
                    <option>Hindi</option>
                    <option>English</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                    Hour
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={intervalHours}
                    onChange={(event) =>
                      setIntervalHours(
                        Math.min(
                          24,
                          Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                        ),
                      )
                    }
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-cyan-400/40 transition focus:border-cyan-300/50 focus:ring-2"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                  Tone
                </span>
                <textarea
                  value={tone}
                  onChange={(event) => setTone(event.target.value)}
                  className="mt-2 h-24 w-full resize-none rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none ring-cyan-400/40 transition focus:border-cyan-300/50 focus:ring-2"
                />
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
                            ? "border-cyan-300/40 bg-cyan-500/15 text-cyan-100"
                            : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-white/45">
                  FB par direct text feed post hoga. Instagram/YouTube direct text support nahi karte.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                      BG music
                    </p>
                    <p className="mt-1 truncate text-xs text-white/55">
                      {musicFileName || "Direct text post me music use nahi hoga"}
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
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/25 bg-cyan-500/10 px-5 py-3 font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingTrends ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <TrendingUp className="h-4 w-4" />
                  )}
                  Find Trends
                </button>
                <button
                  onClick={() => void generateDraft()}
                  disabled={isGenerating}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-5 py-3 font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
                        onClick={() => setTopic(idea.title)}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-left text-sm transition-colors hover:border-cyan-300/30"
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
              <Instagram className="h-5 w-5 text-pink-300" />
              <div>
                <h2 className="font-semibold">Accounts</h2>
                <p className="text-xs text-white/45">
                  Selected target par direct publish hoga.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">
                Instagram / Facebook Page
              </p>
              {accounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/50">
                  Instagram account login karo, phir yahan select hoga.
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
                              (publishTargetMode === "facebook-youtube"
                                ? account.pageId
                                  ? "FB Page text ready, Instagram ignore hoga"
                                  : "FB Page missing"
                                : `${account.followers_count?.toLocaleString() || 0} followers`)}
                        </p>
                      </div>
                      {status?.state === "uploading" ? (
                        <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                      ) : status?.state === "success" ? (
                        <CheckCircle className="h-5 w-5 text-emerald-300" />
                      ) : selected ? (
                        <CheckCircle className="h-5 w-5 text-cyan-300" />
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
                                  : status?.state ||
                                    "Text card video upload ke liye use hoga."}
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
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-amber-300" />
              <div>
                <h2 className="font-semibold">Worker Status</h2>
                <p className="text-xs text-white/45">
                  No-browser mode ke liye same AI route cron se call ho sakta hai.
                </p>
              </div>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/45">Status</dt>
                <dd className={workerEnabled ? "text-emerald-300" : "text-white/70"}>
                  {workerEnabled ? "Hourly on" : "Paused"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/45">Last</dt>
                <dd className="text-right text-white/70">{formatTime(lastRunAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/45">Next</dt>
                <dd className="text-right text-white/70">{formatTime(nextRunAt)}</dd>
              </div>
            </dl>
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

          <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-cyan-500/10 via-emerald-500/10 to-pink-500/10 p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-cyan-200/70">
                  Draft Queue
                </p>
                <h2 className="mt-2 text-2xl font-bold">
                  {drafts.length} text post{drafts.length === 1 ? "" : "s"} ready
                </h2>
                <p className="mt-2 text-sm text-white/55">
                  Post Now se latest draft publish karo ya kisi draft par Post dabao.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white/70">
                {publishTargetMode === "instagram"
                  ? `${selectedAccounts.length} Instagram selected`
                  : `${selectedAccounts.length} IG/FB, ${selectedYouTubeAccounts.length} YouTube selected`}
              </div>
            </div>
          </div>

          {drafts.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
              <Bot className="mx-auto mb-4 h-12 w-12 text-white/25" />
              <p className="text-lg font-semibold">Abhi koi draft nahi hai</p>
              <p className="mt-2 text-sm text-white/50">
                Generate Text Post dabao, phir Post Now se publish karo.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {drafts.map((draft) => (
                <article
                  key={draft.id}
                  className="rounded-3xl border border-white/10 bg-slate-900/60 p-5 transition-colors hover:border-cyan-400/30"
                >
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-cyan-300/25 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
                          Score {draft.score}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/50">
                          {draft.source}
                        </span>
                      </div>
                      <h3 className="text-xl font-semibold leading-snug">
                        {draft.hook}
                      </h3>
                    </div>
                    <button
                      onClick={() => clearDraft(draft.id)}
                      className="rounded-xl p-2 text-white/35 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-6 text-white/75">
                    {draft.caption}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {draft.hashtags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-white/8 px-2.5 py-1 text-xs text-white/60"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/40 p-3 text-sm text-white/55">
                    {draft.audienceReason}
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <button
                      onClick={() => void copyDraft(draft)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold transition-colors hover:bg-white/10"
                    >
                      {copiedDraftId === draft.id ? (
                        <CheckCircle className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {copiedDraftId === draft.id ? "Copied" : "Copy Text"}
                    </button>
                    <button
                      onClick={() => void publishDraft(draft)}
                      disabled={isPublishing || !hasPublishTargets}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-300/25 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isPublishing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Post
                    </button>
                    <button
                      onClick={() => openInPhotoPage(draft)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-amber-500 px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-90"
                    >
                      <ImageIcon className="h-4 w-4" />
                      Make Photo
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

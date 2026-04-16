"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import type React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  Check,
  Cloud,
  Download,
  FolderOpen,
  Instagram,
  Loader2,
  Pause,
  Play,
  Sparkles,
  Trash2,
  Upload,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import {
  createMedia,
  generateSmartCaption,
  publishMedia,
  uploadMediaAssetToCloudinary,
} from "@/lib/meta";
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  validateMediaFile,
} from "@/lib/media-upload";

interface VideoFile {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "processing" | "uploaded" | "scheduled" | "error";
  uploadedUrl?: string;
  error?: string;
  processedAt?: string;
  originalTitle?: string;
}

interface QueueSettings {
  title: string;
  description: string;
  keywords: string;
  intervalMinutes: number;
  startDelayMinutes?: number;
  mode: "now" | "schedule";
  scheduledDate: string;
  scheduledTime: string;
  cloudinaryFolder: string;
  deleteAfterPublish: boolean;
}

interface Account {
  id: string;
  username: string;
  profile_picture_url?: string;
  platform: "instagram" | "youtube";
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  name?: string;
  thumbnail?: string;
}

const folderInputProps = {
  webkitdirectory: "true",
  directory: "true",
} as any;

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

function BulkUploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [settings, setSettings] = useState<QueueSettings>({
    title: "",
    description: "",
    keywords: "",
    intervalMinutes: 5,
    startDelayMinutes: 0,
    mode: "now",
    scheduledDate: "",
    scheduledTime: "",
    cloudinaryFolder: `bulk-uploads/${new Date().toISOString().slice(0, 10)}`,
    deleteAfterPublish: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Account[]>([]);
  const [showAccountSelector, setShowAccountSelector] = useState(false);
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);

  useEffect(() => {
    const loadSegmentsFromSplitter = async () => {
      const source = searchParams.get("source");
      if (source !== "splitter") {
        return;
      }

      setLoadingSegments(true);
      const segmentsJson = sessionStorage.getItem("pending_video_segments");

      if (segmentsJson) {
        try {
          const segmentsData = JSON.parse(segmentsJson);
          const loadedVideos = await Promise.all(
            segmentsData.map(async (segment: any) => {
              const response = await fetch(segment.blobUrl);
              const blob = await response.blob();

              return {
                id: segment.id,
                file: new File([blob], segment.fileName, { type: "video/mp4" }),
                preview: segment.blobUrl,
                status: "pending" as const,
                originalTitle: segment.title,
              };
            }),
          );

          setVideos(loadedVideos);
          sessionStorage.removeItem("pending_video_segments");
          toast.success(`Loaded ${loadedVideos.length} video segments from splitter`);
        } catch (error) {
          console.error("[v0] Failed to load splitter segments:", error);
          toast.error("Failed to load video segments");
        }
      }

      setLoadingSegments(false);
    };

    loadSegmentsFromSplitter();

    const igAccounts = JSON.parse(localStorage.getItem("ig_accounts") || "[]");
    const ytAccounts = JSON.parse(localStorage.getItem("youtube_accounts") || "[]");

    const accounts: Account[] = [
      ...igAccounts.map((account: any) => ({
        ...account,
        username: account.username,
        platform: "instagram" as const,
      })),
      ...ytAccounts.map((account: any) => ({
        ...account,
        username: account.username || account.name,
        platform: "youtube" as const,
      })),
    ];

    setAllAccounts(accounts);
    setSelectedAccounts(accounts);

    return () => {
      videos.forEach((video) => URL.revokeObjectURL(video.preview));
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
      }
    };
  }, [searchParams]);

  const addFilesToQueue = async (files: File[]) => {
    const validFiles: File[] = [];

    for (const file of files) {
      if (!file.type.startsWith("video/")) {
        continue;
      }

      const validationError = validateMediaFile(file);
      if (validationError) {
        toast.error(`${file.name}: ${validationError}`);
        continue;
      }

      validFiles.push(file);
    }

    const nextVideos = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
      status: "pending" as const,
      originalTitle: file.name.replace(/\.[^.]+$/, ""),
    }));

    setVideos((prev) => [...prev, ...nextVideos]);
  };

  const handleFilesSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await addFilesToQueue(Array.from(event.target.files || []));
  };

  const handleFolderSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    await addFilesToQueue(Array.from(event.target.files || []));
  };

  const removeVideo = (id: string) => {
    setVideos((prev) => {
      const target = prev.find((video) => video.id === id);
      if (target) {
        URL.revokeObjectURL(target.preview);
      }
      return prev.filter((video) => video.id !== id);
    });
  };

  const clearAllVideos = () => {
    videos.forEach((video) => URL.revokeObjectURL(video.preview));
    setVideos([]);
    setCurrentVideoIndex(0);
  };

  const downloadVideo = (video: VideoFile) => {
    const url = URL.createObjectURL(video.file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = video.file.name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleAccount = (account: Account) => {
    setSelectedAccounts((prev) => {
      const exists = prev.some(
        (item) => item.id === account.id && item.platform === account.platform,
      );

      if (exists) {
        return prev.filter(
          (item) => !(item.id === account.id && item.platform === account.platform),
        );
      }

      return [...prev, account];
    });
  };

  const generateCaptionDraft = async () => {
    setIsGeneratingCaption(true);
    try {
      const keywords = settings.keywords
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      setSettings((prev) => ({
        ...prev,
        description: generateSmartCaption({
          title: prev.title || "Bulk upload campaign",
          description: prev.description,
          keywords,
        }),
      }));
    } finally {
      setIsGeneratingCaption(false);
    }
  };

  const scheduleQueue = async () => {
    if (!settings.scheduledDate || !settings.scheduledTime) {
      toast.error("Pick schedule date and time");
      return;
    }

    const baseTime = new Date(`${settings.scheduledDate}T${settings.scheduledTime}`);
    if (baseTime <= new Date()) {
      toast.error("Schedule time must be in the future");
      return;
    }

    for (let index = 0; index < videos.length; index++) {
      const video = videos[index];
      const asset = await uploadMediaAssetToCloudinary(video.file, {
        folder: settings.cloudinaryFolder,
      });
      const caption = generateSmartCaption({
        title: video.originalTitle || settings.title,
        description: settings.description,
        keywords: settings.keywords
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      const scheduledFor = new Date(
        baseTime.getTime() + index * settings.intervalMinutes * 60 * 1000,
      );

      const scheduledPosts = JSON.parse(
        localStorage.getItem("scheduled_posts") || "[]",
      );
      scheduledPosts.push({
        id: `${Date.now()}-${index}`,
        mediaUrl: asset.secureUrl,
        cloudinaryPublicId: asset.publicId,
        cloudinaryResourceType: asset.resourceType,
        caption,
        title: video.originalTitle || settings.title,
        keywords: settings.keywords,
        contentType: "REEL",
        accounts: selectedAccounts.map((account) => ({
          id: account.id,
          username: account.username,
          platform: account.platform,
          token: account.token || account.accessToken,
        })),
        scheduledFor: scheduledFor.toISOString(),
        status: "scheduled",
      });
      localStorage.setItem("scheduled_posts", JSON.stringify(scheduledPosts));

      setVideos((prev) =>
        prev.map((item) =>
          item.id === video.id
            ? {
                ...item,
                status: "scheduled",
                uploadedUrl: asset.secureUrl,
              }
            : item,
        ),
      );
    }

    toast.success("Bulk schedule created. Check dashboard scheduled posts.");
    setIsProcessing(false);
  };

  const startBulkUpload = async () => {
    if (videos.length === 0) {
      toast.error("Please add at least one video");
      return;
    }

    if (selectedAccounts.length === 0) {
      toast.error("Please keep at least one account selected");
      return;
    }

    setIsProcessing(true);

    if (settings.mode === "schedule") {
      await scheduleQueue();
      return;
    }

    if (settings.startDelayMinutes && settings.startDelayMinutes > 0) {
      toast.info(`Queue will start in ${settings.startDelayMinutes} minutes`);
      intervalRef.current = setTimeout(
        () => void processNextVideo(),
        settings.startDelayMinutes * 60 * 1000,
      );
      return;
    }

    await processNextVideo();
  };

  const processNextVideo = async () => {
    const pendingVideo = videos.find((video) => video.status === "pending");

    if (!pendingVideo) {
      setIsProcessing(false);
      toast.success("All videos processed");
      return;
    }

    setCurrentVideoIndex(videos.findIndex((video) => video.id === pendingVideo.id) + 1);
    setVideos((prev) =>
      prev.map((video) =>
        video.id === pendingVideo.id ? { ...video, status: "processing" } : video,
      ),
    );

    try {
      const asset = await uploadMediaAssetToCloudinary(pendingVideo.file, {
        folder: settings.cloudinaryFolder,
      });
      const keywords = settings.keywords
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const caption = generateSmartCaption({
        title: pendingVideo.originalTitle || settings.title,
        description: settings.description,
        keywords,
      });

      let successCount = 0;

      for (const account of selectedAccounts) {
        try {
          if (account.platform === "instagram") {
            const containerId = await createMedia({
              igUserId: account.id,
              token: account.token,
              mediaUrl: asset.secureUrl,
              caption,
              isReel: true,
            });

            await publishMedia({
              igUserId: account.id,
              token: account.token,
              creationId: containerId,
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
                videoUrl: asset.secureUrl,
                title:
                  pendingVideo.originalTitle ||
                  settings.title ||
                  "Bulk Upload Video",
                description: caption,
                keywords,
                privacy: "public",
                isShort: true,
              }),
            });

            const data = await response.json();
            if (!response.ok) {
              throw new Error(data.error || "YouTube upload failed");
            }
          }

          successCount += 1;
        } catch (accountError: any) {
          toast.error(
            `${account.username}: ${accountError.message || "Publish failed"}`,
          );
        }
      }

      if (
        settings.deleteAfterPublish &&
        successCount === selectedAccounts.length &&
        asset.publicId
      ) {
        await deleteCloudinaryAsset(asset.publicId, asset.resourceType);
      }

      setVideos((prev) =>
        prev.map((video) =>
          video.id === pendingVideo.id
            ? {
                ...video,
                status: "uploaded",
                uploadedUrl: asset.secureUrl,
                processedAt: new Date().toISOString(),
              }
            : video,
        ),
      );

      const remainingPending = videos.filter(
        (video) => video.status === "pending" && video.id !== pendingVideo.id,
      );

      if (remainingPending.length > 0) {
        intervalRef.current = setTimeout(
          () => void processNextVideo(),
          settings.intervalMinutes * 60 * 1000,
        );
      } else {
        setIsProcessing(false);
        toast.success("Bulk publish completed");
      }
    } catch (error: any) {
      setVideos((prev) =>
        prev.map((video) =>
          video.id === pendingVideo.id
            ? { ...video, status: "error", error: error.message }
            : video,
        ),
      );
      setIsProcessing(false);
      toast.error(error.message || "Bulk upload failed");
    }
  };

  const stopProcessing = () => {
    setIsProcessing(false);
    setCurrentVideoIndex(0);
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const stats = {
    total: videos.length,
    pending: videos.filter((video) => video.status === "pending").length,
    processing: videos.filter((video) => video.status === "processing").length,
    uploaded: videos.filter((video) => video.status === "uploaded").length,
    scheduled: videos.filter((video) => video.status === "scheduled").length,
    error: videos.filter((video) => video.status === "error").length,
  };

  const allSelected = selectedAccounts.length === allAccounts.length;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b_0%,#020617_45%,#000_100%)]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-xl p-2 transition-colors hover:bg-white/10"
            >
              <ArrowLeft className="h-5 w-5 text-white/70" />
            </button>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/70">
                Pro Queue
              </p>
              <h1 className="truncate text-xl font-semibold text-white sm:text-2xl">
                Bulk Upload Studio
              </h1>
            </div>
          </div>

          {isProcessing ? (
            <button
              onClick={stopProcessing}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600 sm:w-auto"
            >
              <Pause className="h-4 w-4" />
              Stop Queue
            </button>
          ) : (
            <button
              onClick={startBulkUpload}
              disabled={videos.length === 0 || loadingSegments}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-5 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {settings.mode === "schedule" ? (
                <CalendarClock className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {settings.mode === "schedule" ? "Create Schedule" : "Post Now"}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        {loadingSegments && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-blue-200">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading segments from splitter...
          </div>
        )}

        <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xl font-bold text-white sm:text-2xl">{stats.total}</div>
            <div className="text-xs text-white/60 sm:text-sm">Total</div>
          </div>
          <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
            <div className="text-xl font-bold text-yellow-300 sm:text-2xl">{stats.pending}</div>
            <div className="text-xs text-white/60 sm:text-sm">Pending</div>
          </div>
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
            <div className="text-xl font-bold text-blue-300 sm:text-2xl">{stats.processing}</div>
            <div className="text-xs text-white/60 sm:text-sm">Processing</div>
          </div>
          <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-4">
            <div className="text-xl font-bold text-green-300 sm:text-2xl">{stats.uploaded}</div>
            <div className="text-xs text-white/60 sm:text-sm">Posted</div>
          </div>
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
            <div className="text-xl font-bold text-cyan-300 sm:text-2xl">{stats.scheduled}</div>
            <div className="text-xs text-white/60 sm:text-sm">Scheduled</div>
          </div>
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
            <div className="text-xl font-bold text-red-300 sm:text-2xl">{stats.error}</div>
            <div className="text-xs text-white/60 sm:text-sm">Failed</div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/70">
                    Campaign Setup
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    Smart defaults on
                  </h2>
                </div>
                <button
                  onClick={generateCaptionDraft}
                  disabled={isGeneratingCaption}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
                >
                  {isGeneratingCaption ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  AI Caption
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-2">
                  <button
                    onClick={() =>
                      setSettings((prev) => ({ ...prev, mode: "now" }))
                    }
                    className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                      settings.mode === "now"
                        ? "bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white"
                        : "text-white/65 hover:bg-white/5"
                    }`}
                  >
                    Post Now
                  </button>
                  <button
                    onClick={() =>
                      setSettings((prev) => ({ ...prev, mode: "schedule" }))
                    }
                    className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                      settings.mode === "schedule"
                        ? "bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white"
                        : "text-white/65 hover:bg-white/5"
                    }`}
                  >
                    Schedule
                  </button>
                </div>

                <input
                  type="text"
                  value={settings.title}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="Campaign title or title prefix"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />

                <textarea
                  value={settings.description}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  rows={5}
                  placeholder="Description / caption base"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />

                <input
                  type="text"
                  value={settings.keywords}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, keywords: event.target.value }))
                  }
                  placeholder="Keywords, comma, separated"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />

                <input
                  type="text"
                  value={settings.cloudinaryFolder}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      cloudinaryFolder: event.target.value,
                    }))
                  }
                  placeholder="Cloudinary folder"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-white placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />

                {settings.mode === "schedule" ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      type="date"
                      value={settings.scheduledDate}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          scheduledDate: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                    />
                    <input
                      type="time"
                      value={settings.scheduledTime}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          scheduledTime: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      type="number"
                      min="1"
                      value={settings.intervalMinutes}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          intervalMinutes: Number.parseInt(event.target.value) || 5,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                    />
                    <input
                      type="number"
                      min="0"
                      value={settings.startDelayMinutes || 0}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          startDelayMinutes: Number.parseInt(event.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                    />
                  </div>
                )}

                <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/70">
                  <input
                    type="checkbox"
                    checked={settings.deleteAfterPublish}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        deleteAfterPublish: event.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded"
                  />
                  Delete Cloudinary file after successful post on all selected accounts
                </label>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-white">Connected Accounts</h2>
                <button
                  onClick={() => setShowAccountSelector((prev) => !prev)}
                  className="text-left text-sm text-cyan-300"
                >
                  {showAccountSelector ? "Hide" : "Manage"}
                </button>
              </div>

              <div className="mb-4 rounded-2xl border border-emerald-400/15 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                Default me saare connected accounts selected hain.
              </div>

              <button
                onClick={() =>
                  setSelectedAccounts(allSelected ? [] : allAccounts)
                }
                className="mb-4 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-white/70 sm:w-auto"
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>

              {showAccountSelector && (
                <div className="space-y-2">
                  {allAccounts.map((account) => (
                    <button
                      key={`${account.id}-${account.platform}`}
                      onClick={() => toggleAccount(account)}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${
                        selectedAccounts.some(
                          (item) =>
                            item.id === account.id &&
                            item.platform === account.platform,
                        )
                          ? "border-cyan-400/30 bg-cyan-400/10"
                          : "border-white/10 bg-slate-950/40"
                      }`}
                    >
                      {account.platform === "instagram" ? (
                        <Instagram className="h-5 w-5 text-pink-400" />
                      ) : (
                        <Youtube className="h-5 w-5 text-red-400" />
                      )}
                      <div className="flex-1">
                        <p className="font-medium text-white">{account.username}</p>
                        <p className="text-xs capitalize text-white/45">
                          {account.platform}
                        </p>
                      </div>
                      {selectedAccounts.some(
                        (item) =>
                          item.id === account.id && item.platform === account.platform,
                      ) && <Check className="h-4 w-4 text-cyan-300" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-white">Add Videos</h2>
                {videos.length > 0 && (
                  <button
                    onClick={clearAllVideos}
                    className="w-full rounded-xl bg-red-500/20 px-3 py-1 text-xs text-red-300 sm:w-auto"
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-3xl border-2 border-dashed border-white/15 bg-slate-950/40 px-4 py-10 text-center transition-colors hover:border-cyan-400/40"
                >
                  <Upload className="mx-auto h-6 w-6 text-cyan-300" />
                  <p className="mt-3 font-medium text-white">Select videos</p>
                  <p className="mt-1 text-xs text-white/45">
                    Max {(MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024 * 1024)).toFixed(0)}GB each
                  </p>
                </button>

                <button
                  onClick={() => folderInputRef.current?.click()}
                  className="rounded-3xl border-2 border-dashed border-white/15 bg-slate-950/40 px-4 py-10 text-center transition-colors hover:border-cyan-400/40"
                >
                  <FolderOpen className="mx-auto h-6 w-6 text-emerald-300" />
                  <p className="mt-3 font-medium text-white">Select folder</p>
                  <p className="mt-1 text-xs text-white/45">
                    Entire folder queue me add ho jayega
                  </p>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                multiple
                onChange={handleFilesSelect}
                className="hidden"
              />
              <input
                {...folderInputProps}
                ref={folderInputRef}
                type="file"
                accept="video/*"
                multiple
                onChange={handleFolderSelect}
                className="hidden"
              />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/70">
                  Live Queue
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Video Queue ({videos.length})
                </h2>
              </div>
              {currentVideoIndex > 0 && (
                <div className="rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1 text-center text-sm text-blue-200">
                  Processing #{currentVideoIndex}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {videos.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-12 text-center text-white/45">
                  Queue empty. Add videos or a full folder to begin.
                </div>
              ) : (
                videos.map((video) => (
                  <div
                    key={video.id}
                    className={`rounded-3xl border p-4 ${
                      video.status === "uploaded"
                        ? "border-green-500/25 bg-green-500/10"
                        : video.status === "scheduled"
                          ? "border-cyan-500/25 bg-cyan-500/10"
                          : video.status === "processing"
                            ? "border-blue-500/25 bg-blue-500/10"
                            : video.status === "error"
                              ? "border-red-500/25 bg-red-500/10"
                              : "border-white/10 bg-slate-950/40"
                    }`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row">
                      <video
                        src={video.preview}
                        className="h-40 w-full rounded-2xl bg-black object-cover sm:h-20 sm:w-20"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-white">
                          {video.originalTitle || video.file.name}
                        </p>
                        <p className="mt-1 text-xs text-white/45">
                          {(video.file.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                        <p className="mt-2 text-xs text-white/70">
                          {video.status === "uploaded"
                            ? "Published"
                            : video.status === "scheduled"
                              ? "Scheduled"
                              : video.status === "processing"
                                ? "Processing now..."
                                : video.status === "error"
                                  ? video.error
                                  : "Waiting in queue"}
                        </p>
                      </div>
                      <div className="flex gap-2 self-end sm:self-start">
                        <button
                          onClick={() => downloadVideo(video)}
                          className="rounded-xl p-2 transition-colors hover:bg-white/10"
                        >
                          <Download className="h-4 w-4 text-white/60" />
                        </button>
                        <button
                          onClick={() => removeVideo(video.id)}
                          className="rounded-xl p-2 transition-colors hover:bg-red-500/20"
                        >
                          <Trash2 className="h-4 w-4 text-red-300" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function BulkUploadPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <BulkUploadContent />
    </Suspense>
  );
}

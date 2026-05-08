"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import type React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Download,
  FolderOpen,
  Instagram,
  Loader2,
  PauseCircle,
  PlayCircle,
  Sparkles,
  Trash2,
  Upload,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildCloudinaryVideoDownloadUrl,
  createMedia,
  publishMedia,
  uploadMediaAssetToCloudinary,
} from "@/lib/meta";
import {
  buildBulkVideoSeoDraft,
  buildCaptionFromSeoDraft,
  buildYouTubeDescriptionFromSeoDraft,
  buildYouTubeTagsFromKeywords,
  splitKeywordText,
  type BulkVideoSeoDraft,
} from "@/lib/bulk-video-seo";
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  validateMediaFile,
} from "@/lib/media-upload";
import { processDueScheduledPosts } from "@/lib/scheduled-posts";

interface VideoItem {
  id: string;
  source: "local" | "cloudinary";
  file?: File;
  preview: string;
  status: "pending" | "processing" | "uploaded" | "scheduled" | "error";
  uploadedUrl?: string;
  error?: string;
  processedAt?: string;
  originalTitle: string;
  sizeBytes: number;
  durationSeconds?: number;
  cloudinaryPublicId?: string;
  cloudinaryResourceType?: string;
  assetFolder?: string;
  createdAt?: string;
  seo: BulkVideoSeoDraft;
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
  cloudinaryImportFolder: string;
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

interface CloudinaryVideoResource {
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

const folderInputProps = {
  webkitdirectory: "true",
  directory: "true",
} as any;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isBlobUrl(value: string) {
  return value.startsWith("blob:");
}

function formatBytes(value?: number) {
  if (!value || value <= 0) {
    return "Size unknown";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatDate(value?: string) {
  if (!value) {
    return "Just now";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  return parsed.toLocaleString();
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

  if (platform === "youtube" && message.toLowerCase().includes("access token")) {
    return "YouTube token missing ya expired hai. YouTube account reconnect karo.";
  }

  return message;
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

function BulkUploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const videosRef = useRef<VideoItem[]>([]);
  const selectedAccountsRef = useRef<Account[]>([]);
  const settingsRef = useRef<QueueSettings | null>(null);
  const scheduledPostProcessingRef = useRef(false);

  const [videos, setVideos] = useState<VideoItem[]>([]);
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
    cloudinaryImportFolder: "shorts-videos",
    deleteAfterPublish: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [isImportingCloudinary, setIsImportingCloudinary] = useState(false);
  const [isRefreshingSeo, setIsRefreshingSeo] = useState(false);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Account[]>([]);
  const [showAccountSelector, setShowAccountSelector] = useState(false);

  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  useEffect(() => {
    selectedAccountsRef.current = selectedAccounts;
  }, [selectedAccounts]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const runScheduledWorker = async () => {
      if (scheduledPostProcessingRef.current) {
        return;
      }

      scheduledPostProcessingRef.current = true;
      try {
        const result = await processDueScheduledPosts();
        if (result.posted > 0) {
          toast.success(
            `${result.posted} scheduled post due time par publish ho gaya.`,
          );
        }
        if (result.failed > 0) {
          toast.error(`${result.failed} scheduled post fail hua.`);
        }
      } catch (error) {
        console.warn("[v0] Scheduled post worker failed:", error);
      } finally {
        scheduledPostProcessingRef.current = false;
      }
    };

    void runScheduledWorker();
    const intervalId = window.setInterval(runScheduledWorker, 30_000);
    window.addEventListener("focus", runScheduledWorker);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", runScheduledWorker);
    };
  }, []);

  const buildSeoDraftForAsset = (
    rawName: string,
    folder: string | undefined,
    durationSeconds?: number,
  ) =>
    buildBulkVideoSeoDraft({
      rawName,
      folder,
      titlePrefix: settingsRef.current?.title,
      descriptionContext: settingsRef.current?.description,
      extraKeywords: splitKeywordText(settingsRef.current?.keywords || ""),
      durationSeconds,
    });

  const createLocalVideoItem = ({
    file,
    preview,
    originalTitle,
    assetFolder,
  }: {
    file: File;
    preview?: string;
    originalTitle?: string;
    assetFolder?: string;
  }): VideoItem => {
    const resolvedTitle =
      originalTitle || file.name.replace(/\.[^.]+$/, "") || "Local Video";
    const resolvedFolder =
      assetFolder || settingsRef.current?.cloudinaryFolder || "bulk-uploads";

    return {
      id: makeId(),
      source: "local",
      file,
      preview: preview || URL.createObjectURL(file),
      status: "pending",
      originalTitle: resolvedTitle,
      sizeBytes: file.size,
      assetFolder: resolvedFolder,
      seo: buildSeoDraftForAsset(resolvedTitle, resolvedFolder),
    };
  };

  const createCloudinaryVideoItem = (
    resource: CloudinaryVideoResource,
  ): VideoItem => {
    const resolvedTitle =
      resource.originalFilename ||
      resource.publicId.split("/").filter(Boolean).pop() ||
      "Cloudinary Video";

    return {
      id: resource.assetId || resource.publicId || makeId(),
      source: "cloudinary",
      preview: resource.secureUrl,
      uploadedUrl: resource.secureUrl,
      status: "pending",
      originalTitle: resolvedTitle.replace(/\.[^.]+$/, ""),
      sizeBytes: resource.bytes || 0,
      durationSeconds: resource.durationSeconds,
      cloudinaryPublicId: resource.publicId,
      cloudinaryResourceType: resource.resourceType || "video",
      assetFolder: resource.folder,
      createdAt: resource.createdAt,
      seo: buildSeoDraftForAsset(
        resolvedTitle,
        resource.folder,
        resource.durationSeconds,
      ),
    };
  };

  useEffect(() => {
    const igAccounts = JSON.parse(localStorage.getItem("ig_accounts") || "[]");
    const ytAccounts = JSON.parse(
      localStorage.getItem("youtube_accounts") || "[]",
    );

    const accounts: Account[] = [
      ...igAccounts.map((account: any) => ({
        ...account,
        username: account.username,
        platform: "instagram" as const,
      })),
      ...ytAccounts.map((account: any) => ({
        ...account,
        username: account.username || account.name || "YouTube Account",
        platform: "youtube" as const,
      })),
    ];

    setAllAccounts(accounts);
    setSelectedAccounts(accounts);

    return () => {
      videosRef.current.forEach((video) => {
        if (isBlobUrl(video.preview)) {
          URL.revokeObjectURL(video.preview);
        }
      });

      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const loadInitialSource = async () => {
      const source = searchParams.get("source");
      const folder = searchParams.get("folder")?.trim();

      if (folder) {
        setSettings((current) => ({
          ...current,
          cloudinaryImportFolder: folder,
        }));
      }

      if (source === "splitter") {
        setLoadingSegments(true);
        const segmentsJson = sessionStorage.getItem("pending_video_segments");

        if (segmentsJson) {
          try {
            const segmentsData = JSON.parse(segmentsJson);
            const loadedVideos = await Promise.all(
              segmentsData.map(async (segment: any) => {
                const response = await fetch(segment.blobUrl);
                const blob = await response.blob();

                return createLocalVideoItem({
                  file: new File([blob], segment.fileName, {
                    type: blob.type || "video/mp4",
                  }),
                  preview: segment.blobUrl,
                  originalTitle: segment.title,
                  assetFolder: settingsRef.current?.cloudinaryFolder,
                });
              }),
            );

            setVideos(loadedVideos);
            sessionStorage.removeItem("pending_video_segments");
            toast.success(`Loaded ${loadedVideos.length} split videos`);
          } catch (error) {
            console.error("[v0] Failed to load splitter segments:", error);
            toast.error("Splitter videos load nahi huye");
          }
        }

        setLoadingSegments(false);
      }

      if (source === "cloudinary" && (folder || settingsRef.current)) {
        const targetFolder = folder || settingsRef.current?.cloudinaryImportFolder;
        if (!targetFolder) {
          return;
        }

        setIsImportingCloudinary(true);
        try {
          const response = await fetch(
            `/api/cloudinary/resources?folder=${encodeURIComponent(targetFolder)}`,
          );
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Cloudinary folder load failed");
          }

          const importedVideos = Array.isArray(data.resources)
            ? data.resources.map((resource: CloudinaryVideoResource) =>
                createCloudinaryVideoItem(resource),
              )
            : [];

          setVideos((current) => {
            const existingIds = new Set(
              current
                .map((item) => item.cloudinaryPublicId)
                .filter((value): value is string => Boolean(value)),
            );

            const deduped = importedVideos.filter(
              (item: VideoItem) =>
                !existingIds.has(item.cloudinaryPublicId || ""),
            );

            return [...deduped, ...current];
          });

          if (importedVideos.length > 0) {
            toast.success(
              `${importedVideos.length} Cloudinary videos queue me aa gayi`,
            );
          }
        } catch (error: any) {
          toast.error(error.message || "Cloudinary folder import nahi hua");
        } finally {
          setIsImportingCloudinary(false);
        }
      }
    };

    void loadInitialSource();
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

    if (validFiles.length === 0) {
      return;
    }

    const nextVideos = validFiles.map((file) =>
      createLocalVideoItem({
        file,
        assetFolder: settingsRef.current?.cloudinaryFolder,
      }),
    );

    setVideos((current) => [...current, ...nextVideos]);
  };

  const handleFilesSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await addFilesToQueue(Array.from(event.target.files || []));
  };

  const handleFolderSelect = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    await addFilesToQueue(Array.from(event.target.files || []));
  };

  const importCloudinaryFolder = async (overrideFolder?: string) => {
    const targetFolder =
      overrideFolder?.trim() || settingsRef.current?.cloudinaryImportFolder || "";

    if (!targetFolder) {
      toast.error("Cloudinary import folder dalo");
      return;
    }

    setIsImportingCloudinary(true);

    try {
      const response = await fetch(
        `/api/cloudinary/resources?folder=${encodeURIComponent(targetFolder)}`,
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Cloudinary import failed");
      }

      const importedVideos = Array.isArray(data.resources)
        ? data.resources.map((resource: CloudinaryVideoResource) =>
            createCloudinaryVideoItem(resource),
          )
        : [];

      if (importedVideos.length === 0) {
        toast.error("Is folder me koi video nahi mili");
        return;
      }

      setVideos((current) => {
        const existingIds = new Set(
          current
            .map((item) => item.cloudinaryPublicId)
            .filter((value): value is string => Boolean(value)),
        );

        const deduped = importedVideos.filter(
          (item: VideoItem) => !existingIds.has(item.cloudinaryPublicId || ""),
        );

        return [...deduped, ...current];
      });

      toast.success(
        `${importedVideos.length} Cloudinary videos import ho gayi`,
      );
    } catch (error: any) {
      toast.error(error.message || "Cloudinary folder import nahi hua");
    } finally {
      setIsImportingCloudinary(false);
    }
  };

  const refreshSeoDrafts = async () => {
    if (videosRef.current.length === 0) {
      toast.error("Queue me videos nahi hain");
      return;
    }

    setIsRefreshingSeo(true);

    try {
      setVideos((current) =>
        current.map((video) => ({
          ...video,
          seo: buildSeoDraftForAsset(
            video.originalTitle,
            video.assetFolder,
            video.durationSeconds,
          ),
        })),
      );

      toast.success("SEO drafts refresh ho gayi");
    } finally {
      setIsRefreshingSeo(false);
    }
  };

  const removeVideo = (id: string) => {
    setVideos((current) => {
      const target = current.find((video) => video.id === id);

      if (target?.preview && isBlobUrl(target.preview)) {
        URL.revokeObjectURL(target.preview);
      }

      return current.filter((video) => video.id !== id);
    });
  };

  const clearAllVideos = () => {
    videosRef.current.forEach((video) => {
      if (isBlobUrl(video.preview)) {
        URL.revokeObjectURL(video.preview);
      }
    });

    setVideos([]);
    setCurrentVideoIndex(0);
  };

  const downloadVideo = (video: VideoItem) => {
    const downloadUrl =
      video.cloudinaryPublicId
        ? buildCloudinaryVideoDownloadUrl(video.cloudinaryPublicId)
        : "";
    const anchor = document.createElement("a");
    anchor.href = downloadUrl || video.uploadedUrl || video.preview;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.download = `${video.originalTitle}.mp4`;
    anchor.click();
  };

  const toggleAccount = (account: Account) => {
    setSelectedAccounts((current) => {
      const exists = current.some(
        (item) => item.id === account.id && item.platform === account.platform,
      );

      if (exists) {
        return current.filter(
          (item) =>
            !(item.id === account.id && item.platform === account.platform),
        );
      }

      return [...current, account];
    });
  };

  const updateVideoSeoField = (
    id: string,
    field: keyof BulkVideoSeoDraft,
    value: string,
  ) => {
    setVideos((current) =>
      current.map((video) => {
        if (video.id !== id) {
          return video;
        }

        if (field === "keywords") {
          return {
            ...video,
            seo: {
              ...video.seo,
              keywords: splitKeywordText(value),
            },
          };
        }

        return {
          ...video,
          seo: {
            ...video.seo,
            [field]: value,
          },
        };
      }),
    );
  };

  const ensureCloudinaryAsset = async (video: VideoItem) => {
    if (
      video.uploadedUrl &&
      video.cloudinaryPublicId &&
      video.cloudinaryResourceType
    ) {
      return {
        secureUrl: video.uploadedUrl,
        publicId: video.cloudinaryPublicId,
        resourceType: video.cloudinaryResourceType,
      };
    }

    if (video.source === "cloudinary" && video.uploadedUrl) {
      return {
        secureUrl: video.uploadedUrl,
        publicId: video.cloudinaryPublicId || "",
        resourceType: video.cloudinaryResourceType || "video",
      };
    }

    if (!video.file) {
      throw new Error("Local video file missing hai");
    }

    const asset = await uploadMediaAssetToCloudinary(video.file, {
      folder: settingsRef.current?.cloudinaryFolder,
    });

    setVideos((current) =>
      current.map((item) =>
        item.id === video.id
          ? {
              ...item,
              uploadedUrl: asset.secureUrl,
              cloudinaryPublicId: asset.publicId,
              cloudinaryResourceType: asset.resourceType,
              assetFolder: settingsRef.current?.cloudinaryFolder,
            }
          : item,
      ),
    );

    return asset;
  };

  const scheduleQueue = async () => {
    const settingsSnapshot = settingsRef.current;

    if (!settingsSnapshot?.scheduledDate || !settingsSnapshot.scheduledTime) {
      toast.error("Schedule date aur time pick karo");
      return;
    }

    const baseTime = new Date(
      `${settingsSnapshot.scheduledDate}T${settingsSnapshot.scheduledTime}`,
    );

    if (baseTime <= new Date()) {
      toast.error("Schedule time future me hona chahiye");
      return;
    }

    for (let index = 0; index < videosRef.current.length; index += 1) {
      const video = videosRef.current[index];
      const asset = await ensureCloudinaryAsset(video);
      const scheduledFor = new Date(
        baseTime.getTime() + index * settingsSnapshot.intervalMinutes * 60 * 1000,
      );
      const caption = buildCaptionFromSeoDraft(video.seo);
      const scheduledPosts = JSON.parse(
        localStorage.getItem("scheduled_posts") || "[]",
      );

      scheduledPosts.push({
        id: `${Date.now()}-${index}`,
        mediaUrl: asset.secureUrl,
        cloudinaryPublicId: asset.publicId,
        cloudinaryResourceType: asset.resourceType,
        caption,
        title: video.seo.title,
        description: video.seo.description,
        keywords: video.seo.keywords,
        contentType: "SHORT",
        accounts: selectedAccountsRef.current.map((account) => ({
          id: account.id,
          username: account.username,
          platform: account.platform,
          token: account.token || account.accessToken,
          accessToken: account.accessToken || account.token,
          refreshToken: account.refreshToken,
        })),
        scheduledFor: scheduledFor.toISOString(),
        status: "scheduled",
      });

      localStorage.setItem("scheduled_posts", JSON.stringify(scheduledPosts));

      setVideos((current) =>
        current.map((item) =>
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

    toast.success("Bulk schedule create ho gaya");
    setIsProcessing(false);
  };

  const processNextVideo = async () => {
    const pendingVideo = videosRef.current.find(
      (video) => video.status === "pending",
    );

    if (!pendingVideo) {
      setIsProcessing(false);
      toast.success("All queued videos process ho gayi");
      return;
    }

    const videoPosition =
      videosRef.current.findIndex((video) => video.id === pendingVideo.id) + 1;
    const remainingPending = videosRef.current.filter(
      (video) => video.status === "pending" && video.id !== pendingVideo.id,
    );
    const settingsSnapshot = settingsRef.current;

    setCurrentVideoIndex(videoPosition);
    setVideos((current) =>
      current.map((video) =>
        video.id === pendingVideo.id
          ? { ...video, status: "processing", error: undefined }
          : video,
      ),
    );

    try {
      const asset = await ensureCloudinaryAsset(pendingVideo);
      const caption = buildCaptionFromSeoDraft(pendingVideo.seo);
      const youtubeTags = buildYouTubeTagsFromKeywords(pendingVideo.seo.keywords);
      const youtubeDescription = buildYouTubeDescriptionFromSeoDraft(
        pendingVideo.seo,
        { isShort: true },
      );

      let successCount = 0;

      for (const account of selectedAccountsRef.current) {
        try {
          if (account.platform === "instagram") {
            const creationId = await createMedia({
              igUserId: account.id,
              token: account.token,
              mediaUrl: asset.secureUrl,
              caption,
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
                videoUrl: asset.secureUrl,
                title: pendingVideo.seo.title || pendingVideo.originalTitle,
                description: youtubeDescription,
                keywords: youtubeTags,
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
            `${account.username}: ${getFriendlyPublishError(
              accountError.message || "Publish failed",
              account.platform,
            )}`,
          );
        }
      }

      if (successCount === 0) {
        throw new Error("Selected accounts par publish nahi ho paya");
      }

      if (
        settingsSnapshot?.deleteAfterPublish &&
        successCount === selectedAccountsRef.current.length &&
        asset.publicId
      ) {
        await deleteCloudinaryAsset(asset.publicId, asset.resourceType);
      }

      setVideos((current) =>
        current.map((video) =>
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

      if (remainingPending.length > 0) {
        intervalRef.current = setTimeout(
          () => void processNextVideo(),
          (settingsSnapshot?.intervalMinutes || 5) * 60 * 1000,
        );
      } else {
        setIsProcessing(false);
        toast.success("Bulk publish complete ho gaya");
      }
    } catch (error: any) {
      setVideos((current) =>
        current.map((video) =>
          video.id === pendingVideo.id
            ? { ...video, status: "error", error: error.message }
            : video,
        ),
      );
      setIsProcessing(false);
      toast.error(error.message || "Bulk upload failed");
    }
  };

  const startBulkUpload = async () => {
    if (videosRef.current.length === 0) {
      toast.error("Queue me kam se kam ek video add karo");
      return;
    }

    if (selectedAccountsRef.current.length === 0) {
      toast.error("At least one target account selected rehna chahiye");
      return;
    }

    setIsProcessing(true);

    if (settingsRef.current?.mode === "schedule") {
      await scheduleQueue();
      return;
    }

    if (
      settingsRef.current?.startDelayMinutes &&
      settingsRef.current.startDelayMinutes > 0
    ) {
      toast.info(
        `Queue ${settingsRef.current.startDelayMinutes} minute baad start hogi`,
      );
      intervalRef.current = setTimeout(
        () => void processNextVideo(),
        settingsRef.current.startDelayMinutes * 60 * 1000,
      );
      return;
    }

    await processNextVideo();
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
  const importedCloudinaryCount = videos.filter(
    (video) => video.source === "cloudinary",
  ).length;
  const autoSeoReadyCount = videos.filter(
    (video) => video.seo.keywords.length > 0,
  ).length;

  const allSelected = selectedAccounts.length === allAccounts.length;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-900/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-xl p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-fuchsia-300/70">
                Bulk Bridge
              </p>
              <h1 className="text-xl font-semibold sm:text-2xl">
                Cloudinary to Insta + YouTube
              </h1>
            </div>
          </div>

          {isProcessing ? (
            <button
              onClick={stopProcessing}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 sm:w-auto"
            >
              <PauseCircle className="h-4 w-4" />
              Stop Queue
            </button>
          ) : (
            <button
              onClick={() => void startBulkUpload()}
              disabled={videos.length === 0 || loadingSegments || isImportingCloudinary}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {settings.mode === "schedule" ? (
                <CalendarClock className="h-4 w-4" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              {settings.mode === "schedule" ? "Create Schedule" : "Post Now"}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {loadingSegments && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-blue-200">
            <Loader2 className="h-5 w-5 animate-spin" />
            Splitter se videos load ho rahi hain...
          </div>
        )}

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-5">
            <div className="text-3xl font-semibold">{stats.total}</div>
            <p className="mt-2 text-sm text-white/55">Queue videos</p>
          </div>
          <div className="rounded-3xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-5">
            <div className="text-3xl font-semibold text-fuchsia-100">
              {selectedAccounts.length}
            </div>
            <p className="mt-2 text-sm text-fuchsia-100/80">Selected targets</p>
          </div>
          <div className="rounded-3xl border border-cyan-400/20 bg-cyan-500/10 p-5">
            <div className="text-3xl font-semibold text-cyan-100">
              {stats.uploaded + stats.scheduled}
            </div>
            <p className="mt-2 text-sm text-cyan-100/80">Completed</p>
          </div>
          <div className="rounded-3xl border border-amber-400/20 bg-amber-500/10 p-5">
            <div className="text-lg font-semibold text-amber-100">
              {currentVideoIndex > 0 ? `#${currentVideoIndex}` : "Ready"}
            </div>
            <p className="mt-2 text-sm text-amber-100/80">Current queue slot</p>
          </div>
        </div>

        <div className="mb-6 rounded-3xl border border-white/10 bg-slate-900/50 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-cyan-300/70">
                Clean Import Flow
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                Cloudinary import ke saath auto title, description, aur keywords
              </h2>
              <p className="mt-2 text-sm text-white/55">
                File name, folder name, aur runtime se har imported video ka SEO
                draft auto-fill hota hai. Yahan se bas review karo, thoda tweak
                karo, aur selected Insta/YouTube accounts par publish ya
                schedule chala do.
              </p>
            </div>
            <div className="grid gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <span>Import folder: `{settings.cloudinaryImportFolder}`</span>
              <span>{importedCloudinaryCount} Cloudinary videos in queue</span>
              <span>{autoSeoReadyCount} cards with SEO ready</span>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-5 shadow-2xl shadow-slate-950/30 backdrop-blur-xl">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-fuchsia-300/70">
                    Metadata Defaults
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    Clean SEO controls
                  </h2>
                  <p className="mt-2 text-sm text-white/55">
                    Imported Cloudinary videos already auto-fill metadata. Ye
                    fields sirf global boost ke liye hain, har card ko baad me
                    alag se edit kar sakte ho.
                  </p>
                </div>
                <button
                  onClick={() => void refreshSeoDrafts()}
                  disabled={isRefreshingSeo || videos.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isRefreshingSeo ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Refresh SEO Drafts
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-2">
                  <button
                    onClick={() =>
                      setSettings((current) => ({ ...current, mode: "now" }))
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
                      setSettings((current) => ({ ...current, mode: "schedule" }))
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
                    setSettings((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Optional title prefix, eg. Daily Shorts"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 outline-none transition-colors focus:border-fuchsia-400/40"
                />

                <textarea
                  value={settings.description}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  rows={5}
                  placeholder="Optional context line jo har description me merge hoga"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 outline-none transition-colors focus:border-fuchsia-400/40"
                />

                <input
                  type="text"
                  value={settings.keywords}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      keywords: event.target.value,
                    }))
                  }
                  placeholder="Extra keywords, comma separated"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 outline-none transition-colors focus:border-fuchsia-400/40"
                />

                <input
                  type="text"
                  value={settings.cloudinaryFolder}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cloudinaryFolder: event.target.value,
                    }))
                  }
                  placeholder="Cloudinary publish folder"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 outline-none transition-colors focus:border-fuchsia-400/40"
                />

                {settings.mode === "schedule" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="date"
                      value={settings.scheduledDate}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          scheduledDate: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none transition-colors focus:border-fuchsia-400/40"
                    />
                    <input
                      type="time"
                      value={settings.scheduledTime}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          scheduledTime: event.target.value,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none transition-colors focus:border-fuchsia-400/40"
                    />
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="number"
                      min="1"
                      value={settings.intervalMinutes}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          intervalMinutes:
                            Number.parseInt(event.target.value, 10) || 5,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none transition-colors focus:border-fuchsia-400/40"
                    />
                    <input
                      type="number"
                      min="0"
                      value={settings.startDelayMinutes || 0}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          startDelayMinutes:
                            Number.parseInt(event.target.value, 10) || 0,
                        }))
                      }
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none transition-colors focus:border-fuchsia-400/40"
                    />
                  </div>
                )}

                <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-white/70">
                  <input
                    type="checkbox"
                    checked={settings.deleteAfterPublish}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        deleteAfterPublish: event.target.checked,
                      }))
                    }
                    className="mt-1 h-4 w-4 rounded"
                  />
                  Publish sab selected accounts par success ho jaye to Cloudinary
                  asset auto-delete kar do.
                </label>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-5 shadow-2xl shadow-slate-950/30 backdrop-blur-xl">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-cyan-300/70">
                    Source Library
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    Add local videos ya import Cloudinary folder
                  </h2>
                </div>
                {videos.length > 0 && (
                  <button
                    onClick={clearAllVideos}
                    className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/20"
                  >
                    Clear Queue
                  </button>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-3xl border-2 border-dashed border-white/15 bg-slate-950/50 px-4 py-10 text-center transition-colors hover:border-cyan-400/40"
                >
                  <Upload className="mx-auto h-6 w-6 text-cyan-300" />
                  <p className="mt-3 font-medium">Select videos</p>
                  <p className="mt-1 text-xs text-white/45">
                    Max{" "}
                    {(
                      MAX_UPLOAD_FILE_SIZE_BYTES /
                      (1024 * 1024 * 1024)
                    ).toFixed(0)}
                    GB per video
                  </p>
                </button>

                <button
                  onClick={() => folderInputRef.current?.click()}
                  className="rounded-3xl border-2 border-dashed border-white/15 bg-slate-950/50 px-4 py-10 text-center transition-colors hover:border-emerald-400/40"
                >
                  <FolderOpen className="mx-auto h-6 w-6 text-emerald-300" />
                  <p className="mt-3 font-medium">Select folder</p>
                  <p className="mt-1 text-xs text-white/45">
                    Pura local folder queue me add ho jayega
                  </p>
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  value={settings.cloudinaryImportFolder}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      cloudinaryImportFolder: event.target.value,
                    }))
                  }
                  placeholder="Cloudinary import folder"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white placeholder:text-white/35 outline-none transition-colors focus:border-cyan-400/40"
                />

                <button
                  onClick={() => void importCloudinaryFolder()}
                  disabled={isImportingCloudinary}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/15 disabled:opacity-60 sm:w-auto"
                >
                  {isImportingCloudinary ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Cloud className="h-4 w-4" />
                  )}
                  Import Cloudinary Folder
                </button>
              </div>

              <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                Import hote hi har Cloudinary video ke liye title, description,
                aur keywords auto draft ho jayenge.
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

            <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-5 shadow-2xl shadow-slate-950/30 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-emerald-300/70">
                    Target Accounts
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    Insta + YouTube selection
                  </h2>
                </div>
                <button
                  onClick={() => setShowAccountSelector((current) => !current)}
                  className="text-sm text-cyan-300"
                >
                  {showAccountSelector ? "Hide" : "Manage"}
                </button>
              </div>

              <p className="mb-4 text-sm text-white/55">
                Publish method bridge jaisa hai: ek asset Cloudinary par ready
                rahega, phir selected Instagram aur YouTube accounts par same
                queue sequence me post hoga.
              </p>

              <button
                onClick={() =>
                  setSelectedAccounts(allSelected ? [] : allAccounts)
                }
                className="mb-4 rounded-xl border border-white/10 bg-slate-950/50 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/5"
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>

              {showAccountSelector && (
                <div className="space-y-2">
                  {allAccounts.map((account) => {
                    const isSelected = selectedAccounts.some(
                      (item) =>
                        item.id === account.id &&
                        item.platform === account.platform,
                    );

                    return (
                      <button
                        key={`${account.id}-${account.platform}`}
                        onClick={() => toggleAccount(account)}
                        className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                          isSelected
                            ? "border-cyan-400/30 bg-cyan-400/10"
                            : "border-white/10 bg-slate-950/50 hover:bg-white/5"
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
                          <p className="text-xs capitalize text-white/45">
                            {account.platform}
                          </p>
                        </div>
                        {isSelected && (
                          <CheckCircle2 className="h-4 w-4 text-cyan-300" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/50 p-5 shadow-2xl shadow-slate-950/30 backdrop-blur-xl">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-fuchsia-300/70">
                  Queue Review
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  Video Queue ({videos.length})
                </h2>
                <p className="mt-2 text-sm text-white/55">
                  Har card me auto-generated title, description, aur keywords
                  milenge. Zarurat ho to yahin se edit karo.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-2 text-sm text-white/70">
                Pending {stats.pending} • Error {stats.error}
              </div>
            </div>

            <div className="space-y-4">
              {videos.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-12 text-center text-white/45">
                  Queue empty hai. Local folder ya Cloudinary import se start karo.
                </div>
              ) : (
                videos.map((video) => {
                  const statusTone =
                    video.status === "uploaded"
                      ? "border-green-500/25 bg-green-500/10"
                      : video.status === "scheduled"
                        ? "border-cyan-500/25 bg-cyan-500/10"
                        : video.status === "processing"
                          ? "border-blue-500/25 bg-blue-500/10"
                          : video.status === "error"
                            ? "border-red-500/25 bg-red-500/10"
                            : "border-white/10 bg-slate-950/50";

                  return (
                    <article
                      key={video.id}
                      className={`rounded-3xl border p-4 ${statusTone}`}
                    >
                      <div className="flex flex-col gap-4 xl:flex-row">
                        <div className="w-full xl:w-56">
                          <video
                            src={video.uploadedUrl || video.preview}
                            controls
                            playsInline
                            preload="metadata"
                            className="aspect-[9/16] w-full rounded-2xl bg-black object-cover"
                          />
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/75">
                              {video.source === "cloudinary"
                                ? "Cloudinary source"
                                : "Local source"}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/75">
                              {formatBytes(video.sizeBytes)}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/75">
                              {video.status}
                            </span>
                          </div>
                        </div>

                        <div className="flex-1 space-y-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-lg font-semibold text-white">
                                {video.originalTitle}
                              </p>
                              <p className="mt-1 text-xs text-white/45">
                                Added {formatDate(video.createdAt)}{" "}
                                {video.assetFolder ? `• ${video.assetFolder}` : ""}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => downloadVideo(video)}
                                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                <Download className="h-4 w-4" />
                                Download
                              </button>
                              <button
                                onClick={() => removeVideo(video.id)}
                                className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/20"
                              >
                                <Trash2 className="h-4 w-4" />
                                Remove
                              </button>
                            </div>
                          </div>

                          <div className="grid gap-3">
                            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                              Auto SEO ready from file name, folder, and video
                              runtime.
                            </div>

                            <label className="grid gap-2">
                              <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                                Title
                              </span>
                              <input
                                type="text"
                                value={video.seo.title}
                                onChange={(event) =>
                                  updateVideoSeoField(
                                    video.id,
                                    "title",
                                    event.target.value,
                                  )
                                }
                                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-colors focus:border-fuchsia-400/40"
                              />
                            </label>

                            <label className="grid gap-2">
                              <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                                Description
                              </span>
                              <textarea
                                rows={5}
                                value={video.seo.description}
                                onChange={(event) =>
                                  updateVideoSeoField(
                                    video.id,
                                    "description",
                                    event.target.value,
                                  )
                                }
                                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-colors focus:border-fuchsia-400/40"
                              />
                            </label>

                            <label className="grid gap-2">
                              <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                                Keywords
                              </span>
                              <textarea
                                rows={3}
                                value={video.seo.keywords.join(", ")}
                                onChange={(event) =>
                                  updateVideoSeoField(
                                    video.id,
                                    "keywords",
                                    event.target.value,
                                  )
                                }
                                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-white outline-none transition-colors focus:border-fuchsia-400/40"
                              />
                            </label>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs text-white/55">
                            <span>{video.seo.keywords.length} keywords ready</span>
                            <span>
                              {video.seo.keywords.length >= 15
                                ? "SEO keyword depth OK"
                                : "15+ keywords ke liye aur add kar sakte ho"}
                            </span>
                            {video.error ? (
                              <span className="text-red-300">{video.error}</span>
                            ) : null}
                            {video.processedAt ? (
                              <span>Processed {formatDate(video.processedAt)}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default function BulkUploadPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading bulk bridge...
          </div>
        </div>
      }
    >
      <BulkUploadContent />
    </Suspense>
  );
}

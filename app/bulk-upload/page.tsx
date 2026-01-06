"use client";
import { useState, useRef, useEffect } from "react";
import type React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  FolderOpen,
  Upload,
  Check,
  AlertCircle,
  Play,
  Pause,
  Trash2,
  Download,
  Instagram,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";

interface VideoFile {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "processing" | "uploaded" | "error";
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
}

interface Account {
  id: string;
  username: string;
  profile_picture_url?: string;
  platform: "instagram" | "youtube";
  token?: string;
  accessToken?: string;
  name?: string;
  thumbnail?: string;
}

function BulkUploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [settings, setSettings] = useState<QueueSettings>({
    title: "",
    description: "",
    keywords: "",
    intervalMinutes: 5,
    startDelayMinutes: 0,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [loadingSegments, setLoadingSegments] = useState(false);

  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Account[]>([]);
  const [showAccountSelector, setShowAccountSelector] = useState(false);

  useEffect(() => {
    const loadSegmentsFromSplitter = async () => {
      const source = searchParams.get("source");
      if (source === "splitter") {
        setLoadingSegments(true);
        const segmentsJson = sessionStorage.getItem("pending_video_segments");

        if (segmentsJson) {
          try {
            const segmentsData = JSON.parse(segmentsJson);
            console.log("[v0] Loading segments from splitter:", segmentsData);

            const loadedVideos: VideoFile[] = await Promise.all(
              segmentsData.map(async (segment: any) => {
                try {
                  const response = await fetch(segment.blobUrl);
                  const blob = await response.blob();

                  const file = new File([blob], segment.fileName, {
                    type: "video/mp4",
                  });

                  return {
                    id: segment.id,
                    file,
                    preview: segment.blobUrl,
                    status: "pending" as const,
                    originalTitle: segment.title,
                  };
                } catch (err) {
                  console.error("[v0] Failed to load segment:", err);
                  return null;
                }
              })
            );

            const validVideos = loadedVideos.filter(
              (v) => v !== null
            ) as VideoFile[];
            setVideos(validVideos);

            sessionStorage.removeItem("pending_video_segments");

            if (validVideos.length > 0) {
              toast.success(
                `Loaded ${validVideos.length} video segments from splitter!`
              );
            }
          } catch (err) {
            console.error("[v0] Failed to parse segments:", err);
            toast.error("Failed to load video segments");
          }
        }
        setLoadingSegments(false);
      }
    };

    loadSegmentsFromSplitter();

    const igAccounts = JSON.parse(localStorage.getItem("ig_accounts") || "[]");
    const ytAccounts = JSON.parse(
      localStorage.getItem("youtube_accounts") || "[]"
    );

    const all: Account[] = [
      ...igAccounts.map((acc: any) => ({
        ...acc,
        platform: "instagram" as const,
      })),
      ...ytAccounts.map((acc: any) => ({
        ...acc,
        platform: "youtube" as const,
      })),
    ];

    setAllAccounts(all);
    setSelectedAccounts(all); // Default: select all accounts

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [searchParams]);

  const handleFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const videoFiles = files.filter((file) => file.type.startsWith("video/"));

    const newVideos: VideoFile[] = await Promise.all(
      videoFiles.map(async (file) => {
        const preview = URL.createObjectURL(file);
        return {
          id: `${Date.now()}-${Math.random()}`,
          file,
          preview,
          status: "pending" as const,
        };
      })
    );

    setVideos((prev) => [...prev, ...newVideos]);
  };

  const removeVideo = (id: string) => {
    setVideos((prev) => {
      const video = prev.find((v) => v.id === id);
      if (video) {
        URL.revokeObjectURL(video.preview);
      }
      return prev.filter((v) => v.id !== id);
    });
  };

  const downloadVideo = (video: VideoFile) => {
    const url = URL.createObjectURL(video.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = video.originalTitle
      ? `${video.originalTitle.replace(/[^a-zA-Z0-9]/g, "_")}.mp4`
      : `${video.file.name.split(".")[0]}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Download started");
  };

  const toggleAccount = (account: Account) => {
    setSelectedAccounts((prev) => {
      const isSelected = prev.some(
        (a) => a.id === account.id && a.platform === account.platform
      );
      if (isSelected) {
        return prev.filter(
          (a) => !(a.id === account.id && a.platform === account.platform)
        );
      } else {
        return [...prev, account];
      }
    });
  };

  const startBulkUpload = async () => {
    if (videos.length === 0) {
      toast.error("Please add at least one video");
      return;
    }

    if (selectedAccounts.length === 0) {
      toast.error("Please select at least one account");
      return;
    }

    if (!settings.title && videos.every((v) => !v.originalTitle)) {
      toast.error("Please fill in a base title or ensure segments have titles");
      return;
    }

    if (!settings.description) {
      toast.error("Please fill in a description");
      return;
    }

    setIsProcessing(true);

    if (settings.startDelayMinutes && settings.startDelayMinutes > 0) {
      console.log(
        `[v0] Delaying start by ${settings.startDelayMinutes} minutes`
      );
      toast.info(`Upload will start in ${settings.startDelayMinutes} minutes`);
      intervalRef.current = setTimeout(() => {
        processNextVideo();
      }, settings.startDelayMinutes * 60 * 1000);
    } else {
      processNextVideo();
    }
  };

  const processNextVideo = async () => {
    const pendingVideos = videos.filter((v) => v.status === "pending");

    console.log(
      "[v0] Processing queue - pending videos:",
      pendingVideos.length
    );

    if (pendingVideos.length === 0) {
      stopProcessing();
      toast.success("All videos uploaded successfully!");
      return;
    }

    const nextVideo = pendingVideos[0];
    const videoIndex = videos.findIndex((v) => v.id === nextVideo.id);

    console.log(
      "[v0] Processing video:",
      nextVideo.originalTitle || nextVideo.file.name,
      "Index:",
      videoIndex
    );

    setVideos((prev) =>
      prev.map((v) =>
        v.id === nextVideo.id ? { ...v, status: "processing" } : v
      )
    );

    try {
      const videoTitle = nextVideo.originalTitle || settings.title;

      const formData = new FormData();
      formData.append("file", nextVideo.file);

      console.log("[v0] Uploading to GridFS...");
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload video to server");
      }

      const { url } = await uploadRes.json();
      console.log("[v0] Video uploaded to:", url);

      const igAccounts = selectedAccounts.filter(
        (a) => a.platform === "instagram"
      );
      const ytAccounts = selectedAccounts.filter(
        (a) => a.platform === "youtube"
      );

      console.log(
        "[v0] Uploading to accounts - Instagram:",
        igAccounts.length,
        "YouTube:",
        ytAccounts.length
      );

      for (const account of igAccounts) {
        try {
          console.log("[v0] Uploading to Instagram account:", account.username);

          const caption = `${videoTitle}\n\n${
            settings.description
          }\n\n${settings.keywords
            .split(",")
            .map((k) => `#${k.trim()}`)
            .filter(Boolean)
            .join(" ")}`;

          console.log("[v0] Instagram caption:", caption);
          console.log("[v0] Video URL for Instagram:", url);

          const createRes = await fetch(
            `https://graph.facebook.com/v21.0/${account.id}/media`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                video_url: url,
                caption,
                media_type: "REELS",
                access_token: account.token,
              }),
            }
          );

          const createData = await createRes.json();
          console.log("[v0] Instagram create response:", createData);

          if (createData.error) {
            console.error(
              "[v0] Instagram create error details:",
              JSON.stringify(createData.error, null, 2)
            );
            throw new Error(
              createData.error.message || "Instagram media creation failed"
            );
          }

          if (!createData.id) {
            throw new Error("Instagram did not return a media container ID");
          }

          const containerId = createData.id;
          console.log("[v0] Instagram media container created:", containerId);

          console.log("[v0] Waiting for Instagram to process the video...");
          let mediaReady = false;
          let attempts = 0;
          const maxAttempts = 30;

          while (!mediaReady && attempts < maxAttempts) {
            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 3000));

            try {
              const statusRes = await fetch(
                `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${account.token}`
              );
              const statusData = await statusRes.json();
              console.log(
                `[v0] Media status check ${attempts}/${maxAttempts}:`,
                statusData
              );

              if (statusData.status_code === "FINISHED") {
                mediaReady = true;
                console.log("[v0] Media is ready!");
              } else if (statusData.status_code === "ERROR") {
                throw new Error(
                  "Instagram reported an error processing the video"
                );
              } else if (statusData.status_code === "EXPIRED") {
                throw new Error("Media container expired");
              }
            } catch (statusErr) {
              console.error("[v0] Status check error:", statusErr);
              if (attempts >= maxAttempts) {
                throw new Error("Failed to check media status");
              }
            }
          }

          if (!mediaReady) {
            throw new Error("Media processing timed out after 90 seconds");
          }

          console.log("[v0] Publishing media to Instagram...");
          const publishRes = await fetch(
            `https://graph.facebook.com/v21.0/${account.id}/media_publish`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                creation_id: containerId,
                access_token: account.token,
              }),
            }
          );

          const publishData = await publishRes.json();
          console.log("[v0] Instagram publish response:", publishData);

          if (publishData.error) {
            console.error(
              "[v0] Instagram publish error details:",
              JSON.stringify(publishData.error, null, 2)
            );
            throw new Error(
              publishData.error.message || "Instagram publishing failed"
            );
          }

          if (!publishData.id) {
            throw new Error("Instagram did not return a published media ID");
          }

          console.log(
            "[v0] Successfully published to Instagram! Media ID:",
            publishData.id
          );
          toast.success(`Published to Instagram: ${account.username}`);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(
            `[v0] Failed to upload to Instagram account ${account.username}:`,
            errorMessage
          );
          console.error("[v0] Full error object:", err);
          toast.error(
            `Instagram upload failed for ${account.username}: ${errorMessage}`
          );
        }
      }

      for (const account of ytAccounts) {
        try {
          console.log(
            "[v0] Uploading to YouTube account:",
            account.name || account.username
          );

          const uploadResponse = await fetch("/api/youtube/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken: account.accessToken || account.token,
              videoUrl: url,
              title: videoTitle,
              description: settings.description,
              keywords: settings.keywords
                .split(",")
                .map((k) => k.trim())
                .filter(Boolean),
              privacy: "public",
              isShort: true,
            }),
          });

          const uploadData = await uploadResponse.json();
          console.log("[v0] YouTube upload response:", uploadData);

          if (!uploadResponse.ok) {
            console.error(
              `[v0] YouTube upload failed for ${account.name}:`,
              uploadData.error
            );
            toast.error(
              `YouTube upload failed for ${account.name || account.username}: ${
                uploadData.error || "Unknown error"
              }`
            );
          } else {
            console.log(
              "[v0] Successfully uploaded to YouTube:",
              uploadData.videoId
            );
            toast.success(
              `Published to YouTube: ${account.name || account.username}`
            );
          }
        } catch (err) {
          console.error(
            `[v0] Failed to upload to YouTube account ${account.name}:`,
            err
          );
          toast.error(
            `YouTube upload failed for ${account.name || account.username}: ${
              err instanceof Error ? err.message : "Unknown error"
            }`
          );
        }
      }

      setVideos((prev) =>
        prev.map((v) =>
          v.id === nextVideo.id
            ? {
                ...v,
                status: "uploaded",
                uploadedUrl: url,
                processedAt: new Date().toISOString(),
              }
            : v
        )
      );

      toast.success(`Uploaded: ${videoTitle}`);

      const remainingPending = videos.filter(
        (v) => v.status === "pending" && v.id !== nextVideo.id
      );
      console.log("[v0] Remaining pending videos:", remainingPending.length);

      if (remainingPending.length > 0) {
        const delayMinutes = settings.intervalMinutes;
        const delayMs = delayMinutes * 60 * 1000;

        toast.info(
          `Next upload in ${delayMinutes} minutes. ${remainingPending.length} videos remaining.`
        );
        console.log("[v0] Scheduling next upload in", delayMinutes, "minutes");

        intervalRef.current = setTimeout(() => {
          processNextVideo();
        }, delayMs);
      } else {
        console.log("[v0] No more videos to process");
        stopProcessing();
        toast.success("All videos uploaded successfully!");
      }
    } catch (error: any) {
      console.error("[v0] Upload error:", error);

      setVideos((prev) =>
        prev.map((v) =>
          v.id === nextVideo.id
            ? {
                ...v,
                status: "error",
                error: error.message,
              }
            : v
        )
      );

      toast.error(`Failed to upload: ${error.message}`);
      stopProcessing();
    }
  };

  const stopProcessing = () => {
    setIsProcessing(false);
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const stats = {
    total: videos.length,
    pending: videos.filter((v) => v.status === "pending").length,
    processing: videos.filter((v) => v.status === "processing").length,
    uploaded: videos.filter((v) => v.status === "uploaded").length,
    error: videos.filter((v) => v.status === "error").length,
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push("/dashboard")}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-white/60" />
              </button>
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-pink-400" />
                <h1 className="text-xl font-semibold text-white">
                  Bulk Upload Automation
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isProcessing ? (
                <button
                  onClick={stopProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 rounded-xl text-white font-medium transition-colors"
                >
                  <Pause className="w-4 h-4" />
                  Stop Queue
                </button>
              ) : (
                <button
                  onClick={startBulkUpload}
                  disabled={videos.length === 0 || loadingSegments}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-red-500 hover:from-pink-600 hover:to-red-600 rounded-xl text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4" />
                  Start Upload Queue
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {loadingSegments && (
          <div className="mb-8 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-blue-400 font-medium">
              Loading video segments from splitter...
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="text-2xl font-bold text-white">{stats.total}</div>
            <div className="text-sm text-white/60">Total Videos</div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-yellow-500/30">
            <div className="text-2xl font-bold text-yellow-400">
              {stats.pending}
            </div>
            <div className="text-sm text-white/60">Pending</div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-blue-500/30">
            <div className="text-2xl font-bold text-blue-400">
              {stats.processing}
            </div>
            <div className="text-sm text-white/60">Processing</div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-green-500/30">
            <div className="text-2xl font-bold text-green-400">
              {stats.uploaded}
            </div>
            <div className="text-sm text-white/60">Uploaded</div>
          </div>
          <div className="bg-slate-900/50 backdrop-blur-sm rounded-xl p-4 border border-red-500/30">
            <div className="text-2xl font-bold text-red-400">{stats.error}</div>
            <div className="text-sm text-white/60">Failed</div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold text-white mb-4">
                Upload Settings
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Title (for YouTube)
                  </label>
                  <input
                    type="text"
                    value={settings.title}
                    onChange={(e) =>
                      setSettings({ ...settings, title: e.target.value })
                    }
                    placeholder="Enter video title..."
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                  <p className="text-xs text-white/40 mt-1">
                    {videos.some((v) => v.originalTitle)
                      ? "Optional - segments have individual titles"
                      : "Required"}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Description
                  </label>
                  <textarea
                    value={settings.description}
                    onChange={(e) =>
                      setSettings({ ...settings, description: e.target.value })
                    }
                    placeholder="Enter video description..."
                    rows={3}
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Keywords (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={settings.keywords}
                    onChange={(e) =>
                      setSettings({ ...settings, keywords: e.target.value })
                    }
                    placeholder="keyword1, keyword2, keyword3..."
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Interval Between Uploads
                  </label>
                  <input
                    type="number"
                    value={settings.intervalMinutes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        intervalMinutes: Number.parseInt(e.target.value) || 5,
                      })
                    }
                    min="1"
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                  <p className="text-xs text-white/40 mt-1">
                    Minutes between each upload
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-2">
                    Start Delay
                  </label>
                  <input
                    type="number"
                    value={settings.startDelayMinutes || 0}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        startDelayMinutes: Number.parseInt(e.target.value) || 0,
                      })
                    }
                    min="0"
                    className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                  <p className="text-xs text-white/40 mt-1">
                    Wait before uploading first video (minutes)
                  </p>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <button
                    onClick={() => setShowAccountSelector(!showAccountSelector)}
                    className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-colors flex items-center justify-between"
                  >
                    <span>
                      Select Accounts ({selectedAccounts.length}/
                      {allAccounts.length})
                    </span>
                    <span className="text-xs">
                      {showAccountSelector ? "▼" : "▶"}
                    </span>
                  </button>

                  {showAccountSelector && (
                    <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                      {allAccounts.length === 0 ? (
                        <p className="text-sm text-white/50 text-center py-4">
                          No accounts connected
                        </p>
                      ) : (
                        allAccounts.map((account) => (
                          <div
                            key={`${account.id}-${account.platform}`}
                            className="flex items-center gap-3 p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                            onClick={() => toggleAccount(account)}
                          >
                            <input
                              type="checkbox"
                              checked={selectedAccounts.some(
                                (a) =>
                                  a.id === account.id &&
                                  a.platform === account.platform
                              )}
                              onChange={() => toggleAccount(account)}
                              className="w-4 h-4 rounded cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {account.platform === "instagram" ? (
                                  <Instagram className="w-4 h-4 text-pink-500 flex-shrink-0" />
                                ) : (
                                  <Youtube className="w-4 h-4 text-red-500 flex-shrink-0" />
                                )}
                                <p className="text-sm font-medium text-white truncate">
                                  {account.username || account.name}
                                </p>
                              </div>
                              <p className="text-xs text-white/40 capitalize">
                                {account.platform}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Add Videos</h2>
                {videos.length > 0 && (
                  <button
                    onClick={() => setVideos([])}
                    className="text-xs px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                  >
                    Clear All
                  </button>
                )}
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-8 border-2 border-dashed border-white/20 hover:border-white/40 rounded-xl transition-colors flex flex-col items-center justify-center gap-2 cursor-pointer"
              >
                <Upload className="w-5 h-5 text-white/60" />
                <span className="text-sm font-medium text-white/70">
                  Click to select videos
                </span>
                <span className="text-xs text-white/40">or drag and drop</span>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="video/*"
                onChange={handleFilesSelect}
                className="hidden"
              />
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-slate-900/50 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
              <h2 className="text-lg font-semibold text-white mb-4">
                Video Queue ({videos.length})
              </h2>

              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {videos.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-white/50">No videos added yet</p>
                  </div>
                ) : (
                  videos.map((video, index) => (
                    <div
                      key={video.id}
                      className={`p-4 rounded-lg border transition-all ${
                        video.status === "pending"
                          ? "bg-white/5 border-white/10 hover:border-white/20"
                          : video.status === "processing"
                          ? "bg-blue-500/10 border-blue-500/30"
                          : video.status === "uploaded"
                          ? "bg-green-500/10 border-green-500/30"
                          : "bg-red-500/10 border-red-500/30"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <video
                          src={video.preview}
                          className="w-16 h-16 rounded-lg object-cover bg-black flex-shrink-0"
                        />

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">
                            {video.originalTitle || video.file.name}
                          </p>
                          <p className="text-xs text-white/40">
                            {(video.file.size / (1024 * 1024)).toFixed(2)} MB
                          </p>

                          {video.status === "processing" && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                              <span className="text-xs text-blue-400">
                                Uploading...
                              </span>
                            </div>
                          )}

                          {video.status === "uploaded" && (
                            <div className="mt-2 flex items-center gap-2">
                              <Check className="w-4 h-4 text-green-400" />
                              <span className="text-xs text-green-400">
                                Uploaded
                              </span>
                            </div>
                          )}

                          {video.status === "error" && (
                            <div className="mt-2 flex items-center gap-2">
                              <AlertCircle className="w-4 h-4 text-red-400" />
                              <span className="text-xs text-red-400">
                                {video.error}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => downloadVideo(video)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                            title="Download video"
                          >
                            <Download className="w-4 h-4 text-white/60 hover:text-white" />
                          </button>
                          <button
                            onClick={() => removeVideo(video.id)}
                            className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
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

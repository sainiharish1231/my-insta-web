"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Instagram,
  Loader2,
  PlayCircle,
  RefreshCw,
  Send,
  Youtube,
} from "lucide-react";
import {
  createMedia,
  getMediaList,
  publishMedia,
  uploadRemoteMediaToCloudinary,
} from "@/lib/meta";

interface InstagramAccount {
  id: string;
  username: string;
  profile_picture_url?: string;
  followers_count?: number;
  token?: string;
}

interface YouTubeAccount {
  id: string;
  name?: string;
  username?: string;
  thumbnail?: string;
  accessToken?: string;
  token?: string;
  refreshToken?: string;
  refresh_token?: string;
}

interface InstagramMedia {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  caption?: string;
  timestamp: string;
}

interface TargetAccount {
  id: string;
  username: string;
  platform: "instagram" | "youtube";
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  selected: boolean;
  status: "idle" | "uploading" | "success" | "error";
  error?: string;
}

function isPlayableMedia(media: InstagramMedia) {
  return (
    (media.media_type === "VIDEO" || media.media_type === "REELS") &&
    Boolean(media.media_url)
  );
}

function formatDate(value?: string) {
  if (!value) {
    return "Unknown date";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }

  return parsed.toLocaleString();
}

function getFriendlyPublishError(
  message: string,
  platform: "instagram" | "youtube"
) {
  if (
    platform === "instagram" &&
    message.includes(
      "The user must be an administrator, editor, or moderator of the page"
    )
  ) {
    return "Instagram page permission missing. Is target account ki Facebook Page par aap admin/editor/moderator hone chahiye. Agar page par 2FA required hai to 2FA ON bhi hona chahiye.";
  }

  if (platform === "youtube" && message.includes("access token")) {
    return "YouTube token missing ya expired hai. YouTube account ko reconnect karo.";
  }

  return message;
}

function buildYouTubeTags(caption: string) {
  const defaultTags = [
    "viral",
    "new",
    "feed",
    "shorts",
    "yt",
    "timesnews.in",
    "sainiharish",
    "trending",
    "news",
    "reels",
    "youtube",
    "instagram",
    "breaking",
    "latest",
    "update",
    "india",
    "hindi",
    "english",
    "socialmedia",
    "creator",
    "contentcreator",
    "explore",
    "fyp",
    "viralvideo",
    "dailynews",
    "trendingshorts",
    "youtubevideo",
    "instareels",
    "harish",
    "sri",
  ];

  const derivedTags = caption
    .toLowerCase()
    .replace(/[#\n]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9.]/g, "").trim())
    .filter((word) => word.length > 2)
    .slice(0, 30);

  return [...new Set([...defaultTags, ...derivedTags])].slice(0, 40);
}

function buildYouTubeDescription(baseCaption: string, tags: string[]) {
  const hashtagLine = tags.map((tag) => `#${tag.replace(/[^a-zA-Z0-9.]/g, "")}`).join(" ");
  const cleanCaption = baseCaption.trim() || "Latest repost video";
  return `${cleanCaption}\n\n${hashtagLine}`.trim();
}

export default function InstaVideoBridgePage() {
  const router = useRouter();
  const [primaryAccount, setPrimaryAccount] = useState<InstagramAccount | null>(null);
  const [latestVideo, setLatestVideo] = useState<InstagramMedia | null>(null);
  const [targets, setTargets] = useState<TargetAccount[]>([]);
  const [youtubeAccountCount, setYouTubeAccountCount] = useState(0);
  const [instagramTargetCount, setInstagramTargetCount] = useState(0);
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  const selectedTargets = useMemo(
    () => targets.filter((target) => target.selected),
    [targets]
  );

  const loadData = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      const igAccounts = JSON.parse(
        localStorage.getItem("ig_accounts") || "[]"
      ) as InstagramAccount[];
      const ytAccounts = JSON.parse(
        localStorage.getItem("youtube_accounts") || "[]"
      ) as YouTubeAccount[];
      setYouTubeAccountCount(Array.isArray(ytAccounts) ? ytAccounts.length : 0);
      const primaryId =
        localStorage.getItem("primary_ig_account_id") ||
        localStorage.getItem("ig_user_id");

      if (!primaryId) {
        throw new Error("Primary Instagram account not selected yet.");
      }

      const primary = igAccounts.find((account) => account.id === primaryId);
      if (!primary) {
        throw new Error("Primary Instagram account not found.");
      }
      if (!primary.token) {
        throw new Error("Primary Instagram account token is missing.");
      }

      const media = await getMediaList(primary.id, primary.token);
      const latestPlayable = [...media]
        .sort(
          (a, b) =>
            new Date(b.timestamp || 0).getTime() -
            new Date(a.timestamp || 0).getTime()
        )
        .find((item) => isPlayableMedia(item));

      if (!latestPlayable) {
        throw new Error(
          "Primary account does not have a latest reel/video available."
        );
      }

      const nextTargets: TargetAccount[] = [
        ...igAccounts
          .filter((account) => account.id !== primary.id)
          .map((account) => ({
            id: account.id,
            username: account.username,
            platform: "instagram" as const,
            token: account.token,
            selected: true,
            status: "idle" as const,
          })),
        ...ytAccounts.map((account) => ({
          id: account.id,
          username: account.username || account.name || "YouTube Account",
          platform: "youtube" as const,
          accessToken: account.accessToken || account.token,
          refreshToken: account.refreshToken || account.refresh_token,
          selected: true,
          status: "idle" as const,
        })),
      ];
      setInstagramTargetCount(
        igAccounts.filter((account) => account.id !== primary.id).length
      );

      setPrimaryAccount(primary);
      setLatestVideo(latestPlayable);
      setCaption(latestPlayable.caption || "");
      setTargets(nextTargets);
    } catch (loadError: any) {
      console.error("[v0] Failed to load bridge data:", loadError);
      setPrimaryAccount(null);
      setLatestVideo(null);
      setTargets([]);
      setError(loadError?.message || "Failed to load repost page.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleTarget = (targetId: string, platform: "instagram" | "youtube") => {
    setTargets((current) =>
      current.map((target) =>
        target.id === targetId && target.platform === platform
          ? { ...target, selected: !target.selected }
          : target
      )
    );
  };

  const publishLatestVideo = async () => {
    if (!primaryAccount || !latestVideo?.media_url) {
      setError("Latest primary video is not ready.");
      return;
    }

    if (selectedTargets.length === 0) {
      setError("At least one target account select karo.");
      return;
    }

    setPublishing(true);
    setError("");
    setTargets((current) =>
      current.map((target) => ({
        ...target,
        status: target.selected ? "idle" : target.status,
        error: undefined,
      }))
    );

    try {
      const uploadedAsset = await uploadRemoteMediaToCloudinary(
        latestVideo.media_url,
        {
          folder: `reposts/${new Date().toISOString().slice(0, 10)}`,
          resourceType: "video",
        }
      );

      for (const target of selectedTargets) {
        setTargets((current) =>
          current.map((item) =>
            item.id === target.id && item.platform === target.platform
              ? { ...item, status: "uploading", error: undefined }
              : item
          )
        );

        try {
          if (target.platform === "instagram") {
            if (!target.token) {
              throw new Error("Instagram token missing.");
            }

            const creationId = await createMedia({
              igUserId: target.id,
              token: target.token,
              mediaUrl: uploadedAsset.secureUrl,
              caption,
              isReel: true,
            });

            await publishMedia({
              igUserId: target.id,
              token: target.token,
              creationId,
            });
          } else {
            if (!target.accessToken) {
              throw new Error("YouTube access token missing.");
            }

            const youtubeTags = buildYouTubeTags(caption);
            const youtubeDescription = buildYouTubeDescription(caption, youtubeTags);

            const response = await fetch("/api/youtube/upload", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                accessToken: target.accessToken,
                refreshToken: target.refreshToken,
                videoUrl: uploadedAsset.secureUrl,
                title: caption.substring(0, 100) || "Instagram repost video",
                description: youtubeDescription,
                keywords: youtubeTags,
                privacy: "public",
                isShort: false,
              }),
            });

            const result = await response.json();
            if (!response.ok) {
              throw new Error(result.error || "YouTube upload failed");
            }
          }

          setTargets((current) =>
            current.map((item) =>
              item.id === target.id && item.platform === target.platform
                ? { ...item, status: "success", error: undefined }
                : item
            )
          );
        } catch (targetError: any) {
          setTargets((current) =>
            current.map((item) =>
              item.id === target.id && item.platform === target.platform
                ? {
                    ...item,
                    status: "error",
                    error: getFriendlyPublishError(
                      targetError?.message || "Publishing failed",
                      target.platform
                    ),
                  }
                : item
            )
          );
        }
      }
    } catch (publishError: any) {
      console.error("[v0] Bridge publish failed:", publishError);
      setError(publishError?.message || "Publishing failed");
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-fuchsia-400" />
          <p className="text-white/60">Preparing repost workflow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-900/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/my-insta-id")}
              className="rounded-xl p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-fuchsia-300/70">
                Repost Flow
              </p>
              <h1 className="text-xl font-semibold">
                Insta Video to YT & Other Insta
              </h1>
            </div>
          </div>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing || publishing}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error && (
          <div className="mb-6 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!primaryAccount || !latestVideo ? (
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-10 text-center">
            <p className="text-lg font-medium text-white">
              Primary account ya latest video missing hai.
            </p>
            <p className="mt-2 text-sm text-white/50">
              `My Insta IDs` page par jaakar pehle primary account set karo.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-fuchsia-500/10 via-pink-500/10 to-orange-500/10 p-6">
                <p className="text-sm uppercase tracking-[0.25em] text-fuchsia-300/75">
                  Primary account
                </p>
                <div className="mt-4 flex items-center gap-4">
                  <img
                    src={
                      primaryAccount.profile_picture_url ||
                      "/placeholder.svg?height=64&width=64&query=instagram profile"
                    }
                    alt={primaryAccount.username}
                    className="h-16 w-16 rounded-full object-cover"
                  />
                  <div>
                    <h2 className="text-2xl font-semibold">
                      @{primaryAccount.username}
                    </h2>
                    <p className="text-sm text-white/55">
                      Latest playable reel/video will be reused everywhere
                    </p>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60">
                <div className="border-b border-white/10 px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm uppercase tracking-[0.25em] text-cyan-300/70">
                        Latest source video
                      </p>
                      <p className="mt-1 text-sm text-white/55">
                        {latestVideo.media_type} • {formatDate(latestVideo.timestamp)}
                      </p>
                    </div>
                    {latestVideo.media_url && (
                      <a
                        href={latestVideo.media_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/15"
                      >
                        <Download className="h-4 w-4" />
                        Download / Open
                      </a>
                    )}
                  </div>
                </div>
                <div className="bg-black/30 p-4">
                  {latestVideo.media_url ? (
                    <video
                      src={latestVideo.media_url}
                      poster={latestVideo.thumbnail_url}
                      controls
                      playsInline
                      preload="metadata"
                      className="aspect-[9/16] w-full rounded-2xl bg-black object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[9/16] w-full items-center justify-center rounded-2xl bg-black/30">
                      <PlayCircle className="h-14 w-14 text-white/20" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <label className="block text-sm font-medium text-white/80">
                    Caption for repost
                  </label>
                  <textarea
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    rows={6}
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-white/25 focus:border-fuchsia-400/40"
                    placeholder="Caption edit karo before repost..."
                  />
                </div>
              </div>
            </section>

            <section className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm uppercase tracking-[0.25em] text-emerald-300/70">
                  Target accounts
                </p>
                <h3 className="mt-2 text-xl font-semibold">
                  Other Insta + YouTube
                </h3>
                <p className="mt-2 text-sm text-white/55">
                  Primary Instagram ko skip karke baaki logged-in accounts auto-selected hain.
                </p>
                <p className="mt-2 text-xs text-white/40">
                  Detected: {instagramTargetCount} other Instagram, {youtubeAccountCount} YouTube account
                  {youtubeAccountCount === 1 ? "" : "s"}
                </p>
                {youtubeAccountCount === 0 && (
                  <p className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                    Koi YouTube account detected nahi hua. Agar aapne YouTube connect kiya hai, ek baar reconnect karke phir page refresh karo.
                  </p>
                )}
                {instagramTargetCount > 0 && (
                  <p className="mt-3 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-200">
                    Instagram repost ke liye target account ki connected Facebook Page par aapke paas admin/editor/moderator access hona chahiye. Kuch pages me 2FA bhi required hota hai.
                  </p>
                )}

                <div className="mt-5 space-y-3">
                  {targets.length === 0 ? (
                    <p className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-white/55">
                      No target accounts available. Connect another Instagram or YouTube account.
                    </p>
                  ) : (
                    targets.map((target) => (
                      <button
                        key={`${target.platform}-${target.id}`}
                        onClick={() => toggleTarget(target.id, target.platform)}
                        className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                          target.selected
                            ? "border-fuchsia-500/35 bg-fuchsia-500/10"
                            : "border-white/10 bg-slate-950/40 hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {target.platform === "instagram" ? (
                              <Instagram className="h-5 w-5 text-pink-400" />
                            ) : (
                              <Youtube className="h-5 w-5 text-red-400" />
                            )}
                            <div>
                              <p className="font-medium">{target.username}</p>
                              <p className="text-xs capitalize text-white/45">
                                {target.platform}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-white/40">
                              {target.selected ? "Selected" : "Skipped"}
                            </p>
                            {target.status === "success" && (
                              <p className="text-xs text-emerald-300">Success</p>
                            )}
                            {target.status === "uploading" && (
                              <p className="text-xs text-cyan-300">Publishing...</p>
                            )}
                            {target.status === "error" && (
                              <p className="text-xs text-red-300">Failed</p>
                            )}
                          </div>
                        </div>
                        {target.error && (
                          <p className="mt-3 text-xs text-red-300">{target.error}</p>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-5">
                <p className="text-sm text-white/55">
                  Selected targets: {selectedTargets.length}
                </p>
                <button
                  onClick={publishLatestVideo}
                  disabled={publishing || !latestVideo.media_url || selectedTargets.length === 0}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-pink-500 px-5 py-3 font-medium text-white transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publishing ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Publishing latest video...
                    </>
                  ) : (
                    <>
                      <Send className="h-5 w-5" />
                      Post to selected Insta / YT accounts
                    </>
                  )}
                </button>

                <div className="mt-4 space-y-2 text-sm text-white/55">
                  <p>1. Primary Insta latest reel/video pick hota hai.</p>
                  <p>2. Video Cloudinary par ek baar upload hota hai.</p>
                  <p>3. Wahi asset selected Instagram aur YouTube accounts me publish hota hai.</p>
                </div>

                {targets.some((target) => target.status === "success") && (
                  <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-200">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <p className="text-sm">
                      Kuch accounts par publish complete ho chuka hai. Remaining failures ko account cards me dekh sakte ho.
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

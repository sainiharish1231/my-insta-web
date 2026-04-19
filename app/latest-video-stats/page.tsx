"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  Heart,
  Instagram,
  Loader2,
  RefreshCw,
  Video,
  Youtube,
  AlertCircle,
  Play,
  Calendar,
  MessageCircle,
} from "lucide-react";
import { getMediaInsights, getMediaList } from "@/lib/meta";
import { getYouTubeVideoDetails } from "@/lib/youtube";

interface InstagramAccount {
  id: string;
  username: string;
  profile_picture_url?: string;
  followers_count?: number;
  token?: string;
}

interface InstagramMediaItem {
  id: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  caption?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

interface YouTubeAccount {
  id: string;
  name?: string;
  username?: string;
  thumbnail?: string;
  accessToken?: string;
  token?: string;
}

interface AccountVideoStat {
  id: string;
  accountId: string;
  accountName: string;
  platform: "instagram" | "youtube";
  accountImage?: string;
  title: string;
  caption?: string;
  thumbnail?: string;
  publishedAt?: string;
  views: number | string;
  likes: number | string;
  comments?: number | string;
  mediaType?: string;
  error?: string;
  mediaUrl?: string;
}

function formatDate(value?: string) {
  if (!value) return "Unknown date";
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return "Unknown date";
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelativeTime(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(value);
}

function formatMetric(value: number | string) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "N/A";
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return value.toLocaleString();
  }
  if (typeof value === "string") {
    const num = Number(value);
    if (!isNaN(num) && isFinite(num)) return formatMetric(num);
    return value || "0";
  }
  return "0";
}

function getMediaTypeIcon(mediaType?: string) {
  if (mediaType === "REELS") return "📱 Reel";
  if (mediaType === "VIDEO") return "🎬 Video";
  if (mediaType === "CAROUSEL_ALBUM") return "🖼️ Carousel";
  if (mediaType === "IMAGE") return "📷 Image";
  return "🎥 Video";
}

export default function LatestVideoStatsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<AccountVideoStat[]>([]);

  const isInstagramVideoItem = (item: InstagramMediaItem) =>
    item.media_type === "VIDEO" ||
    item.media_type === "REELS" ||
    item.media_product_type === "REELS";

  const fetchInstagramVideoViews = async (
    mediaId: string,
    token: string,
    mediaType: string,
  ) => {
    try {
      const insights = await getMediaInsights(mediaId, token, mediaType);

      console.log(`[Instagram] Insights for ${mediaId}:`, insights);

      if (insights.views && Number(insights.views) > 0) {
        return Number(insights.views);
      }
      if (insights.video_views && Number(insights.video_views) > 0) {
        return Number(insights.video_views);
      }
      if (insights.reach && Number(insights.reach) > 0) {
        return Number(insights.reach);
      }
      if (insights.impressions && Number(insights.impressions) > 0) {
        return Number(insights.impressions);
      }

      const mediaRes = await fetch(
        `https://graph.facebook.com/v24.0/${mediaId}?fields=play_count&access_token=${token}`,
      );
      const mediaData = await mediaRes.json();

      if (mediaData.play_count && Number(mediaData.play_count) > 0) {
        return Number(mediaData.play_count);
      }

      return "N/A";
    } catch (err) {
      console.warn(`Failed to fetch views for media ${mediaId}:`, err);
      return "N/A";
    }
  };

  const loadStats = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      const igAccounts = JSON.parse(
        localStorage.getItem("ig_accounts") || "[]",
      ) as InstagramAccount[];
      const ytAccounts = JSON.parse(
        localStorage.getItem("youtube_accounts") || "[]",
      ) as YouTubeAccount[];

      if (igAccounts.length === 0 && ytAccounts.length === 0) {
        setError(
          "No connected accounts found. Please connect Instagram or YouTube accounts first.",
        );
        setStats([]);
        return;
      }

      const nextStats: AccountVideoStat[] = [];

      // Process Instagram accounts
      for (const account of igAccounts) {
        if (!account.token) {
          nextStats.push({
            id: `instagram-${account.id}`,
            accountId: account.id,
            accountName: `@${account.username}`,
            platform: "instagram",
            accountImage: account.profile_picture_url,
            title: "⚠️ Account not connected",
            views: "N/A",
            likes: "N/A",
            error: "Token missing. Please reconnect this Instagram account.",
          });
          continue;
        }

        try {
          // Fetch media list
          const mediaList = await getMediaList(account.id, account.token);

          if (!mediaList || mediaList.length === 0) {
            nextStats.push({
              id: `instagram-${account.id}`,
              accountId: account.id,
              accountName: `@${account.username}`,
              platform: "instagram",
              accountImage: account.profile_picture_url,
              title: "No posts yet",
              views: "N/A",
              likes: "N/A",
              error: "This account has no media posts.",
            });
            continue;
          }

          // Sort by timestamp and find latest video/reel
          const sortedMedia = [...mediaList].sort(
            (a, b) =>
              new Date(b.timestamp || 0).getTime() -
              new Date(a.timestamp || 0).getTime(),
          );

          const latestVideo = sortedMedia.find((item) =>
            isInstagramVideoItem(item),
          );

          if (!latestVideo) {
            nextStats.push({
              id: `instagram-${account.id}`,
              accountId: account.id,
              accountName: `@${account.username}`,
              platform: "instagram",
              accountImage: account.profile_picture_url,
              title: "No video/reel found",
              views: "N/A",
              likes: "N/A",
              error: "No recent reel or video found for this account.",
            });
            continue;
          }

          // Fetch views for the video
          const viewsValue = await fetchInstagramVideoViews(
            latestVideo.id,
            account.token,
            latestVideo.media_type,
          );

          // Get likes from media or insights
          let likesValue: number | string = latestVideo.like_count || "N/A";

          // Try to get insights for better data
          try {
            const insights = await getMediaInsights(
              latestVideo.id,
              account.token,
              latestVideo.media_type,
            );
            if (insights.engagement && Number(insights.engagement) > 0) {
              likesValue = Number(insights.engagement);
            }
          } catch (insightErr) {
            console.warn(`Could not fetch insights for likes:`, insightErr);
          }

          nextStats.push({
            id: latestVideo.id,
            accountId: account.id,
            accountName: `@${account.username}`,
            platform: "instagram",
            accountImage: account.profile_picture_url,
            title:
              latestVideo.caption?.slice(0, 80) || "Latest Instagram Video",
            caption: latestVideo.caption,
            thumbnail: latestVideo.thumbnail_url || latestVideo.media_url,
            mediaUrl: latestVideo.media_url,
            publishedAt: latestVideo.timestamp,
            views: viewsValue,
            likes: likesValue,
            comments: latestVideo.comments_count || "N/A",
            mediaType: latestVideo.media_type,
          });
        } catch (accountError: any) {
          console.error(
            `Error processing Instagram account ${account.username}:`,
            accountError,
          );
          nextStats.push({
            id: `instagram-${account.id}`,
            accountId: account.id,
            accountName: `@${account.username}`,
            platform: "instagram",
            accountImage: account.profile_picture_url,
            title: "Failed to load",
            views: "N/A",
            likes: "N/A",
            error:
              accountError?.message ||
              "Could not load Instagram stats. Please check your connection.",
          });
        }
      }

      // Process YouTube accounts
      for (const account of ytAccounts) {
        const accessToken = account.accessToken || account.token;
        if (!accessToken) {
          nextStats.push({
            id: `youtube-${account.id}`,
            accountId: account.id,
            accountName: account.username || account.name || "YouTube Account",
            platform: "youtube",
            accountImage: account.thumbnail,
            title: "⚠️ Account not connected",
            views: "N/A",
            likes: "N/A",
            error: "Token missing. Please reconnect this YouTube account.",
          });
          continue;
        }

        try {
          // Fetch latest video
          const searchResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${account.id}&order=date&type=video&maxResults=1&access_token=${accessToken}`,
          );
          const searchData = await searchResponse.json();

          if (!searchResponse.ok) {
            throw new Error(
              searchData.error?.message || "Failed to fetch YouTube videos",
            );
          }

          const latestVideo = searchData.items?.[0];

          if (!latestVideo?.id?.videoId) {
            nextStats.push({
              id: `youtube-${account.id}`,
              accountId: account.id,
              accountName:
                account.username || account.name || "YouTube Account",
              platform: "youtube",
              accountImage: account.thumbnail,
              title: "No videos found",
              views: "N/A",
              likes: "N/A",
              error: "No videos found for this channel.",
            });
            continue;
          }

          // Get video details
          const details = await getYouTubeVideoDetails(
            latestVideo.id.videoId,
            accessToken,
          );

          if (!details) {
            throw new Error("Could not load video details");
          }

          nextStats.push({
            id: details.id,
            accountId: account.id,
            accountName: account.username || account.name || "YouTube Account",
            platform: "youtube",
            accountImage: account.thumbnail,
            title: details.title,
            caption: details.description,
            thumbnail: details.thumbnail,
            publishedAt: details.publishedAt,
            views: Number(details.viewCount || 0),
            likes: Number(details.likeCount || 0),
            comments: Number(details.commentCount || 0),
            mediaType: "VIDEO",
          });
        } catch (accountError: any) {
          console.error(
            `Error processing YouTube account ${account.name}:`,
            accountError,
          );
          nextStats.push({
            id: `youtube-${account.id}`,
            accountId: account.id,
            accountName: account.username || account.name || "YouTube Account",
            platform: "youtube",
            accountImage: account.thumbnail,
            title: "Failed to load",
            views: "N/A",
            likes: "N/A",
            error:
              accountError?.message ||
              "Could not load YouTube stats. Please check your connection.",
          });
        }
      }

      // Sort stats: accounts with errors last, then by views (highest first)
      nextStats.sort((a, b) => {
        if (a.error && !b.error) return 1;
        if (!a.error && b.error) return -1;

        const aViews = typeof a.views === "number" ? a.views : 0;
        const bViews = typeof b.views === "number" ? b.views : 0;
        return bViews - aViews;
      });

      setStats(nextStats);
    } catch (loadError: any) {
      console.error("Failed to load latest video stats:", loadError);
      setError(
        loadError?.message ||
          "Failed to load latest video stats. Please try again.",
      );
      setStats([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-cyan-500/20 blur-xl animate-pulse"></div>
            <Loader2 className="relative h-12 w-12 animate-spin text-cyan-400" />
          </div>
          <p className="text-white/60 font-medium">
            Loading latest video stats...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-900/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-xl p-2 text-white/60 transition-all hover:bg-white/10 hover:text-white hover:scale-105"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-wider text-cyan-300/70 font-semibold">
                Latest Performance
              </p>
              <h1 className="text-xl font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                Latest Video Stats
              </h1>
            </div>
          </div>
          <button
            onClick={() => loadStats(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-all hover:bg-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 backdrop-blur-sm p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-red-200">Error loading stats</p>
              <p className="text-sm text-red-300/80">{error}</p>
            </div>
          </div>
        )}

        {stats.length === 0 && !error ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-12 text-center">
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-white/10 p-4">
                <Video className="h-8 w-8 text-white/40" />
              </div>
            </div>
            <p className="text-lg font-medium text-white">
              No accounts connected
            </p>
            <p className="mt-2 text-sm text-white/50">
              Connect Instagram or YouTube accounts to see their latest video
              stats.
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-cyan-500/20 px-4 py-2 text-sm font-medium text-cyan-300 transition-all hover:bg-cyan-500/30"
            >
              Go to Dashboard
              <ArrowLeft className="h-4 w-4 rotate-180" />
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {stats.map((item) => (
              <div
                key={`${item.platform}-${item.accountId}-${item.id}`}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm transition-all hover:border-white/20 hover:bg-white/10 hover:shadow-xl"
              >
                {/* Gradient overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-purple-500/0 opacity-0 transition-opacity group-hover:opacity-10"></div>

                <div className="relative p-4">
                  {/* Header with account info */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className="relative">
                        <img
                          src={
                            item.accountImage ||
                            `https://ui-avatars.com/api/?name=${encodeURIComponent(item.accountName)}&background=0D9488&color=fff&rounded=true&size=32`
                          }
                          alt={item.accountName}
                          className="h-8 w-8 rounded-full object-cover ring-2 ring-white/20"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              `https://ui-avatars.com/api/?name=${encodeURIComponent(item.accountName)}&background=0D9488&color=fff&rounded=true&size=32`;
                          }}
                        />
                        <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-slate-900 p-0.5">
                          {item.platform === "instagram" ? (
                            <Instagram className="h-3 w-3 text-pink-400" />
                          ) : (
                            <Youtube className="h-3 w-3 text-red-400" />
                          )}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">
                          {item.accountName}
                        </p>
                        {item.publishedAt && !item.error && (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-white/40" />
                            <p className="text-xs text-white/40">
                              {formatRelativeTime(item.publishedAt)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    {item.mediaType && !item.error && (
                      <div className="rounded-full bg-white/10 px-2 py-1">
                        <span className="text-[10px] font-medium text-white/60">
                          {getMediaTypeIcon(item.mediaType)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Thumbnail */}
                  {item.thumbnail && !item.error ? (
                    <div className="relative mb-3 overflow-hidden rounded-xl bg-black/40 aspect-video">
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          (
                            e.target as HTMLImageElement
                          ).parentElement!.innerHTML +=
                            '<div class="flex h-full items-center justify-center"><Play className="h-8 w-8 text-white/40" /></div>';
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 bg-black/50">
                        <Play className="h-8 w-8 text-white" />
                      </div>
                    </div>
                  ) : (
                    !item.error && (
                      <div className="mb-3 flex h-32 items-center justify-center rounded-xl bg-white/5">
                        <Play className="h-8 w-8 text-white/20" />
                      </div>
                    )
                  )}

                  {/* Title */}
                  <p className="mb-3 line-clamp-2 text-sm font-medium text-white/90 group-hover:text-white">
                    {item.title}
                  </p>

                  {/* Stats */}
                  {!item.error ? (
                    <>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5">
                          <Eye className="h-3.5 w-3.5 text-cyan-300" />
                          <span className="text-sm font-bold text-white">
                            {formatMetric(item.views)}
                          </span>
                          <span className="text-[10px] text-white/50">
                            views
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5">
                          <Heart className="h-3.5 w-3.5 text-pink-300" />
                          <span className="text-sm font-bold text-white">
                            {formatMetric(item.likes)}
                          </span>
                          <span className="text-[10px] text-white/50">
                            likes
                          </span>
                        </div>
                        {item.comments && Number(item.comments) > 0 && (
                          <div className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5">
                            <MessageCircle className="h-3.5 w-3.5 text-purple-300" />
                            <span className="text-sm font-bold text-white">
                              {formatMetric(item.comments)}
                            </span>
                            <span className="text-[10px] text-white/50">
                              comments
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Engagement rate indicator */}
                      {typeof item.views === "number" &&
                        typeof item.likes === "number" &&
                        item.views > 0 && (
                          <div className="mt-2">
                            <div className="flex justify-between text-[10px] text-white/40 mb-1">
                              <span>Engagement Rate</span>
                              <span>
                                {((item.likes / item.views) * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-purple-400 transition-all duration-500"
                                style={{
                                  width: `${Math.min((item.likes / item.views) * 100, 100)}%`,
                                }}
                              ></div>
                            </div>
                          </div>
                        )}
                    </>
                  ) : (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 mt-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-amber-200">{item.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

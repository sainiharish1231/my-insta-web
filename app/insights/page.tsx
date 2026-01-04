"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMediaList, getMediaInsights } from "@/lib/meta";
import {
  ArrowLeft,
  Heart,
  Eye,
  MessageCircle,
  TrendingUp,
  Calendar,
  ImageIcon,
  Video,
  Globe,
  RefreshCw,
  Loader2,
} from "lucide-react";

interface Media {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  caption?: string;
  timestamp: string;
}

interface Insights {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  reach?: number;
  engagement?: number;
}

export default function InsightsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [insights, setInsights] = useState<Record<string, Insights>>({});

  useEffect(() => {
    const token = localStorage.getItem("fb_access_token");
    const igUserId = localStorage.getItem("ig_user_id");

    if (!token || !igUserId) {
      router.push("/");
      return;
    }

    loadInsights(token, igUserId);
  }, [router]);

  const loadInsights = async (
    token: string,
    igUserId: string,
    isRefresh = false
  ) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const igAccountsStored = JSON.parse(
        localStorage.getItem("ig_accounts") || "[]"
      );
      const igAccount = igAccountsStored.find((a: any) => a.id === igUserId);
      const accountToken = igAccount?.token || token; // Fallback to old token

      const media = await getMediaList(igUserId, accountToken);
      setMediaList(media);

      const insightsData: Record<string, Insights> = {};
      for (const item of media.slice(0, 10)) {
        try {
          const data = await getMediaInsights(
            item.id,
            accountToken,
            item.media_type
          );
          insightsData[item.id] = data;
        } catch (err) {
          console.error(`[v0] Failed to load insights for ${item.id}`);
        }
      }
      setInsights(insightsData);
    } catch (err: any) {
      console.error("[v0] Error loading insights:", err);
      setError(err.message || "Failed to load insights");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    const token = localStorage.getItem("fb_access_token");
    const igUserId = localStorage.getItem("ig_user_id");
    if (token && igUserId) {
      loadInsights(token, igUserId, true);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-pink-500 animate-spin" />
          <p className="text-white/60">Loading insights...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="bg-slate-900/80 backdrop-blur-xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push("/dashboard")}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-white/60" />
              </button>
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-pink-400" />
                <h1 className="text-xl font-semibold text-white">
                  Analytics & Insights
                </h1>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-white/70 transition-colors border border-white/10"
            >
              <RefreshCw
                className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {mediaList.length === 0 ? (
          <div className="bg-slate-900/50 rounded-2xl p-12 text-center border border-white/10">
            <ImageIcon className="w-12 h-12 text-white/30 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              No Media Found
            </h2>
            <p className="text-white/50">
              Create your first post to see insights!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {mediaList.map((media) => {
              const mediaInsights = insights[media.id] || {};
              return (
                <div
                  key={media.id}
                  className="bg-slate-900/50 backdrop-blur-sm rounded-2xl overflow-hidden border border-white/10"
                >
                  {/* Media Preview */}
                  {(media.media_url || media.thumbnail_url) && (
                    <div className="relative h-48">
                      <img
                        src={
                          media.media_type === "VIDEO"
                            ? media.thumbnail_url
                            : media.media_url
                        }
                        alt="Media"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-3 left-3">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-md ${
                            media.media_type === "VIDEO" ||
                            media.media_type === "REELS"
                              ? "bg-purple-500/80 text-white"
                              : "bg-pink-500/80 text-white"
                          }`}
                        >
                          {media.media_type === "VIDEO" ||
                          media.media_type === "REELS" ? (
                            <Video className="w-3 h-3 inline mr-1" />
                          ) : (
                            <ImageIcon className="w-3 h-3 inline mr-1" />
                          )}
                          {media.media_type}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="p-5">
                    {/* Caption */}
                    <p className="text-white/70 text-sm mb-4 line-clamp-2">
                      {media.caption || "No caption"}
                    </p>

                    {/* Insights Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-pink-500/20 rounded-lg">
                          <Heart className="w-4 h-4 text-pink-400" />
                        </div>
                        <div>
                          <p className="text-lg font-bold text-white">
                            {mediaInsights.engagement || "N/A"}
                          </p>
                          <p className="text-xs text-white/40">Likes</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-500/20 rounded-lg">
                          <MessageCircle className="w-4 h-4 text-purple-400" />
                        </div>
                        <div>
                          <p className="text-lg font-bold text-white">
                            {mediaInsights.comments || "N/A"}
                          </p>
                          <p className="text-xs text-white/40">Comments</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-500/20 rounded-lg">
                          <Eye className="w-4 h-4 text-orange-400" />
                        </div>
                        <div>
                          <p className="text-lg font-bold text-white">
                            {mediaInsights.views ||
                              mediaInsights.reach ||
                              "N/A"}
                          </p>
                          <p className="text-xs text-white/40">Views</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-500/20 rounded-lg">
                          <TrendingUp className="w-4 h-4 text-emerald-400" />
                        </div>
                        <div>
                          <p className="text-lg font-bold text-white">
                            {mediaInsights.reach || "N/A"}
                          </p>
                          <p className="text-xs text-white/40">Reach</p>
                        </div>
                      </div>
                    </div>

                    {/* Date */}
                    <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/10">
                      <Calendar className="w-4 h-4 text-white/30" />
                      <span className="text-sm text-white/40">
                        {new Date(media.timestamp).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

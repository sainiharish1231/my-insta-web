"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  ImageIcon,
  Instagram,
  Loader2,
  RefreshCw,
  Video,
} from "lucide-react";
import { getMediaList } from "@/lib/meta";

interface InstagramAccount {
  id: string;
  username: string;
  profile_picture_url?: string;
  followers_count?: number;
  token?: string;
}

interface InstagramMedia {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  caption?: string;
  timestamp: string;
}

function formatPostDate(value?: string) {
  if (!value) {
    return "Unknown date";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }

  return parsed.toLocaleString();
}

function getMediaPreview(media: InstagramMedia) {
  return media.media_type === "VIDEO" || media.media_type === "REELS"
    ? media.thumbnail_url || media.media_url
    : media.media_url || media.thumbnail_url;
}

function isPlayableMedia(media: InstagramMedia) {
  return (
    (media.media_type === "VIDEO" || media.media_type === "REELS") &&
    Boolean(media.media_url)
  );
}

export default function MyInstaIdPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [media, setMedia] = useState<InstagramMedia[]>([]);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [primaryAccountId, setPrimaryAccountId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const storedAccounts = JSON.parse(
        localStorage.getItem("ig_accounts") || "[]"
      ) as InstagramAccount[];

      setAccounts(storedAccounts);

      if (storedAccounts.length > 0) {
        const storedPrimaryId = localStorage.getItem("primary_ig_account_id");
        const storedSelected = localStorage.getItem("ig_user_id");
        const preferredAccount = storedAccounts.find(
          (account) => account.id === storedPrimaryId || account.id === storedSelected
        );
        setPrimaryAccountId(storedPrimaryId || storedAccounts[0].id);
        setSelectedAccountId(preferredAccount?.id || storedAccounts[0].id);
      }
    } catch (loadError) {
      console.error("[v0] Failed to load Instagram accounts:", loadError);
      setError("Saved Instagram accounts could not be loaded.");
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    const selectedAccount = accounts.find(
      (account) => account.id === selectedAccountId
    );

    if (!selectedAccount) {
      setMedia([]);
      return;
    }

    if (!selectedAccount.token) {
      setMedia([]);
      setError("This account is missing its Instagram token.");
      return;
    }

    let cancelled = false;

    const loadMedia = async () => {
      setLoadingMedia(true);
      setError("");

      try {
        const mediaList = await getMediaList(
          selectedAccount.id,
          selectedAccount.token as string
        );

        if (cancelled) {
          return;
        }

        const sortedMedia = [...mediaList].sort((a, b) => {
          return (
            new Date(b.timestamp || 0).getTime() -
            new Date(a.timestamp || 0).getTime()
          );
        });

        setMedia(sortedMedia);
        localStorage.setItem("ig_user_id", selectedAccount.id);
      } catch (mediaError: any) {
        if (cancelled) {
          return;
        }

        console.error("[v0] Failed to load Instagram media:", mediaError);
        setMedia([]);
        setError(mediaError?.message || "Instagram posts could not be loaded.");
      } finally {
        if (!cancelled) {
          setLoadingMedia(false);
        }
      }
    };

    loadMedia();

    return () => {
      cancelled = true;
    };
  }, [accounts, selectedAccountId, refreshSeed]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );
  const latestPost = media[0];

  const setPrimaryAccount = (accountId: string) => {
    setPrimaryAccountId(accountId);
    localStorage.setItem("primary_ig_account_id", accountId);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-900/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-xl p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 p-2.5">
                <Instagram className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">My Insta IDs</h1>
                <p className="text-sm text-white/50">
                  Saved Instagram accounts, posts, reels, and playable videos
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => setRefreshSeed((current) => current + 1)}
            disabled={loadingMedia}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${loadingMedia ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
          <div className="mb-4">
            <p className="text-sm font-medium text-white/70">
              Connected Instagram Accounts
            </p>
            <p className="text-xs text-white/40">
              Click any account to load its posts
            </p>
          </div>

          {loadingAccounts ? (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
              <Loader2 className="h-4 w-4 animate-spin text-pink-400" />
              <span className="text-sm text-white/60">Loading accounts...</span>
            </div>
          ) : accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/40 p-5 text-center">
              <Instagram className="mx-auto mb-3 h-8 w-8 text-white/30" />
              <p className="font-medium text-white">No Instagram accounts</p>
              <p className="mt-1 text-sm text-white/50">
                Login an Instagram account first from the home page.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => {
                const isSelected = account.id === selectedAccountId;
                const isPrimary = account.id === primaryAccountId;

                return (
                  <div
                    key={account.id}
                    className={`w-full rounded-2xl border p-3 text-left transition-all ${
                      isSelected
                        ? "border-pink-500/40 bg-gradient-to-r from-pink-500/15 to-orange-500/10"
                        : "border-white/10 bg-slate-900/50 hover:border-white/20 hover:bg-white/10"
                    }`}
                  >
                    <button
                      onClick={() => setSelectedAccountId(account.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={
                            account.profile_picture_url ||
                            "/placeholder.svg?height=48&width=48&query=instagram profile"
                          }
                          alt={account.username}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium text-white">
                              @{account.username}
                            </p>
                            {isPrimary && (
                              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-300">
                                Primary
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-white/50">
                            {account.followers_count?.toLocaleString() || 0} followers
                          </p>
                        </div>
                      </div>
                    </button>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => setPrimaryAccount(account.id)}
                        className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                          isPrimary
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-white/8 text-white/70 hover:bg-white/12 hover:text-white"
                        }`}
                      >
                        {isPrimary ? "Primary Account" : "Set Primary"}
                      </button>
                      {isPrimary && (
                        <button
                          onClick={() => router.push("/insta-video-bridge")}
                          className="rounded-xl bg-fuchsia-500/15 px-3 py-2 text-xs font-medium text-fuchsia-200 transition-colors hover:bg-fuchsia-500/25"
                        >
                          Open Repost Page
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <section className="space-y-6">
          {selectedAccount && (
            <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-fuchsia-500/10 via-pink-500/10 to-orange-500/10 p-6">
              <div className="flex flex-wrap items-center gap-4">
                <img
                  src={
                    selectedAccount.profile_picture_url ||
                    "/placeholder.svg?height=64&width=64&query=instagram profile"
                  }
                  alt={selectedAccount.username}
                  className="h-16 w-16 rounded-full border border-white/10 object-cover"
                />
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-pink-300/80">
                    Selected account
                  </p>
                  <h2 className="text-2xl font-semibold">
                    @{selectedAccount.username}
                  </h2>
                  <p className="text-sm text-white/55">
                    {selectedAccount.followers_count?.toLocaleString() || 0} followers
                    {" • "}
                    {media.length} post{media.length === 1 ? "" : "s"} loaded
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              {error}
            </div>
          )}

          {loadingMedia ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-3xl border border-white/10 bg-slate-900/40">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-pink-400" />
                <p className="text-white/60">Loading posts...</p>
              </div>
            </div>
          ) : !selectedAccount ? (
            <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-10 text-center">
              <p className="text-white/60">
                Select an Instagram account to view its posts.
              </p>
            </div>
          ) : media.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-10 text-center">
              <ImageIcon className="mx-auto mb-4 h-10 w-10 text-white/30" />
              <p className="text-lg font-medium text-white">No posts found</p>
              <p className="mt-2 text-sm text-white/50">
                This account does not have recent media available right now.
              </p>
            </div>
          ) : (
            <>
              {latestPost && (
                <div className="overflow-hidden rounded-3xl border border-pink-500/20 bg-slate-900/60">
                  <div className="border-b border-white/10 px-5 py-4">
                    <p className="text-sm uppercase tracking-[0.2em] text-pink-300/80">
                      Latest post
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-white">
                      Most recent post from @{selectedAccount.username}
                    </h3>
                  </div>
                  <div className="grid gap-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                    <div className="bg-black/30">
                      {isPlayableMedia(latestPost) ? (
                        <video
                          src={latestPost.media_url}
                          poster={latestPost.thumbnail_url}
                          controls
                          playsInline
                          preload="metadata"
                          className="h-full min-h-[280px] w-full object-cover"
                        />
                      ) : getMediaPreview(latestPost) ? (
                        <img
                          src={getMediaPreview(latestPost)}
                          alt={latestPost.caption || "Latest Instagram post"}
                          className="h-full min-h-[280px] w-full object-cover"
                        />
                      ) : (
                        <div className="flex min-h-[280px] items-center justify-center">
                          <ImageIcon className="h-12 w-12 text-white/20" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-4 p-5">
                      <div className="flex items-center gap-2 text-xs text-white/45">
                        <span className="rounded-full bg-white/10 px-2 py-1">
                          {latestPost.media_type}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatPostDate(latestPost.timestamp)}
                        </span>
                      </div>
                      <p className="line-clamp-6 text-sm leading-6 text-white/75">
                        {latestPost.caption || "No caption on this post."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-white">
                    All posts
                  </h3>
                  <p className="text-sm text-white/45">
                    {media.length} recent post{media.length === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {media.map((item) => {
                    const preview = getMediaPreview(item);
                    const isVideo =
                      item.media_type === "VIDEO" || item.media_type === "REELS";

                    return (
                      <article
                        key={item.id}
                        className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 transition-colors hover:border-pink-500/30"
                      >
                        <div className="relative h-64 bg-black/30">
                          {isPlayableMedia(item) ? (
                            <video
                              src={item.media_url}
                              poster={item.thumbnail_url}
                              controls
                              playsInline
                              preload="metadata"
                              className="h-full w-full object-cover"
                            />
                          ) : preview ? (
                            <img
                              src={preview}
                              alt={item.caption || "Instagram media"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center">
                              <ImageIcon className="h-10 w-10 text-white/20" />
                            </div>
                          )}

                          <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs text-white">
                            <span className="inline-flex items-center gap-1">
                              {isVideo ? (
                                <Video className="h-3.5 w-3.5" />
                              ) : (
                                <ImageIcon className="h-3.5 w-3.5" />
                              )}
                              {item.media_type}
                            </span>
                          </div>
                        </div>

                        <div className="p-4">
                          <p className="mb-3 line-clamp-3 text-sm leading-6 text-white/75">
                            {item.caption || "No caption"}
                          </p>
                          <p className="text-xs text-white/45">
                            {formatPostDate(item.timestamp)}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

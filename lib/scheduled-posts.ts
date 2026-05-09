import {
  buildYouTubeDescriptionFromSeoDraft,
  buildYouTubeTagsFromKeywords,
} from "@/lib/bulk-video-seo";
import { publishInstagramAndFacebookReel } from "@/lib/meta";

export const SCHEDULED_POSTS_STORAGE_KEY = "scheduled_posts";

export interface ScheduledPostAccount {
  id: string;
  username: string;
  platform: "instagram" | "youtube";
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  pageId?: string;
}

export interface ScheduledPost {
  id: string;
  mediaUrl: string;
  cloudinaryPublicId?: string;
  cloudinaryResourceType?: string;
  caption?: string;
  title?: string;
  description?: string;
  keywords?: string[];
  contentType?: "POST" | "REEL" | "VIDEO" | "SHORT";
  accounts: ScheduledPostAccount[];
  scheduledFor: string;
  status: "scheduled" | "processing" | "posted" | "error";
  error?: string;
  postedAt?: string;
  processingStartedAt?: string;
  source?: string;
}

interface ProcessDueScheduledPostsOptions {
  now?: Date;
  onYouTubeAccessToken?: (accountId: string, accessToken: string) => void;
}

const STALE_PROCESSING_MS = 15 * 60 * 1000;

function getBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function isFuturePost(post: ScheduledPost, now = new Date()) {
  const scheduledTime = new Date(post.scheduledFor).getTime();
  return (
    Number.isFinite(scheduledTime) &&
    scheduledTime > now.getTime() &&
    (post.status === "scheduled" || post.status === "processing")
  );
}

function isDuePost(post: ScheduledPost, now = new Date()) {
  const scheduledTime = new Date(post.scheduledFor).getTime();
  if (!Number.isFinite(scheduledTime) || scheduledTime > now.getTime()) {
    return false;
  }

  if (post.status === "scheduled") {
    return true;
  }

  if (post.status !== "processing" || !post.processingStartedAt) {
    return false;
  }

  const processingStartedAt = new Date(post.processingStartedAt).getTime();
  return (
    Number.isFinite(processingStartedAt) &&
    now.getTime() - processingStartedAt > STALE_PROCESSING_MS
  );
}

function parseScheduledPosts(rawValue: string | null) {
  try {
    const parsed = JSON.parse(rawValue || "[]");
    return Array.isArray(parsed) ? (parsed as ScheduledPost[]) : [];
  } catch {
    return [];
  }
}

export function readScheduledPosts() {
  return parseScheduledPosts(
    getBrowserStorage()?.getItem(SCHEDULED_POSTS_STORAGE_KEY) || "[]",
  );
}

export function writeScheduledPosts(posts: ScheduledPost[]) {
  getBrowserStorage()?.setItem(
    SCHEDULED_POSTS_STORAGE_KEY,
    JSON.stringify(posts),
  );
}

export function appendScheduledPosts(posts: ScheduledPost[]) {
  if (posts.length === 0) {
    return;
  }

  writeScheduledPosts([...readScheduledPosts(), ...posts]);
}

export function getUpcomingScheduledPosts(now = new Date()) {
  return readScheduledPosts().filter((post) => isFuturePost(post, now));
}

async function publishScheduledPostToAccount(
  post: ScheduledPost,
  account: ScheduledPostAccount,
  options: ProcessDueScheduledPostsOptions,
) {
  if (account.platform === "instagram") {
    if (!account.token) {
      throw new Error("Instagram token missing hai.");
    }

    const result = await publishInstagramAndFacebookReel({
      igUserId: account.id,
      token: account.token,
      pageId: account.pageId,
      mediaUrl: post.mediaUrl,
      caption: post.caption || post.title || "",
    });

    if (result.facebookError) {
      throw new Error(
        `Instagram publish ho gaya, lekin connected Facebook Page fail hua: ${result.facebookError}`,
      );
    }
    return;
  }

  const accessToken = account.accessToken || account.token;
  if (!accessToken) {
    throw new Error("YouTube token missing hai.");
  }

  const keywords = Array.isArray(post.keywords) ? post.keywords : [];
  const response = await fetch("/api/youtube/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accessToken,
      refreshToken: account.refreshToken,
      videoUrl: post.mediaUrl,
      title: post.title || "Scheduled Short",
      description: buildYouTubeDescriptionFromSeoDraft(
        {
          title: post.title || "Scheduled Short",
          description: post.description || post.caption || "",
          keywords,
        },
        { isShort: true },
      ),
      keywords: buildYouTubeTagsFromKeywords(keywords),
      privacy: "public",
      isShort: true,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "YouTube scheduled publish failed");
  }

  if (typeof data.accessToken === "string" && data.accessToken) {
    options.onYouTubeAccessToken?.(account.id, data.accessToken);
  }
}

async function publishScheduledPost(
  post: ScheduledPost,
  options: ProcessDueScheduledPostsOptions,
) {
  const accounts = Array.isArray(post.accounts) ? post.accounts : [];
  const errors: string[] = [];
  const publishedOn: string[] = [];

  for (const account of accounts) {
    try {
      await publishScheduledPostToAccount(post, account, options);
      publishedOn.push(account.username || account.id);
    } catch (error: any) {
      errors.push(
        `${account.username || account.id}: ${error?.message || "Publish failed"}`,
      );
    }
  }

  return {
    errors,
    publishedOn,
    successCount: publishedOn.length,
    totalTargets: accounts.length,
  };
}

export async function processDueScheduledPosts(
  options: ProcessDueScheduledPostsOptions = {},
) {
  const now = options.now || new Date();
  const posts = readScheduledPosts();
  const duePosts = posts.filter((post) => isDuePost(post, now));

  if (duePosts.length === 0) {
    return { processed: 0, posted: 0, failed: 0 };
  }

  const dueIds = new Set(duePosts.map((post) => post.id));
  const processingStartedAt = now.toISOString();

  writeScheduledPosts(
    posts.map((post) =>
      dueIds.has(post.id)
        ? {
            ...post,
            status: "processing",
            error: undefined,
            processingStartedAt,
          }
        : post,
    ),
  );

  let posted = 0;
  let failed = 0;

  for (const post of duePosts) {
    const currentPosts = readScheduledPosts();

    try {
      const result = await publishScheduledPost(post, options);
      const allTargetsPosted =
        result.totalTargets > 0 && result.successCount === result.totalTargets;

      if (allTargetsPosted) {
        posted += 1;
      } else {
        failed += 1;
      }

      writeScheduledPosts(
        currentPosts.map((currentPost) =>
          currentPost.id === post.id
            ? {
                ...currentPost,
                status: allTargetsPosted ? "posted" : "error",
                postedAt:
                  result.successCount > 0 ? new Date().toISOString() : undefined,
                error: allTargetsPosted
                  ? undefined
                  : result.errors.join("; ") ||
                    "Scheduled post kisi selected account par publish nahi hua.",
                processingStartedAt: undefined,
              }
            : currentPost,
        ),
      );
    } catch (error: any) {
      failed += 1;
      writeScheduledPosts(
        currentPosts.map((currentPost) =>
          currentPost.id === post.id
            ? {
                ...currentPost,
                status: "error",
                error: error?.message || "Scheduled publish failed",
                processingStartedAt: undefined,
              }
            : currentPost,
        ),
      );
    }
  }

  return {
    processed: duePosts.length,
    posted,
    failed,
  };
}

import {
  AUTO_PHOTO_DRAFTS_STORAGE_KEY,
  AUTO_TEXT_DRAFTS_STORAGE_KEY,
  AUTO_TEXT_SETTINGS_STORAGE_KEY,
} from "@/lib/auto-maction";
import type { AutoPhotoDraft, AutoTextDraft } from "@/lib/auto-maction";

const SCHEDULED_POSTS_STORAGE_KEY = "scheduled_posts";

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

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
}

function removeAccountIds(accountIds: unknown, accountId: string): string[] {
  return Array.isArray(accountIds)
    ? accountIds.filter(
        (id): id is string => typeof id === "string" && id !== accountId,
      )
    : [];
}

export function stopLocalAutomationForAccount(accountId: string) {
  const settings = readJson<any>(AUTO_TEXT_SETTINGS_STORAGE_KEY, null);
  if (settings && Array.isArray(settings.accountIds)) {
    const nextAccountIds = removeAccountIds(settings.accountIds, accountId);
    writeJson(AUTO_TEXT_SETTINGS_STORAGE_KEY, {
      ...settings,
      accountIds: nextAccountIds,
      enabled: nextAccountIds.length > 0 ? settings.enabled : false,
    });
  }

  const textDrafts = readJson<AutoTextDraft[]>(AUTO_TEXT_DRAFTS_STORAGE_KEY, []);
  if (textDrafts.length > 0) {
    writeJson(
      AUTO_TEXT_DRAFTS_STORAGE_KEY,
      textDrafts.map((draft) => ({
        ...draft,
        accountIds: removeAccountIds(draft.accountIds, accountId) as string[],
      })),
    );
  }

  const photoDrafts = readJson<AutoPhotoDraft[]>(
    AUTO_PHOTO_DRAFTS_STORAGE_KEY,
    [],
  );
  if (photoDrafts.length > 0) {
    writeJson(
      AUTO_PHOTO_DRAFTS_STORAGE_KEY,
      photoDrafts.map((draft) => ({
        ...draft,
        accountIds: removeAccountIds(draft.accountIds, accountId) as string[],
      })),
    );
  }

  const scheduledPosts = readJson<any[]>(SCHEDULED_POSTS_STORAGE_KEY, []);
  if (scheduledPosts.length > 0) {
    writeJson(
      SCHEDULED_POSTS_STORAGE_KEY,
      scheduledPosts
        .map((post) => ({
          ...post,
          accounts: Array.isArray(post.accounts)
            ? post.accounts.filter((account: any) => account.id !== accountId)
            : [],
        }))
        .filter((post) => post.accounts.length > 0),
    );
  }
}

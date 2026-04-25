export interface StoredInstagramAccount {
  id: string;
  username: string;
  profile_picture_url?: string;
  followers_count?: number;
  token?: string;
  pageId?: string;
}

interface FacebookPageAccount {
  id?: string;
  access_token?: string;
  instagram_business_account?: {
    id?: string;
  };
}

function isUnsupportedAccountsEdgeError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  const message =
    typeof candidate.message === "string"
      ? candidate.message.toLowerCase()
      : "";
  const code =
    typeof candidate.code === "number"
      ? candidate.code
      : typeof candidate.code === "string"
        ? Number(candidate.code)
        : NaN;

  return (
    Number.isFinite(code) &&
    code === 100 &&
    (message.includes("nonexisting field (accounts)") ||
      message.includes("unsupported get request"))
  );
}

function normalizeStoredInstagramAccount(
  value: unknown,
): StoredInstagramAccount | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const username =
    typeof candidate.username === "string" ? candidate.username.trim() : "";

  if (!id || !username) {
    return null;
  }

  return {
    id,
    username,
    profile_picture_url:
      typeof candidate.profile_picture_url === "string"
        ? candidate.profile_picture_url
        : undefined,
    followers_count:
      typeof candidate.followers_count === "number"
        ? candidate.followers_count
        : undefined,
    token: typeof candidate.token === "string" ? candidate.token : undefined,
    pageId: typeof candidate.pageId === "string" ? candidate.pageId : undefined,
  };
}

export function readStoredInstagramAccounts(
  storage?: Pick<Storage, "getItem"> | null,
) {
  if (!storage) {
    return [];
  }

  try {
    const parsed = JSON.parse(storage.getItem("ig_accounts") || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((account) => normalizeStoredInstagramAccount(account))
      .filter((account): account is StoredInstagramAccount => Boolean(account));
  } catch {
    return [];
  }
}

export function mergeInstagramAccounts(
  existingAccounts: StoredInstagramAccount[],
  nextAccounts: StoredInstagramAccount[],
) {
  const merged = new Map<string, StoredInstagramAccount>();

  for (const account of existingAccounts) {
    merged.set(account.id, account);
  }

  for (const account of nextAccounts) {
    const previousAccount = merged.get(account.id);
    merged.set(account.id, {
      ...previousAccount,
      ...account,
      token: account.token || previousAccount?.token,
      pageId: account.pageId || previousAccount?.pageId,
    });
  }

  return Array.from(merged.values());
}

export function persistInstagramAccounts(
  accounts: StoredInstagramAccount[],
  storage?: Pick<Storage, "setItem"> | null,
) {
  storage?.setItem("ig_accounts", JSON.stringify(accounts));
}

async function fetchInstagramAccountProfile(
  igUserId: string,
  pageToken: string,
): Promise<StoredInstagramAccount | null> {
  const profileRes = await fetch(
    `https://graph.facebook.com/v21.0/${igUserId}?fields=username,profile_picture_url,followers_count&access_token=${encodeURIComponent(pageToken)}`,
  );
  const profileData = await profileRes.json();

  if (profileData?.error) {
    throw new Error(profileData.error.message || "Failed to fetch Instagram profile.");
  }

  const username =
    typeof profileData?.username === "string" ? profileData.username.trim() : "";

  if (!username) {
    return null;
  }

  return {
    id: igUserId,
    username,
    profile_picture_url:
      typeof profileData.profile_picture_url === "string"
        ? profileData.profile_picture_url
        : undefined,
    followers_count:
      typeof profileData.followers_count === "number"
        ? profileData.followers_count
        : undefined,
    token: pageToken,
  };
}

export async function fetchInstagramAccountsFromFacebook(accessToken: string) {
  if (!accessToken.trim()) {
    return [];
  }

  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token,instagram_business_account&access_token=${encodeURIComponent(accessToken)}`,
  );
  const pagesData = await pagesRes.json();

  if (pagesData?.error) {
    if (isUnsupportedAccountsEdgeError(pagesData.error)) {
      return [];
    }

    throw new Error(
      pagesData.error.message || "Failed to load Facebook Pages for this account.",
    );
  }

  const pages = Array.isArray(pagesData?.data)
    ? (pagesData.data as FacebookPageAccount[])
    : [];

  const results = await Promise.allSettled(
    pages.map(async (page) => {
      const pageId = typeof page.id === "string" ? page.id : "";
      const pageToken =
        typeof page.access_token === "string" ? page.access_token : "";
      const igUserId =
        typeof page.instagram_business_account?.id === "string"
          ? page.instagram_business_account.id
          : "";

      if (!pageId || !pageToken || !igUserId) {
        return null;
      }

      const account = await fetchInstagramAccountProfile(igUserId, pageToken);
      if (!account) {
        return null;
      }

      return {
        ...account,
        pageId,
      } satisfies StoredInstagramAccount;
    }),
  );

  const nextAccounts: StoredInstagramAccount[] = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      nextAccounts.push(result.value);
      continue;
    }

    if (result.status === "rejected") {
      console.warn("[v0] Failed to sync one Instagram page account:", result.reason);
    }
  }

  return mergeInstagramAccounts([], nextAccounts);
}

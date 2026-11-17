const OWNER_KEY_STORAGE = "instagram_schedule_owner_key";

export function getInstagramOwnerKey(create = true) {
  let ownerKey = localStorage.getItem(OWNER_KEY_STORAGE);
  if (!ownerKey && create) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    ownerKey = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(OWNER_KEY_STORAGE, ownerKey);
  }
  return ownerKey || "";
}

export async function scheduleInstagramReel(input: {
  igUserId: string;
  username: string;
  accessToken: string;
  mediaUrl: string;
  caption: string;
  scheduledFor: string;
}) {
  const response = await fetch("/api/schedule/instagram", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-schedule-owner-key": getInstagramOwnerKey(true),
    },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Instagram post schedule nahi ho paaya.");
  }
  return data as { jobId: string; status: "scheduled" };
}

export async function listInstagramScheduledPosts() {
  const ownerKey = getInstagramOwnerKey(false);
  if (!ownerKey) return [];
  const response = await fetch("/api/schedule/instagram", {
    headers: { "x-schedule-owner-key": ownerKey },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Schedule list load nahi ho paayi.");
  return Array.isArray(data.jobs) ? data.jobs : [];
}

export async function deleteInstagramScheduledPost(jobId: string) {
  const response = await fetch(`/api/schedule/instagram/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
    headers: { "x-schedule-owner-key": getInstagramOwnerKey(false) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Scheduled post delete nahi ho paaya.");
}

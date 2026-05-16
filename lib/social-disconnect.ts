export async function disconnectSocialAccount(accountId: string) {
  const response = await fetch(
    `/api/social/disconnect/${encodeURIComponent(accountId)}`,
    {
      method: "DELETE",
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || "Account disconnect failed.");
  }

  return data;
}

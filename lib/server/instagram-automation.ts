import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

const GRAPH_VERSION = "v27.0";

function encryptionKey() {
  const configured = process.env.SCHEDULED_POSTS_ENCRYPTION_KEY || "";
  const key = Buffer.from(configured.replace(/^base64:/, ""), "base64");
  if (key.length !== 32) {
    throw new Error("SCHEDULED_POSTS_ENCRYPTION_KEY must be base64 for exactly 32 random bytes.");
  }
  return key;
}

export function instagramAutomationOwnerHash(ownerKey: string) {
  return createHash("sha256").update(ownerKey).digest("hex");
}

function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decryptToken(value: { iv: string; ciphertext: string; tag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export async function registerInstagramAutomationAccounts(ownerKey: string, accounts: any[]) {
  const db = await getDb();
  const collection = db.collection("instagram_automation_accounts");
  const ownerKeyHash = instagramAutomationOwnerHash(ownerKey);
  const warnings: string[] = [];

  for (const account of accounts) {
    const id = typeof account?.id === "string" ? account.id.trim() : "";
    const username = typeof account?.username === "string" ? account.username.trim().slice(0, 100) : "";
    const pageId = typeof account?.pageId === "string" ? account.pageId.trim() : "";
    const token = typeof account?.token === "string" ? account.token.trim() : "";
    if (!id || !username || !pageId || !token) continue;

    await collection.updateOne(
      { igUserId: id },
      {
        $set: {
          igUserId: id,
          username,
          pageId,
          ownerKeyHash,
          accessToken: encryptToken(token),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );

    const subscription = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/subscribed_apps`);
    subscription.searchParams.set("subscribed_fields", "messages,messaging_postbacks");
    subscription.searchParams.set("access_token", token);
    const response = await fetch(subscription, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      warnings.push(`${username}: webhook subscription not enabled (${data.error?.message || "Meta permission missing"}).`);
    }
  }

  return { registered: accounts.length, warnings };
}

export async function listInstagramAutomationAccounts(ownerKey: string) {
  const db = await getDb();
  return db.collection("instagram_automation_accounts")
    .find(
      { ownerKeyHash: instagramAutomationOwnerHash(ownerKey) },
      { projection: { igUserId: 1, username: 1, pageId: 1 } },
    )
    .sort({ username: 1 })
    .toArray();
}

export async function listInstagramAutomations(ownerKey: string, igUserId: string, triggerType: "dm" | "reel_comment" = "dm") {
  const db = await getDb();
  const triggerFilter = triggerType === "dm"
    ? { $or: [{ triggerType: "dm" }, { triggerType: { $exists: false } }] }
    : { triggerType };
  const rows = await db.collection("instagram_dm_automations")
    .find({ ownerKeyHash: instagramAutomationOwnerHash(ownerKey), igUserId, ...triggerFilter })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  return rows.map((row: any) => ({
    id: row._id.toString(),
    keyword: row.keyword,
    reply: row.reply,
    matchType: row.matchType,
    enabled: row.enabled,
    triggerType: row.triggerType || "dm",
  }));
}

export async function saveInstagramAutomation(ownerKey: string, input: {
  id?: string;
  igUserId: string;
  keyword: string;
  reply: string;
  matchType: "contains" | "exact";
  enabled: boolean;
  triggerType?: "dm" | "reel_comment";
}) {
  const db = await getDb();
  const ownerKeyHash = instagramAutomationOwnerHash(ownerKey);
  const collection = db.collection("instagram_dm_automations");
  const existingId = input.id && ObjectId.isValid(input.id) ? new ObjectId(input.id) : null;
  if (!existingId) {
    const count = await collection.countDocuments({ ownerKeyHash, igUserId: input.igUserId });
    if (count >= 20) throw new Error("Ek Instagram account par maximum 20 keyword rules rakh sakte ho.");
  }
  const filter = existingId
    ? { _id: existingId, ownerKeyHash, igUserId: input.igUserId }
    : null;
  const values = {
    ownerKeyHash,
    igUserId: input.igUserId,
    triggerType: input.triggerType || "dm",
    keyword: input.keyword,
    normalizedKeyword: input.keyword.trim().toLocaleLowerCase(),
    reply: input.reply,
    matchType: input.matchType,
    enabled: input.enabled,
    updatedAt: new Date(),
  };

  if (filter) {
    const result = await collection.updateOne(filter, { $set: values });
    if (result.matchedCount !== 1) throw new Error("Automation rule nahi mila.");
    return input.id;
  }

  const result = await collection.insertOne({ ...values, createdAt: new Date() });
  return result.insertedId.toString();
}

export async function deleteInstagramAutomation(ownerKey: string, igUserId: string, id: string) {
  if (!ObjectId.isValid(id)) return false;
  const db = await getDb();
  const result = await db.collection("instagram_dm_automations").deleteOne({
    _id: new ObjectId(id),
    ownerKeyHash: instagramAutomationOwnerHash(ownerKey),
    igUserId,
  });
  return result.deletedCount === 1;
}

async function sendInstagramTextReply(pageId: string, token: string, recipientId: string, text: string) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages`);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Instagram message send failed for Page ${pageId}.`);
  }
}

export async function processInstagramMessageWebhook(payload: any) {
  if (payload?.object !== "instagram" || !Array.isArray(payload.entry)) return;
  const db = await getDb();
  const events = db.collection("instagram_dm_events");
  await events.createIndex({ messageId: 1 }, { unique: true, sparse: true });
  const accounts = db.collection("instagram_automation_accounts");
  const rules = db.collection("instagram_dm_automations");

  for (const entry of payload.entry) {
    const igUserId = typeof entry?.id === "string" ? entry.id : "";
    if (!igUserId || !Array.isArray(entry.messaging)) continue;
    for (const event of entry.messaging) {
      const message = event?.message;
      const senderId = typeof event?.sender?.id === "string" ? event.sender.id : "";
      const messageId = typeof message?.mid === "string" ? message.mid : "";
      const text = typeof message?.text === "string" ? message.text.trim() : "";
      if (!senderId || !messageId || !text || message?.is_echo) continue;

      try {
        await events.insertOne({ messageId, igUserId, status: "processing", createdAt: new Date() });
      } catch (error: any) {
        if (error?.code === 11000) continue;
        throw error;
      }

      try {
        const account: any = await accounts.findOne({ igUserId });
        if (!account) {
          await events.updateOne({ messageId }, { $set: { status: "ignored", reason: "account_not_registered" } });
          continue;
        }
        const normalizedText = text.normalize("NFKC").toLocaleLowerCase();
        const enabledRules = await rules.find({ igUserId, ownerKeyHash: account.ownerKeyHash, enabled: true }).sort({ createdAt: 1 }).toArray();
        const match: any = enabledRules.find((rule: any) => {
          const keyword = rule.normalizedKeyword || String(rule.keyword || "").normalize("NFKC").toLocaleLowerCase();
          return rule.matchType === "exact" ? normalizedText === keyword : normalizedText.includes(keyword);
        });
        if (!match) {
          await events.updateOne({ messageId }, { $set: { status: "ignored", reason: "no_keyword_match" } });
          continue;
        }

        await sendInstagramTextReply(account.pageId, decryptToken(account.accessToken), senderId, match.reply);
        await events.updateOne({ messageId }, { $set: { status: "replied", automationId: match._id, repliedAt: new Date() } });
      } catch (error: any) {
        await events.updateOne({ messageId }, { $set: { status: "error", error: String(error?.message || "Auto reply failed").slice(0, 500), failedAt: new Date() } });
        console.error("[instagram-dm] Auto reply failed:", error);
      }
    }
  }
}

async function fetchGraphJson(url: URL) {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || "Instagram Graph API request failed.");
  return data;
}

async function replyToInstagramComment(commentId: string, token: string, message: string) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/replies`);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || "Instagram comment reply failed.");
}

export async function processRecentInstagramReelComments() {
  const db = await getDb();
  const accounts = await db.collection("instagram_automation_accounts").find({}).toArray();
  const rules = db.collection("instagram_dm_automations");
  const cursors = db.collection("instagram_reel_comment_cursors");
  const events = db.collection("instagram_dm_events");
  await events.createIndex({ messageId: 1 }, { unique: true, sparse: true });
  const results: Array<{ igUserId: string; processed: number; error?: string }> = [];

  for (const account of accounts as any[]) {
    const cursor = await cursors.findOne({ igUserId: account.igUserId });
    if (!cursor) {
      await cursors.insertOne({ igUserId: account.igUserId, lastScannedAt: new Date(), createdAt: new Date() });
      results.push({ igUserId: account.igUserId, processed: 0 });
      continue;
    }

    const lastScannedAt = new Date(cursor.lastScannedAt);
    let processed = 0;
    try {
      const token = decryptToken(account.accessToken);
      const mediaUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${account.igUserId}/media`);
      mediaUrl.searchParams.set("fields", "id,media_type,media_product_type,timestamp");
      mediaUrl.searchParams.set("limit", "100");
      mediaUrl.searchParams.set("access_token", token);
      const mediaData = await fetchGraphJson(mediaUrl);
      const reels = (mediaData.data || []).filter((media: any) => media.media_product_type === "REELS").slice(0, 25);
      const enabledRules = await rules.find({
        igUserId: account.igUserId,
        ownerKeyHash: account.ownerKeyHash,
        triggerType: "reel_comment",
        enabled: true,
      }).sort({ createdAt: 1 }).toArray();

      for (const reel of reels) {
        const commentsUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${reel.id}/comments`);
        commentsUrl.searchParams.set("fields", "id,text,timestamp,from{id,username}");
        commentsUrl.searchParams.set("limit", "100");
        commentsUrl.searchParams.set("access_token", token);
        let nextCommentsUrl: URL | null = commentsUrl;
        while (nextCommentsUrl) {
          const commentsData = await fetchGraphJson(nextCommentsUrl);
          for (const comment of commentsData.data || []) {
          const commentId = String(comment.id || "");
          const text = String(comment.text || "").trim();
          const createdAt = comment.timestamp ? new Date(comment.timestamp) : new Date(0);
          if (!commentId || !text || Number.isNaN(createdAt.getTime()) || createdAt <= lastScannedAt) continue;
          if (String(comment.from?.id || "") === String(account.igUserId)) continue;

          try {
            await events.insertOne({ messageId: `comment:${commentId}`, igUserId: account.igUserId, status: "processing", createdAt: new Date() });
          } catch (error: any) {
            if (error?.code === 11000) continue;
            throw error;
          }

          try {
            const normalizedText = text.normalize("NFKC").toLocaleLowerCase();
            const match: any = enabledRules.find((rule: any) => {
              const keyword = rule.normalizedKeyword || String(rule.keyword || "").normalize("NFKC").toLocaleLowerCase();
              return rule.matchType === "exact" ? normalizedText === keyword : normalizedText.includes(keyword);
            });
            if (!match) {
              await events.updateOne({ messageId: `comment:${commentId}` }, { $set: { status: "ignored", reason: "no_keyword_match" } });
              continue;
            }
            await replyToInstagramComment(commentId, token, match.reply);
            await events.updateOne({ messageId: `comment:${commentId}` }, { $set: { status: "replied", automationId: match._id, repliedAt: new Date() } });
            processed += 1;
          } catch (error: any) {
            await events.updateOne({ messageId: `comment:${commentId}` }, { $set: { status: "error", error: String(error?.message || "Comment reply failed").slice(0, 500), failedAt: new Date() } });
            console.error("[instagram-comments] Auto reply failed:", error);
          }
          }
          nextCommentsUrl = commentsData.paging?.next ? new URL(commentsData.paging.next) : null;
          if ((commentsData.data || []).some((comment: any) => comment.timestamp && new Date(comment.timestamp) <= lastScannedAt)) {
            nextCommentsUrl = null;
          }
        }
      }

      await cursors.updateOne({ igUserId: account.igUserId }, { $set: { lastScannedAt: new Date(), updatedAt: new Date() } });
      results.push({ igUserId: account.igUserId, processed });
    } catch (error: any) {
      console.error("[instagram-comments] Reel comment scan failed:", error);
      results.push({ igUserId: account.igUserId, processed, error: String(error?.message || "Scan failed") });
    }
  }

  return results;
}

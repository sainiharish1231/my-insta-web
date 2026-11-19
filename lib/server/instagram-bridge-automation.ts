import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { getInstagramAutomationAccountsWithTokensByHash, instagramAutomationOwnerHash } from "@/lib/server/instagram-automation";
import { hashScheduleOwnerKey, insertInstagramScheduledPost } from "@/lib/server/instagram-scheduled-posts";

const COLLECTION = "instagram_bridge_automations";
const TIME_ZONE = "Asia/Kolkata";
const PUBLISH_AFTER_MINUTE = 17 * 60;
const GRAPH_VERSION = "v27.0";

function indiaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export async function saveInstagramBridgeAutomation(ownerKey: string, input: {
  sourceIgUserId: string;
  baselineMediaId: string;
  targetIgUserIds: string[];
  enabled: boolean;
}) {
  const db = await getDb();
  const collection = db.collection(COLLECTION);
  const ownerKeyHash = instagramAutomationOwnerHash(ownerKey);
  const scheduleOwnerKeyHash = hashScheduleOwnerKey(ownerKey);
  await collection.createIndex({ ownerKeyHash: 1 }, { unique: true });
  const existing = await collection.findOne({ ownerKeyHash });
  const sourceChanged = existing?.sourceIgUserId !== input.sourceIgUserId;
  const beingEnabled = Boolean(input.enabled && !existing?.enabled);
  const resetBaseline = !existing || sourceChanged || beingEnabled;
  await collection.updateOne(
    { ownerKeyHash },
    {
      $set: {
        ownerKeyHash,
        scheduleOwnerKeyHash,
        sourceIgUserId: input.sourceIgUserId,
        targetIgUserIds: [...new Set(input.targetIgUserIds)],
        enabled: input.enabled,
        updatedAt: new Date(),
        ...(resetBaseline ? { lastSourceMediaId: input.baselineMediaId, lastRunLocalDate: null, lastRunStatus: "ready" } : {}),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
  return getInstagramBridgeAutomation(ownerKey);
}

export async function getInstagramBridgeAutomation(ownerKey: string) {
  const db = await getDb();
  const row: any = await db.collection(COLLECTION).findOne({ ownerKeyHash: instagramAutomationOwnerHash(ownerKey) });
  if (!row) return null;
  return {
    enabled: Boolean(row.enabled),
    sourceIgUserId: row.sourceIgUserId,
    targetIgUserIds: Array.isArray(row.targetIgUserIds) ? row.targetIgUserIds : [],
    lastSourceMediaId: row.lastSourceMediaId || "",
    lastRunLocalDate: row.lastRunLocalDate || null,
    lastRunStatus: row.lastRunStatus || "ready",
    lastRunMessage: row.lastRunMessage || "",
  };
}

async function uploadSourceVideoToCloudinary(mediaUrl: string, date: string) {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "";
  const apiKey = process.env.CLOUDINARY_API_KEY || "";
  if (!cloudName || !apiKey || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error("Daily repost ke liye Cloudinary signed upload env vars missing hain.");
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `instagram-bridge-auto/${date}`;
  const { generateCloudinarySignature } = await import("@/lib/cloudinary");
  const signature = await generateCloudinarySignature({ timestamp, folder });
  const body = new FormData();
  body.append("file", mediaUrl);
  body.append("folder", folder);
  body.append("timestamp", String(timestamp));
  body.append("api_key", apiKey);
  body.append("signature", signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, { method: "POST", body });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || !data.public_id) {
    throw new Error(data?.error?.message || "Cloudinary source video upload fail hua.");
  }
  const encodedId = String(data.public_id).split("/").map(encodeURIComponent).join("/");
  return `https://res.cloudinary.com/${cloudName}/video/upload/f_mp4,vc_h264:high,ac_aac,af_48000,q_auto:best,c_limit,w_1080,h_1920,so_0/${encodedId}.mp4`;
}

async function fetchLatestPlayableSource(account: { igUserId: string; token: string }) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${account.igUserId}/media`);
  url.searchParams.set("fields", "id,caption,media_type,media_product_type,media_url,timestamp");
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", account.token);
  const response = await fetch(url, { cache: "no-store" });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data?.error?.message || "Primary Instagram posts load nahi huye.");
  const videos = (Array.isArray(data.data) ? data.data : []).filter((item: any) =>
    (item.media_type === "VIDEO" || item.media_type === "REELS") && item.id && item.media_url,
  );
  return videos.sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())[0] || null;
}

async function releaseClaim(collection: any, id: any, lockId: string, values: Record<string, unknown>) {
  await collection.updateOne(
    { _id: id, lockId },
    { $set: { ...values, updatedAt: new Date() }, $unset: { lockId: "", lockUntil: "" } },
  );
}

export async function runDueInstagramBridgeAutomation() {
  const db = await getDb();
  const collection = db.collection(COLLECTION);
  const now = new Date();
  const { date, minutes } = indiaDateParts(now);
  const settings = await collection.find({ enabled: true }).toArray();
  const results: Array<Record<string, unknown>> = [];

  for (const setting of settings as any[]) {
    if (minutes < PUBLISH_AFTER_MINUTE) {
      results.push({ status: "waiting_for_5pm", date, sourceIgUserId: setting.sourceIgUserId });
      continue;
    }
    if (setting.lastRunLocalDate === date) {
      results.push({ status: setting.lastRunStatus || "done_today", date, sourceIgUserId: setting.sourceIgUserId });
      continue;
    }

    const lockId = randomUUID();
    const claimed = await collection.findOneAndUpdate(
      {
        _id: setting._id,
        enabled: true,
        lastRunLocalDate: { $ne: date },
        $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lte: now } }],
      },
      { $set: { lockId, lockUntil: new Date(now.getTime() + 4 * 60 * 1000) } },
      { returnDocument: "after" },
    );
    if (!claimed) {
      results.push({ status: "already_running", date, sourceIgUserId: setting.sourceIgUserId });
      continue;
    }

    try {
      const ids = [setting.sourceIgUserId, ...(setting.targetIgUserIds || [])];
      const accounts = await getInstagramAutomationAccountsWithTokensByHash(setting.ownerKeyHash, ids);
      const accountById = new Map<string, any>(accounts.map((account: any) => [account.igUserId, account] as const));
      const source: any = accountById.get(setting.sourceIgUserId);
      const targets: any[] = (setting.targetIgUserIds || []).map((id: string) => accountById.get(id)).filter(Boolean);
      if (!source || targets.length !== (setting.targetIgUserIds || []).length || !targets.length) {
        throw new Error("Source ya target Instagram account sync nahi hai. Insta Video Bridge me settings phir se save karo.");
      }

      const media = await fetchLatestPlayableSource(source);
      if (!media || media.id === setting.lastSourceMediaId) {
        await releaseClaim(collection, setting._id, lockId, {
          lastRunLocalDate: date,
          lastRunStatus: "skipped_no_new_video",
          lastRunMessage: "Aaj primary account par naya Reel/video nahi mila; kal 5 PM IST par phir check hoga.",
        });
        results.push({ status: "skipped_no_new_video", date, sourceUsername: source.username });
        continue;
      }

      const hostedMediaUrl = await uploadSourceVideoToCloudinary(media.media_url, date);
      for (const target of targets) {
        await insertInstagramScheduledPost({
          ownerKeyHash: setting.scheduleOwnerKeyHash,
          automationKey: `${setting.ownerKeyHash}:${media.id}:${target.igUserId}`,
          igUserId: target.igUserId,
          username: target.username,
          accessToken: target.token,
          mediaUrl: hostedMediaUrl,
          caption: typeof media.caption === "string" ? media.caption : "",
          scheduledFor: now,
        });
      }

      await releaseClaim(collection, setting._id, lockId, {
        lastSourceMediaId: media.id,
        lastRunLocalDate: date,
        lastRunStatus: "queued_for_targets",
        lastRunMessage: `Nayi Reel/video ${targets.length} target account(s) ke liye queue hui.`,
        lastSourceTimestamp: media.timestamp ? new Date(media.timestamp) : null,
      });
      results.push({ status: "queued_for_targets", date, sourceMediaId: media.id, targetCount: targets.length });
    } catch (error: any) {
      await releaseClaim(collection, setting._id, lockId, {
        lastRunStatus: "error",
        lastRunMessage: String(error?.message || "Daily bridge automation failed").slice(0, 500),
      });
      results.push({ status: "error", date, sourceIgUserId: setting.sourceIgUserId, error: String(error?.message || "Daily bridge automation failed").slice(0, 500) });
    }
  }
  return results;
}

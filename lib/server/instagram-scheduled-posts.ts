import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const COLLECTION = "instagram_scheduled_posts";

function encryptionKey() {
  const configured = process.env.SCHEDULED_POSTS_ENCRYPTION_KEY || "";
  const key = Buffer.from(configured.replace(/^base64:/, ""), "base64");
  if (key.length !== 32) {
    throw new Error("SCHEDULED_POSTS_ENCRYPTION_KEY must be base64 for exactly 32 random bytes.");
  }
  return key;
}

export function hashScheduleOwnerKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptToken(value: { iv: string; ciphertext: string; tag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function insertInstagramScheduledPost(input: {
  ownerKey: string;
  igUserId: string;
  username: string;
  accessToken: string;
  mediaUrl: string;
  caption: string;
  scheduledFor: Date;
}) {
  const db = await getDb();
  const collection = db.collection(COLLECTION);
  await collection.createIndex({ status: 1, scheduledFor: 1 });
  await collection.createIndex({ ownerKeyHash: 1, createdAt: -1 });
  const result = await collection.insertOne({
    ownerKeyHash: hashScheduleOwnerKey(input.ownerKey),
    igUserId: input.igUserId,
    username: input.username,
    accessToken: encryptToken(input.accessToken),
    mediaUrl: input.mediaUrl,
    caption: input.caption,
    scheduledFor: input.scheduledFor,
    status: "scheduled",
    createdAt: new Date(),
  });
  return result.insertedId.toString();
}

export async function listInstagramScheduledPosts(ownerKey: string) {
  const db = await getDb();
  const jobs = await db.collection(COLLECTION)
    .find(
      { ownerKeyHash: hashScheduleOwnerKey(ownerKey) },
      { projection: { igUserId: 1, username: 1, mediaUrl: 1, caption: 1, scheduledFor: 1, status: 1, error: 1, publishedAt: 1, createdAt: 1 } },
    )
    .sort({ scheduledFor: -1 })
    .limit(100)
    .toArray();
  return jobs.map((job: any) => ({
    id: job._id.toString(),
    igUserId: job.igUserId,
    username: job.username,
    mediaUrl: job.mediaUrl,
    caption: job.caption,
    scheduledFor: job.scheduledFor,
    status: job.status,
    error: job.error,
    publishedAt: job.publishedAt,
  }));
}

export async function deleteInstagramScheduledPost(ownerKey: string, jobId: string) {
  if (!ObjectId.isValid(jobId)) return false;
  const db = await getDb();
  const result = await db.collection(COLLECTION).deleteOne({
    _id: new ObjectId(jobId),
    ownerKeyHash: hashScheduleOwnerKey(ownerKey),
    status: { $ne: "publishing" },
  });
  return result.deletedCount === 1;
}

export async function runDueInstagramScheduledPosts(limit = 3) {
  const db = await getDb();
  const collection = db.collection(COLLECTION);
  const results: { status: "queued" | "published" | "error"; username: string; error?: string }[] = [];
  const tenMinutesAhead = new Date(Date.now() + 10 * 60 * 1000);
  const stalePreparationThreshold = new Date(Date.now() - 5 * 60 * 1000);

  for (let index = 0; index < limit; index += 1) {
    const job: any = await collection.findOneAndUpdate(
      {
        $or: [
          { status: "scheduled", scheduledFor: { $lte: tenMinutesAhead } },
          { status: "processing", processingStartedAt: { $lte: stalePreparationThreshold } },
        ],
      },
      { $set: { status: "processing", processingStartedAt: new Date() } },
      { sort: { scheduledFor: 1 }, returnDocument: "after" },
    );
    if (!job) break;

    try {
      const { createMedia } = await import("@/lib/meta");
      const token = decryptToken(job.accessToken);
      const creationId = await createMedia({
        igUserId: job.igUserId,
        token,
        mediaUrl: job.mediaUrl,
        caption: job.caption,
        isReel: true,
      });
      await collection.updateOne(
        { _id: job._id, status: "processing" },
        { $set: { status: "processing_media", mediaContainerId: creationId }, $unset: { processingStartedAt: "" } },
      );
      results.push({ status: "queued", username: job.username });
    } catch (error: any) {
      const message = (error?.message || "Instagram scheduled publish failed").slice(0, 1000);
      await collection.updateOne(
        { _id: job._id, status: "processing" },
        { $set: { status: "error", error: message, failedAt: new Date() }, $unset: { accessToken: "", processingStartedAt: "" } },
      );
      results.push({ status: "error", username: job.username, error: message });
    }
  }

  const dueMediaJobs = await collection
    .find({ status: "processing_media", scheduledFor: { $lte: new Date() } })
    .sort({ scheduledFor: 1 })
    .limit(limit)
    .toArray();

  for (const job of dueMediaJobs as any[]) {
    const claim = await collection.updateOne(
      { _id: job._id, status: "processing_media" },
      { $set: { status: "publishing", processingStartedAt: new Date() } },
    );
    if (claim.modifiedCount !== 1) continue;

    try {
      const { checkMediaStatus, publishMedia } = await import("@/lib/meta");
      const token = decryptToken(job.accessToken);
      const mediaStatus = await checkMediaStatus(job.mediaContainerId, token);
      if (mediaStatus.statusCode === "ERROR" || mediaStatus.statusCode === "EXPIRED") {
        throw new Error(mediaStatus.status || "Instagram video processing failed.");
      }
      if (mediaStatus.statusCode !== "FINISHED") {
        await collection.updateOne(
          { _id: job._id, status: "publishing" },
          { $set: { status: "processing_media" }, $unset: { processingStartedAt: "" } },
        );
        continue;
      }

      await publishMedia({
        igUserId: job.igUserId,
        token,
        creationId: job.mediaContainerId,
      });
      await collection.updateOne(
        { _id: job._id, status: "publishing" },
        { $set: { status: "published", publishedAt: new Date() }, $unset: { accessToken: "", processingStartedAt: "" } },
      );
      results.push({ status: "published", username: job.username });
    } catch (error: any) {
      const message = (error?.message || "Instagram scheduled publish failed").slice(0, 1000);
      await collection.updateOne(
        { _id: job._id, status: "publishing" },
        { $set: { status: "error", error: message, failedAt: new Date() }, $unset: { accessToken: "", processingStartedAt: "" } },
      );
      results.push({ status: "error", username: job.username, error: message });
    }
  }

  return results;
}

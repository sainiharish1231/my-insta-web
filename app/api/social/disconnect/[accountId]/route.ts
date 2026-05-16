import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function updateDatabaseDisconnect(accountId: string) {
  if (!process.env.MONGODB_URI) {
    return {
      databaseUpdated: false,
      automationStopped: false,
      reason: "MONGODB_URI is not configured.",
    };
  }

  const { getDb } = await import("@/lib/mongodb");
  const db = await getDb();
  const now = new Date();
  const accountQuery = {
    $or: [{ id: accountId }, { accountId }, { igUserId: accountId }],
  };

  const accountResult = await db.collection("social_accounts").updateOne(
    accountQuery,
    {
      $set: {
        isConnected: false,
        automationEnabled: false,
        disconnectedAt: now,
        updatedAt: now,
      },
      $unset: {
        accessToken: "",
        refreshToken: "",
        token: "",
        pageToken: "",
      },
    },
  );

  const automationResult = await db.collection("auto_maction_jobs").updateMany(
    {
      $or: [{ accountId }, { accountIds: accountId }],
    },
    {
      $set: {
        automationEnabled: false,
        status: "stopped",
        stoppedAt: now,
        stopReason: "account_disconnected",
      },
    },
  );

  return {
    databaseUpdated: accountResult.matchedCount > 0,
    automationStopped: automationResult.modifiedCount > 0,
    matchedAccounts: accountResult.matchedCount,
    stoppedJobs: automationResult.modifiedCount,
  };
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await params;
  const cleanAccountId = decodeURIComponent(accountId || "").trim();

  if (!cleanAccountId) {
    return NextResponse.json(
      { error: "accountId is required" },
      { status: 400 },
    );
  }

  try {
    const result = await updateDatabaseDisconnect(cleanAccountId);
    return NextResponse.json({
      ok: true,
      accountId: cleanAccountId,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        accountId: cleanAccountId,
        error: error?.message || "Failed to disconnect account.",
      },
      { status: 500 },
    );
  }
}

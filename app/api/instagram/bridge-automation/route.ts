import { NextRequest, NextResponse } from "next/server";
import { registerInstagramAutomationAccounts } from "@/lib/server/instagram-automation";
import { getInstagramBridgeAutomation, saveInstagramBridgeAutomation } from "@/lib/server/instagram-bridge-automation";

export const runtime = "nodejs";

function getOwnerKey(request: NextRequest) {
  const value = request.headers.get("x-instagram-owner-key") || "";
  return /^[a-f0-9]{64}$/i.test(value) ? value : "";
}

export async function GET(request: NextRequest) {
  const ownerKey = getOwnerKey(request);
  if (!ownerKey) return NextResponse.json({ error: "Instagram owner key invalid hai." }, { status: 401 });
  try {
    return NextResponse.json({ settings: await getInstagramBridgeAutomation(ownerKey) });
  } catch (error: any) {
    console.error("[instagram-bridge-auto] Settings load failed:", error);
    return NextResponse.json({ error: "Daily repost settings load nahi hui." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const ownerKey = getOwnerKey(request);
  if (!ownerKey) return NextResponse.json({ error: "Instagram owner key invalid hai." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const sourceIgUserId = typeof body.sourceIgUserId === "string" ? body.sourceIgUserId.trim() : "";
  const baselineMediaId = typeof body.baselineMediaId === "string" ? body.baselineMediaId.trim() : "";
  const targetIgUserIds = Array.isArray(body.targetIgUserIds)
    ? [...new Set(body.targetIgUserIds.filter((id: unknown) => typeof id === "string").map((id: string) => id.trim()).filter(Boolean))].slice(0, 20)
    : [];
  const enabled = body.enabled === true;
  const accounts = Array.isArray(body.accounts) ? body.accounts.slice(0, 20) : [];
  if (!sourceIgUserId || !baselineMediaId || (enabled && !targetIgUserIds.length)) {
    return NextResponse.json({ error: "Source video aur kam se kam ek target Instagram account select karo." }, { status: 400 });
  }
  if (targetIgUserIds.includes(sourceIgUserId)) {
    return NextResponse.json({ error: "Primary account ko target me select nahi kar sakte." }, { status: 400 });
  }
  const requiredIds = new Set([sourceIgUserId, ...targetIgUserIds]);
  const selectedAccounts = accounts.filter((account: any) => requiredIds.has(String(account?.id || "")));
  if ([...requiredIds].some((id) => !selectedAccounts.some((account: any) => account?.id === id && account?.username && account?.pageId && account?.token))) {
    return NextResponse.json({ error: "Source/target account ka page token missing hai. Instagram accounts reconnect karke phir save karo." }, { status: 400 });
  }

  try {
    await registerInstagramAutomationAccounts(ownerKey, selectedAccounts, { subscribeWebhooks: false });
    const settings = await saveInstagramBridgeAutomation(ownerKey, {
      sourceIgUserId,
      baselineMediaId,
      targetIgUserIds,
      enabled,
    });
    return NextResponse.json({ settings });
  } catch (error: any) {
    console.error("[instagram-bridge-auto] Settings save failed:", error);
    return NextResponse.json({ error: error?.message || "Daily repost automation save nahi hui." }, { status: 503 });
  }
}

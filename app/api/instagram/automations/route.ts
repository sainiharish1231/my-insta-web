import { NextRequest, NextResponse } from "next/server";
import {
  deleteInstagramAutomation,
  listInstagramAutomationAccounts,
  listInstagramAutomations,
  saveInstagramAutomation,
} from "@/lib/server/instagram-automation";

export const runtime = "nodejs";

function getOwnerKey(request: NextRequest) {
  const key = request.headers.get("x-instagram-owner-key") || "";
  return /^[a-f0-9]{64}$/i.test(key) ? key : "";
}

function validSameOrigin(request: NextRequest) {
  return request.headers.get("origin") === request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const ownerKey = getOwnerKey(request);
  const igUserId = request.nextUrl.searchParams.get("accountId") || "";
  const triggerType = request.nextUrl.searchParams.get("triggerType") === "reel_comment" ? "reel_comment" : "dm";
  if (!ownerKey) return NextResponse.json({ error: "Instagram owner key invalid hai." }, { status: 401 });
  try {
    const accounts = await listInstagramAutomationAccounts(ownerKey);
    if (!accounts.some((account: any) => account.igUserId === igUserId)) {
      return NextResponse.json({ rules: [], accounts });
    }
    return NextResponse.json({ rules: await listInstagramAutomations(ownerKey, igUserId, triggerType), accounts });
  } catch (error) {
    console.error("[instagram-dm] Automation list failed:", error);
    return NextResponse.json({ error: "Automation rules load nahi ho paye." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!validSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const ownerKey = getOwnerKey(request);
  if (!ownerKey) return NextResponse.json({ error: "Instagram owner key invalid hai." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const igUserId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  const keyword = typeof body.keyword === "string" ? body.keyword.trim().slice(0, 60) : "";
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  const matchType = body.matchType === "exact" ? "exact" : "contains";
  const triggerType = body.triggerType === "reel_comment" ? "reel_comment" : "dm";
  if (!igUserId || !keyword || !reply) return NextResponse.json({ error: "Account, keyword aur reply required hain." }, { status: 400 });
  if (reply.length > 900 || Buffer.byteLength(reply, "utf8") > 1000) {
    return NextResponse.json({ error: "Reply 1,000 UTF-8 bytes se chhota rakho." }, { status: 400 });
  }
  try {
    const accounts = await listInstagramAutomationAccounts(ownerKey);
    if (!accounts.some((account: any) => account.igUserId === igUserId)) {
      return NextResponse.json({ error: "Connected Instagram account nahi mila." }, { status: 404 });
    }
    const id = await saveInstagramAutomation(ownerKey, {
      id: typeof body.id === "string" ? body.id : undefined,
      igUserId,
      triggerType,
      keyword,
      reply,
      matchType,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    });
    return NextResponse.json({ id, saved: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Automation save nahi ho paaya." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!validSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const ownerKey = getOwnerKey(request);
  if (!ownerKey) return NextResponse.json({ error: "Instagram owner key invalid hai." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const accountId = typeof body.accountId === "string" ? body.accountId : "";
  const id = typeof body.id === "string" ? body.id : "";
  try {
    const deleted = await deleteInstagramAutomation(ownerKey, accountId, id);
    return deleted
      ? NextResponse.json({ deleted: true })
      : NextResponse.json({ error: "Rule nahi mila." }, { status: 404 });
  } catch (error) {
    console.error("[instagram-dm] Automation delete failed:", error);
    return NextResponse.json({ error: "Automation delete nahi ho paaya." }, { status: 503 });
  }
}

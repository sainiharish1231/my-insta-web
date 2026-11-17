import { NextRequest, NextResponse } from "next/server";
import { registerInstagramAutomationAccounts } from "@/lib/server/instagram-automation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const ownerKey = request.headers.get("x-instagram-owner-key") || "";
  if (!/^[a-f0-9]{64}$/i.test(ownerKey)) {
    return NextResponse.json({ error: "Instagram owner key invalid hai." }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const accounts = Array.isArray(body.accounts) ? body.accounts.slice(0, 20) : [];
  if (!accounts.length) return NextResponse.json({ error: "Instagram account data missing hai." }, { status: 400 });
  try {
    const result = await registerInstagramAutomationAccounts(ownerKey, accounts);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[instagram-dm] Account registration failed:", error);
    return NextResponse.json({ error: error?.message || "Instagram automation setup save nahi ho paya." }, { status: 503 });
  }
}

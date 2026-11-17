"use client";

import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { getInstagramOwnerKey } from "@/lib/instagram-scheduler-client";

interface InstagramAccount {
  id: string;
  username: string;
  token?: string;
  pageId?: string;
}

interface AutomationRule {
  id: string;
  keyword: string;
  reply: string;
  matchType: "contains" | "exact";
  enabled: boolean;
  triggerType?: "dm" | "reel_comment";
}

export default function InstagramAutomationPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [registeredIds, setRegisteredIds] = useState<string[]>([]);
  const [accountId, setAccountId] = useState("");
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [keyword, setKeyword] = useState("");
  const [reply, setReply] = useState("");
  const [triggerType, setTriggerType] = useState<"dm" | "reel_comment">("dm");
  const [matchType, setMatchType] = useState<"contains" | "exact">("contains");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadLocalAccounts = useCallback(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("ig_accounts") || "[]");
      const next = Array.isArray(stored) ? stored.filter((item) => item?.id && item?.username) : [];
      setAccounts(next);
      setAccountId((current) => current || next[0]?.id || "");
    } catch {
      setAccounts([]);
    }
  }, []);

  const loadRules = useCallback(async (selectedId: string) => {
    if (!selectedId) {
      setRules([]);
      setRegisteredIds([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`/api/instagram/automations?accountId=${encodeURIComponent(selectedId)}&triggerType=${triggerType}`, {
        headers: { "x-instagram-owner-key": getInstagramOwnerKey(true) },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Automation rules load nahi huye.");
      setRegisteredIds((data.accounts || []).map((account: any) => account.igUserId));
      setRules(data.rules || []);
    } catch (error: any) {
      setRules([]);
      toast.error(error?.message || "Automation rules load nahi huye.");
    } finally {
      setIsLoading(false);
    }
  }, [triggerType]);

  useEffect(() => loadLocalAccounts(), [loadLocalAccounts]);
  useEffect(() => { void loadRules(accountId); }, [accountId, loadRules]);

  const syncAccount = async () => {
    const account = accounts.find((item) => item.id === accountId);
    if (!account?.token || !account.pageId) {
      toast.error("Account ko DM permissions ke saath reconnect karo.");
      return;
    }
    setIsSyncing(true);
    try {
      const response = await fetch("/api/instagram/automation/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-instagram-owner-key": getInstagramOwnerKey(true) },
        body: JSON.stringify({ accounts: [account] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Account DM ke liye register nahi hua.");
      setRegisteredIds((current) => current.includes(account.id) ? current : [...current, account.id]);
      if (data.warnings?.length) toast.warning(data.warnings.join(" "));
      else toast.success("Account Auto DM ke liye sync ho gaya.");
      await loadRules(accountId);
    } catch (error: any) {
      toast.error(error?.message || "Account sync nahi ho paya.");
    } finally {
      setIsSyncing(false);
    }
  };

  const saveRule = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const response = await fetch("/api/instagram/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-instagram-owner-key": getInstagramOwnerKey(false) },
        body: JSON.stringify({ accountId, keyword, reply, matchType, triggerType, enabled: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rule save nahi hua.");
      setKeyword("");
      setReply("");
      toast.success("Keyword auto-reply rule save ho gaya.");
      await loadRules(accountId);
    } catch (error: any) {
      toast.error(error?.message || "Rule save nahi hua.");
    } finally {
      setIsSaving(false);
    }
  };

  const updateRule = async (rule: AutomationRule, patch: Partial<AutomationRule>) => {
    try {
      const response = await fetch("/api/instagram/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-instagram-owner-key": getInstagramOwnerKey(false) },
        body: JSON.stringify({ ...rule, ...patch, accountId, triggerType: rule.triggerType || triggerType }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rule update nahi hua.");
      await loadRules(accountId);
    } catch (error: any) {
      toast.error(error?.message || "Rule update nahi hua.");
    }
  };

  const deleteRule = async (id: string) => {
    try {
      const response = await fetch("/api/instagram/automations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-instagram-owner-key": getInstagramOwnerKey(false) },
        body: JSON.stringify({ id, accountId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rule delete nahi hua.");
      setRules((current) => current.filter((rule) => rule.id !== id));
      toast.success("Rule delete ho gaya.");
    } catch (error: any) {
      toast.error(error?.message || "Rule delete nahi hua.");
    }
  };

  const isRegistered = registeredIds.includes(accountId);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <button onClick={() => router.push("/dashboard")} className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"><ArrowLeft className="h-4 w-4" /> Dashboard</button>
        <header className="mb-8 flex items-start gap-4">
          <div className="rounded-2xl bg-pink-500/15 p-3 text-pink-300"><Zap className="h-6 w-6" /></div>
          <div><h1 className="text-3xl font-bold">Instagram Automation</h1><p className="mt-2 max-w-2xl text-sm text-white/60">DM keywords par automatic DM reply set karo, ya Reel comments par matching public reply lagao.</p></div>
        </header>

        <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm text-white/70">Instagram account
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white">
                {accounts.length === 0 && <option value="">No connected Instagram accounts</option>}
                {accounts.map((account) => <option key={account.id} value={account.id}>@{account.username}</option>)}
              </select>
            </label>
            <button disabled={!accountId || isSyncing} onClick={() => void syncAccount()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />Sync account</button>
          </div>
          {accountId && !isRegistered && <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100/80">DM ke liye account server par register nahi hai. Agar Meta permission warning aaye to account ko naye permissions ke saath reconnect karo.</p>}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">New keyword rule</h2><label className="text-sm text-white/70">Trigger<select value={triggerType} onChange={(event) => setTriggerType(event.target.value as "dm" | "reel_comment")} className="ml-2 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white"><option value="dm">Incoming DM</option><option value="reel_comment">Reel comment</option></select></label></div>
          <form onSubmit={saveRule} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <label className="text-sm text-white/70">Keyword<input required minLength={1} maxLength={60} value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="e.g. price" className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white placeholder:text-white/30" /></label>
              <label className="text-sm text-white/70">Match<select value={matchType} onChange={(event) => setMatchType(event.target.value as "contains" | "exact")} className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white"><option value="contains">Contains keyword</option><option value="exact">Exact message</option></select></label>
            </div>
            <label className="block text-sm text-white/70">{triggerType === "dm" ? "Automatic DM reply" : "Public comment reply"}<textarea required maxLength={900} rows={3} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={triggerType === "dm" ? "Thanks for messaging! Here are the details..." : "Thanks! Check your DMs for details."} className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white placeholder:text-white/30" /><span className="mt-1 block text-right text-xs text-white/40">{reply.length}/900</span></label>
            <button disabled={!isRegistered || isSaving || !keyword.trim() || !reply.trim()} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-violet-600 px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Save rule</button>
          </form>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Saved rules</h2><span className="text-xs text-white/40">{rules.length}/20 rules</span></div>
          {isLoading ? <div className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" />Loading rules…</div> : rules.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/45">Is account ke liye abhi koi auto-reply rule nahi hai.</div> : <div className="space-y-3">{rules.map((rule) => <article key={rule.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{rule.keyword} <span className="ml-2 text-xs text-white/40">{rule.matchType}</span></p><p className="mt-2 whitespace-pre-wrap text-sm text-white/65">{rule.reply}</p></div><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={rule.enabled} onChange={(event) => void updateRule(rule, { enabled: event.target.checked })} />Enabled</label><button onClick={() => void deleteRule(rule.id)} aria-label="Delete rule" className="rounded-lg p-2 text-white/50 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button></div></div></article>)}</div>}
        </section>

        <p className="mt-8 text-xs leading-5 text-white/40">Auto DM ke liye Meta ka public webhook, Messages subscription aur permissions chahiye. Reel comments polling se har 5 minute check hote hain; GitHub Actions scheduler enabled, app public URL par deployed, aur instagram_manage_comments permission approved honi chahiye.</p>
      </div>
    </main>
  );
}

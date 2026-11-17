"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Loader2, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";

interface Drafts {
  headline: string;
  instagram: string;
  x: string;
  telegram: string;
  hashtags: string[];
}

const platforms: { key: "instagram" | "x" | "telegram"; label: string }[] = [
  { key: "instagram", label: "Instagram" },
  { key: "x", label: "X" },
  { key: "telegram", label: "Telegram" },
];

export default function ContentStudioPage() {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [language, setLanguage] = useState("Hinglish");
  const [tone, setTone] = useState("clear and engaging");
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [draftTexts, setDraftTexts] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = async () => {
    setIsGenerating(true);
    setDrafts(null);
    try {
      const response = await fetch("/api/ai/repurpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, language, tone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Drafts generate nahi ho paaye.");
      setDrafts(result.drafts);
      setDraftTexts({
        instagram: [result.drafts.instagram, result.drafts.hashtags.join(" ")].filter(Boolean).join("\n\n"),
        x: result.drafts.x,
        telegram: result.drafts.telegram,
      });
      toast.success("Platform drafts ready hain. Publish se pehle review kar lena.");
    } catch (error: any) {
      toast.error(error?.message || "Drafts generate nahi ho paaye.");
    } finally {
      setIsGenerating(false);
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Draft copy ho gaya.");
    } catch {
      toast.error("Clipboard access nahi mila. Draft manually select karke copy karo.");
    }
  };

  const sendToPublisher = (caption: string) => {
    sessionStorage.setItem("content_studio_caption", caption);
    router.push("/upload");
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <button onClick={() => router.push("/dashboard")} className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </button>
        <div className="mb-8 flex items-start gap-4">
          <div className="rounded-2xl bg-fuchsia-500/15 p-3 text-fuchsia-300"><Sparkles className="h-6 w-6" /></div>
          <div>
            <h1 className="text-3xl font-bold">Content Studio</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/60">Article ya apne source notes paste karo. AI usi information se platform ke hisaab se drafts banayega. Publish se pehle har draft verify aur edit karo.</p>
          </div>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <label htmlFor="source" className="mb-2 block text-sm font-semibold">Source text</label>
          <textarea id="source" value={source} onChange={(event) => setSource(event.target.value)} maxLength={12000} rows={9} placeholder="Article ka relevant text ya apne notes yahan paste karo…" className="w-full resize-y rounded-xl border border-white/10 bg-slate-900 p-4 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-400/60" />
          <div className="mt-2 flex justify-between gap-4 text-xs text-white/40"><span>Source text configured AI provider ko draft banane ke liye bheja jayega; app ise database mein save nahi karta.</span><span className="shrink-0">{source.length}/12,000</span></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-white/70">Language
              <select value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white">
                <option>Hinglish</option><option>Hindi</option><option>English</option><option>Persian</option>
              </select>
            </label>
            <label className="text-sm text-white/70">Tone
              <input value={tone} onChange={(event) => setTone(event.target.value)} maxLength={80} className="mt-2 block w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white" />
            </label>
          </div>
          <button disabled={isGenerating || source.trim().length < 40} onClick={generate} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-cyan-600 px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{isGenerating ? "Draft bana raha hai…" : "Generate platform drafts"}
          </button>
        </section>

        {drafts && <section className="mt-8 space-y-4">
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100/80">AI draft ko publish karne se pehle source ke against check karo. AI output mein galti ho sakti hai.</div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Suggested headline</p><p className="text-lg font-semibold">{drafts.headline}</p></div>
          {platforms.map(({ key, label }) => {
            const text = draftTexts[key] || "";
            return <article key={key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{label}</h2><button onClick={() => void copyText(text)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/5"><Copy className="h-3.5 w-3.5" /> Copy</button></div>
              <textarea aria-label={`${label} draft`} value={text} onChange={(event) => setDraftTexts((current) => ({ ...current, [key]: event.target.value }))} rows={5} className="w-full resize-y rounded-xl border border-white/10 bg-slate-900 p-3 text-sm leading-6 outline-none focus:border-cyan-400/50" />
              {key === "instagram" && <button onClick={() => sendToPublisher(text)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs hover:bg-white/15"><Upload className="h-3.5 w-3.5" /> Use in publisher</button>}
            </article>;
          })}
        </section>}
      </div>
    </main>
  );
}

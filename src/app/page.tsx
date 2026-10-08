"use client";

import { useState, useEffect } from "react";
import { KeyRound, Sparkles, Loader2, AlertCircle, ExternalLink, Copy, Check, Server, ShieldCheck } from "lucide-react";

interface ScrapeResponse {
  title: string;
  summary: string;
  url: string;
  characterCount: number;
  provider: string;
  modelUsed?: string;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [useCustomKey, setUseCustomKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("byok_groq_key");
    if (stored) {
      setApiKey(stored);
      setUseCustomKey(true);
    }
  }, []);

  const handleKeyUpdate = (val: string) => {
    setApiKey(val);
    if (val.trim()) {
      sessionStorage.setItem("byok_groq_key", val.trim());
    } else {
      sessionStorage.removeItem("byok_groq_key");
    }
  };

  const handleToggle = (enabled: boolean) => {
    setUseCustomKey(enabled);
    setError(null);
  };

  const handleSummarize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    if (useCustomKey) {
      if (!apiKey.trim()) {
        setError("Please provide a valid Groq API key or toggle back to Default Key.");
        return;
      }
      if (!apiKey.trim().startsWith("gsk_")) {
        setError("Invalid Key Format: BYOK currently only supports Groq API keys (must start with 'gsk_').");
        return;
      }
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-ai-provider": "groq",
      };

      // Only forward the BYOK key if custom key toggle is explicitly active
      if (useCustomKey && apiKey.trim()) {
        headers["x-user-api-key"] = apiKey.trim();
      }

      const res = await fetch("/api/summarize", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Server error (HTTP ${res.status})`);
      }

      if (!res.body) {
        throw new Error("No response stream received.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      setResult({
        title: "Fetching...",
        summary: "",
        url: url.trim(),
        characterCount: 0,
        provider: "groq",
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.replace(/^data:\s*/, "").trim();
          if (!trimmed || trimmed === "[DONE]") continue;

          try {
            const parsed = JSON.parse(trimmed);

            if (parsed.type === "meta") {
              setResult((prev) => ({
                ...prev!,
                title: parsed.title,
                url: parsed.url,
                modelUsed: parsed.modelUsed,
                characterCount: parsed.characterCount,
              }));
            } else if (parsed.type === "token") {
              setResult((prev) => ({
                ...prev!,
                summary: (prev?.summary || "") + parsed.text,
              }));
            }
          } catch {
            // Partial JSON safety guard
          }
        }
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!result?.summary) return;
    navigator.clipboard.writeText(result.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">
        
        {/* Header Controls & Toggle Switch */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3 border border-slate-800 bg-slate-900/60 p-3 rounded-xl">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-mono text-slate-400">
              {useCustomKey ? "BYOK Active (Uncapped Rate)" : "Default Engine (10 req/min limit)"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 p-1 rounded-lg">
            <button
              type="button"
              onClick={() => handleToggle(false)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                !useCustomKey
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              Default Key
            </button>
            <button
              type="button"
              onClick={() => handleToggle(true)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                useCustomKey
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              Custom BYOK
            </button>
          </div>
        </div>

        {/* Conditional BYOK Key Drawer */}
        {useCustomKey && (
          <div className="border border-indigo-900/50 bg-indigo-950/20 rounded-xl p-4 space-y-2.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                Custom API Key
                <span className="ml-1 text-[10px] normal-case tracking-normal px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                  Groq Only
                </span>
              </label>
              {apiKey && (
                <button
                  type="button"
                  onClick={() => handleKeyUpdate("")}
                  className="text-xs text-rose-400 hover:text-rose-300 hover:underline"
                >
                  Clear Key
                </button>
              )}
            </div>

            <input
              type="password"
              placeholder="gsk_..."
              value={apiKey}
              onChange={(e) => handleKeyUpdate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-600"
            />

            <div className="flex items-center justify-between text-[11px] text-slate-400 leading-relaxed pt-0.5">
              <span>
                Currently supports <strong className="text-slate-300 font-semibold">Groq API Keys</strong> (starts with <code className="text-indigo-300 font-mono">gsk_</code>).
              </span>
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:text-indigo-300 underline shrink-0 ml-2"
              >
                Get Groq Key ↗
              </a>
            </div>
          </div>
        )}

        {/* Main Heading */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            AI Web Content Summarizer
          </h1>
          <p className="text-slate-400 text-xs">
            Extract text and generate an instant summary with pluggable AI engines.
          </p>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSummarize} className="space-y-4">
          <div className="relative flex items-center">
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="w-full pl-4 pr-32 py-3.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={loading || !url}
              className="absolute right-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition-all flex items-center gap-1.5"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Processing</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Summarize</span>
                </>
              )}
            </button>
          </div>
        </form>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">Execution Failed</p>
              <p className="text-rose-300/80">{error}</p>
              {error.includes("GROQ_API_KEY_MISSING") && (
                <button
                  type="button"
                  onClick={() => setUseCustomKey(true)}
                  className="underline text-indigo-300 hover:text-indigo-200 mt-1 inline-block"
                >
                  Switch to Custom BYOK and enter your Groq Key
                </button>
              )}
            </div>
          </div>
        )}

        {result && (
          <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4 shadow-xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3 gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span>Processed {result.characterCount.toLocaleString()} chars</span>
                  <span className="text-emerald-400/90 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                    Active Engine: {result.modelUsed || "Groq"}
                  </span>
                </div>
                <h2 className="text-base font-semibold text-white">{result.title}</h2>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 mt-0.5 truncate max-w-[280px] sm:max-w-md"
                >
                  {result.url} <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
              <button
                type="button"
                onClick={copyToClipboard}
                className="px-2.5 py-1 rounded-md border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1.5 shrink-0 transition"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="text-slate-300 text-xs leading-relaxed whitespace-pre-line">
              {result.summary || "Generating summary tokens..."}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
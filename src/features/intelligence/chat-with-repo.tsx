"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MaterialIcon } from "@/components/material-icon";
import { cn } from "@/lib/utils";
import { getCsrfToken } from "@/lib/csrf-client";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface ChatWithRepoProps {
  selectedRepo: string | null;
  isPro?: boolean;
}

const EFFORT_OPTIONS = [
  { id: "quick",    label: "Quick",    desc: "Fast responses" },
  { id: "balanced", label: "Balanced", desc: "Default" },
  { id: "thorough", label: "Thorough", desc: "More depth" },
  { id: "maximum",  label: "Maximum",  desc: "Best quality" },
] as const;

type Effort = "quick" | "balanced" | "thorough" | "maximum";

export function ChatWithRepo({ selectedRepo, isPro = false }: ChatWithRepoProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [effort, setEffort] = useState<Effort>("balanced");
  const [error, setError] = useState<string | null>(null);
  const [repoContext, setRepoContext] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [clearing, setClearing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const repo = selectedRepo ?? "";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  // Load history when repo changes
  useEffect(() => {
    if (!repo) { setMessages([]); setHistoryLoaded(false); return; }
    setHistoryLoaded(false);
    fetch(`/api/ai/chat?repo=${encodeURIComponent(repo)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d?.messages) {
          setMessages(d.messages as ChatMessage[]);
        }
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, [repo]);

  const sendMessage = useCallback(async () => {
    if (!repo || !input.trim() || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: input.trim(), timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreamBuffer("");
    setError(null);
    setStatusMsg("");
    setStreaming(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          repo,
          message: userMsg.content,
          effort,
          ...(repoContext.trim() ? { repoContext: repoContext.trim() } : {}),
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error((err as { error?: string }).error ?? "Request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6)) as {
              type: string; text?: string; step?: string; error?: string;
            };
            if (data.type === "status" && data.step) setStatusMsg(data.step);
            if (data.type === "delta" && data.text) {
              assistantText += data.text;
              setStreamBuffer(assistantText);
            }
            if (data.type === "done") {
              if (data.error) {
                setError(data.error);
              } else {
                const assistantMsg: ChatMessage = {
                  role: "assistant",
                  content: assistantText || data.text || "",
                  timestamp: Date.now(),
                };
                setMessages((prev) => [...prev, assistantMsg]);
              }
              setStreamBuffer("");
            }
          } catch { /* skip bad chunks */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setStreaming(false);
      setStatusMsg("");
    }
  }, [repo, input, effort, repoContext, streaming]);

  const clearHistory = async () => {
    if (!repo || clearing) return;
    setClearing(true);
    try {
      const csrfToken = await getCsrfToken();
      await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ repo, message: "", clear: true }),
      });
      setMessages([]);
      setStreamBuffer("");
      setError(null);
    } catch { /* ignore */ } finally {
      setClearing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  if (!repo) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <div className="size-16 rounded-none bg-amber-500/5 border border-amber-500/10 flex items-center justify-center">
          <MaterialIcon name="chat" size={28} className="text-amber-500/30" />
        </div>
        <div>
          <p className="text-sm font-black text-foreground/60">No repository selected</p>
          <p className="text-[11px] text-muted-foreground/40 mt-1">Select a repo from the search bar above to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[600px] sm:h-[700px] rounded-none border border-outline-variant/15 bg-surface-container/10 overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10 bg-surface-container/30 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-7 rounded-none bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
            <MaterialIcon name="chat" size={14} className="text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-400/80">AI Chat</p>
            <p className="text-xs font-black text-foreground/70 truncate">{repo}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Effort selector */}
          <div className="hidden sm:flex items-center gap-0.5 p-0.5 bg-surface-container/50 border border-outline-variant/10 rounded-none">
            {EFFORT_OPTIONS.map((e) => (
              <button key={e.id} type="button"
                onClick={() => setEffort(e.id)}
                disabled={streaming}
                title={e.desc}
                className={cn(
                  "px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-none transition-all",
                  effort === e.id ? "bg-amber-500 text-white shadow-sm" : "text-muted-foreground/50 hover:text-foreground/70"
                )}>
                {e.label}
              </button>
            ))}
          </div>

          {/* Context toggle */}
          <button type="button" onClick={() => setShowContext((v) => !v)}
            title="Add repo context"
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 rounded-none border text-[9px] font-black uppercase tracking-widest transition-all",
              showContext
                ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                : "border-outline-variant/15 text-muted-foreground/40 hover:text-foreground/60"
            )}>
            <MaterialIcon name="info" size={11} />
            <span className="hidden sm:inline">Context</span>
          </button>

          {/* Clear */}
          {messages.length > 0 && (
            <button type="button" onClick={clearHistory} disabled={clearing || streaming}
              title="Clear conversation"
              className="flex items-center gap-1 px-2 py-1.5 rounded-none border border-outline-variant/15 text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 hover:text-red-400 hover:border-red-500/20 transition-all disabled:opacity-40">
              <MaterialIcon name="delete_outline" size={11} />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Context box ── */}
      {showContext && (
        <div className="px-4 py-3 border-b border-outline-variant/10 bg-surface-container/20 animate-in fade-in duration-200 shrink-0">
          <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50 mb-1.5">
            Repo Context (optional) — paste README, tech stack, or notes for more accurate answers
          </p>
          <textarea
            value={repoContext}
            onChange={(e) => setRepoContext(e.target.value)}
            placeholder="Paste key info about this repo: tech stack, architecture, key files, conventions…"
            rows={3}
            className="w-full text-[11px] bg-surface-container/40 border border-outline-variant/15 rounded-none px-3 py-2 text-foreground/70 placeholder:text-muted-foreground/25 focus:outline-none focus:ring-1 focus:ring-amber-500/30 resize-none"
          />
        </div>
      )}

      {/* ── Mobile effort selector ── */}
      <div className="flex sm:hidden items-center gap-0.5 px-3 py-2 border-b border-outline-variant/10 bg-surface-container/20 shrink-0">
        <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/40 mr-1.5">Depth:</span>
        {EFFORT_OPTIONS.map((e) => (
          <button key={e.id} type="button"
            onClick={() => setEffort(e.id)}
            disabled={streaming}
            className={cn(
              "px-2 py-0.5 text-[8px] font-black uppercase tracking-wider rounded-none transition-all",
              effort === e.id ? "bg-amber-500 text-white" : "text-muted-foreground/40 hover:text-foreground/60"
            )}>
            {e.label}
          </button>
        ))}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
        {!historyLoaded && (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground/30">
            <MaterialIcon name="sync" size={16} className="animate-spin" />
            <span className="text-xs">Loading history…</span>
          </div>
        )}

        {historyLoaded && messages.length === 0 && !streamBuffer && (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="size-14 rounded-none bg-amber-500/5 border border-amber-500/10 flex items-center justify-center">
              <MaterialIcon name="chat_bubble_outline" size={24} className="text-amber-500/25" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground/50">Ask anything about <span className="text-amber-400">{repo.split("/")[1]}</span></p>
              <p className="text-[11px] text-muted-foreground/35 mt-1 max-w-xs mx-auto leading-relaxed">
                Architecture, code patterns, security issues, performance, how to implement features…
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {[
                "What's the architecture?",
                "Any security issues?",
                "How do I add a feature?",
                "What are the main dependencies?",
              ].map((q) => (
                <button key={q} type="button"
                  onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  className="px-3 py-1.5 rounded-none border border-outline-variant/15 text-[10px] font-black text-muted-foreground/50 hover:border-amber-500/30 hover:text-amber-400 transition-all">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="size-7 rounded-none bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                <MaterialIcon name="smart_toy" size={14} className="text-amber-400" />
              </div>
            )}
            <div className={cn(
              "max-w-[85%] sm:max-w-[75%] rounded-none px-4 py-3 text-sm leading-relaxed",
              msg.role === "user"
                ? "bg-amber-500/15 border border-amber-500/25 text-foreground/85 font-medium"
                : "bg-surface-container/40 border border-outline-variant/15 text-foreground/80"
            )}>
              {msg.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none text-[13px]">
                  <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">{msg.content}</pre>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-[13px]">{msg.content}</p>
              )}
              <p className="text-[8px] font-mono text-muted-foreground/25 mt-2 text-right">
                {new Date(msg.timestamp).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            {msg.role === "user" && (
              <div className="size-7 rounded-none bg-surface-container/60 border border-outline-variant/15 flex items-center justify-center shrink-0 mt-0.5">
                <MaterialIcon name="person" size={14} className="text-muted-foreground/40" />
              </div>
            )}
          </div>
        ))}

        {/* Streaming assistant response */}
        {streamBuffer && (
          <div className="flex gap-3 justify-start">
            <div className="size-7 rounded-none bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
              <MaterialIcon name="smart_toy" size={14} className="text-amber-400 animate-pulse" />
            </div>
            <div className="max-w-[85%] sm:max-w-[75%] rounded-none px-4 py-3 bg-surface-container/40 border border-outline-variant/15">
              <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-foreground/80">{streamBuffer}</pre>
              <span className="inline-block size-2 rounded-full bg-amber-400 animate-pulse mt-1" />
            </div>
          </div>
        )}

        {/* Status message while streaming */}
        {streaming && !streamBuffer && statusMsg && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40 pl-10">
            <MaterialIcon name="sync" size={12} className="animate-spin" />
            {statusMsg}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-none bg-red-500/5 border border-red-500/15 text-xs text-red-400">
            <MaterialIcon name="error" size={13} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className="shrink-0 border-t border-outline-variant/10 bg-surface-container/20 px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about ${repo.split("/")[1] ?? repo}… (Enter to send, Shift+Enter for newline)`}
            rows={1}
            disabled={streaming}
            className="flex-1 bg-surface-container/50 border border-outline-variant/15 rounded-none px-4 py-3 text-sm text-foreground/80 placeholder:text-muted-foreground/25 focus:outline-none focus:ring-1 focus:ring-amber-500/30 resize-none disabled:opacity-50 leading-relaxed min-h-[44px] max-h-[120px] overflow-y-auto"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!input.trim() || streaming}
            className={cn(
              "shrink-0 size-11 rounded-none flex items-center justify-center transition-all",
              input.trim() && !streaming
                ? "bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/20"
                : "bg-surface-container/60 border border-outline-variant/15 text-muted-foreground/30 cursor-not-allowed"
            )}>
            <MaterialIcon name={streaming ? "stop" : "send"} size={16} />
          </button>
        </div>
        <p className="text-[8px] font-mono text-muted-foreground/20 mt-1.5 text-center">
          {effort} depth · conversation persists across sessions · {repo}
        </p>
      </div>
    </div>
  );
}

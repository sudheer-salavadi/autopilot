"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import {
  IconSend,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";

// ── Gradient shared ────────────────────────────────────────────────────────
// Used on both the button wrapper and the panel wrapper.
const GRADIENT = "bg-gradient-to-br from-violet-500 via-blue-500 to-cyan-400";

// ── Types ─────────────────────────────────────────────────────────────────
type Message = { role: "user" | "assistant"; content: string };

const WELCOME: Message = {
  role: "assistant",
  content:
    "Ask me anything about this project — open issues, affected users, revenue impact, root causes, or what to fix first.",
};

// ── Helpers ───────────────────────────────────────────────────────────────
function useProjectSlug() {
  const pathname = usePathname();
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m && m[1] !== "new" ? m[1] : null;
}

/** Splits plain-text AI responses into readable paragraphs. */
function MessageText({ content }: { content: string }) {
  const paragraphs = content.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 1) return <span>{content}</span>;
  return (
    <div className="space-y-2">
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────
export function AskAIButton() {
  const [open, setOpen] = useState(false);
  const slug = useProjectSlug();
  if (!slug) return null;

  return (
    <>
      {/* Gradient border wrapper */}
      <div className={`ml-auto p-px rounded-md ${GRADIENT}`}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-[5px] bg-background px-2.5 py-1 text-xs font-medium transition-colors hover:text-foreground"
          aria-label="Ask AI"
        >
          <IconSparkles className="size-3.5" />
          Ask AI
        </button>
      </div>
      {open && <AskAIPanel slug={slug} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────
function AskAIPanel({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    posthog.capture("ask_ai_query_sent", {
      project_slug: slug,
      query_length: text.length,
    });
    try {
      const data = await apiClient().post<{ response: string }>(
        `/api/projects/${slug}/chat`,
        { message: text }
      );
      setMessages((m) => [...m, { role: "assistant", content: data.response }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
      posthog.captureException(err);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />

      {/* Gradient border wrapper */}
      <div
        className={`fixed bottom-5 right-5 z-50 p-px rounded-xl ${GRADIENT} shadow-2xl`}
        style={{ width: 360, height: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Inner panel */}
        <div className="flex h-full w-full flex-col rounded-[11px] bg-background overflow-hidden">

          {/* Header */}
          <div className="flex items-center gap-2 border-b px-4 py-3 shrink-0">
            <IconSparkles className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm font-semibold">Ask AI</span>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <IconX className="size-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-foreground text-background"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <MessageText content={m.content} />
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-xl px-3 py-2.5">
                  <span className="flex gap-1 items-center">
                    <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                    <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t px-3 py-3 shrink-0">
            <div className="flex items-end gap-2 rounded-lg border bg-muted/30 px-3 py-2 focus-within:ring-1 focus-within:ring-border">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                rows={1}
                placeholder="Ask about this project…"
                disabled={loading}
                className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50 max-h-24"
                style={{ lineHeight: "1.5" }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                onClick={send}
                disabled={!input.trim() || loading}
                aria-label="Send"
              >
                <IconSend className="size-3.5" />
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
              Answers are scoped to this project's issues and signals.
            </p>
          </div>

        </div>
      </div>
    </>
  );
}

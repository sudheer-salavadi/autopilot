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

type Message = { role: "user" | "assistant"; content: string };

const WELCOME: Message = {
  role: "assistant",
  content:
    "Ask me anything about this project — open issues, affected users, revenue impact, root causes, or what to fix first.",
};

function useProjectSlug() {
  const pathname = usePathname();
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m && m[1] !== "new" ? m[1] : null;
}

export function AskAIButton() {
  const [open, setOpen] = useState(false);
  const slug = useProjectSlug();
  if (!slug) return null;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="ml-auto flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        aria-label="Ask AI"
      >
        <IconSparkles className="size-3.5" />
        Ask AI
      </button>
      {open && <AskAIPanel slug={slug} onClose={() => setOpen(false)} />}
    </>
  );
}

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

  // Close on Escape
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
      {/* Backdrop (transparent, just to close on outside click) */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="fixed bottom-5 right-5 z-50 flex w-[360px] flex-col rounded-xl border bg-background shadow-2xl"
        style={{ height: "480px" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
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
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-xl px-3 py-2">
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
        <div className="border-t px-3 py-3">
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
    </>
  );
}

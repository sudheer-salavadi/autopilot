"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

// Lines matching any of these patterns are treated as negative signals and highlighted.
const NEGATIVE_PATTERNS: RegExp[] = [
  // Sentry — error severity
  /"level"\s*:\s*"(error|fatal|warning)"/i,
  // Stripe — failed / disputed payments
  /"status"\s*:\s*"(failed|payment_failed|canceled|cancelled|requires_action)"/i,
  /"disputed"\s*:\s*true/i,
  // FullStory — frustration signals
  /"frustration_type"\s*:\s*"(rage_click|thrash|error_click|dead_click)"/i,
  // Generic — unresolved errors
  /"status"\s*:\s*"unresolved"/i,
  /"outcome"\s*:\s*\{/,
];

function isNegativeLine(line: string): boolean {
  return NEGATIVE_PATTERNS.some((p) => p.test(line));
}

export function JsonBlock({
  value,
  maxHeight = "12rem",
  className,
}: {
  value: unknown;
  maxHeight?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const lines = text.split("\n");

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("relative group rounded-md bg-muted/50 border overflow-hidden", className)}>
      {/* copy button — visible on hover */}
      <button
        onClick={copy}
        className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 bg-background/90 border shadow-sm hover:bg-muted"
        aria-label="Copy"
      >
        {copied ? (
          <IconCheck className="size-3 text-emerald-600" />
        ) : (
          <IconCopy className="size-3 text-muted-foreground" />
        )}
      </button>

      {/* code block */}
      <div className="overflow-auto text-[11px] font-mono leading-relaxed" style={{ maxHeight }}>
        {lines.map((line, i) => {
          const negative = isNegativeLine(line);
          return (
            <div
              key={i}
              className={negative ? "bg-red-500/10" : undefined}
            >
              <span className={cn("block px-3", negative && "text-red-600 dark:text-red-400 font-medium")}>
                {line}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

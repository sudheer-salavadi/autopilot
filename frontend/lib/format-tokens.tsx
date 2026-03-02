import React from "react";

// Shared token regex — order matters, first match wins:
//   backtick > full URL > /path > currency
//   > short IDs like cus_AZ1 / pi_XyZ  (mixed-case after underscore, e.g. Stripe mocks)
//   > snake_case  > dot.notation
const TOKEN_RE =
  /(`[^`]+`|https?:\/\/[^\s,;]+|\/[a-zA-Z][a-zA-Z0-9/_-]+|\$[\d,]+(?:\.\d{1,2})?|\b[a-z]{2,6}_[A-Za-z0-9]{2,}\b|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]+)+\b)/g;

function tokenize(
  text: string,
  render: (display: string, token: string, key: number) => React.ReactNode,
): React.ReactNode {
  const pattern = new RegExp(TOKEN_RE.source, "g");
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const display = token.startsWith("`") ? token.slice(1, -1) : token;
    parts.push(render(display, token, key++));
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 1 ? parts : text;
}

/** Blue chips — for root_cause and pm_insight */
export function formatRootCause(text: string): React.ReactNode {
  return tokenize(text, (display, token, key) =>
    token.startsWith("$") ? (
      <span key={key} className="font-mono font-semibold px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
        {display}
      </span>
    ) : (
      <code key={key} className="font-mono bg-blue-50 dark:bg-blue-950/40 px-1 py-0.5 text-blue-950 dark:text-blue-100 rounded">
        {display}
      </code>
    )
  );
}

/** Plain mono — for titles (no background, no colour change) */
export function formatTitle(text: string): React.ReactNode {
  return tokenize(text, (display, _token, key) => (
    <code key={key} className="font-mono text-[0.9em]">{display}</code>
  ));
}

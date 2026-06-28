export default function HowItWorksPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-12">

      {/* Intro */}
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">How Autopilot works</h1>
        <p className="text-muted-foreground leading-relaxed">
          Autopilot acts as your AI product manager. It reads signals from Stripe, Sentry,
          FullStory, Zendesk, and more — groups them by root cause, scores them by business
          impact, and tells you what to fix first. No more triaging noise across tabs.
        </p>
      </div>

      <hr />

      {/* What it does */}
      <div className="space-y-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">What your AI PM does</h2>
        <div className="space-y-5">
          <div className="space-y-1">
            <p className="font-semibold">Reads signals across all your tools</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connect Stripe, Sentry, FullStory, Zendesk, or any MCP-compatible source via
              webhook. No new SDK. Autopilot works with what you already have.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold">Groups related signals into a single issue</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              A Stripe payment failure, a Sentry exception, and a FullStory rage-click
              from the same checkout flow become one issue — not three separate alerts.
              Root cause first, not source.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold">Decides what to fix first</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every issue is scored by revenue at risk, frequency, and UX friction. The
              highest-impact problem is always at the top. You control how those signals
              are weighted in Settings → Severity.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold">Explains the root cause and recommends a fix</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Open any issue to see which users are affected across all your tools,
              what the likely cause is, and the recommended next step.
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold">Ask it anything</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Chat with your data directly — "what&apos;s driving the most churn?",
              "which users are affected by the checkout bug?", "what should we fix this sprint?"
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-semibold">Files the ticket for you</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connect a GitHub repo and send any issue straight to your tracker —
              pre-written with full context, ready for the team to pick up.
            </p>
          </div>
        </div>
      </div>

      <hr />

      {/* How to get started */}
      <div className="space-y-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Get started in minutes</h2>
        <ol className="space-y-4">
          {[
            { n: "1", text: "Create a project." },
            { n: "2", text: "Go to Integrations. Connect a source or turn on Simulate to walk through the full experience with AI-generated events — no webhooks needed." },
            { n: "3", text: "Go to Issues. Your AI PM groups and ranks incoming signals automatically. The highest-impact problem is always first." },
            { n: "4", text: "Open any issue to see the root cause, affected users, revenue impact, and what to do about it." },
            { n: "5", text: "Optionally: go to Settings → Severity to tune how revenue, frequency, and UX friction are weighted." },
            { n: "6", text: "Optionally: go to Integrations → GitHub to connect a repo and file issues directly from Autopilot." },
          ].map(({ n, text }) => (
            <li key={n} className="flex gap-3 text-sm">
              <span className="shrink-0 size-5 rounded-full border flex items-center justify-center text-xs font-medium tabular-nums">
                {n}
              </span>
              <span className="text-muted-foreground leading-relaxed pt-0.5">{text}</span>
            </li>
          ))}
        </ol>
      </div>

    </div>
  );
}

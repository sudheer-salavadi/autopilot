import Link from "next/link";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-20">
      <div className="max-w-2xl w-full space-y-12">

        {/* Hero */}
        <div className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">Autopilot</h1>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">The problem</h2>
          <p className="text-lg leading-relaxed">
            Product and engineering teams operate across four tools — Stripe for revenue,
            Sentry for errors, FullStory for UX friction, Zendesk for support. Each fires
            separate alerts. There is no shared view, no root cause, and no ranking.
            The result: teams spend hours triaging noise and miss the issues that are
            actually costing them money or users.
          </p>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">How Autopilot works</h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Connect your tools — Stripe, Sentry, FullStory, Zendesk, and more. Autopilot
            reads raw events across your stack, groups them by root cause, scores them by
            business impact, and tells you what to fix first.
          </p>
          <div className="flex gap-3 pt-1">
            <Button asChild size="lg">
              <a href={`${API_URL}/api/auth/login`}>Access Demo</a>
            </Button>
          </div>
        </div>

        <hr />

        {/* What it does */}
        <div className="space-y-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">What it does</h2>
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="font-semibold">Ingests events from your existing tools</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Connect your tools via webhook or turn on Simulate for instant demo data.
                Works with any supported integration — no new SDK to install.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Groups events by root cause, not by source</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A Stripe payment failure, a Sentry exception, and a FullStory rage-click
                from the same checkout flow become one issue — not three separate alerts.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Scores every issue by business impact</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Each issue gets a priority score based on revenue at risk, how often it
                occurs, and UX friction signals. The highest-impact problem is always at
                the top. You control the weights in Settings → Prioritization.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Explains root cause and recommends a fix</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Open any issue to see what's happening, which users are affected across
                all your tools, what the likely cause is, and what to do about it.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Files GitHub issues with one click</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Connect your GitHub repo in Settings. Every issue can be sent directly
                to your tracker — pre-written, with full context attached.
              </p>
            </div>
          </div>
        </div>

        <hr />

        {/* How to get started */}
        <div className="space-y-6">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">How to get started</h2>
          <ol className="space-y-4">
            {[
              { n: "1", text: "Create a project." },
              { n: "2", text: "Go to Integrations. Connect a source or turn on Simulate to generate realistic demo events immediately." },
              { n: "3", text: "Go to Issues. Autopilot groups and scores incoming events automatically. Critical issues appear at the top." },
              { n: "4", text: "Open an issue to see the root cause, affected users, revenue impact, and recommended fix." },
              { n: "5", text: "Optionally: go to Settings → Prioritization to adjust how revenue, frequency, and UX signals are weighted." },
              { n: "6", text: "Optionally: go to Settings → GitHub to connect a repo and file issues directly from Autopilot." },
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
    </main>
  );
}

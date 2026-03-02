import Link from "next/link";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const STEPS = [
  {
    label: "Events in, issues out",
    body: "Stripe, Sentry, FullStory, and Zendesk signals are grouped by root cause — not by source or time window. One broken checkout becomes one issue, not three alerts.",
  },
  {
    label: "A brief, not a log dump",
    body: "Every issue surfaces root cause, recommended fix, revenue at risk, affected users, and cross-source correlation. Everything needed to act — nothing that isn't.",
  },
  {
    label: "Built for your business",
    body: "Weight revenue, frequency, and UX friction to match how your team prioritises. The ranking reflects your judgment, not ours.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-20 gap-16">

      {/* Hero */}
      <div className="text-center space-y-5 max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          AI-native incident intelligence
        </p>
        <h1 className="text-5xl font-bold tracking-tight">Autopilot</h1>
        <p className="text-muted-foreground text-xl leading-relaxed">
          Your team gets alerted by four tools. None of them talk to each other.
          Autopilot connects the dots — automatically.
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <Button asChild size="lg">
            <a href={`${API_URL}/api/auth/login`}>Get started</a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>

      {/* Problem line */}
      <div className="max-w-xl w-full text-center space-y-2">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Legacy ops: alert&nbsp;→ Slack thread&nbsp;→ Jira ticket&nbsp;→ investigation&nbsp;→ too late.
        </p>
        <p className="text-sm font-medium">
          AI-native: signal&nbsp;→ grouped&nbsp;→ scored&nbsp;→ actionable.
        </p>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl w-full">
        {STEPS.map((s, i) => (
          <div key={s.label} className="rounded-lg border bg-card p-5 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </p>
            <p className="font-semibold">{s.label}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>

    </main>
  );
}

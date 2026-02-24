"use client";

import { IconRefresh } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useEvents } from "@/lib/hooks/useEvents";

const SOURCE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  stripe: "default",
  sentry: "secondary",
};

export default function EventsFeed({ slug }: { slug: string }) {
  const { data, loading, error, page, setPage, refetch } = useEvents(slug);

  if (loading && !data) {
    return (
      <p className="text-sm text-muted-foreground animate-pulse">
        Loading events…
      </p>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          <IconRefresh />
          Retry
        </Button>
      </div>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No events yet. Configure an integration and send a webhook.
      </p>
    );
  }

  const totalPages = Math.ceil((data?.total ?? 0) / (data?.page_size ?? 50));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{data?.total} events</span>
        <Button variant="ghost" size="xs" onClick={refetch}>
          <IconRefresh />
          Refresh
        </Button>
      </div>

      <div className="rounded-xl ring-1 ring-foreground/10 divide-y overflow-hidden">
        {items.map((event) => (
          <div key={event.id} className="px-4 py-3 space-y-1.5 bg-card">
            <div className="flex items-center gap-2">
              <Badge variant={SOURCE_VARIANT[event.source] ?? "outline"}>
                {event.source}
              </Badge>
              <span className="text-sm font-mono">{event.event_type}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(event.received_at).toLocaleString()}
              </span>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                Payload
              </summary>
              <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 text-xs max-h-48 leading-relaxed">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </details>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {data?.page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

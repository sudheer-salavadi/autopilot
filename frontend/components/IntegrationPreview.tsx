"use client";

import { useEffect } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useEvents } from "@/lib/hooks/useEvents";

const REFETCH_INTERVAL_MS = 5_000;

export default function IntegrationPreview({
  slug,
  source,
  isSimulating,
}: {
  slug: string;
  source: string;
  isSimulating: boolean;
}) {
  const { data, loading, error, page, setPage, refetch } = useEvents(slug, source);
  const items = data?.items ?? [];
  const totalPages = Math.ceil((data?.total ?? 0) / (data?.page_size ?? 50));

  // Auto-refetch while simulation is running
  useEffect(() => {
    if (!isSimulating) return;
    const id = setInterval(refetch, REFETCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isSimulating, refetch]);

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Events</span>
          {data?.total != null && data.total > 0 && (
            <span className="text-xs text-muted-foreground">{data.total} total</span>
          )}
          {isSimulating && (
            <span className="text-[11px] text-blue-500 font-medium animate-pulse">
              · simulating
            </span>
          )}
        </div>
        <Button variant="ghost" size="xs" onClick={refetch} disabled={loading}>
          <IconRefresh className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto divide-y">
        {loading && !data && (
          <p className="p-4 text-sm text-muted-foreground animate-pulse">Loading…</p>
        )}
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            No events yet. Toggle Simulate to generate demo data.
          </p>
        )}
        {items.map((event) => (
          <div
            key={event.id}
            className="px-4 py-3 space-y-1.5 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-medium truncate">
                {event.event_type}
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                {new Date(event.received_at).toLocaleString()}
              </span>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                Payload
              </summary>
              <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 text-xs max-h-48 leading-relaxed">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </details>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-2 shrink-0">
          <Button
            variant="outline"
            size="xs"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            {data?.page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="xs"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

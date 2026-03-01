"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IconBrandGithub, IconLoader2 } from "@tabler/icons-react";
import { apiClient } from "@/lib/api";

function GitHubCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const installationId = searchParams.get("installation_id");
    const projectSlug = searchParams.get("state"); // state param carries project slug

    if (!installationId || !projectSlug) {
      setError("Missing installation_id or state parameter from GitHub.");
      return;
    }

    const api = apiClient();
    api
      .put(`/api/projects/${projectSlug}/github-config`, {
        installation_id: Number(installationId),
      })
      .then(() => {
        router.replace(`/projects/${projectSlug}/integrations?github=connected`);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "Failed to save GitHub installation."
        );
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    const projectSlug = searchParams.get("state");
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-sm text-center space-y-4">
          <IconBrandGithub className="size-10 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium text-destructive">{error}</p>
          {projectSlug && (
            <a
              href={`/projects/${projectSlug}/integrations`}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              ← Back to integrations
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center space-y-3">
        <IconLoader2 className="size-8 mx-auto animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Connecting GitHub App…</p>
      </div>
    </div>
  );
}

export default function GitHubCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <IconLoader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <GitHubCallbackInner />
    </Suspense>
  );
}

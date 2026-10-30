"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the server component every few seconds while documents are moving through
 * the pipeline, and stops once nothing is queued or processing. Skips hidden tabs.
 */
export function AutoRefresh({
  active,
  intervalMs = 2500,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [active, intervalMs, router]);

  return null;
}

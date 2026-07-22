import { useEffect, useRef, useState } from "react";
import type { Activity } from "../types";
import { api } from "../api/client";
import { FEED_POLL_MS } from "../config";

/**
 * Buddy/social feed via polling (TASKS.md §6 — GET /api/feed?since=<ts> every
 * 4s, NOT WebSockets). Merges new rows and keeps the list bounded.
 */
export function useFeed(enabled: boolean) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const since = useRef(0);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await api.getFeed(since.current);
        if (!alive) return;
        since.current = res.now;
        if (res.activities.length) {
          const fresh = res.activities.filter((a) => !seen.current.has(a.id));
          for (const a of fresh) seen.current.add(a.id);
          if (fresh.length) {
            setActivities((prev) => [...fresh, ...prev].slice(0, 60));
          }
        }
      } catch {
        /* transient poll error — try again next tick */
      } finally {
        if (alive) timer = setTimeout(tick, FEED_POLL_MS);
      }
    };

    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled]);

  return activities;
}

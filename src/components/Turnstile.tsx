import { useEffect, useRef, useState } from "react";
import { TURNSTILE_SITE_KEY, IS_MOCK } from "../config";

// Cloudflare Turnstile widget (TASKS.md §2 abuse control). Guards /api/photos
// and /api/auth/magic-link. Renders the real widget when the script is
// reachable; if it can't load (e.g. offline demo), it degrades to a manual
// human-check that only yields a usable token in mock mode.

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "dark" | "light" | "auto";
      size?: "normal" | "flexible" | "compact";
    },
  ) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __cfTurnstileLoading?: Promise<void>;
  }
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (window.__cfTurnstileLoading) return window.__cfTurnstileLoading;
  window.__cfTurnstileLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile script failed"));
    document.head.appendChild(s);
  });
  return window.__cfTurnstileLoading;
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled && !window.turnstile) setFallback(true);
    }, 3500);

    loadScript()
      .then(() => {
        if (cancelled || !hostRef.current || !window.turnstile) return;
        clearTimeout(timeout);
        widgetId.current = window.turnstile.render(hostRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "dark",
          size: "flexible",
          callback: (t) => onTokenRef.current(t),
          "error-callback": () => onTokenRef.current(null),
          "expired-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      try {
        if (widgetId.current) window.turnstile?.remove(widgetId.current);
      } catch {
        /* ignore */
      }
    };
  }, []);

  if (fallback) {
    return (
      <div className="turnstile-host">
        <button
          type="button"
          className="fake"
          onClick={() => onTokenRef.current(IS_MOCK ? "mock-turnstile-ok" : null)}
          title={IS_MOCK ? "Mock verification" : "Turnstile unavailable"}
        >
          <span className="pulse" style={{ color: "var(--neon)" }} />
          {IS_MOCK
            ? "Turnstile offline — tap to simulate verification"
            : "Turnstile could not load"}
        </button>
      </div>
    );
  }

  return <div className="turnstile-host" ref={hostRef} />;
}

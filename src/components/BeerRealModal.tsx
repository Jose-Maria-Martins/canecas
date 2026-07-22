import { useEffect, useState } from "react";
import type { BeerRealPrompt } from "../types";

// BeerReal daily prompt (TASKS.md §8): a BeReal-style random-time push to snap
// your current pint within a short window. Completion grants XP via the daily
// challenge and surfaces in the polled feed.

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function BeerRealModal({
  prompt,
  onSnap,
  onClose,
}: {
  prompt: BeerRealPrompt;
  onSnap: () => void;
  onClose: () => void;
}) {
  const [left, setLeft] = useState(prompt.window_ends_at - Date.now());

  useEffect(() => {
    const t = setInterval(() => setLeft(prompt.window_ends_at - Date.now()), 500);
    return () => clearInterval(t);
  }, [prompt.window_ends_at]);

  const expired = left <= 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="beerreal" style={{ marginBottom: 18 }}>
          <div className="kicker">⚡ BeerReal</div>
        </div>
        <h2>Time for a BeerReal!</h2>
        <p className="sub">{prompt.prompt}</p>
        {!expired ? (
          <p style={{ fontSize: 15, margin: "0 0 18px" }}>
            Window closes in <span className="cd" style={{ color: "var(--neon)" }}>{fmt(left)}</span>
          </p>
        ) : (
          <p className="err">Window closed — catch the next one tomorrow.</p>
        )}
        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            Later
          </button>
          <button className="btn primary" onClick={onSnap} disabled={expired}>
            📸 Snap my pint (+60 XP)
          </button>
        </div>
      </div>
    </div>
  );
}

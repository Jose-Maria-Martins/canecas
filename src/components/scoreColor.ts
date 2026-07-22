/** Map a 0–5 weighted score to a pin colour: muted red → amber → gold. */
export function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 5));
  // hue 8 (red) → 45 (gold)
  const hue = 8 + t * 37;
  const sat = 70 + t * 20;
  const light = 45 + t * 12;
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

export function stars(score: number): string {
  const full = Math.round(score);
  return "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

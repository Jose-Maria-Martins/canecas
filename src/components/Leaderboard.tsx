import type { LeaderboardEntry } from "../types";

const MEDAL = ["🥇", "🥈", "🥉"];

export function Leaderboard({ rows }: { rows: LeaderboardEntry[] }) {
  if (!rows.length) return <div className="empty">Leaderboard loading…</div>;
  return (
    <div>
      <div className="section-title">Top drinking buddies</div>
      {rows.map((r) => (
        <div key={r.user_id} className={"lb-row" + (r.is_me ? " me" : "")}>
          <div className="lb-rank">{MEDAL[r.rank - 1] ?? r.rank}</div>
          <div className="avatar" style={{ width: 30, height: 30, fontSize: 13 }}>
            {r.display_name.charAt(0).toUpperCase()}
          </div>
          <div className="lb-name">
            {r.display_name}
            {r.is_me && <span className="chip" style={{ marginLeft: 8 }}>you</span>}
          </div>
          <div className="lb-xp">
            L{r.level} · {r.xp.toLocaleString()} XP
          </div>
        </div>
      ))}
    </div>
  );
}

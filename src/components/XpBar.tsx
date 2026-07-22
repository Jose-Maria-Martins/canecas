import type { User } from "../types";
import { levelProgress } from "../api/scoring";

export function XpBar({ user }: { user: User }) {
  const p = levelProgress(user.xp);
  return (
    <div className="xp" title={`${user.display_name} · ${user.xp} XP`}>
      <div className="lvl">{p.level}</div>
      <div className="meta">
        <div className="row">
          <span>Lv {p.level}</span>
          <span>
            {p.xpIntoLevel}/{p.xpForNext}
          </span>
        </div>
        <div className="bar">
          <span style={{ width: `${Math.round(p.pct * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

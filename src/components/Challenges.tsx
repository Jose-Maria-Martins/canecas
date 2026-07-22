import type { Challenge } from "../types";

export function Challenges({ challenges }: { challenges: Challenge[] }) {
  if (!challenges.length) return <div className="empty">No active challenges.</div>;
  const daily = challenges.filter((c) => c.type === "daily");
  const weekly = challenges.filter((c) => c.type === "weekly");
  return (
    <div>
      {daily.length > 0 && <div className="section-title">Daily</div>}
      {daily.map((c) => (
        <ChallengeRow key={c.id} c={c} />
      ))}
      {weekly.length > 0 && <div className="section-title" style={{ marginTop: 14 }}>Weekly</div>}
      {weekly.map((c) => (
        <ChallengeRow key={c.id} c={c} />
      ))}
    </div>
  );
}

function ChallengeRow({ c }: { c: Challenge }) {
  return (
    <div className={"chl" + (c.completed ? " done" : "")}>
      <div className="top">
        <span className="title">
          {c.completed ? "✓ " : ""}
          {c.title}
        </span>
        <span className="xp-tag">+{c.xp} XP</span>
      </div>
      <div className="type">{c.type}</div>
    </div>
  );
}

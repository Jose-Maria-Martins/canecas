import type { Activity } from "../types";
import { timeAgo } from "./scoreColor";

function verbText(a: Activity): string {
  switch (a.type) {
    case "submission":
      return a.target_name ? `rated a pint at ${a.target_name}` : "rated a pint";
    case "check_in":
      return a.target_name ? `checked in at ${a.target_name}` : "checked in";
    case "level_up":
      return "leveled up 🎉";
    case "challenge_complete":
      return a.target_name ? `completed “${a.target_name}”` : "completed a challenge";
    case "beerreal":
      return "answered the BeerReal 📸";
    default:
      return "did something";
  }
}

export function Feed({ activities }: { activities: Activity[] }) {
  if (!activities.length) {
    return (
      <div className="empty">
        No activity yet.
        <br />
        Rate a beer or add buddies to fill this up.
      </div>
    );
  }
  return (
    <div>
      <div className="section-title">Live buddy feed · polls every 4s</div>
      {activities.map((a) => {
        const initial = a.display_name.replace(/\s*\(demo\)$/i, "").charAt(0).toUpperCase();
        return (
          <div key={a.id} className={"feed-item" + (a.demo ? " is-demo" : "")}>
            <div className={"avatar" + (a.demo ? " demo" : "")}>{initial}</div>
            <div className="txt">
              <span className="who">{a.display_name.replace(/\s*\(demo\)$/i, "")}</span> {verbText(a)}
              {a.demo && <span className="chip demo" style={{ marginLeft: 8 }}>demo</span>}
              <div className="when">{timeAgo(a.ts)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

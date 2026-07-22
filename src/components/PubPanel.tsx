import type { Pub, PubScore } from "../types";
import { categoryEmoji, pubPhoto, stars } from "./scoreColor";

interface Props {
  pub: Pub;
  score: PubScore | undefined;
  scoreBumped: boolean;
  photo: string | undefined;
  onClose: () => void;
  onCapture: () => void;
}

export function PubPanel({ pub, score, scoreBumped, photo, onClose, onCapture }: Props) {
  const heroSrc = photo ?? pubPhoto(pub);

  return (
    <div className="pubsheet" onClick={(event) => event.stopPropagation()}>
      <div className="hero">
        <div className="grab" />
        <img
          src={heroSrc}
          alt={pub.name}
          onError={(event) => {
            event.currentTarget.hidden = true;
            event.currentTarget.nextElementSibling?.removeAttribute("hidden");
          }}
        />
        <div className="fallback" hidden>{categoryEmoji(pub)}</div>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="content">
        <h2>{pub.name}</h2>
        <p className="addr">{pub.address}</p>

        <div className="scorebox">
          <div className={"bigscore" + (scoreBumped ? " bump" : "")}>
            {score ? score.weighted_score.toFixed(1) : "–"}
          </div>
          <div className="scoremeta">
            <div className="stars">{stars(score?.weighted_score ?? 0)}</div>
            <div><b>{score?.rating_count ?? 0}</b> pours · avg <b>{score ? score.avg_rating.toFixed(2) : "–"}</b></div>
            <div style={{ color: "#9aa1b0" }}>Bayesian weighted score</div>
          </div>
        </div>

        <div className="upload">
          <button className="btn primary camera-open" onClick={onCapture}>📸 Open pint camera</button>
        </div>
      </div>
    </div>
  );
}

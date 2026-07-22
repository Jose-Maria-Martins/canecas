import { divIcon, latLngBounds } from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { MapSubmission } from "./types";

interface SubmissionMapProps {
  submissions: MapSubmission[];
}

const DEFAULT_CENTER: [number, number] = [51.5074, -0.1278];

export function SubmissionMap({ submissions }: SubmissionMapProps) {
  return (
    <MapContainer
      className="submission-map"
      center={DEFAULT_CENTER}
      zoom={12}
      minZoom={3}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitSubmissions submissions={submissions} />
      {submissions.map((submission) => (
        <Marker
          key={submission.submissionId}
          position={[submission.latitude, submission.longitude]}
          icon={scoreIcon(submission.score)}
        >
          <Popup minWidth={230} maxWidth={280}>
            <article className="pint-popup">
              <img src={submission.imageUrl} alt="Uploaded beer" loading="lazy" />
              <div className="pint-popup-copy">
                <div className="pint-popup-rating">
                  <strong>{submission.score.toFixed(1)}</strong>
                  <span>/ 5 vibe</span>
                </div>
                <p>{submission.reason}</p>
                <time dateTime={new Date(submission.createdAt).toISOString()}>
                  {formatDate(submission.createdAt)}
                </time>
              </div>
            </article>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function FitSubmissions({ submissions }: SubmissionMapProps) {
  const map = useMap();
  const lastSignature = useRef("");

  useEffect(() => {
    const signature = submissions
      .map(({ submissionId, latitude, longitude }) => `${submissionId}:${latitude}:${longitude}`)
      .join("|");
    if (!signature || signature === lastSignature.current) {
      return;
    }
    lastSignature.current = signature;

    if (submissions.length === 1) {
      map.setView([submissions[0].latitude, submissions[0].longitude], 15);
      return;
    }

    map.fitBounds(
      latLngBounds(submissions.map(({ latitude, longitude }) => [latitude, longitude])),
      { padding: [60, 60], maxZoom: 15 },
    );
  }, [map, submissions]);

  return null;
}

function scoreIcon(score: number) {
  return divIcon({
    className: "score-marker-wrap",
    html: `<span class="score-marker"><b>${score.toFixed(1)}</b></span>`,
    iconAnchor: [24, 48],
    iconSize: [48, 48],
    popupAnchor: [0, -44],
  });
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

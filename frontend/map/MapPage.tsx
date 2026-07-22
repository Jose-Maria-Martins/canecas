import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";
import { fetchMapSubmissions } from "./api";
import "./map.css";
import { SubmissionMap } from "./SubmissionMap";
import type { MapSubmission } from "./types";

const REFRESH_INTERVAL_MS = 10_000;

export function MapPage() {
  const [submissions, setSubmissions] = useState<MapSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function refresh() {
      try {
        const nextSubmissions = await fetchMapSubmissions(controller.signal);
        setSubmissions(nextSubmissions);
        setError(null);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "The pint map could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  return (
    <main className="map-page">
      <header className="map-header">
        <a className="brand" href="/" aria-label="Caneca home">caneca<span>.</span></a>
        <div className="map-heading">
          <p className="eyebrow">Live from the crawl</p>
          <h1>Pints in the wild.</h1>
        </div>
        <a className="map-camera-link" href="/">Rate a pint <span>↗</span></a>
      </header>

      <section className="map-stage" aria-label="Map of rated beer photos">
        <SubmissionMap submissions={submissions} />
        <div className="map-count" aria-live="polite">
          <strong>{submissions.length.toString().padStart(2, "0")}</strong>
          <span>rated pints<br />on the map</span>
        </div>
        {loading && <p className="map-notice">Finding the latest round...</p>}
        {!loading && error && <p className="map-notice map-notice-error">{error}</p>}
        {!loading && !error && submissions.length === 0 && (
          <div className="map-empty">
            <span>First round?</span>
            <strong>No location-tagged pints yet.</strong>
            <p>Rate a beer and allow location access to put it on the map.</p>
            <a href="/">Open the camera</a>
          </div>
        )}
      </section>
    </main>
  );
}

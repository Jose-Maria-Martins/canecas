import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Pub, PubScore } from "../types";
import { MAP_CENTER } from "../config";
import { scoreColor } from "./scoreColor";

// OSM raster tiles via MapLibre GL (TASKS.md §2/§11 — documented map exception,
// Cloudflare has no maps product). Toned down to fit the dark UI.
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0d0b14" } },
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: {
        "raster-saturation": -0.45,
        "raster-brightness-max": 0.78,
        "raster-contrast": 0.08,
        "raster-opacity": 0.92,
      },
    },
  ],
};

interface Props {
  pubs: Pub[];
  scores: Record<string, PubScore>;
  selectedId: string | null;
  onSelectPub: (pubId: string) => void;
  me: { lat: number; lon: number } | null;
  focus: { lat: number; lon: number; zoom?: number } | null;
  flashPubId: string | null;
}

export function MapView({ pubs, scores, selectedId, onSelectPub, me, focus, flashPubId }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<Map<string, { marker: Marker; el: HTMLDivElement }>>(new Map());
  const meMarker = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelectPub);
  onSelectRef.current = onSelectPub;

  // init map once
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: hostRef.current,
      style: OSM_STYLE,
      center: [MAP_CENTER.lon, MAP_CENTER.lat],
      zoom: MAP_CENTER.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    for (const pub of pubs) {
      const el = document.createElement("div");
      el.className = "pin";
      el.innerHTML = `<div class="body"></div><div class="score"></div>`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(pub.id);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([pub.lon, pub.lat])
        .addTo(map);
      markers.current.set(pub.id, { marker, el });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reflect scores onto pins
  useEffect(() => {
    for (const [pubId, { el }] of markers.current) {
      const s = scores[pubId];
      const scoreEl = el.querySelector<HTMLDivElement>(".score");
      const bodyEl = el.querySelector<HTMLDivElement>(".body");
      if (scoreEl) scoreEl.textContent = s ? s.weighted_score.toFixed(1) : "–";
      if (bodyEl) el.style.setProperty("--pin", scoreColor(s?.weighted_score ?? 0));
    }
  }, [scores]);

  // selected styling
  useEffect(() => {
    for (const [pubId, { el }] of markers.current) {
      el.classList.toggle("selected", pubId === selectedId);
    }
  }, [selectedId]);

  // flash a pin when its live score updates
  useEffect(() => {
    if (!flashPubId) return;
    const entry = markers.current.get(flashPubId);
    if (!entry) return;
    entry.el.classList.remove("flash");
    // reflow to restart the animation
    void entry.el.offsetWidth;
    entry.el.classList.add("flash");
  }, [flashPubId]);

  // "me" marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!me) {
      meMarker.current?.remove();
      meMarker.current = null;
      return;
    }
    if (!meMarker.current) {
      const el = document.createElement("div");
      el.className = "me-dot";
      meMarker.current = new maplibregl.Marker({ element: el }).setLngLat([me.lon, me.lat]).addTo(map);
    } else {
      meMarker.current.setLngLat([me.lon, me.lat]);
    }
  }, [me]);

  // fly to a focus target
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom ?? 16, duration: 900, essential: true });
  }, [focus]);

  return <div ref={hostRef} className="maplibregl-map" aria-label="Pub map" />;
}

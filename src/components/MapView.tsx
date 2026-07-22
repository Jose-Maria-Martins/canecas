import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Pub, PubScore } from "../types";
import { MAP_CENTER } from "../config";
import { categoryEmoji, pinGradient, pubPhoto } from "./scoreColor";

// OSM raster tiles via MapLibre GL (TASKS.md §2/§11 — documented map exception).
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
    { id: "bg", type: "background", paint: { "background-color": "#0e1116" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.95 } },
  ],
};

const LIGHT = { "raster-brightness-max": 0.92, "raster-saturation": -0.15, "raster-contrast": 0.05 };
const DARK = { "raster-brightness-max": 0.4, "raster-saturation": -0.1, "raster-contrast": 0.12 };

interface PinRefs {
  marker: Marker;
  el: HTMLDivElement;
  thumb: HTMLImageElement;
  bubble: HTMLDivElement;
  fallback: HTMLDivElement;
  badge: HTMLDivElement;
  sub: HTMLDivElement;
}

interface Props {
  pubs: Pub[];
  scores: Record<string, PubScore>;
  photos: Record<string, string>; // pubId -> user-uploaded photo (overrides seed)
  featuredIds: Set<string>;
  selectedId: string | null;
  onSelectPub: (pubId: string) => void;
  me: { lat: number; lon: number } | null;
  focus: { lat: number; lon: number; zoom?: number } | null;
  flashPubId: string | null;
  dark: boolean;
}

export function MapView(props: Props) {
  const { pubs, scores, photos, featuredIds, selectedId, onSelectPub, me, focus, flashPubId, dark } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const pins = useRef<Map<string, PinRefs>>(new Map());
  const meMarker = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelectPub);
  onSelectRef.current = onSelectPub;

  // init once
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: hostRef.current,
      style: OSM_STYLE,
      center: [MAP_CENTER.lon, MAP_CENTER.lat],
      zoom: MAP_CENTER.zoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    for (const pub of pubs) {
      const el = document.createElement("div");
      el.className = "ppin";
      el.innerHTML = `
        <div class="plabel"><div class="nm"></div><div class="sub"></div></div>
        <div class="bubble">
          <img class="thumb" loading="lazy" alt="" />
          <div class="fallback"></div>
          <div class="badge"><span class="star">★</span><span class="val"></span></div>
        </div>
        <div class="stem"></div>`;
      const thumb = el.querySelector<HTMLImageElement>(".thumb")!;
      const bubble = el.querySelector<HTMLDivElement>(".bubble")!;
      const fallback = el.querySelector<HTMLDivElement>(".fallback")!;
      const badge = el.querySelector<HTMLDivElement>(".badge .val")!.parentElement as HTMLDivElement;
      const nm = el.querySelector<HTMLDivElement>(".plabel .nm")!;
      const sub = el.querySelector<HTMLDivElement>(".plabel .sub")!;

      nm.textContent = pub.name;
      fallback.textContent = categoryEmoji(pub);
      const [c1, c2] = pinGradient(scores[pub.id]?.weighted_score ?? 0);
      fallback.style.setProperty("--pin-c1", c1);
      fallback.style.setProperty("--pin-c2", c2);
      thumb.onerror = () => bubble.classList.add("noimg");
      thumb.src = photos[pub.id] ?? pubPhoto(pub);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(pub.id);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([pub.lon, pub.lat])
        .addTo(map);
      pins.current.set(pub.id, { marker, el, thumb, bubble, fallback, badge, sub });
    }

    return () => {
      map.remove();
      mapRef.current = null;
      pins.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // scores → badges, labels, fallback colour
  useEffect(() => {
    for (const [pubId, p] of pins.current) {
      const s = scores[pubId];
      const val = p.badge.querySelector<HTMLSpanElement>(".val");
      if (val) val.textContent = s ? s.weighted_score.toFixed(1) : "–";
      p.sub.textContent = s ? `${s.rating_count} pours` : "new";
      const [c1, c2] = pinGradient(s?.weighted_score ?? 0);
      p.fallback.style.setProperty("--pin-c1", c1);
      p.fallback.style.setProperty("--pin-c2", c2);
    }
  }, [scores]);

  // user photos override the seed thumbnail
  useEffect(() => {
    for (const [pubId, p] of pins.current) {
      const override = photos[pubId];
      if (override && p.thumb.src !== override) {
        p.bubble.classList.remove("noimg");
        p.thumb.src = override;
      }
    }
  }, [photos]);

  // featured / selected labelling
  useEffect(() => {
    for (const [pubId, p] of pins.current) {
      p.el.classList.toggle("selected", pubId === selectedId);
      p.el.classList.toggle("labelled", featuredIds.has(pubId));
    }
  }, [selectedId, featuredIds]);

  // flash on live update
  useEffect(() => {
    if (!flashPubId) return;
    const p = pins.current.get(flashPubId);
    if (!p) return;
    p.el.classList.remove("flash");
    void p.el.offsetWidth;
    p.el.classList.add("flash");
  }, [flashPubId]);

  // light/dark map
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const props2 = dark ? DARK : LIGHT;
      for (const [k, v] of Object.entries(props2)) {
        try {
          map.setPaintProperty("osm", k as keyof typeof props2, v);
        } catch {
          /* style not ready */
        }
      }
      (map.getContainer().querySelector(".maplibregl-canvas") as HTMLElement | null)?.style.setProperty(
        "background",
        dark ? "#07060c" : "#0e1116",
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [dark]);

  // me marker
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

  // fly to focus
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom ?? 16, duration: 900, essential: true });
  }, [focus]);

  return <div ref={hostRef} className="maplibregl-map" aria-label="Pub map" />;
}

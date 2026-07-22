import { useCallback, useState } from "react";

export interface GeoState {
  coords: { lat: number; lon: number } | null;
  loading: boolean;
  error: string | null;
}

/** "Pubs near me" via the browser Geolocation API (TASKS.md core product). */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ coords: null, loading: false, error: null });

  const locate = useCallback((): Promise<{ lat: number; lon: number } | null> => {
    if (!("geolocation" in navigator)) {
      setState({ coords: null, loading: false, error: "Geolocation not supported" });
      return Promise.resolve(null);
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setState({ coords, loading: false, error: null });
          resolve(coords);
        },
        (err) => {
          setState({ coords: null, loading: false, error: err.message || "Location blocked" });
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
      );
    });
  }, []);

  return { ...state, locate };
}

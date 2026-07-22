import { useCallback, useEffect, useRef, useState } from "react";

export interface GeoState {
  coords: { lat: number; lon: number } | null;
  loading: boolean;
  error: string | null;
}

/** "Pubs near me" via the browser Geolocation API (TASKS.md core product). */
export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ coords: null, loading: true, error: null });
  const watchId = useRef<number | null>(null);

  // Prompt for location on first load rather than waiting on a button click, and
  // keep watching (not a one-shot read) so the fix stays current for the session.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setState({ coords: null, loading: false, error: "Geolocation not supported" });
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          coords: { lat: pos.coords.latitude, lon: pos.coords.longitude },
          loading: false,
          error: null,
        });
      },
      (err) => {
        // Denied/unavailable: fall back to the default map center. The browser
        // won't re-prompt on its own after a denial, and neither do we.
        setState({ coords: null, loading: false, error: err.message || "Location blocked" });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, []);

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

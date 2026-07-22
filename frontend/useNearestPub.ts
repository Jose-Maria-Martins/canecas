import { useState } from "react";

export interface NearestPub {
  id: string;
  name: string;
  category: "pub" | "bar" | "biergarten";
  lat: number;
  lon: number;
  distanceMeters: number;
  address: string | null;
  source: "openstreetmap" | "estimated";
}

type LocationStatus = "idle" | "locating" | "found" | "error";
type Coordinates = { latitude: number; longitude: number };

interface NearestPubResponse {
  pub: NearestPub;
}

export function useNearestPub() {
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [pub, setPub] = useState<NearestPub | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function locate(): Promise<Coordinates | null> {
    if (!navigator.geolocation) {
      setStatus("error");
      setError("Location is not available in this browser");
      return null;
    }

    setStatus("locating");
    setError(null);
    let foundCoordinates: Coordinates | null = null;

    try {
      const position = await currentPosition();
      foundCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setCoordinates(foundCoordinates);
      const params = new URLSearchParams({
        lat: String(position.coords.latitude),
        lon: String(position.coords.longitude),
      });
      const response = await fetch(`/api/pubs/nearest?${params}`);
      const body = (await response.json()) as NearestPubResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || "Pub radar is unavailable");
      setPub(body.pub);
      setStatus("found");
      return foundCoordinates;
    } catch (cause) {
      setStatus("error");
      setError(locationError(cause));
      return foundCoordinates;
    }
  }

  return { status, pub, coordinates, error, locate };
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 8_000,
      maximumAge: 5 * 60_000,
    });
  });
}

function locationError(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = Number(cause.code);
    if (code === 1) return "Location permission was declined";
    if (code === 3) return "Location took too long. Try again";
    return "Your location could not be determined";
  }
  return cause instanceof Error ? cause.message : "Pub radar is unavailable";
}

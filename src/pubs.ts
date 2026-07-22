const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const PUB_SEARCH_RADIUS_METERS = 5_000;
const CACHE_TTL_SECONDS = 86_400;

export interface Pub {
  id: string;
  name: string;
  category: "pub" | "bar" | "biergarten";
  lat: number;
  lon: number;
  distanceMeters: number;
  address: string | null;
  source: "openstreetmap" | "estimated";
}

export interface OsmPubElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

export async function lookupNearestPub(
  lat: number,
  lon: number,
  ctx: ExecutionContext,
): Promise<Pub> {
  const bucketLat = Number(lat.toFixed(2));
  const bucketLon = Number(lon.toFixed(2));
  const cacheKey = new Request(
    `https://caneca.internal/pub-search?lat=${bucketLat}&lon=${bucketLon}`,
  );

  try {
    let cached: Response | undefined;
    try {
      cached = await workerCache().match(cacheKey);
    } catch {
      // Cache availability should not decide whether location lookup works.
    }

    let elements: OsmPubElement[];
    if (cached) {
      elements = (await cached.json()) as OsmPubElement[];
    } else {
      elements = await fetchPubs(bucketLat, bucketLon);
      const cacheResponse = Response.json(elements, {
        headers: { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
      });
      ctx.waitUntil(workerCache().put(cacheKey, cacheResponse).catch(() => undefined));
    }

    return findNearestPub(elements, lat, lon) ?? estimatedPub(lat, lon);
  } catch {
    return estimatedPub(lat, lon);
  }
}

function workerCache(): Cache {
  return (caches as CacheStorage & { default: Cache }).default;
}

export function findNearestPub(
  elements: OsmPubElement[],
  lat: number,
  lon: number,
): Pub | null {
  let nearest: Pub | null = null;

  for (const element of elements) {
    const pubLat = element.lat ?? element.center?.lat;
    const pubLon = element.lon ?? element.center?.lon;
    const amenity = element.tags?.amenity;
    if (
      pubLat === undefined ||
      pubLon === undefined ||
      (amenity !== "pub" && amenity !== "bar" && amenity !== "biergarten")
    ) {
      continue;
    }

    const distanceMeters = Math.round(haversineDistance(lat, lon, pubLat, pubLon));
    if (nearest && nearest.distanceMeters <= distanceMeters) {
      continue;
    }

    nearest = {
      id: `osm:${element.type}:${element.id}`,
      name: element.tags?.name?.trim() || "Unnamed local pub",
      category: amenity,
      lat: pubLat,
      lon: pubLon,
      distanceMeters,
      address: formatAddress(element.tags),
      source: "openstreetmap",
    };
  }

  return nearest;
}

export function isValidPubId(value: string): boolean {
  return /^(?:osm:(?:node|way|relation):\d+|estimated:-?\d+\.\d{2}:-?\d+\.\d{2})$/.test(
    value,
  );
}

async function fetchPubs(lat: number, lon: number): Promise<OsmPubElement[]> {
  const query = `[out:json][timeout:5];(nwr(around:${PUB_SEARCH_RADIUS_METERS},${lat},${lon})["amenity"~"^(pub|bar|biergarten)$"];);out center tags qt;`;
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(6_000),
  });

  if (!response.ok) {
    throw new Error(`Overpass returned ${response.status}`);
  }

  const payload = (await response.json()) as { elements?: OsmPubElement[] };
  if (!Array.isArray(payload.elements)) {
    throw new Error("Overpass response did not contain elements");
  }
  return payload.elements;
}

function estimatedPub(lat: number, lon: number): Pub {
  const estimatedLat = Number(lat.toFixed(2));
  const estimatedLon = Number(lon.toFixed(2));
  return {
    id: `estimated:${estimatedLat.toFixed(2)}:${estimatedLon.toFixed(2)}`,
    name: "Nearby pub",
    category: "pub",
    lat: estimatedLat,
    lon: estimatedLon,
    distanceMeters: Math.round(haversineDistance(lat, lon, estimatedLat, estimatedLon)),
    address: null,
    source: "estimated",
  };
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = Math.PI / 180;
  const latDelta = (lat2 - lat1) * toRadians;
  const lonDelta = (lon2 - lon1) * toRadians;
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1 * toRadians) *
      Math.cos(lat2 * toRadians) *
      Math.sin(lonDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatAddress(tags: Record<string, string> | undefined): string | null {
  if (!tags) return null;
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const address = [street, tags["addr:city"]].filter(Boolean).join(", ");
  return address || null;
}

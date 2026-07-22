import type { MapSubmission } from "./types";

/**
 * Sample pints with real beer photos, shown when there are no location-tagged
 * submissions yet (e.g. a fresh/empty database or local development). Real
 * submissions from the API always take precedence over these.
 */
const DEMO_PINTS: Array<{
  latitude: number;
  longitude: number;
  score: number;
  reason: string;
  image: string;
}> = [
  {
    latitude: 51.5121,
    longitude: -0.1198,
    score: 4.6,
    reason: "Crisp lager, perfect head, worth the queue.",
    image: "photo-1608270586620-248524c67de9",
  },
  {
    latitude: 51.5155,
    longitude: -0.1411,
    score: 4.1,
    reason: "Hazy IPA with a proper citrus punch.",
    image: "photo-1575361204480-aadea25e6e68",
  },
  {
    latitude: 51.5033,
    longitude: -0.1276,
    score: 3.8,
    reason: "Solid amber ale, a touch flat but decent.",
    image: "photo-1518099074172-2e47ee6cfdc0",
  },
  {
    latitude: 51.5085,
    longitude: -0.0961,
    score: 4.9,
    reason: "Stout so smooth it should be illegal.",
    image: "photo-1535958636474-b021ee887b13",
  },
  {
    latitude: 51.4975,
    longitude: -0.1357,
    score: 4.3,
    reason: "Golden pilsner, ice cold, spot on.",
    image: "photo-1566633806327-68e152aaf26d",
  },
  {
    latitude: 51.5194,
    longitude: -0.1270,
    score: 3.5,
    reason: "Cloudy wheat beer, a bit too sweet for me.",
    image: "photo-1505075106905-fb052892c116",
  },
  {
    latitude: 51.5142,
    longitude: -0.1494,
    score: 4.7,
    reason: "Local pale ale, dangerously drinkable.",
    image: "photo-1567696911980-2eed69a46042",
  },
  {
    latitude: 51.5049,
    longitude: -0.0866,
    score: 4.0,
    reason: "Dark porter with a nice roasted finish.",
    image: "photo-1571613316887-6f8d5cbf7ef7",
  },
];

const REASON_BASE_TS = Date.UTC(2024, 5, 1, 18, 0, 0);

function unsplash(id: string): string {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=640&h=640&q=80`;
}

export const DEMO_SUBMISSIONS: MapSubmission[] = DEMO_PINTS.map((pint, index) => ({
  submissionId: `demo-${index + 1}`,
  latitude: pint.latitude,
  longitude: pint.longitude,
  score: pint.score,
  reason: pint.reason,
  createdAt: REASON_BASE_TS + index * 37 * 60_000,
  imageUrl: unsplash(pint.image),
}));

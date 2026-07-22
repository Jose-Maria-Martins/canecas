import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Challenge, LeaderboardEntry, Pub, PubScore, BeerRealPrompt } from "./types";
import { api } from "./api/client";
import { IS_MOCK, CITY } from "./config";
import { distanceMeters } from "./api/scoring";
import { useSession } from "./hooks/useSession";
import { useGeolocation } from "./hooks/useGeolocation";
import { useFeed } from "./hooks/useFeed";
import { MapView } from "./components/MapView";
import { PubPanel } from "./components/PubPanel";
import { Feed } from "./components/Feed";
import { Leaderboard } from "./components/Leaderboard";
import { Challenges } from "./components/Challenges";
import { XpBar } from "./components/XpBar";
import { BeerRealModal } from "./components/BeerRealModal";
import { pubPhoto } from "./components/scoreColor";
import { PhotoCaptureDialog } from "./components/PhotoCaptureDialog";

type Tab = "feed" | "board" | "quests";
interface Toast {
  id: number;
  msg: string;
  gold: boolean;
}

interface SavedMapSubmission {
  latitude: number;
  longitude: number;
  imageUrl: string;
}

export default function App() {
  const { user, setUser } = useSession();
  const geo = useGeolocation();

  const [pubs, setPubs] = useState<Pub[]>([]);
  const [scores, setScores] = useState<Record<string, PubScore>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; zoom?: number } | null>(null);
  const [flashPubId, setFlashPubId] = useState<string | null>(null);
  const [bumped, setBumped] = useState(false);
  const [dark, setDark] = useState(false);

  const [tab, setTab] = useState<Tab>("feed");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);

  const [beerreal, setBeerreal] = useState<BeerRealPrompt | null>(null);
  const [beerrealDismissed, setBeerrealDismissed] = useState<string | null>(null);
  const [capturePubId, setCapturePubId] = useState<string | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const feed = useFeed(true);

  const pushToast = useCallback((msg: string, gold = false) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, gold }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const refreshGamification = useCallback(async () => {
    const [lb, ch, sess] = await Promise.all([
      api.getLeaderboard(),
      api.getChallenges(),
      api.getSession(),
    ]);
    setLeaderboard(lb);
    setChallenges(ch);
    setUser(sess);
  }, [setUser]);

  // initial load
  useEffect(() => {
    void (async () => {
      const [p, s] = await Promise.all([api.listPubs(), api.getScores()]);
      setPubs(p);
      setScores(s);
      try {
        const response = await fetch("/api/map/submissions?limit=100");
        if (!response.ok) return;
        const body = (await response.json()) as { submissions: SavedMapSubmission[] };
        const savedPhotos: Record<string, string> = {};
        for (const submission of body.submissions) {
          const location = {
            lat: submission.latitude,
            lon: submission.longitude,
          };
          const nearest = [...p].sort(
            (a, b) =>
              distanceMeters(location, a) - distanceMeters(location, b),
          )[0];
          if (
            nearest &&
            savedPhotos[nearest.id] === undefined &&
            distanceMeters(location, nearest) < 250
          ) {
            savedPhotos[nearest.id] = submission.imageUrl;
          }
        }
        setPhotos(savedPhotos);
      } catch {
        // The seeded map remains usable when the local Worker is offline.
      }
    })();
    void refreshGamification();
  }, [refreshGamification]);

  // magic-link token in the URL (real-mode inbox click lands here)
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    if (!token) return;
    void (async () => {
      try {
        const u = await api.verifyMagicLink(token);
        setUser(u);
        pushToast(`Welcome, ${u.display_name}! 🍻`, true);
      } catch {
        pushToast("That magic link was invalid or expired.");
      } finally {
        url.searchParams.delete("token");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    })();
  }, [setUser, pushToast]);

  // active BeerReal (poll for it once signed in)
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const check = async () => {
      const br = await api.getActiveBeerReal();
      if (alive) setBeerreal(br);
    };
    void check();
    const t = setInterval(check, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [user]);

  // live pub-score subscription for the selected pub (WS + polling fallback)
  useEffect(() => {
    if (!selectedId) return;
    const sub = api.subscribePubScore(selectedId, (score) => {
      setScores((prev) => ({ ...prev, [score.pub_id]: score }));
      setFlashPubId(score.pub_id);
      setBumped(true);
      setTimeout(() => setBumped(false), 650);
    });
    return () => sub.close();
  }, [selectedId]);

  const selectedPub = useMemo(
    () => pubs.find((p) => p.id === selectedId) ?? null,
    [pubs, selectedId],
  );

  // top pubs get a floating name label on the map
  const featuredIds = useMemo(() => {
    const ranked = [...pubs].sort(
      (a, b) => (scores[b.id]?.weighted_score ?? 0) - (scores[a.id]?.weighted_score ?? 0),
    );
    return new Set(ranked.slice(0, 4).map((p) => p.id));
  }, [pubs, scores]);

  const selectPub = useCallback((pubId: string) => {
    setSelectedId(pubId);
    setSheetOpen(false);
  }, []);

  useEffect(() => {
    if (selectedPub) setFocus({ lat: selectedPub.lat, lon: selectedPub.lon, zoom: 16 });
  }, [selectedPub]);

  const setPhoto = useCallback((pubId: string, url: string) => {
    setPhotos((prev) => ({ ...prev, [pubId]: url }));
  }, []);

  async function nearMe() {
    const coords = await geo.locate();
    if (!coords) {
      pushToast(geo.error ?? "Couldn't get your location");
      return;
    }
    setFocus({ ...coords, zoom: 15.5 });
    let best: { id: string; d: number } | null = null;
    for (const p of pubs) {
      const d = distanceMeters(coords, p);
      if (!best || d < best.d) best = { id: p.id, d };
    }
    if (best) {
      selectPub(best.id);
      pushToast(`Nearest pub is ${Math.round(best.d)}m away`);
    }
  }

  function openPhotoUpload() {
    const target = geo.coords
      ? [...pubs].sort((a, b) => distanceMeters(geo.coords!, a) - distanceMeters(geo.coords!, b))[0]
      : pubs[0];
    if (target) {
      selectPub(target.id);
      setCapturePubId(target.id);
    }
  }

  function onToastAndRefresh(msg: string, gold = false) {
    pushToast(msg, gold);
    void refreshGamification();
  }

  function snapBeerReal() {
    if (beerreal) setBeerrealDismissed(beerreal.id);
    const target = geo.coords
      ? [...pubs].sort((a, b) => distanceMeters(geo.coords!, a) - distanceMeters(geo.coords!, b))[0]
      : pubs[0];
    if (target) selectPub(target.id);
  }

  const beerrealOpen = !!beerreal && beerrealDismissed !== beerreal.id;
  const pillThumbs = pubs.slice(0, 4);

  return (
    <div className="app" onClick={() => sheetOpen && setSheetOpen(false)}>
      <div className="stage">
        <MapView
          pubs={pubs}
          scores={scores}
          photos={photos}
          featuredIds={featuredIds}
          selectedId={selectedId}
          onSelectPub={selectPub}
          me={geo.coords}
          focus={focus}
          flashPubId={flashPubId}
          dark={dark}
        />

        <div className="stickers" aria-hidden>
          <div className="sticker s1">🍺</div>
          <div className="sticker s2">🍻</div>
          <div className="sticker s3">🍷</div>
        </div>

        <div className="top-left">
          <div className="city">
            {CITY.name}
            <small>.</small>
          </div>
        </div>

        <div className="top-right">
          {user ? (
            <XpBar user={user} />
          ) : (
            <span className="demo-access">Open demo</span>
          )}
        </div>

        <div className="fab-stack">
          <button
            className="fab"
            title={dark ? "Light map" : "Dark map"}
            onClick={(e) => {
              e.stopPropagation();
              setDark((d) => !d);
            }}
          >
            {dark ? "☀️" : "🌙"}
          </button>
          <button
            className={"fab" + (geo.loading ? " locating" : "")}
            title="Pubs near me"
            onClick={(e) => {
              e.stopPropagation();
              void nearMe();
            }}
          >
            {geo.loading ? "…" : "📍"}
          </button>
        </div>

        {IS_MOCK && <div className="mockflag">mock API · standalone demo</div>}
      </div>

      {selectedPub ? (
        <PubPanel
          pub={selectedPub}
          score={scores[selectedPub.id]}
          scoreBumped={bumped}
          photo={photos[selectedPub.id]}
          onClose={() => setSelectedId(null)}
          onCapture={() => setCapturePubId(selectedPub.id)}
        />
      ) : (
        <>
          {!sheetOpen && (
            <div className="bottom">
              <button className="camera-cta" onClick={openPhotoUpload} disabled={pubs.length === 0}>
                <span>📸</span> Take a pint photo
              </button>
              <button
                className="places-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  setSheetOpen(true);
                }}
              >
                <span className="stack">
                  {pillThumbs.map((p) => (
                    <i key={p.id} style={{ backgroundImage: `url(${photos[p.id] ?? pubPhoto(p)})` }} />
                  ))}
                </span>
                {pubs.length} pubs
              </button>
            </div>
          )}

          <div className={"sheet" + (sheetOpen ? " open" : "")} onClick={(e) => e.stopPropagation()}>
            <div className="grab" onClick={() => setSheetOpen(false)}>
              <i />
            </div>
            <div className="tabs">
              <button className={"tab" + (tab === "feed" ? " active" : "")} onClick={() => setTab("feed")}>
                Feed<span className="n">{feed.length}</span>
              </button>
              <button className={"tab" + (tab === "board" ? " active" : "")} onClick={() => setTab("board")}>
                Board<span className="n">{leaderboard.length}</span>
              </button>
              <button className={"tab" + (tab === "quests" ? " active" : "")} onClick={() => setTab("quests")}>
                Quests<span className="n">{challenges.length}</span>
              </button>
            </div>
            <div className="sheet-body">
              {beerrealOpen && tab === "feed" && (
                <div className="beerreal-banner">
                  <div className="kicker">⚡ BeerReal live</div>
                  <div style={{ fontSize: 13.5, margin: "6px 0 10px", lineHeight: 1.4 }}>
                    {beerreal!.prompt}
                  </div>
                  <button className="btn primary sm" onClick={snapBeerReal}>
                    Snap my pint
                  </button>
                </div>
              )}
              {tab === "feed" && <Feed activities={feed} />}
              {tab === "board" && <Leaderboard rows={leaderboard} />}
              {tab === "quests" && <Challenges challenges={challenges} />}
            </div>
          </div>
        </>
      )}

      {capturePubId && pubs.find((pub) => pub.id === capturePubId) && (
        <PhotoCaptureDialog
          pub={pubs.find((pub) => pub.id === capturePubId)!}
          onClose={() => setCapturePubId(null)}
          onPhoto={setPhoto}
          onRated={(score) => onToastAndRefresh(`AI vibe rating: ${score.toFixed(1)} ★`, true)}
        />
      )}

      {user && beerrealOpen && (
        <BeerRealModal
          prompt={beerreal!}
          onSnap={snapBeerReal}
          onClose={() => setBeerrealDismissed(beerreal!.id)}
        />
      )}

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={"toast" + (t.gold ? " gold" : "")}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

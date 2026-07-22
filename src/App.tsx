import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Challenge, LeaderboardEntry, Pub, PubScore, BeerRealPrompt } from "./types";
import { api } from "./api/client";
import { IS_MOCK } from "./config";
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

type Tab = "feed" | "board" | "quests";
interface Toast {
  id: number;
  msg: string;
  gold: boolean;
}

export default function App() {
  const { user, setUser } = useSession();
  const geo = useGeolocation();

  const [pubs, setPubs] = useState<Pub[]>([]);
  const [scores, setScores] = useState<Record<string, PubScore>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; zoom?: number } | null>(null);
  const [flashPubId, setFlashPubId] = useState<string | null>(null);
  const [bumped, setBumped] = useState(false);

  const [tab, setTab] = useState<Tab>("feed");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);

  const [beerreal, setBeerreal] = useState<BeerRealPrompt | null>(null);
  const [beerrealDismissed, setBeerrealDismissed] = useState<string | null>(null);

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

  const selectPub = useCallback((pubId: string) => {
    setSelectedId(pubId);
  }, []);

  useEffect(() => {
    if (selectedPub) setFocus({ lat: selectedPub.lat, lon: selectedPub.lon, zoom: 16 });
  }, [selectedPub]);

  async function nearMe() {
    const coords = await geo.locate();
    if (!coords) {
      pushToast(geo.error ?? "Couldn't get your location");
      return;
    }
    setFocus({ ...coords, zoom: 15.5 });
    // select the closest pub
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
    if (target) selectPub(target.id);
  }

  function onToastAndRefresh(msg: string, gold = false) {
    pushToast(msg, gold);
    void refreshGamification();
  }

  function snapBeerReal() {
    if (beerreal) setBeerrealDismissed(beerreal.id);
    // steer the user to a pub to fulfil it
    const target = geo.coords
      ? [...pubs].sort((a, b) => distanceMeters(geo.coords!, a) - distanceMeters(geo.coords!, b))[0]
      : pubs[0];
    if (target) selectPub(target.id);
  }

  const beerrealOpen = !!beerreal && beerrealDismissed !== beerreal.id;

  return (
    <div className="app">
      <div className="stage">
        <MapView
          pubs={pubs}
          scores={scores}
          selectedId={selectedId}
          onSelectPub={selectPub}
          me={geo.coords}
          focus={focus}
          flashPubId={flashPubId}
        />

        <div className="topbar">
          <div className="brand">
            <span className="mug">🍺</span>
            Caneca
            <span className="dot" title="live" />
          </div>
          <div className="spacer" />
          {user ? (
            <XpBar user={user} />
          ) : (
            <span className="demo-access">Open demo</span>
          )}
        </div>

        <div className="map-fabs">
          <button className="fab rate-fab" onClick={openPhotoUpload} disabled={pubs.length === 0}>
            📸 Rate a pint
          </button>
          <button className="fab" onClick={() => void nearMe()} disabled={geo.loading}>
            📍 {geo.loading ? "Locating…" : "Pubs near me"}
          </button>
        </div>

        {selectedPub && (
          <PubPanel
            pub={selectedPub}
            score={scores[selectedPub.id]}
            scoreBumped={bumped}
            onClose={() => setSelectedId(null)}
            onToast={onToastAndRefresh}
          />
        )}
      </div>

      <aside className="rail">
        <div className="rail-head">
          <button className={"tab" + (tab === "feed" ? " active" : "")} onClick={() => setTab("feed")}>
            Feed
          </button>
          <button className={"tab" + (tab === "board" ? " active" : "")} onClick={() => setTab("board")}>
            Leaderboard
          </button>
          <button className={"tab" + (tab === "quests" ? " active" : "")} onClick={() => setTab("quests")}>
            Quests
          </button>
        </div>
        <div className="rail-body">
          {beerrealOpen && tab === "feed" && (
            <div className="beerreal">
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
      </aside>

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

      {IS_MOCK && (
        <div
          style={{
            position: "fixed",
            bottom: 8,
            right: 388,
            zIndex: 30,
            fontSize: 11,
            color: "var(--text-faint)",
            pointerEvents: "none",
          }}
        >
          mock API · standalone demo mode
        </div>
      )}
    </div>
  );
}

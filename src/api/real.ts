// Real backend client — talks to the single Caneca Worker (TASKS.md §1/§9):
//   REST  /api/*   (cookie-based sessions, §7 — always credentials: "include")
//   WS    /ws/pub/:pubId   (live pub-score stream only, §6)
// Selected when VITE_API_MODE=real. Until Devs B/C/D ship these routes the app
// runs in mock mode instead; nothing here needs to change when they land.

import type {
  BeerRealPrompt,
  Challenge,
  FeedResponse,
  LeaderboardEntry,
  PhotoAccepted,
  Pub,
  PubScore,
  PubScoreMessage,
  Submission,
  User,
} from "../types";
import type { ApiClient, ScoreSubscription } from "./client";
import { SCORE_POLL_MS } from "../config";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include", // send the caneca_sess cookie (§7)
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class RealClient implements ApiClient {
  async requestMagicLink(email: string, turnstileToken: string): Promise<{ ok: true }> {
    return http("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, turnstileToken }),
    });
  }

  async verifyMagicLink(token: string): Promise<User> {
    return http(`/api/auth/verify?token=${encodeURIComponent(token)}`);
  }

  async getSession(): Promise<User | null> {
    try {
      return await http<User>("/api/auth/session");
    } catch {
      return null; // 401 → not signed in
    }
  }

  async logout(): Promise<void> {
    await http("/api/auth/logout", { method: "POST" });
  }

  async listPubs(): Promise<Pub[]> {
    return http("/api/pubs");
  }

  async getScores(): Promise<Record<string, PubScore>> {
    return http("/api/pubs/scores");
  }

  async getPubScore(pubId: string): Promise<PubScore> {
    return http(`/api/pub/${encodeURIComponent(pubId)}/score`);
  }

  async listPubSubmissions(pubId: string): Promise<Submission[]> {
    return http(`/api/pub/${encodeURIComponent(pubId)}/submissions`);
  }

  async submitPhoto(input: { pubId: string; file: File; turnstileToken: string }): Promise<PhotoAccepted> {
    const form = new FormData();
    form.set("pubId", input.pubId);
    form.set("turnstileToken", input.turnstileToken);
    form.set("photo", input.file);
    // Let the browser set the multipart boundary — no explicit content-type.
    return http("/api/photos", { method: "POST", body: form, headers: {} });
  }

  async getSubmission(id: string): Promise<Submission> {
    return http(`/api/submissions/${encodeURIComponent(id)}`);
  }

  async getFeed(since: number): Promise<FeedResponse> {
    return http(`/api/feed?since=${since}`);
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    return http("/api/leaderboard");
  }

  async getChallenges(): Promise<Challenge[]> {
    return http("/api/challenges");
  }

  async getActiveBeerReal(): Promise<BeerRealPrompt | null> {
    return http("/api/beerreal/active");
  }

  subscribePubScore(pubId: string, onScore: (s: PubScore) => void): ScoreSubscription {
    let closed = false;
    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (closed || pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          onScore(await this.getPubScore(pubId));
        } catch {
          /* keep trying */
        }
      }, SCORE_POLL_MS);
    };

    try {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/pub/${encodeURIComponent(pubId)}`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as PubScoreMessage;
          if (msg.t === "pubScore" && msg.pubId === pubId) onScore(msg.score);
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onerror = () => startPolling(); // §11 fallback
      ws.onclose = () => {
        if (!closed) startPolling();
      };
    } catch {
      startPolling();
    }

    return {
      close: () => {
        closed = true;
        ws?.close();
        if (pollTimer) clearInterval(pollTimer);
      },
    };
  }
}

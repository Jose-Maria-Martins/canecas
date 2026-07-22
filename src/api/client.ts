// Typed API client. One interface, two implementations (mock + real), selected
// by config.API_MODE. Components only ever import `api` from here, so flipping
// VITE_API_MODE=real swaps the whole backend with zero component changes.

import type {
  Activity,
  BeerRealPrompt,
  Challenge,
  FeedResponse,
  LeaderboardEntry,
  PhotoAccepted,
  Pub,
  PubScore,
  Submission,
  User,
} from "../types";
import { API_MODE } from "../config";

/** Handle for a live pub-score subscription (WS, with polling fallback). */
export interface ScoreSubscription {
  close(): void;
}

export interface ApiClient {
  // --- auth (TASKS.md §7) ---
  requestMagicLink(email: string, turnstileToken: string): Promise<{ ok: true }>;
  /** Dev/mock convenience: resolve a magic-link token to a session. */
  verifyMagicLink(token: string): Promise<User>;
  getSession(): Promise<User | null>;
  logout(): Promise<void>;

  // --- pubs (seed JSON + materialized scores) ---
  listPubs(): Promise<Pub[]>;
  getScores(): Promise<Record<string, PubScore>>;
  getPubScore(pubId: string): Promise<PubScore>;
  listPubSubmissions(pubId: string): Promise<Submission[]>;

  // --- photos / AI pipeline (TASKS.md §5) ---
  submitPhoto(input: {
    pubId: string;
    file: File;
    latitude: number;
    longitude: number;
  }): Promise<PhotoAccepted>;
  /** Poll a submission until AI sets `rating` (mock resolves after a delay). */
  getSubmission(id: string): Promise<Submission>;

  // --- buddy feed (TASKS.md §6, polled) ---
  getFeed(since: number): Promise<FeedResponse>;

  // --- gamification ---
  getLeaderboard(): Promise<LeaderboardEntry[]>;
  getChallenges(): Promise<Challenge[]>;

  // --- BeerReal (TASKS.md §8) ---
  getActiveBeerReal(): Promise<BeerRealPrompt | null>;

  // --- real-time pub scores (TASKS.md §5.3 / §6) ---
  subscribePubScore(
    pubId: string,
    onScore: (score: PubScore) => void,
  ): ScoreSubscription;
}

// Both implementations are imported, but only the selected one is constructed —
// so the mock's demo simulator/timers never start in real mode, and vice versa.
import { MockClient } from "./mock";
import { RealClient } from "./real";

export const api: ApiClient =
  API_MODE === "real" ? new RealClient() : new MockClient();

export type { Activity };

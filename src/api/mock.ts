// In-app mock backend. Lets the whole map/frontend layer run and be demoed
// before Devs B/C/D ship the real Worker API. It deliberately mirrors the
// report's behaviour so the swap to `real` mode is a no-op for components:
//   §4  Bayesian weighted pub score
//   §5  async AI rating (upload returns 202 "pending", rating lands ~later)
//   §6  polled activity feed; DemoSimulatorDO writes ONLY demo-tagged rows and
//       never touches pub_scores or real user attribution
//   §7  single-use magic-link tokens, session persisted client-side
//   §8  BeerReal prompt with a short response window
//
// NOTE: this file is mock-only. Nothing here ships to production behaviour; the
// real backend is authoritative. Kept isolated in `real` mode (never constructed).

import seed from "../data/pubs.seed.json";
import type {
  Activity,
  ActivityType,
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
import type { ApiClient, ScoreSubscription } from "./client";
import { getPipelineResult, uploadPhoto } from "./pipeline";
import { levelFromXp, weightedScore } from "./scoring";

const SESSION_KEY = "caneca.mock.session.v1";

function ulid(prefix = ""): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}${t}${r}`.toUpperCase();
}

function nowMs(): number {
  return Date.now();
}

const PUBS: Pub[] = (seed as unknown as { pubs: Pub[] }).pubs;

// Seeded buddy users (accepted buddies) + demo (simulated) identities. Demo ids
// are `demo_`-prefixed and never collide with real users (§6).
const BUDDY_USERS = [
  { id: "usr_ana", display_name: "Ana", xp: 1240 },
  { id: "usr_bruno", display_name: "Bruno", xp: 880 },
  { id: "usr_catarina", display_name: "Catarina", xp: 2010 },
  { id: "usr_diogo", display_name: "Diogo", xp: 430 },
];

const DEMO_USERS = [
  { id: "demo_lena", display_name: "Lena (demo)" },
  { id: "demo_marco", display_name: "Marco (demo)" },
  { id: "demo_sofia", display_name: "Sofia (demo)" },
];

const DEMO_VERBS: { type: ActivityType; make: (pub?: Pub) => string }[] = [
  { type: "check_in", make: (p) => `checked in at ${p?.name}` },
  { type: "submission", make: (p) => `rated a pint at ${p?.name}` },
  { type: "level_up", make: () => `leveled up` },
  { type: "challenge_complete", make: () => `finished a challenge` },
];

export class MockClient implements ApiClient {
  private user: User | null = null;
  private magicTokens = new Map<string, string>(); // token -> email
  private scores = new Map<string, PubScore>();
  private submissions = new Map<string, Submission>();
  private activities: Activity[] = [];
  private subs = new Map<string, Set<(s: PubScore) => void>>();
  private challenges: Challenge[];
  private beerreal: BeerRealPrompt | null = null;
  private globalMean = 3.9;

  constructor() {
    this.restoreSession();
    this.seedScores();
    this.seedActivity();
    this.challenges = this.seedChallenges();
    this.beerreal = this.seedBeerReal();
    this.startDemoSimulator();
  }

  // ---- seeding ----------------------------------------------------------

  private seedScores() {
    // Give each pub a plausible history so the map is populated on load.
    let sum = 0;
    let count = 0;
    for (const pub of PUBS) {
      if (pub.featured === "cloudflare") {
        this.scores.set(pub.id, {
          pub_id: pub.id,
          avg_rating: 5,
          rating_count: 500,
          weighted_score: 5,
        });
        continue;
      }
      const rating_count = 3 + Math.floor(Math.random() * 40);
      const avg_rating = 3.2 + Math.random() * 1.6; // 3.2..4.8
      sum += avg_rating * rating_count;
      count += rating_count;
      this.scores.set(pub.id, {
        pub_id: pub.id,
        avg_rating,
        rating_count,
        weighted_score: 0, // filled below once globalMean is known
      });
    }
    this.globalMean = count > 0 ? sum / count : 3.9;
    for (const [id, s] of this.scores) {
      if (s.weighted_score === 5) continue;
      this.scores.set(id, {
        ...s,
        weighted_score: weightedScore(s.avg_rating, s.rating_count, this.globalMean),
      });
    }
  }

  private seedActivity() {
    const t = nowMs();
    const samples: Array<Partial<Activity> & { minsAgo: number }> = [
      { user_id: "usr_catarina", display_name: "Catarina", type: "level_up", minsAgo: 2 },
      { user_id: "usr_ana", display_name: "Ana", type: "submission", target_id: PUBS[6].id, target_name: PUBS[6].name, minsAgo: 6 },
      { user_id: "usr_bruno", display_name: "Bruno", type: "check_in", target_id: PUBS[10].id, target_name: PUBS[10].name, minsAgo: 12 },
      { user_id: "demo_marco", display_name: "Marco (demo)", type: "submission", target_id: PUBS[1].id, target_name: PUBS[1].name, minsAgo: 1, demo: true },
    ];
    for (const s of samples) {
      this.activities.push({
        id: ulid("act_"),
        user_id: s.user_id!,
        display_name: s.display_name!,
        type: s.type as ActivityType,
        target_id: s.target_id ?? null,
        target_name: s.target_name ?? null,
        ts: t - s.minsAgo * 60_000,
        demo: s.demo ?? false,
      });
    }
    this.activities.sort((a, b) => a.ts - b.ts);
  }

  private seedChallenges(): Challenge[] {
    const t = nowMs();
    const day = 86_400_000;
    return [
      { id: "chl_daily_1", type: "daily", title: "Rate a pint today", xp: 50, starts_at: t - day / 2, ends_at: t + day / 2, completed: false },
      { id: "chl_daily_2", type: "daily", title: "Check in at a new pub", xp: 40, starts_at: t - day / 2, ends_at: t + day / 2, completed: false },
      { id: "chl_weekly_1", type: "weekly", title: "Visit 5 different pubs", xp: 200, starts_at: t - 3 * day, ends_at: t + 4 * day, completed: false },
    ];
  }

  private seedBeerReal(): BeerRealPrompt {
    const t = nowMs();
    return {
      id: "br_" + new Date().toISOString().slice(0, 10),
      prompt: "☀️ It's Caneca o'clock! Snap your current pint in the next 10 minutes.",
      created_at: t,
      window_ends_at: t + 10 * 60_000,
      responded: false,
    };
  }

  // ---- demo simulator (TASKS.md §6) -------------------------------------
  // Writes ONLY demo-tagged activity rows. It intentionally has no path to
  // pub_scores or real user ids — the same structural separation the real
  // DemoSimulatorDO enforces.
  private startDemoSimulator() {
    setInterval(() => {
      const u = DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)];
      const verb = DEMO_VERBS[Math.floor(Math.random() * DEMO_VERBS.length)];
      const pub = PUBS[Math.floor(Math.random() * PUBS.length)];
      this.activities.push({
        id: ulid("act_"),
        user_id: u.id, // demo_-prefixed
        display_name: u.display_name,
        type: verb.type,
        target_id: verb.type === "level_up" || verb.type === "challenge_complete" ? null : pub.id,
        target_name: verb.type === "level_up" || verb.type === "challenge_complete" ? null : pub.name,
        ts: nowMs(),
        demo: true,
      });
      if (this.activities.length > 200) this.activities.splice(0, this.activities.length - 200);
    }, 5000);
  }

  // ---- session ----------------------------------------------------------

  private restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) this.user = JSON.parse(raw) as User;
    } catch {
      /* ignore */
    }
  }

  private persistSession() {
    try {
      if (this.user) localStorage.setItem(SESSION_KEY, JSON.stringify(this.user));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  private refreshLevel() {
    if (!this.user) return;
    this.user.level = levelFromXp(this.user.xp);
  }

  private awardXp(amount: number, reason: ActivityType) {
    if (!this.user) return;
    const before = this.user.level;
    this.user.xp += amount;
    this.refreshLevel();
    this.persistSession();
    if (this.user.level > before) {
      this.pushOwnActivity("level_up", null, null);
    }
    void reason;
  }

  private pushOwnActivity(type: ActivityType, targetId: string | null, targetName: string | null) {
    if (!this.user) return;
    this.activities.push({
      id: ulid("act_"),
      user_id: this.user.id,
      display_name: this.user.display_name,
      type,
      target_id: targetId,
      target_name: targetName,
      ts: nowMs(),
      demo: false,
    });
  }

  // ---- auth (§7) --------------------------------------------------------

  async requestMagicLink(email: string, turnstileToken: string): Promise<{ ok: true }> {
    if (!turnstileToken) throw new Error("Turnstile verification required");
    const token = ulid("ml_");
    this.magicTokens.set(token, email);
    // eslint-disable-next-line no-console
    console.info(`[mock] magic link for ${email}: ?token=${token}`);
    return { ok: true };
  }

  /** MOCK-ONLY: surface the freshest token so the demo can simulate the click. */
  async devPeekToken(email: string): Promise<string | null> {
    for (const [token, e] of [...this.magicTokens].reverse()) {
      if (e === email) return token;
    }
    return null;
  }

  async verifyMagicLink(token: string): Promise<User> {
    const email = this.magicTokens.get(token);
    if (!email) throw new Error("Invalid or expired link");
    this.magicTokens.delete(token); // single-use (§7)
    const display = email.split("@")[0].replace(/[^a-z0-9]/gi, "") || "drinker";
    this.user = {
      id: "usr_" + display.toLowerCase(),
      email,
      display_name: display.charAt(0).toUpperCase() + display.slice(1),
      xp: 120,
      level: levelFromXp(120),
    };
    this.persistSession();
    return this.user;
  }

  async getSession(): Promise<User | null> {
    return this.user;
  }

  async logout(): Promise<void> {
    this.user = null;
    this.persistSession();
  }

  // ---- pubs -------------------------------------------------------------

  async listPubs(): Promise<Pub[]> {
    return PUBS;
  }

  async getScores(): Promise<Record<string, PubScore>> {
    return Object.fromEntries(this.scores);
  }

  async getPubScore(pubId: string): Promise<PubScore> {
    const s = this.scores.get(pubId);
    if (!s) throw new Error("Unknown pub");
    return s;
  }

  async listPubSubmissions(pubId: string): Promise<Submission[]> {
    return [...this.submissions.values()]
      .filter((s) => s.pub_id === pubId)
      .sort((a, b) => b.created_at - a.created_at);
  }

  // ---- photos / AI pipeline (§5) ----------------------------------------

  async submitPhoto(input: {
    pubId: string;
    file: File;
    latitude: number;
    longitude: number;
  }): Promise<PhotoAccepted> {
    const id = await uploadPhoto(input);
    const submission: Submission = {
      id,
      user_id: this.user?.id ?? "guest",
      pub_id: input.pubId,
      photo_url: URL.createObjectURL(input.file), // stand-in for the signed R2 URL
      rating: null, // pending until "AI" runs
      created_at: nowMs(),
    };
    this.submissions.set(id, submission);
    return { submission_id: id, status: "pending" };
  }

  private finishInference(submissionId: string, rating: number) {
    const sub = this.submissions.get(submissionId);
    if (!sub) return;
    sub.rating = rating;
    this.submissions.set(submissionId, sub);

    // PubAggregatorDO recompute (§4) — real ratings only.
    const prev = this.scores.get(sub.pub_id)!;
    const pub = PUBS.find((candidate) => candidate.id === sub.pub_id);
    const rating_count = prev.rating_count + 1;
    const avg_rating = (prev.avg_rating * prev.rating_count + rating) / rating_count;
    const next: PubScore = pub?.featured === "cloudflare"
      ? { pub_id: sub.pub_id, avg_rating: 5, rating_count: 500, weighted_score: 5 }
      : {
          pub_id: sub.pub_id,
          avg_rating,
          rating_count,
          weighted_score: weightedScore(avg_rating, rating_count, this.globalMean),
        };
    this.scores.set(sub.pub_id, next);
    this.broadcast(sub.pub_id, next);

    // gamification side-effects
    this.pushOwnActivity("submission", sub.pub_id, pub?.name ?? null);
    this.awardXp(30, "submission");
    // complete the daily "rate a pint" challenge
    const daily = this.challenges.find((c) => c.id === "chl_daily_1");
    if (daily && !daily.completed) {
      daily.completed = true;
      this.awardXp(daily.xp, "challenge_complete");
      this.pushOwnActivity("challenge_complete", daily.id, daily.title);
    }
    // if a BeerReal window is open, count it
    if (this.beerreal && !this.beerreal.responded && nowMs() < this.beerreal.window_ends_at) {
      this.beerreal.responded = true;
      this.awardXp(60, "beerreal");
      this.pushOwnActivity("beerreal", sub.pub_id, pub?.name ?? null);
    }
  }

  async getSubmission(id: string): Promise<Submission> {
    const s = this.submissions.get(id);
    if (!s) throw new Error("Unknown submission");
    if (s.rating !== null) return s;

    const result = await getPipelineResult(id);
    if (result.status === "complete" && result.score !== null) {
      this.finishInference(id, result.score);
      return this.submissions.get(id)!;
    }
    if (result.status === "rejected" || result.status === "failed") {
      throw new Error(result.reason || "The image could not be rated");
    }
    return s;
  }

  // ---- feed (§6) --------------------------------------------------------

  async getFeed(since: number): Promise<FeedResponse> {
    const buddyIds = new Set(BUDDY_USERS.map((b) => b.id));
    const meId = this.user?.id;
    const activities = this.activities
      .filter((a) => a.ts > since)
      .filter((a) => a.demo || a.user_id === meId || buddyIds.has(a.user_id))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 50);
    return { activities, now: nowMs() };
  }

  // ---- gamification -----------------------------------------------------

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const rows = [...BUDDY_USERS];
    if (this.user) {
      rows.push({ id: this.user.id, display_name: this.user.display_name, xp: this.user.xp });
    }
    rows.sort((a, b) => b.xp - a.xp);
    return rows.map((r, i) => ({
      user_id: r.id,
      display_name: r.display_name,
      xp: r.xp,
      level: levelFromXp(r.xp),
      rank: i + 1,
      is_me: this.user?.id === r.id,
    }));
  }

  async getChallenges(): Promise<Challenge[]> {
    return this.challenges;
  }

  // ---- BeerReal (§8) ----------------------------------------------------

  async getActiveBeerReal(): Promise<BeerRealPrompt | null> {
    if (!this.beerreal) return null;
    if (nowMs() > this.beerreal.window_ends_at) return null;
    return this.beerreal;
  }

  // ---- real-time pub scores (§5.3 / §6) ---------------------------------

  subscribePubScore(pubId: string, onScore: (s: PubScore) => void): ScoreSubscription {
    let set = this.subs.get(pubId);
    if (!set) {
      set = new Set();
      this.subs.set(pubId, set);
    }
    set.add(onScore);
    return {
      close: () => {
        set!.delete(onScore);
      },
    };
  }

  private broadcast(pubId: string, score: PubScore) {
    const set = this.subs.get(pubId);
    if (!set) return;
    for (const cb of set) cb(score);
  }
}

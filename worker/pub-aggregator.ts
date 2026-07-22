// PubAggregatorDO — one instance per pub id (TASKS.md §4/§5.3/§6).
// Owns the pub's materialized score and the live WebSocket fan-out for
// /ws/pub/:pubId. Recalculates the Bayesian weighted score on every new
// rating and broadcasts it to connected clients.

import type { Env, PubScore } from "./types";
import { weightedScore } from "./lib";

export class PubAggregatorDO {
  private env: Env;
  private sockets = new Set<WebSocket>();

  constructor(_state: DurableObjectState, env: Env) {
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pubId = url.searchParams.get("pubId") ?? "";

    // WebSocket subscribe
    if (url.pathname.endsWith("/ws")) {
      if (req.headers.get("upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      this.sockets.add(server);
      server.addEventListener("close", () => this.sockets.delete(server));
      server.addEventListener("error", () => this.sockets.delete(server));
      // push current score immediately
      const score = await this.currentScore(pubId);
      server.send(JSON.stringify({ t: "pubScore", pubId, score }));
      return new Response(null, { status: 101, webSocket: client });
    }

    // recalc + broadcast (called by the queue consumer after a rating lands)
    if (url.pathname.endsWith("/recalc") && req.method === "POST") {
      const score = await this.recalc(pubId);
      this.broadcast(pubId, score);
      return new Response(JSON.stringify(score), {
        headers: { "content-type": "application/json" },
      });
    }

    // read current score
    if (url.pathname.endsWith("/score")) {
      return new Response(JSON.stringify(await this.currentScore(pubId)), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  }

  private async currentScore(pubId: string): Promise<PubScore> {
    const row = await this.env.DB.prepare(
      "SELECT pub_id, avg_rating, weighted_score, rating_count FROM pub_scores WHERE pub_id = ?",
    )
      .bind(pubId)
      .first<PubScore>();
    return row ?? { pub_id: pubId, avg_rating: 0, weighted_score: 0, rating_count: 0 };
  }

  private async recalc(pubId: string): Promise<PubScore> {
    const agg = await this.env.DB.prepare(
      "SELECT COUNT(rating) AS v, AVG(rating) AS r FROM submissions WHERE pub_id = ? AND rating IS NOT NULL",
    )
      .bind(pubId)
      .first<{ v: number; r: number | null }>();
    const v = agg?.v ?? 0;
    const r = agg?.r ?? 0;
    // refresh the global mean snapshot from all rated submissions
    const gm = await this.env.DB.prepare(
      "SELECT AVG(rating) AS m FROM submissions WHERE rating IS NOT NULL",
    ).first<{ m: number | null }>();
    const globalMean = gm?.m ?? 3.5;
    await this.env.GLOBAL_CACHE.put("global_mean", String(globalMean), { expirationTtl: 86400 });

    const weighted = weightedScore(r, v, globalMean);
    const score: PubScore = {
      pub_id: pubId,
      avg_rating: Number(r.toFixed(3)),
      weighted_score: Number(weighted.toFixed(3)),
      rating_count: v,
    };
    await this.env.DB.prepare(
      `INSERT INTO pub_scores (pub_id, avg_rating, weighted_score, rating_count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pub_id) DO UPDATE SET
         avg_rating = excluded.avg_rating,
         weighted_score = excluded.weighted_score,
         rating_count = excluded.rating_count`,
    )
      .bind(pubId, score.avg_rating, score.weighted_score, score.rating_count)
      .run();
    return score;
  }

  private broadcast(pubId: string, score: PubScore): void {
    const msg = JSON.stringify({ t: "pubScore", pubId, score });
    for (const ws of this.sockets) {
      try {
        ws.send(msg);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }
}

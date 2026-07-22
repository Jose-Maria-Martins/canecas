// DemoSimulatorDO — writes clearly-labeled fake activity into `activities`
// (TASKS.md §6) so the buddy feed looks alive during the demo without real
// concurrent users. Every row is demo=1 with a synthetic `demo_`-prefixed
// user id — it never touches pub_scores or attributes to a real user.

import type { Env } from "./types";
import { ulid } from "./lib";

const DEMO_USERS = [
  "Mariana (demo)",
  "Tiago (demo)",
  "Sofia (demo)",
  "João (demo)",
  "Beatriz (demo)",
  "André (demo)",
];

const DEMO_TYPES = ["submission", "check_in", "level_up", "challenge_complete"] as const;

const TICK_MS = 5000; // one fake event every ~5s while running

export class DemoSimulatorDO {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/start")) {
      await this.state.storage.put("running", true);
      const existing = await this.state.storage.getAlarm();
      if (existing == null) await this.state.storage.setAlarm(Date.now() + TICK_MS);
      return new Response("started");
    }
    if (url.pathname.endsWith("/stop")) {
      await this.state.storage.put("running", false);
      await this.state.storage.deleteAlarm();
      return new Response("stopped");
    }
    if (url.pathname.endsWith("/tick")) {
      await this.emitOne();
      return new Response("tick");
    }
    return new Response("not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const running = (await this.state.storage.get<boolean>("running")) ?? false;
    if (!running) return;
    await this.emitOne();
    await this.state.storage.setAlarm(Date.now() + TICK_MS);
  }

  private async emitOne(): Promise<void> {
    const name = DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)];
    const type = DEMO_TYPES[Math.floor(Math.random() * DEMO_TYPES.length)];
    const pub = await this.env.DB.prepare(
      "SELECT id, name FROM pubs ORDER BY RANDOM() LIMIT 1",
    ).first<{ id: string; name: string }>();
    const now = Date.now();
    await this.env.DB.prepare(
      `INSERT INTO activities (id, user_id, display_name, type, target_id, target_name, ts, demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    )
      .bind(
        ulid(now),
        `demo_${name.replace(/\W+/g, "").toLowerCase()}`,
        name,
        type,
        type === "level_up" ? null : (pub?.id ?? null),
        type === "level_up" ? null : (pub?.name ?? null),
        now,
      )
      .run();
    // keep the demo table from growing unbounded during a long-running demo
    await this.env.DB.prepare(
      "DELETE FROM activities WHERE demo = 1 AND ts < ?",
    )
      .bind(now - 60 * 60 * 1000)
      .run();
  }
}

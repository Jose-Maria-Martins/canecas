import { DurableObject } from "cloudflare:workers";
import type { Env, MapSubmission } from "./worker-types";

interface MapSubmissionRow extends Record<string, SqlStorageValue> {
  submission_id: string;
  latitude: number;
  longitude: number;
  score: number;
  reason: string;
  created_at: number;
}

export class MapSubmissions extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS map_submissions (
        submission_id TEXT PRIMARY KEY,
        latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
        longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
        score REAL NOT NULL CHECK (score >= 0 AND score <= 5),
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  upsert(submission: MapSubmission): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO map_submissions
        (submission_id, latitude, longitude, score, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(submission_id) DO UPDATE SET
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         score = excluded.score,
         reason = excluded.reason`,
      submission.submissionId,
      submission.latitude,
      submission.longitude,
      submission.score,
      submission.reason,
      submission.createdAt,
    );
  }

  list(limit = 100): MapSubmission[] {
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 250));
    return this.ctx.storage.sql
      .exec<MapSubmissionRow>(
        `SELECT submission_id, latitude, longitude, score, reason, created_at
         FROM map_submissions
         ORDER BY created_at DESC
         LIMIT ?`,
        safeLimit,
      )
      .toArray()
      .map((row) => ({
        submissionId: row.submission_id,
        latitude: row.latitude,
        longitude: row.longitude,
        score: row.score,
        reason: row.reason,
        createdAt: row.created_at,
      }));
  }
}

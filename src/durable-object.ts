import { DurableObject } from "cloudflare:workers";
import type {
  Env,
  PhotoAssessment,
  PhotoResult,
  PhotoWorkflowParams,
} from "./worker-types";

interface PhotoResultRow extends Record<string, SqlStorageValue> {
  submission_id: string;
  object_key: string;
  content_type: string;
  pub_id: string | null;
  status: string;
  is_image: number | null;
  is_beer: number | null;
  score: number | null;
  reason: string | null;
  created_at: number;
  completed_at: number | null;
}

interface SocketAttachment {
  submissionId: string;
}

export class PhotoResults extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS photo_results (
        submission_id TEXT PRIMARY KEY,
        object_key TEXT NOT NULL,
        content_type TEXT NOT NULL,
        pub_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('processing', 'complete', 'rejected', 'failed')),
        is_image INTEGER,
        is_beer INTEGER,
        score REAL CHECK (score IS NULL OR (score >= 0 AND score <= 5)),
        reason TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);
    const columns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(photo_results)")
      .toArray();
    if (!columns.some((column) => column.name === "pub_id")) {
      this.ctx.storage.sql.exec("ALTER TABLE photo_results ADD COLUMN pub_id TEXT");
    }
  }

  fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    const match = new URL(request.url).pathname.match(
      /^\/api\/uploads\/([0-9a-f-]+)\/events$/,
    );
    const submissionId = match?.[1];
    const result = submissionId ? this.getResult(submissionId) : null;
    if (!submissionId || !result) {
      return new Response("Submission not found", { status: 404 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ submissionId } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(result));

    return new Response(null, { status: 101, webSocket: client });
  }

  createPending(params: PhotoWorkflowParams): void {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO photo_results
        (submission_id, object_key, content_type, pub_id, status, created_at)
       VALUES (?, ?, ?, ?, 'processing', ?)`,
      params.submissionId,
      params.objectKey,
      params.contentType,
      params.pubId,
      Date.now(),
    );
  }

  complete(submissionId: string, assessment: PhotoAssessment): void {
    const status = assessment.isImage && assessment.isBeer ? "complete" : "rejected";
    this.ctx.storage.sql.exec(
      `UPDATE photo_results
       SET status = ?, is_image = ?, is_beer = ?, score = ?, reason = ?, completed_at = ?
       WHERE submission_id = ? AND status = 'processing'`,
      status,
      assessment.isImage ? 1 : 0,
      assessment.isBeer ? 1 : 0,
      assessment.score,
      assessment.reason,
      Date.now(),
      submissionId,
    );
    this.broadcast(submissionId);
  }

  fail(submissionId: string, reason: string): void {
    this.ctx.storage.sql.exec(
      `UPDATE photo_results
       SET status = 'failed', reason = ?, completed_at = ?
       WHERE submission_id = ? AND status = 'processing'`,
      reason.slice(0, 280),
      Date.now(),
      submissionId,
    );
    this.broadcast(submissionId);
  }

  getResult(submissionId: string): PhotoResult | null {
    const row = this.ctx.storage.sql
      .exec<PhotoResultRow>(
        "SELECT * FROM photo_results WHERE submission_id = ?",
        submissionId,
      )
      .toArray()[0];

    if (!row) {
      return null;
    }

    return {
      submissionId: row.submission_id,
      objectKey: row.object_key,
      contentType: row.content_type as PhotoResult["contentType"],
      pubId: row.pub_id,
      status: row.status as PhotoResult["status"],
      isImage: row.is_image === null ? null : row.is_image === 1,
      isBeer: row.is_beer === null ? null : row.is_beer === 1,
      score: row.score,
      reason: row.reason ?? "",
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (message !== "status") {
      return;
    }

    const { submissionId } = ws.deserializeAttachment() as SocketAttachment;
    const result = this.getResult(submissionId);
    if (result) {
      ws.send(JSON.stringify(result));
    }
  }

  webSocketClose(): void {
    // Close frames are handled automatically on this compatibility date.
  }

  webSocketError(ws: WebSocket): void {
    ws.close(1011, "WebSocket error");
  }

  private broadcast(submissionId: string): void {
    const result = this.getResult(submissionId);
    if (!result) {
      return;
    }

    const payload = JSON.stringify(result);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.submissionId !== submissionId) {
        continue;
      }

      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "Could not deliver result");
      }
    }
  }
}

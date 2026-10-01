import { DurableObject } from "cloudflare:workers";

const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_CONCURRENT = 5;
const LEASE_MS = 15_000;

interface GuardDecision {
  allowed: boolean;
  code?: "RATE_LIMITED" | "CONCURRENCY_LIMITED";
  retryAfterSeconds?: number;
  token?: string;
}

export class IpGuard extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS rate_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rate_requests_created_at
          ON rate_requests(created_at);

        CREATE TABLE IF NOT EXISTS leases (
          token TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_leases_expires_at
          ON leases(expires_at);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/acquire") {
      const decision = this.acquire();

      return Response.json(decision, {
        status: decision.allowed ? 200 : 429,
        headers: {
          "cache-control": "no-store"
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/release") {
      const token = request.headers.get("x-whites-lease-token")?.trim();

      if (token) {
        this.ctx.storage.sql.exec(
          "DELETE FROM leases WHERE token = ?1",
          token
        );
      }

      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  }

  private acquire(): GuardDecision {
    const now = Date.now();
    const windowStart = now - RATE_WINDOW_MS;

    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM rate_requests WHERE created_at <= ?1",
        windowStart
      );

      this.ctx.storage.sql.exec(
        "DELETE FROM leases WHERE expires_at <= ?1",
        now
      );

      const requestCount = this.ctx.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM rate_requests WHERE created_at > ?1",
          windowStart
        )
        .one().count;

      if (requestCount >= MAX_REQUESTS_PER_WINDOW) {
        return {
          allowed: false as const,
          code: "RATE_LIMITED" as const,
          retryAfterSeconds: 60
        };
      }

      this.ctx.storage.sql.exec(
        "INSERT INTO rate_requests(created_at) VALUES (?1)",
        now
      );

      const activeCount = this.ctx.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM leases WHERE expires_at > ?1",
          now
        )
        .one().count;

      if (activeCount >= MAX_CONCURRENT) {
        return {
          allowed: false as const,
          code: "CONCURRENCY_LIMITED" as const,
          retryAfterSeconds: 1
        };
      }

      const token = crypto.randomUUID();

      this.ctx.storage.sql.exec(
        "INSERT INTO leases(token, expires_at) VALUES (?1, ?2)",
        token,
        now + LEASE_MS
      );

      return {
        allowed: true as const,
        token
      };
    });
  }
}

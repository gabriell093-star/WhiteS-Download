import { ResolverError } from "./core/errors.js";
import { ResolverEngine } from "./core/engine.js";
import { ProviderRegistry } from "./core/registry.js";
import { createDefaultProviders } from "./providers/index.js";
import { createBrowserAutomation } from "./browser/automation.js";
import { IpGuard } from "./security/ip-guard.js";

interface Env {
  BROWSER: unknown;
  IP_GUARD: DurableObjectNamespace<IpGuard>;
}

const registry = new ProviderRegistry();
for (const provider of createDefaultProviders()) registry.register(provider);

function getClientIp(request: Request): string {
  const ip = request.headers.get("cf-connecting-ip")?.trim();
  return ip && ip.length <= 64 ? ip : "unknown";
}

async function acquireIpGuard(
  request: Request,
  env: Env
): Promise<{ token: string } | Response> {
  const ip = getClientIp(request);
  const id = env.IP_GUARD.idFromName(`ip:${ip}`);
  const stub = env.IP_GUARD.get(id);

  const response = await stub.fetch(
    new Request("https://ip-guard/acquire", { method: "POST" })
  );

  if (response.ok) {
    const decision = (await response.json()) as { allowed: true; token: string };
    return { token: decision.token };
  }

  const decision = (await response.json()) as {
    allowed: false;
    code: "RATE_LIMITED" | "CONCURRENCY_LIMITED";
    retryAfterSeconds?: number;
  };

  const retryAfter = Math.max(1, decision.retryAfterSeconds ?? 1);
  const message =
    decision.code === "RATE_LIMITED"
      ? "Too many requests from this IP address."
      : "Too many concurrent resolutions from this IP address.";

  return Response.json(
    {
      ok: false,
      error: new ResolverError(decision.code, message, true).toJSON()
    },
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(retryAfter)
      }
    }
  );
}

async function releaseIpGuard(
  request: Request,
  env: Env,
  token: string
): Promise<void> {
  const ip = getClientIp(request);
  const id = env.IP_GUARD.idFromName(`ip:${ip}`);
  const stub = env.IP_GUARD.get(id);

  await stub.fetch(
    new Request("https://ip-guard/release", {
      method: "POST",
      headers: {
        "x-whites-lease-token": token
      }
    })
  );
}

export { IpGuard };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("WhiteS Download Worker is running.", {
        headers: {
          "content-type": "text/plain; charset=utf-8"
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/resolve") {
      const lease = await acquireIpGuard(request, env);
      if (lease instanceof Response) return lease;

      try {
        let body: unknown;

        try {
          body = await request.json();
        } catch {
          return Response.json(
            {
              ok: false,
              error: {
                code: "INVALID_URL",
                message: "Invalid JSON body.",
                retryable: false
              }
            },
            { status: 400 }
          );
        }

        if (
          typeof body !== "object" ||
          body === null ||
          typeof (body as { url?: unknown }).url !== "string"
        ) {
          return Response.json(
            {
              ok: false,
              error: {
                code: "INVALID_URL",
                message: "Body must contain a URL string.",
                retryable: false
              }
            },
            { status: 400 }
          );
        }

        const engine = new ResolverEngine(registry, {
          browser: createBrowserAutomation({ browser: env.BROWSER })
        });

        const result = await engine.resolve(
          (body as { url: string }).url
        );

        return Response.json(result, {
          status:
            result.ok
              ? 200
              : result.error.code === "UNSUPPORTED_PROVIDER"
                ? 422
                : 400,
          headers: {
            "cache-control": "no-store"
          }
        });
      } finally {
        try {
          await releaseIpGuard(request, env, lease.token);
        } catch {
          // A short lease expiry remains in force if release cannot be reached.
        }
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};

import { ResolverError } from "../core/errors.js";
import { Deadline, withTimeout } from "../core/deadline.js";
import { assertPublicEndpoint } from "../security/ssrf.js";
import { parseAndValidateUrl } from "../security/urlValidator.js";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface SafeHttpResponse {
  status: number;
  url: string;
  headers: Headers;
  body: string;
  redirects: number;
}

export interface HttpTransport {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

const defaultTransport: HttpTransport = {
  fetch: (input, init) => fetch(input, init)
};

interface Options {
  transport?: HttpTransport;
  maxRedirects?: number;
  maxBytes?: number;
  userAgent?: string;
}

export class SafeHttpClient {
  private readonly maxRedirects: number;
  private readonly maxBytes: number;
  private readonly userAgent: string;
  private readonly transport: HttpTransport;

  constructor(options: Options = {}) {
    this.transport = options.transport ?? defaultTransport;
    this.maxRedirects = options.maxRedirects ?? 10;
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
    this.userAgent = options.userAgent ?? "WhiteSResolver/0.1";
  }

  async fetchText(
    rawUrl: URL | string,
    deadline: Deadline
  ): Promise<SafeHttpResponse> {
    let current = parseAndValidateUrl(rawUrl.toString());
    let redirects = 0;

    while (true) {
      deadline.throwIfExpired();
      await assertPublicEndpoint(current, deadline);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline.remainingMs()));

      let response: Response;
      try {
        response = await withTimeout(
          this.transport.fetch(current, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: {
              "user-agent": this.userAgent,
              "accept": "text/html,application/xhtml+xml,*/*;q=0.8"
            }
          }),
          Math.max(1, deadline.remainingMs()),
          () => new ResolverError("RESOLUTION_TIMEOUT", "HTTP request timed out.", true)
        );
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ResolverError("RESOLUTION_TIMEOUT", "HTTP request timed out.", true);
        }
        if (error instanceof ResolverError) throw error;
        throw new ResolverError("RESOLUTION_FAILED", "HTTP request failed.", true, { cause: error });
      } finally {
        clearTimeout(timeout);
      }

      const location = response.headers.get("location");

      if (REDIRECTS.has(response.status) && location) {
        if (redirects >= this.maxRedirects) {
          throw new ResolverError(
            "TOO_MANY_REDIRECTS",
            `Redirect limit of ${this.maxRedirects} exceeded.`
          );
        }

        redirects += 1;
        try {
          current = parseAndValidateUrl(new URL(location, current).toString());
        } catch (error) {
          if (error instanceof ResolverError) throw error;
          throw new ResolverError("RESOLUTION_FAILED", "Invalid redirect location.");
        }
        continue;
      }

      const body = await this.readBody(response, deadline);
      return {
        status: response.status,
        url: current.toString(),
        headers: response.headers,
        body,
        redirects
      };
    }
  }

  private async readBody(response: Response, deadline: Deadline): Promise<string> {
    if (!response.body) return "";

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (true) {
        deadline.throwIfExpired();
        const result = await withTimeout(
          reader.read(),
          Math.max(1, deadline.remainingMs()),
          () => new ResolverError("RESOLUTION_TIMEOUT", "Response body read timed out.", true)
        );

        if (result.done) break;

        total += result.value.byteLength;
        if (total > this.maxBytes) {
          throw new ResolverError("RESOLUTION_FAILED", "Response body exceeds the configured size limit.");
        }

        chunks.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }

    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(output);
  }
}
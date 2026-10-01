import { ResolverError } from "./errors.js";
import { Deadline, withTimeout } from "./deadline.js";
import type { ProviderContext } from "./provider.js";
import type { ProviderRegistry } from "./registry.js";
import type { ResolverResult } from "./types.js";
import { SafeHttpClient } from "../http/client.js";
import { parseAndValidateUrl } from "../security/urlValidator.js";
import { assertPublicEndpoint } from "../security/ssrf.js";
import { browserUnavailable } from "../browser/unavailable.js";

export interface ResolverEngineOptions {
  browser?: ProviderContext["browser"];
}

export class ResolverEngine {
  private readonly http = new SafeHttpClient();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly options: ResolverEngineOptions = {}
  ) {}

  async resolve(rawUrl: string): Promise<ResolverResult> {
    let providerId: string | null = null;

    try {
      const url = parseAndValidateUrl(rawUrl);
      const provider = this.registry.detect(url);

      if (!provider) {
        throw new ResolverError("UNSUPPORTED_PROVIDER", "This provider is not supported.");
      }

      providerId = provider.meta.id;

      const deadline = new Deadline(20_000);
      const context: ProviderContext = {
        http: this.http,
        deadline,
        browser: this.options.browser ?? browserUnavailable()
      };

      const success = await withTimeout(
        provider.resolve(url, context),
        deadline.remainingMs(),
        () => new ResolverError("RESOLUTION_TIMEOUT", "Resolution timed out.", true)
      );

      const destination = parseAndValidateUrl(success.destinationUrl);
      await assertPublicEndpoint(destination, deadline);

      const probe = await this.http.probe(destination, deadline, {
        headers: {
          referer: new URL(rawUrl).origin + "/"
        }
      });

      if (probe.status >= 400) {
        throw new ResolverError(
          "DESTINATION_NOT_FOUND",
          "The resolved destination is not reachable."
        );
      }

      const contentType = probe.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.startsWith("text/html") &&
          !/(download|attachment|octet-stream)/i.test(probe.headers.get("content-disposition") ?? "")) {
        throw new ResolverError(
          "DESTINATION_NOT_FOUND",
          "The resolved destination is still a web page."
        );
      }

      return {
        ok: true,
        providerId,
        destinationUrl: probe.url,
        meta: success.meta
      };
    } catch (error) {
      if (error instanceof ResolverError) {
        return {
          ok: false,
          providerId,
          error: error.toJSON()
        };
      }

      return {
        ok: false,
        providerId,
        error: new ResolverError(
          "RESOLUTION_FAILED",
          "Resolution failed unexpectedly.",
          true
        ).toJSON()
      };
    }
  }
}
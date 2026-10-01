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

      const deadline = new Deadline(15_000);
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

      return {
        ok: true,
        providerId,
        destinationUrl: destination.toString(),
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
import { ResolverError } from "../../core/errors.js";
import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";

const HOSTNAMES = [
  "dood.re",
  "doodstream.com",
  "dood.to",
  "dood.so",
  "dood.watch"
] as const;

function randomToken(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";

  for (const byte of bytes) {
    result += alphabet[byte % alphabet.length];
  }

  return result;
}

export class DoodProvider implements Provider {
  readonly meta = {
    id: "dood",
    label: "DoodStream",
    hostnames: HOSTNAMES,
    enabled: true,
    requiresBrowser: false
  } as const;

  detect(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return HOSTNAMES.some((candidate) => host === candidate || host.endsWith("." + candidate));
  }

  async resolve(url: URL, ctx: ProviderContext): Promise<ResolutionSuccess> {
    const page = await ctx.http.fetchText(url, ctx.deadline, {
      headers: {
        referer: url.origin + "/",
        accept: "text/html,application/xhtml+xml"
      }
    });

    if (page.status === 404 || page.status === 410) {
      throw new ResolverError(
        "DESTINATION_NOT_FOUND",
        "The DoodStream page does not exist."
      );
    }

    const match = page.body.match(
      /\/pass_md5\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/i
    );

    if (!match?.[0] || !match[1]) {
      const browserUrl = await import("../browser-lane.js").then(({ runBrowserFlow }) =>
        runBrowserFlow(url, ctx, HOSTNAMES, [
          "a[href*='/e/']",
          "#download",
          "#downloadBtn",
          "#dl"
        ], 10)
      );

      return {
        ok: true,
        providerId: this.meta.id,
        destinationUrl: browserUrl
      };
    }

    const token = match[1];
    const base = await ctx.http.fetchText(
      new URL(match[0], page.url),
      ctx.deadline,
      {
        headers: {
          referer: page.url,
          accept: "text/plain,*/*;q=0.8"
        }
      }
    );

    const baseUrl = base.body.trim().replace(/\\/g, "");
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new ResolverError(
        "PROVIDER_CHANGED",
        "DoodStream returned an invalid media base URL."
      );
    }

    let destination: URL;
    if (/cloudflarestorage/i.test(baseUrl) && !/[?&]token=/i.test(baseUrl)) {
      destination = new URL(baseUrl);
    } else if (/[?&]token=/i.test(baseUrl)) {
      destination = new URL(baseUrl);
    } else {
      destination = new URL(
        baseUrl +
        randomToken() +
        "?token=" +
        encodeURIComponent(token) +
        "&expiry=" +
        Date.now()
      );
    }

    return {
      ok: true,
      providerId: this.meta.id,
      destinationUrl: destination.toString()
    };
  }
}

import { ResolverError } from "../../core/errors.js";
import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";

const HOSTNAMES = ["sfile.co", "sfile.mobi"] as const;

function sameHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return HOSTNAMES.some((candidate) => host === candidate || host.endsWith("." + candidate));
}

export class SfileProvider implements Provider {
  readonly meta = {
    id: "sfile",
    label: "Sfile",
    hostnames: HOSTNAMES,
    enabled: false,
    requiresBrowser: false
  } as const;

  detect(url: URL): boolean {
    return sameHost(url.hostname);
  }

  async resolve(url: URL, ctx: ProviderContext): Promise<ResolutionSuccess> {
    const page = await ctx.http.fetchText(url, ctx.deadline);

    if (page.status === 404 || page.status === 410) {
      throw new ResolverError(
        "DESTINATION_NOT_FOUND",
        "The Sfile page does not exist or has expired."
      );
    }

    if (page.status >= 400) {
      throw new ResolverError(
        "RESOLUTION_FAILED",
        "Sfile returned HTTP " + page.status + ".",
        true
      );
    }

    const current = new URL(page.url);
    if (!sameHost(current.hostname)) {
      return {
        ok: true,
        providerId: this.meta.id,
        destinationUrl: current.toString()
      };
    }

    const anchorRe = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;

    for (const match of page.body.matchAll(anchorRe)) {
      const href = match[1] ?? match[2] ?? match[3] ?? "";
      const text = (match[4] ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!href) continue;

      try {
        const candidate = new URL(href, page.url);
        if (candidate.protocol !== "http:" && candidate.protocol !== "https:") continue;

        if (!sameHost(candidate.hostname) &&
            (/download|direct|save/i.test(text) || /\/downloadfile\//i.test(candidate.pathname))) {
          return {
            ok: true,
            providerId: this.meta.id,
            destinationUrl: candidate.toString()
          };
        }
      } catch {}
    }

    const scriptTarget = page.body.match(
      /(?:window\.location|location)\.(?:href|replace)\s*(?:=|\()\s*["'](https?:\/\/[^"']+)["']/i
    );

    if (scriptTarget?.[1]) {
      return {
        ok: true,
        providerId: this.meta.id,
        destinationUrl: new URL(scriptTarget[1]).toString()
      };
    }

    throw new ResolverError(
      "PROVIDER_CHANGED",
      "No direct download link was found on the Sfile page."
    );
  }
}

import { ResolverError } from "../../core/errors.js";
import type { Provider } from "../../core/provider.js";
import type { ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";
import { extractAnchors } from "../../html/extract.js";

const HOSTNAMES = ["sfile.mobi"] as const;
const FILE_EXT_RE = /\.(apk|zip|rar|7z|exe|pdf|mp3|mp4|mkv|iso|tar|gz|dmg|ipa)$/i;

export class SfileProvider implements Provider {
  readonly meta = {
    id: "sfile",
    label: "Sfile.mobi",
    hostnames: HOSTNAMES,
    enabled: true,
    requiresBrowser: false
  } as const;

  detect(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host === "sfile.mobi" || host === "www.sfile.mobi";
  }

  async resolve(url: URL, ctx: ProviderContext): Promise<ResolutionSuccess> {
    const page = await ctx.http.fetchText(url, ctx.deadline);

    if (page.status === 404 || page.status === 410) {
      throw new ResolverError(
        "DESTINATION_NOT_FOUND",
        "The Sfile.mobi page does not exist or has expired."
      );
    }

    if (page.status >= 400) {
      throw new ResolverError(
        "RESOLUTION_FAILED",
        `Sfile.mobi returned HTTP ${page.status}.`,
        true
      );
    }

    const candidates: URL[] = [];

    for (const anchor of extractAnchors(page.body)) {
      try {
        const candidate = new URL(anchor.href, page.url);
        if (candidate.protocol !== "http:" && candidate.protocol !== "https:") continue;
        if (candidate.toString() === page.url) continue;
        if (FILE_EXT_RE.test(candidate.pathname)) {
          candidates.push(candidate);
        }
      } catch {
        // Ignore malformed anchors.
      }
    }

    const destination = candidates[0];
    if (!destination) {
      throw new ResolverError(
        "PROVIDER_CHANGED",
        "No direct download link was found. Sfile.mobi may have changed its page structure."
      );
    }

    return {
      ok: true,
      providerId: this.meta.id,
      destinationUrl: destination.toString()
    };
  }
}
import { ResolverError } from "../../core/errors.js";
import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";
import { runBrowserFlow } from "../browser-lane.js";

const HOSTNAMES = ["sfile.co", "sfile.mobi"] as const;

function sameHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return HOSTNAMES.some((candidate) => host === candidate || host.endsWith("." + candidate));
}

function findHttpTargets(body: string, baseUrl: string): string[] {
  const targets: string[] = [];
  const add = (raw: string | undefined) => {
    if (!raw || !/^https?:\/\//i.test(raw)) return;
    try {
      targets.push(new URL(raw.replace(/&amp;/g, "&"), baseUrl).toString());
    } catch {}
  };

  const direct = body.match(
    /(?:data-direct-download|data-direct-smartlink|href)\s*=\s*(?:"|')?(https?:\/\/[^"'\s>]+)/gi
  );
  for (const raw of direct ?? []) {
    add(raw.replace(/^(?:data-direct-download|data-direct-smartlink|href)\s*=\s*(?:"|')?/i, ""));
  }

  for (const match of body.matchAll(/https?:\/\/[^"'\s<>]+/gi)) {
    const raw = match[0];
    if (/\/download\/|\.(zip|rar|7z|tar|gz|bz2|apk|exe|msi|iso|pdf|mp4|mkv|avi|mov|mp3|m4a|flac|wav)(?:[?#]|$)/i.test(raw)) {
      add(raw);
    }
  }

  return [...new Set(targets)];
}

export class SfileProvider implements Provider {
  readonly meta = {
    id: "sfile",
    label: "Sfile",
    hostnames: HOSTNAMES,
    enabled: true,
    requiresBrowser: true
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
    const downloadPages: string[] = [];

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

        if (
          sameHost(candidate.hostname) &&
          /^\/download\//i.test(candidate.pathname) &&
          (candidate.searchParams.has("fid") || /download file|download now/i.test(text))
        ) {
          downloadPages.push(candidate.toString());
          continue;
        }

        if (
          !sameHost(candidate.hostname) &&
          (/download|direct|save/i.test(text) || /\/downloadfile\//i.test(candidate.pathname))
        ) {
          return {
            ok: true,
            providerId: this.meta.id,
            destinationUrl: candidate.toString()
          };
        }
      } catch {}
    }

    const directTargets = findHttpTargets(page.body, page.url);
    for (const target of directTargets) {
      const candidate = new URL(target);
      if (!sameHost(candidate.hostname)) {
        return {
          ok: true,
          providerId: this.meta.id,
          destinationUrl: candidate.toString()
        };
      }
    }

    for (const downloadUrl of [...new Set(downloadPages)]) {
      try {
        const downloadPage = await ctx.http.fetchText(
          downloadUrl,
          ctx.deadline,
          { headers: { referer: page.url, accept: "text/html,application/xhtml+xml" } }
        );

        const targets = findHttpTargets(downloadPage.body, downloadPage.url);
        for (const target of targets) {
          const candidate = new URL(target);
          if (!sameHost(candidate.hostname)) {
            return {
              ok: true,
              providerId: this.meta.id,
              destinationUrl: candidate.toString()
            };
          }

          if (/\/download\/[^/]+\/[^/]+\//i.test(candidate.pathname)) {
            return {
              ok: true,
              providerId: this.meta.id,
              destinationUrl: candidate.toString()
            };
          }
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

    return {
      ok: true,
      providerId: this.meta.id,
      destinationUrl: await runBrowserFlow(
        url,
        ctx,
        HOSTNAMES,
        [
          "#download",
          "#downloadBtn",
          "#downloadbtn",
          "#download-now",
          "#dl",
          "button#dl",
          "a#download"
        ],
        12
      )
    };
  }
}

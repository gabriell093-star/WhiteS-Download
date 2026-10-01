import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";
import { runBrowserFlow } from "../browser-lane.js";

const HOSTNAMES = [
  "sfl.gl",
  "safelinku.com",
  "linku.to",
  "semawur.com"
] as const;

function sameHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return HOSTNAMES.some((candidate) => host === candidate || host.endsWith("." + candidate));
}

export class SafelinkuProvider implements Provider {
  readonly meta = {
    id: "safelinku",
    label: "SafelinkU / SFL",
    hostnames: HOSTNAMES,
    enabled: false,
    requiresBrowser: true
  } as const;

  detect(url: URL): boolean {
    return sameHost(url.hostname);
  }

  async resolve(url: URL, ctx: ProviderContext): Promise<ResolutionSuccess> {
    try {
      const response = await ctx.http.fetchText(url, ctx.deadline);
      const finalUrl = new URL(response.url);

      if (!sameHost(finalUrl.hostname)) {
        return {
          ok: true,
          providerId: this.meta.id,
          destinationUrl: finalUrl.toString()
        };
      }

      const encodedTargets = response.body.match(
        /https?:\/\/[^"'<>\s]+/gi
      ) ?? [];

      for (const raw of encodedTargets) {
        try {
          const candidate = new URL(raw.replace(/&amp;/g, "&"));
          if (!sameHost(candidate.hostname)) {
            return {
              ok: true,
              providerId: this.meta.id,
              destinationUrl: candidate.toString()
            };
          }
        } catch {}
      }
    } catch {}

    return {
      ok: true,
      providerId: this.meta.id,
      destinationUrl: await runBrowserFlow(
        url,
        ctx,
        HOSTNAMES,
        [
          "#submit-button",
          "#btn-2",
          "#verify > a",
          "#verify > button",
          "#first_open_button_page_1",
          "#second_open_placeholder a",
          "#btn-3"
        ]
      )
    };
  }
}

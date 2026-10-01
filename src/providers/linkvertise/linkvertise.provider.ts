import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";
import { runBrowserFlow } from "../browser-lane.js";

const HOSTNAMES = ["linkvertise.com", "linkvertise.net", "link-to.net"] as const;

function sameHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return HOSTNAMES.some((candidate) => host === candidate || host.endsWith("." + candidate));
}

export class LinkvertiseProvider implements Provider {
  readonly meta = {
    id: "linkvertise",
    label: "Linkvertise",
    hostnames: HOSTNAMES,
    enabled: true,
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
    } catch {}

    return {
      ok: true,
      providerId: this.meta.id,
      destinationUrl: await runBrowserFlow(
        url,
        ctx,
        HOSTNAMES,
        [],
        10
      )
    };
  }
}

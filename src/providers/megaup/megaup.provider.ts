import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";
import { runBrowserFlow } from "../browser-lane.js";

const HOSTNAMES = ["megaup.net"] as const;

export class MegaupProvider implements Provider {
  readonly meta = {
    id: "megaup",
    label: "MegaUp",
    hostnames: HOSTNAMES,
    enabled: false,
    requiresBrowser: true
  } as const;

  detect(url: URL): boolean {
    return HOSTNAMES.some((candidate) => {
      const host = url.hostname.toLowerCase();
      return host === candidate || host.endsWith("." + candidate);
    });
  }

  async resolve(url: URL, ctx: ProviderContext): Promise<ResolutionSuccess> {
    return {
      ok: true,
      providerId: this.meta.id,
      destinationUrl: await runBrowserFlow(
        url,
        ctx,
        HOSTNAMES,
        [
          ".download-timer > a",
          "#direct_link > a",
          "a[href*='download.megaup.net']",
          "#download-now"
        ],
        8
      )
    };
  }
}

import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";
import { runBrowserFlow } from "../browser-lane.js";

const HOSTNAMES = ["dropgalaxy.com", "dropgalaxy.co"] as const;

export class DropgalaxyProvider implements Provider {
  readonly meta = {
    id: "dropgalaxy",
    label: "DropGalaxy",
    hostnames: HOSTNAMES,
    enabled: false,
    requiresBrowser: true
  } as const;

  detect(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return HOSTNAMES.some((candidate) => host === candidate || host.endsWith("." + candidate));
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
          "#method_free",
          "#downloadBtnClick",
          "#downloadbtn",
          "#downloadBtn",
          "#dl",
          "button#dl",
          "#dllink"
        ],
        10
      )
    };
  }
}

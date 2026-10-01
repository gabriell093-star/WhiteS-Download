import { ResolverError } from "../../core/errors.js";
import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";
import { runBrowserFlow } from "../browser-lane.js";

const HOSTNAMES = ["ouo.io", "ouo.press"] as const;

function sameHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return HOSTNAMES.some((candidate) => host === candidate || host.endsWith("." + candidate));
}

export class OuoProvider implements Provider {
  readonly meta = {
    id: "ouo",
    label: "Ouo",
    hostnames: HOSTNAMES,
    enabled: false,
    requiresBrowser: true
  } as const;

  detect(url: URL): boolean {
    return sameHost(url.hostname);
  }

  async resolve(url: URL, ctx: ProviderContext): Promise<ResolutionSuccess> {
    let page;
    try {
      page = await ctx.http.fetchText(url, ctx.deadline);
      const finalUrl = new URL(page.url);

      if (!sameHost(finalUrl.hostname)) {
        return {
          ok: true,
          providerId: this.meta.id,
          destinationUrl: finalUrl.toString()
        };
      }

      if (/captcha|recaptcha|hcaptcha|turnstile/i.test(page.body)) {
        throw new ResolverError(
          "RESOLUTION_UNSUPPORTED",
          "Ouo requires a CAPTCHA or verification challenge."
        );
      }
    } catch (error) {
      if (error instanceof ResolverError && error.code === "RESOLUTION_UNSUPPORTED") {
        throw error;
      }
    }

    return {
      ok: true,
      providerId: this.meta.id,
      destinationUrl: await runBrowserFlow(
        url,
        ctx,
        HOSTNAMES,
        [
          "form:not(#form-captcha) button[type='submit']",
          "form:not(#form-captcha) input[type='submit']"
        ],
        6
      )
    };
  }
}

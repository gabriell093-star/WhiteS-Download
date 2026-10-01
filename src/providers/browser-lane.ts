import { ResolverError } from "../core/errors.js";
import type { ProviderContext } from "../core/provider.js";
import { assertPublicEndpoint } from "../security/ssrf.js";

function sameProviderHost(hostname: string, hosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return hosts.some((candidate) => {
    const c = candidate.toLowerCase();
    return host === c || host.endsWith("." + c);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBrowserFlow(
  url: URL,
  ctx: ProviderContext,
  providerHosts: readonly string[],
  selectors: readonly string[],
  maxSteps = 10
): Promise<string> {
  const remaining = Math.min(
    12_000,
    Math.max(2_000, ctx.deadline.remainingMs() - 500)
  );
  const page = await ctx.browser.open(url, {
    timeoutMs: Math.min(10_000, remaining)
  });

  try {
    await page.evaluate(() => {
      try {
        window.open = () => null;
      } catch {}
    });

    const endAt = Date.now() + remaining;

    for (let step = 0; step < maxSteps && Date.now() < endAt; step += 1) {
      ctx.deadline.throwIfExpired();

      const state = await page.evaluate(() => {
        const visible = (el: Element) => {
          const node = el as HTMLElement;
          const style = getComputedStyle(node);
          return style.display !== "none" &&
            style.visibility !== "hidden" &&
            node.offsetParent !== null;
        };

        const pageText = document.body?.innerText ?? "";
        const captcha = Boolean(
          document.querySelector(
            'iframe[src*="captcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, [data-sitekey], [name*="captcha" i], [id*="captcha" i]'
          )
        ) || /captcha|recaptcha|hcaptcha|turnstile/i.test(pageText);

        const candidate = Array.from(document.querySelectorAll("a[href]"))
          .map((anchor) => {
            const a = anchor as HTMLAnchorElement;
            return {
              href: a.href,
              text: (a.innerText || a.textContent || "").trim()
            };
          })
          .find((entry) =>
            /^(open link|download|direct download|get link|continue|go to link)$/i.test(entry.text)
          );

        const actions = [
          "#submit-button",
          "#btn-2",
          "#btn-3",
          "#verify > a",
          "#verify > button",
          "#first_open_button_page_1",
          "#second_open_placeholder a",
          "#method_free",
          "#downloadBtnClick",
          "#downloadbtn",
          "#downloadBtn",
          "#direct_link > a",
          ".download-timer > a",
          "#download-now",
          "#dl",
          "button#dl",
          "a#download"
        ].filter((selector) => {
          const el = document.querySelector(selector);
          return Boolean(el && visible(el));
        });

        return {
          url: location.href,
          captcha,
          candidate: candidate?.href ?? null,
          actions
        };
      });

      if (state.captcha) {
        throw new ResolverError(
          "RESOLUTION_UNSUPPORTED",
          "The provider requires a CAPTCHA or browser challenge."
        );
      }

      const current = new URL(state.url);
      if (!sameProviderHost(current.hostname, providerHosts)) {
        await assertPublicEndpoint(current, ctx.deadline);
        return current.toString();
      }

      if (state.candidate) {
        const candidate = new URL(state.candidate);
        if (!sameProviderHost(candidate.hostname, providerHosts)) {
          await assertPublicEndpoint(candidate, ctx.deadline);
          return candidate.toString();
        }
      }

      let selector: string | null = null;
      for (const item of selectors) {
        if (state.actions.includes(item)) {
          selector = item;
          break;
        }
      }

      if (selector) {
        try {
          await page.click(selector);
        } catch {
          // A navigation may detach the old execution context.
        }
        await sleep(350);
        continue;
      }

      await sleep(400);
    }

    const finalUrl = new URL(page.url());
    if (!sameProviderHost(finalUrl.hostname, providerHosts)) {
      await assertPublicEndpoint(finalUrl, ctx.deadline);
      return finalUrl.toString();
    }

    throw new ResolverError(
      "DESTINATION_NOT_FOUND",
      "The provider did not expose a final destination URL."
    );
  } finally {
    await page.close();
  }
}

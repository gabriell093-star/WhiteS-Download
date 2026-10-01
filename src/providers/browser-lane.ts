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

function isLikelyDownloadResponse(entry: {
  url: string;
  status: number;
  contentType: string;
  contentDisposition: string;
}): boolean {
  if (entry.status < 200 || entry.status >= 400) return false;

  const contentType = entry.contentType.toLowerCase();
  const disposition = entry.contentDisposition.toLowerCase();
  const path = (() => {
    try {
      return new URL(entry.url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (/attachment|filename\s*=/.test(disposition)) return true;

  if (
    contentType.startsWith("application/octet-stream") ||
    contentType.startsWith("application/zip") ||
    contentType.startsWith("application/x-rar") ||
    contentType.startsWith("application/x-7z") ||
    contentType.startsWith("application/x-gzip") ||
    contentType.startsWith("application/pdf") ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/")
  ) {
    return true;
  }

  return /\.(zip|rar|7z|tar|gz|bz2|apk|exe|msi|iso|pdf|mp4|mkv|avi|mov|mp3|m4a|flac|wav)(?:$|[?#])/i.test(path);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isActionText(value: string): boolean {
  return /^(download(?: file| now)?|direct download|get link|continue|go to link|start download|generate link|create link|free download|download free|download file|save file)$/i.test(
    normalizeText(value)
  );
}

export async function runBrowserFlow(
  url: URL,
  ctx: ProviderContext,
  providerHosts: readonly string[],
  selectors: readonly string[],
  maxSteps = 12
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
          const rect = node.getBoundingClientRect();
          return style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0;
        };

        const pageText = document.body?.innerText ?? "";
        const captcha = Boolean(
          document.querySelector(
            'iframe[src*="captcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, [data-sitekey], [name*="captcha" i], [id*="captcha" i]'
          )
        ) || /\bcaptcha\b|recaptcha|hcaptcha|turnstile/i.test(pageText);

        const candidate = Array.from(document.querySelectorAll("a[href]"))
          .map((anchor) => {
            const a = anchor as HTMLAnchorElement;
            return {
              href: a.href,
              text: normalizeText(a.innerText || a.textContent || "")
            };
          })
          .find((entry) => isActionText(entry.text) && entry.href);

        let actionIndex = 0;
        const actions: string[] = [];

        const elements = Array.from(
          document.querySelectorAll(
            "button, input[type='submit'], input[type='button'], a[href]"
          )
        );

        for (const element of elements) {
          if (!visible(element)) continue;

          const node = element as HTMLElement;
          const textValue = normalizeText(
            "value" in element
              ? String((element as HTMLInputElement).value || "")
              : node.innerText || node.textContent || ""
          );

          const href =
            element instanceof HTMLAnchorElement
              ? element.href
              : element.getAttribute("data-href") ||
                element.getAttribute("data-url") ||
                element.getAttribute("data-download") ||
                element.getAttribute("data-link") ||
                "";

          const onclick = element.getAttribute("onclick") || "";
          const actionable =
            isActionText(textValue) ||
            /download|direct|continue|get link|generate|create link/i.test(
              [href, onclick, element.id, element.className?.toString() ?? ""].join(" ")
            );

          if (!actionable) continue;

          const selector = '[data-whites-action="' + actionIndex + '"]';
          element.setAttribute("data-whites-action", String(actionIndex));
          actions.push(selector);
          actionIndex += 1;
        }

        const directTargets: string[] = [];

        for (const element of elements) {
          if (!visible(element)) continue;

          const values = [
            element.getAttribute("data-href"),
            element.getAttribute("data-url"),
            element.getAttribute("data-download"),
            element.getAttribute("data-link")
          ];

          for (const value of values) {
            if (value && /^https?:\/\//i.test(value)) {
              directTargets.push(value);
            }
          }

          const onclick = element.getAttribute("onclick") || "";
          for (const match of onclick.matchAll(/https?:\/\/[^"'\s)]+/gi)) {
            directTargets.push(match[0]);
          }
        }

        return {
          url: location.href,
          captcha,
          candidate: candidate?.href ?? null,
          actions,
          directTargets
        };
      });

      if (state.captcha) {
        throw new ResolverError(
          "RESOLUTION_UNSUPPORTED",
          "The provider requires a CAPTCHA or browser challenge."
        );
      }

      for (const raw of state.directTargets) {
        try {
          const candidate = new URL(raw, state.url);
          if (!sameProviderHost(candidate.hostname, providerHosts)) {
            await assertPublicEndpoint(candidate, ctx.deadline);
            return candidate.toString();
          }
        } catch {}
      }

      for (const entry of [...page.observedResponses()].reverse()) {
        if (!isLikelyDownloadResponse(entry)) continue;
        const candidate = new URL(entry.url);
        await assertPublicEndpoint(candidate, ctx.deadline);
        return candidate.toString();
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

      if (!selector && state.actions.length > 0) {
        selector = state.actions[0] ?? null;
      }

      if (selector) {
        try {
          await page.click(selector);
        } catch {
          // Navigation or DOM replacement may detach the old execution context.
        }
        await sleep(650);
        continue;
      }

      await sleep(500);
    }

    const finalUrl = new URL(page.url());
    if (!sameProviderHost(finalUrl.hostname, providerHosts)) {
      await assertPublicEndpoint(finalUrl, ctx.deadline);
      return finalUrl.toString();
    }

    for (const entry of [...page.observedResponses()].reverse()) {
      if (!isLikelyDownloadResponse(entry)) continue;
      const candidate = new URL(entry.url);
      await assertPublicEndpoint(candidate, ctx.deadline);
      return candidate.toString();
    }

    throw new ResolverError(
      "DESTINATION_NOT_FOUND",
      "The provider did not expose a final destination URL."
    );
  } finally {
    await page.close();
  }
}

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

  const path = (() => {
    try {
      return new URL(entry.url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();

  return /\.(zip|rar|7z|tar|gz|bz2|apk|exe|msi|iso|pdf|mp4|mkv|avi|mov|mp3|m4a|flac|wav)(?:$|[?#])/i.test(path);
}

function isLikelyDownloadUrl(rawUrl: string): boolean {
  try {
    const candidate = new URL(rawUrl);
    const path = candidate.pathname.toLowerCase();
    return (
      /(^|\/)download(\/|$)/.test(path) &&
      /\.(zip|rar|7z|tar|gz|bz2|apk|exe|msi|iso|pdf|mp4|mkv|avi|mov|mp3|m4a|flac|wav)(?:$|[?#])/i.test(path)
    );
  } catch {
    return false;
  }
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
    17_000,
    Math.max(3_000, ctx.deadline.remainingMs() - 300)
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

      const state = await page.evaluate((providerSelectors) => {
        const visible = (el: Element) => {
          const node = el as HTMLElement;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };

        const enabled = (el: Element) => {
          if (el.hasAttribute("disabled")) return false;
          const ariaDisabled = el.getAttribute("aria-disabled");
          if (ariaDisabled === "true") return false;

          const text = (
            "value" in el
              ? String((el as HTMLInputElement).value || "")
              : (el as HTMLElement).innerText || el.textContent || ""
          )
            .replace(/\s+/g, " ")
            .trim();

          return !/^please wait\b/i.test(text);
        };

        const actionText = (value: string): boolean =>
          /^(download(?: file| now)?|direct download|get link|continue|go to link|start download|generate link|create link|free download|download free|download file|save file)$/i.test(
            value.replace(/\\s+/g, " ").trim()
          );

        const pageText = document.body?.innerText ?? "";
        const challengeElement = Array.from(
          document.querySelectorAll(
            'iframe[src*="captcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], [name*="captcha" i], [id*="captcha" i]'
          )
        ).find(visible);

        const captcha = Boolean(challengeElement);

        const providerActions = providerSelectors.filter((selector: string) => {
          try {
            const element = document.querySelector(selector);
            return Boolean(element && visible(element) && enabled(element));
          } catch {
            return false;
          }
        });

        const elements = Array.from(
          document.querySelectorAll(
            "button, input[type='submit'], input[type='button'], a[href], form"
          )
        );

        const directTargets: string[] = [];

        for (const element of elements) {
          if (!visible(element)) continue;

          const values = [
            element.getAttribute("data-href"),
            element.getAttribute("data-url"),
            element.getAttribute("data-download"),
            element.getAttribute("data-link"),
            element.getAttribute("data-direct-download"),
            element.getAttribute("data-smartlink")
          ];

          for (const value of values) {
            if (value && /^https?:\/\//i.test(value)) {
              directTargets.push(value);
            }
          }

          if (element instanceof HTMLFormElement && element.action) {
            directTargets.push(element.action);
          }

          const onclick = element.getAttribute("onclick") || "";
          for (const match of onclick.matchAll(/https?:\/\/[^"'\s)]+/gi)) {
            directTargets.push(match[0]);
          }
        }

        const candidates = elements
          .filter((element) => visible(element) && enabled(element))
          .map((element, index) => {
            const node = element as HTMLElement;
            const text = (
              "value" in element
                ? String((element as HTMLInputElement).value || "")
                : node.innerText || node.textContent || ""
            ).replace(/\s+/g, " ").trim();

            const href =
              element instanceof HTMLAnchorElement
                ? element.href
                : element instanceof HTMLFormElement
                  ? element.action
                  : element.getAttribute("data-href") ||
                    element.getAttribute("data-url") ||
                    element.getAttribute("data-download") ||
                    element.getAttribute("data-link") ||
                    "";

            const onclick = element.getAttribute("onclick") || "";
            const signature = [
              text,
              href,
              onclick,
              element.id,
              element.className?.toString() ?? ""
            ].join(" ");

            if (
              element instanceof HTMLFormElement ||
              isActionText(text) ||
              /download|direct|continue|get link|generate|create link/i.test(signature)
            ) {
              const marker = "data-whites-action";
              const value = String(index);
              element.setAttribute(marker, value);
              return {
                selector: '[data-whites-action="' + value + '"]',
                text,
                href
              };
            }

            return null;
          })
          .filter((value): value is { selector: string; text: string; href: string } => Boolean(value));

        const candidate = candidates.find(
          (entry) => actionText(entry.text) && entry.href
        );

        return {
          url: location.href,
          pageTextLength: pageText.length,
          captcha,
          providerActions,
          candidate: candidate?.href ?? null,
          actions: candidates.map((entry) => entry.selector),
          directTargets
        };
      }, selectors);

      if (state.captcha) {
        throw new ResolverError(
          "RESOLUTION_UNSUPPORTED",
          "The provider requires a CAPTCHA or browser challenge."
        );
      }

      for (const raw of state.directTargets) {
        try {
          const candidate = new URL(raw, state.url);
          if (
            !sameProviderHost(candidate.hostname, providerHosts) ||
            isLikelyDownloadUrl(candidate.toString())
          ) {
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
        if (
          !sameProviderHost(candidate.hostname, providerHosts) ||
          isLikelyDownloadUrl(candidate.toString())
        ) {
          await assertPublicEndpoint(candidate, ctx.deadline);
          return candidate.toString();
        }
      }

      const selector =
        state.providerActions[0] ??
        state.actions[0] ??
        null;

      if (selector) {
        try {
          await page.click(selector);
        } catch {
          // Navigation or DOM replacement may detach the old execution context.
        }

        await sleep(900);
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

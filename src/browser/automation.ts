import { ResolverError } from "../core/errors.js";
import puppeteer from "@cloudflare/puppeteer";
import { COSMETIC_AD_SELECTORS, shouldBlockRequest } from "./adblock.js";

export interface BrowserObservedResponse {
  url: string;
  status: number;
  contentType: string;
  contentDisposition: string;
}

export interface BrowserPage {
  url(): string;
  html(): Promise<string>;
  evaluate<T>(pageFunction: (...args: any[]) => T, ...args: any[]): Promise<T>;
  click(selector: string): Promise<void>;
  observedResponses(): readonly BrowserObservedResponse[];
  close(): Promise<void>;
}

export interface BrowserAutomation {
  open(url: URL, options?: { timeoutMs?: number }): Promise<BrowserPage>;
}

export interface BrowserBinding {
  browser: unknown;
}

export function createBrowserAutomation(binding: BrowserBinding): BrowserAutomation {
  return {
    async open(url, options = {}) {
      const browser = await puppeteer.launch(
        binding.browser as Parameters<typeof puppeteer.launch>[0]
      );
      const page = await browser.newPage();
      const observedResponses: BrowserObservedResponse[] = [];
      const seenResponseUrls = new Set<string>();

      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (shouldBlockRequest(request.url())) {
          void request.abort().catch(() => {});
          return;
        }

        void request.continue().catch(() => {});
      });

      page.on("response", (response) => {
        const responseUrl = response.url();
        if (seenResponseUrls.has(responseUrl)) return;
        seenResponseUrls.add(responseUrl);

        const headers = response.headers();
        observedResponses.push({
          url: responseUrl,
          status: response.status(),
          contentType: headers["content-type"] ?? "",
          contentDisposition: headers["content-disposition"] ?? ""
        });

        if (observedResponses.length > 128) {
          observedResponses.shift();
        }
      });

      try {
        await page.goto(url.toString(), {
          waitUntil: "domcontentloaded",
          timeout: options.timeoutMs ?? 15_000
        });

        await page.evaluate((selectors) => {
          for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
              element.remove();
            }
          }
        }, COSMETIC_AD_SELECTORS);
      } catch (error) {
        await browser.close();
        throw new ResolverError(
          "RESOLUTION_FAILED",
          "Browser navigation failed.",
          true,
          { cause: error }
        );
      }

      return {
        url: () => page.url(),
        html: () => page.content(),
        evaluate: <T>(fn: (...args: any[]) => T, ...args: any[]) =>
          page.evaluate(fn, ...args),
        click: async (selector: string) => {
          await page.click(selector);
        },
        observedResponses: () => observedResponses,
        close: async () => {
          await browser.close();
        }
      };
    }
  };
}

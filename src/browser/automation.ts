import { ResolverError } from "../core/errors.js";
import puppeteer from "@cloudflare/puppeteer";
import { COSMETIC_AD_SELECTORS, shouldBlockRequest } from "./adblock.js";

export interface BrowserPage {
  url(): string;
  html(): Promise<string>;
  evaluate<T>(pageFunction: () => T): Promise<T>;
  click(selector: string): Promise<void>;
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

      await page.setRequestInterception(true);
      page.on("request", (request) => {
        if (shouldBlockRequest(request.url())) {
          void request.abort().catch(() => {});
          return;
        }

        void request.continue().catch(() => {});
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
        evaluate: <T>(fn: () => T) => page.evaluate(fn),
        click: async (selector: string) => {
          await page.click(selector);
        },
        close: async () => {
          await browser.close();
        }
      };
    }
  };
}

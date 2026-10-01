import { ResolverError } from "../core/errors.js";
import puppeteer from "@cloudflare/puppeteer";

export interface BrowserPage {
  url(): string;
  html(): Promise<string>;
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
      const browser = await puppeteer.launch(binding.browser as Parameters<typeof puppeteer.launch>[0]);
      const page = await browser.newPage();

      try {
        await page.goto(url.toString(), {
          waitUntil: "domcontentloaded",
          timeout: options.timeoutMs ?? 15_000
        });
      } catch (error) {
        await browser.close();
        throw new ResolverError("RESOLUTION_FAILED", "Browser navigation failed.", true, { cause: error });
      }

      return {
        url: () => page.url(),
        html: () => page.content(),
        close: async () => {
          await browser.close();
        }
      };
    }
  };
}
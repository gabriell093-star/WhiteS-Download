import type { BrowserAutomation } from "../browser/automation.js";
import type { SafeHttpClient } from "../http/client.js";
import type { Deadline } from "./deadline.js";
import type { ResolutionSuccess } from "./types.js";

export interface ProviderMeta {
  id: string;
  label: string;
  hostnames: readonly string[];
  enabled: boolean;
  requiresBrowser: boolean;
}

export interface ProviderContext {
  http: SafeHttpClient;
  deadline: Deadline;
  browser: BrowserAutomation;
}

export interface Provider {
  meta: ProviderMeta;
  detect(url: URL): boolean;
  resolve(url: URL, ctx: ProviderContext): Promise<ResolutionSuccess>;
}
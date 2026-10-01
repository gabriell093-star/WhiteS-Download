import { ResolverError } from "../core/errors.js";
import type { BrowserAutomation } from "./automation.js";

export function browserUnavailable(): BrowserAutomation {
  return {
    async open() {
      throw new ResolverError(
        "RESOLUTION_UNSUPPORTED",
        "Browser automation is not configured."
      );
    }
  };
}
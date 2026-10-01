import type { Provider } from "../core/provider.js";
import { SfileProvider } from "./sfile/sfile.provider.js";

export function createDefaultProviders(): Provider[] {
  return [new SfileProvider()];
}
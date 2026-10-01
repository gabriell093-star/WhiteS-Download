import type { Provider } from "./provider.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();
  private readonly disabled = new Set<string>();

  register(provider: Provider): void {
    if (this.providers.has(provider.meta.id)) {
      throw new Error(`Provider "${provider.meta.id}" is already registered.`);
    }
    this.providers.set(provider.meta.id, provider);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    if (!this.providers.has(id)) return false;
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
    return true;
  }

  detect(url: URL): Provider | null {
    for (const provider of this.providers.values()) {
      if (!provider.meta.enabled) continue;
      if (this.disabled.has(provider.meta.id)) continue;
      try {
        if (provider.detect(url)) return provider;
      } catch {
        // Detection must not break the engine.
      }
    }
    return null;
  }

  list(): readonly Provider[] {
    return [...this.providers.values()];
  }
}
import { ResolverError } from "../core/errors.js";
import { isBlockedIp } from "./ipBlocker.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localdomain",
  "broadcasthost"
]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".corp",
  ".home.arpa",
  ".localdomain"
] as const;

export function assertSafeUrlSyntax(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ResolverError("INVALID_URL", "Only HTTP(S) URLs are supported.");
  }

  if (url.username !== "" || url.password !== "") {
    throw new ResolverError("INVALID_URL", "Embedded URL credentials are not allowed.");
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    throw new ResolverError("INVALID_URL", "URL hostname is required.");
  }

  if (
    BLOCKED_HOSTNAMES.has(host) ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new ResolverError("SECURITY_BLOCKED", "Internal hostnames are blocked.");
  }

  if (
    host.startsWith("[") &&
    host.endsWith("]") &&
    isBlockedIp(host.slice(1, -1))
  ) {
    throw new ResolverError("SECURITY_BLOCKED", "Private or reserved IP addresses are blocked.");
  }

  if (
    !host.includes(".") &&
    !host.includes(":")
  ) {
    throw new ResolverError("SECURITY_BLOCKED", "Single-label hostnames are blocked.");
  }
}

export function parseAndValidateUrl(raw: string): URL {
  try {
    const url = new URL(raw.trim());
    assertSafeUrlSyntax(url);
    return url;
  } catch (error) {
    if (error instanceof ResolverError) throw error;
    throw new ResolverError("INVALID_URL", "The provided value is not a valid URL.");
  }
}
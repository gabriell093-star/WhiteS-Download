import { ResolverError } from "../core/errors.js";
import { Deadline, withTimeout } from "../core/deadline.js";
import { isBlockedIp } from "./ipBlocker.js";
import { assertSafeUrlSyntax } from "./urlValidator.js";

async function resolveDns(hostname: string): Promise<string[]> {
  // Cloudflare Workers' node:dns support provides resolve4/resolve6 through DNS-over-HTTPS.
  const dns = await import("node:dns/promises");
  const [v4, v6] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname)
  ]);

  const addresses = [
    ...(v4.status === "fulfilled" ? v4.value : []),
    ...(v6.status === "fulfilled" ? v6.value : [])
  ];

  if (addresses.length === 0) {
    throw new ResolverError("RESOLUTION_FAILED", "The hostname could not be resolved.", true);
  }

  return addresses;
}

export async function assertPublicEndpoint(
  url: URL,
  deadline: Deadline
): Promise<void> {
  assertSafeUrlSyntax(url);
  deadline.throwIfExpired();

  const host = url.hostname.toLowerCase();

  // DNS is only needed for hostnames. Literal IPs have already been checked.
  if (host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isBlockedIp(host.replace(/^\[|\]$/g, ""))) {
      throw new ResolverError("SECURITY_BLOCKED", "Private or reserved IP addresses are blocked.");
    }
    return;
  }

  const addresses = await withTimeout(
    resolveDns(host),
    Math.max(1, deadline.remainingMs()),
    () => new ResolverError("RESOLUTION_TIMEOUT", "DNS resolution timed out.", true)
  );

  if (addresses.some(isBlockedIp)) {
    throw new ResolverError("SECURITY_BLOCKED", "Destination resolves to a private or reserved address.");
  }
}
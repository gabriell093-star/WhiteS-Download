import { ResolverError } from "../core/errors.js";
import { Deadline, withTimeout } from "../core/deadline.js";
import { isBlockedIp } from "./ipBlocker.js";
import { assertSafeUrlSyntax } from "./urlValidator.js";

async function resolveDns(hostname: string): Promise<string[]> {
  const dns = await import("node:dns/promises");
  const [v4, v6] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname)
  ]);

  const addresses = [
    ...(v4.status === "fulfilled" ? v4.value : []),
    ...(v6.status === "fulfilled" ? v6.value : [])
  ]
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);

  if (addresses.length === 0) {
    throw new ResolverError(
      "RESOLUTION_FAILED",
      "The hostname could not be resolved.",
      true
    );
  }

  return [...new Set(addresses)].sort();
}

function assertAllAddressesPublic(addresses: readonly string[]): void {
  if (addresses.some(isBlockedIp)) {
    throw new ResolverError(
      "SECURITY_BLOCKED",
      "Destination resolves to a private or reserved address."
    );
  }
}

async function resolveDnsWithDeadline(
  hostname: string,
  deadline: Deadline
): Promise<string[]> {
  return withTimeout(
    resolveDns(hostname),
    Math.max(1, deadline.remainingMs()),
    () =>
      new ResolverError(
        "RESOLUTION_TIMEOUT",
        "DNS resolution timed out.",
        true
      )
  );
}

export async function assertPublicEndpoint(
  url: URL,
  deadline: Deadline
): Promise<void> {
  assertSafeUrlSyntax(url);
  deadline.throwIfExpired();

  const host = url.hostname.toLowerCase();

  if (host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const ip = host.replace(/^\[|\]$/g, "");
    if (isBlockedIp(ip)) {
      throw new ResolverError(
        "SECURITY_BLOCKED",
        "Private or reserved IP addresses are blocked."
      );
    }
    return;
  }

  const first = await resolveDnsWithDeadline(host, deadline);
  assertAllAddressesPublic(first);
  deadline.throwIfExpired();

  // Resolve twice to reduce the TOCTOU window and detect DNS-answer churn.
  const second = await resolveDnsWithDeadline(host, deadline);
  assertAllAddressesPublic(second);

  if (
    first.length !== second.length ||
    first.some((address, index) => address !== second[index])
  ) {
    throw new ResolverError(
      "SECURITY_BLOCKED",
      "DNS answers changed during security validation."
    );
  }
}

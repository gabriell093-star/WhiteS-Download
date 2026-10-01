function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

const V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const;

function cidrContains(ip: string, base: string, bits: number): boolean {
  const value = ipv4ToInt(ip);
  const baseValue = ipv4ToInt(base);
  if (value === null || baseValue === null) return true;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isIpv4(ip: string): boolean {
  return ipv4ToInt(ip) !== null;
}

export function isBlockedIp(ip: string): boolean {
  const value = ip.trim().toLowerCase();

  if (isIpv4(value)) {
    return V4_BLOCKED.some(([base, bits]) => cidrContains(value, base, bits));
  }

  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
  if (value.startsWith("ff")) return true;
  if (value.startsWith("2001:db8:")) return true;

  // IPv4-mapped IPv6. Hex-form is conservatively blocked.
  if (value.startsWith("::ffff:")) return true;

  return !value.includes(":");
}
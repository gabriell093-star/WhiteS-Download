const BLOCKED_HOSTS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "adnxs.com",
  "adsrvr.org",
  "taboola.com",
  "outbrain.com",
  "criteo.com",
  "amazon-adsystem.com",
  "zedo.com",
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "exoclick.com",
  "adsterra.com",
  "juicyads.com"
] as const;

const BLOCKED_PATH_MARKERS = [
  "/ads/",
  "/adserver/",
  "/adservice/",
  "/pagead/",
  "/gampad/",
  "/popup/",
  "/popunder/"
] as const;

const BLOCKED_QUERY_KEYS = [
  "gclid",
  "dclid",
  "fbclid"
] as const;

function hostMatches(hostname: string, candidate: string): boolean {
  const host = hostname.toLowerCase();
  const item = candidate.toLowerCase();
  return host === item || host.endsWith("." + item);
}

export function shouldBlockRequest(rawUrl: string): boolean {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  if (BLOCKED_HOSTS.some((host) => hostMatches(url.hostname, host))) {
    return true;
  }

  const path = url.pathname.toLowerCase();
  if (BLOCKED_PATH_MARKERS.some((marker) => path.includes(marker))) {
    return true;
  }

  return BLOCKED_QUERY_KEYS.some((key) => url.searchParams.has(key));
}

export const COSMETIC_AD_SELECTORS = [
  'iframe[src*="doubleclick.net" i]',
  'iframe[src*="googlesyndication.com" i]',
  'iframe[src*="googleadservices.com" i]',
  'iframe[src*="adservice.google.com" i]',
  '[data-ad-client]',
  '[data-google-query-id]',
  '[aria-label="advertisement" i]',
  '[aria-label="advertisements" i]'
] as const;

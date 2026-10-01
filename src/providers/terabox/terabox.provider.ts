import { ResolverError } from "../../core/errors.js";
import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";

const HOSTNAMES = [
  "terabox.com",
  "teraboxapp.com",
  "1024terabox.com",
  "terabox.app"
] as const;

interface ShareFile {
  isdir?: string | number;
  fs_id?: string | number;
  fid?: string | number;
  fid_id?: string | number;
  server_filename?: string;
  dlink?: string;
}

interface ShareListResponse {
  errno?: number;
  errmsg?: string;
  sign?: string;
  timestamp?: string | number;
  shareid?: string | number;
  uk?: string | number;
  list?: ShareFile[];
  data?: {
    sign?: string;
    timestamp?: string | number;
    shareid?: string | number;
    uk?: string | number;
    list?: ShareFile[];
  };
}

interface DownloadResponse {
  errno?: number;
  errmsg?: string;
  dlink?: string;
  list?: ShareFile[];
  data?: { dlink?: string; list?: ShareFile[] };
}

function sameHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return HOSTNAMES.some((candidate) =>
    host === candidate || host.endsWith("." + candidate)
  );
}

function extractSurl(url: URL): string | null {
  const query =
    url.searchParams.get("surl") ||
    url.searchParams.get("shorturl");

  if (query) return query.replace(/^1/, "");

  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === "s");
  const value = index >= 0 ? parts[index + 1] : undefined;

  if (value) return value.replace(/^1/, "");
  return null;
}

function extractString(body: string, name: "jsToken" | "jstoken" | "js_token" | "dp-logid" | "dp_logid" | "dplogid"): string | null {
  if (/js/i.test(name)) {
    const match = body.match(/(?:["']?jsToken["']?|["']?jstoken["']?|["']?js_token["']?)\\s*[:=]\\s*["']([^"']+)["']/i);
    return match?.[1] ?? null;
  }

  const match = body.match(/(?:["']?dp-logid["']?|["']?dp_logid["']?|["']?dplogid["']?)\\s*[:=]\\s*["']?([0-9]+)["']?/i);
  return match?.[1] ?? null;
}

function firstFile(response: ShareListResponse): ShareFile | null {
  const list = response.list ?? response.data?.list ?? [];
  return list.find((entry) => Number(entry.isdir ?? 0) === 0) ?? null;
}

function extractDlink(response: DownloadResponse): string | null {
  const direct = response.dlink ?? response.data?.dlink;
  if (direct) return direct;

  const list = response.list ?? response.data?.list ?? [];
  return list.find((entry) => entry.dlink)?.dlink ?? null;
}

async function resolveWithPublicShareApi(
  ctx: ProviderContext,
  resolved: URL,
  surl: string,
  html: string
): Promise<ResolutionSuccess> {
  const jsToken = extractString(html, ["jsToken", "jstoken", "js_token"]);
  const dpLogId = extractString(html, ["dp-logid", "dp_logid", "dplogid"]) ?? String(Date.now());

  if (!jsToken) {
    throw new ResolverError(
      "RESOLUTION_UNSUPPORTED",
      "TeraBox did not expose its public share token."
    );
  }

  const listUrl = new URL("/share/list", resolved.origin);
  listUrl.search = new URLSearchParams({
    app_id: "250528",
    web: "1",
    channel: "0",
    jsToken,
    "dp-logid": dpLogId,
    page: "1",
    num: "20",
    by: "name",
    order: "asc",
    site_referer: "",
    shorturl: surl,
    root: "1"
  }).toString();

  const listResponse = await ctx.http.fetchText(listUrl, ctx.deadline, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: resolved.toString()
    }
  });

  let info: ShareListResponse;
  try {
    info = JSON.parse(listResponse.body) as ShareListResponse;
  } catch {
    throw new ResolverError(
      "PROVIDER_CHANGED",
      "TeraBox returned an unexpected share-list response."
    );
  }

  if (info.errno && info.errno !== 0) {
    throw new ResolverError(
      "RESOLUTION_UNSUPPORTED",
      info.errmsg || "TeraBox rejected the public share lookup."
    );
  }

  const file = firstFile(info);
  const fsId = String(file?.fs_id ?? file?.fid ?? file?.fid_id ?? "");
  const shareid = String(info.shareid ?? info.data?.shareid ?? "");
  const uk = String(info.uk ?? info.data?.uk ?? "");
  const sign = String(info.sign ?? info.data?.sign ?? "");
  const timestamp = String(info.timestamp ?? info.data?.timestamp ?? "");

  if (file?.dlink) {
    return {
      ok: true,
      providerId: "terabox",
      destinationUrl: new URL(file.dlink).toString(),
      meta: { filename: file.server_filename || "unknown" }
    };
  }

  if (!fsId || !shareid || !uk || !sign || !timestamp) {
    throw new ResolverError(
      "RESOLUTION_UNSUPPORTED",
      "TeraBox did not expose enough public share data for a fresh download link."
    );
  }

  const downloadUrl = new URL("/share/download", resolved.origin);
  downloadUrl.search = new URLSearchParams({
    app_id: "250528",
    web: "1",
    channel: "0",
    jsToken,
    "dp-logid": dpLogId,
    sign,
    timestamp,
    shareid,
    uk,
    primaryid: shareid,
    fid_list: "[" + fsId + "]",
    encrypt: "0",
    product: "share",
    nozip: "0"
  }).toString();

  const response = await ctx.http.fetchText(downloadUrl, ctx.deadline, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: resolved.toString()
    }
  });

  let download: DownloadResponse;
  try {
    download = JSON.parse(response.body) as DownloadResponse;
  } catch {
    throw new ResolverError(
      "PROVIDER_CHANGED",
      "TeraBox returned an unexpected download response."
    );
  }

  if (download.errno) {
    throw new ResolverError(
      "RESOLUTION_UNSUPPORTED",
      download.errmsg || "TeraBox rejected the download-link request."
    );
  }

  const dlink = extractDlink(download);
  if (!dlink) {
    throw new ResolverError(
      "DESTINATION_NOT_FOUND",
      "TeraBox did not return a public download URL."
    );
  }

  return {
    ok: true,
    providerId: "terabox",
    destinationUrl: new URL(dlink).toString(),
    meta: { filename: file.server_filename || "unknown" }
  };
}

export class TeraboxProvider implements Provider {
  readonly meta = {
    id: "terabox",
    label: "TeraBox",
    hostnames: HOSTNAMES,
    enabled: true,
    requiresBrowser: true
  } as const;

  detect(url: URL): boolean {
    return sameHost(url.hostname);
  }

  async resolve(url: URL, ctx: ProviderContext): Promise<ResolutionSuccess> {
    const page = await ctx.http.fetchText(url, ctx.deadline, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9"
      }
    });

    const resolved = new URL(page.url);
    const surl = extractSurl(resolved) || extractSurl(url);

    if (!surl) {
      throw new ResolverError(
        "DESTINATION_NOT_FOUND",
        "TeraBox share identifier was not found."
      );
    }

    try {
      return await resolveWithPublicShareApi(ctx, resolved, surl, page.body);
    } catch (error) {
      if (
        error instanceof ResolverError &&
        error.code !== "RESOLUTION_UNSUPPORTED" &&
        error.code !== "DESTINATION_NOT_FOUND" &&
        error.code !== "PROVIDER_CHANGED"
      ) {
        throw error;
      }
    }

    const browser = await ctx.browser.open(resolved, {
      timeoutMs: Math.min(10_000, Math.max(3_000, ctx.deadline.remainingMs() - 500))
    });

    try {
      const result = await browser.evaluate(async (shorturl) => {
        const html = document.documentElement.innerHTML;
        const find = (names: string[]): string | null => {
          for (const name of names) {
            const re =
              name === "jsToken" || name === "jstoken" || name === "js_token"
                ? /(?:["']?jsToken["']?|["']?jstoken["']?|["']?js_token["']?)\\s*[:=]\\s*["']([^"']+)["']/i
                : /(?:["']?dp-logid["']?|["']?dp_logid["']?|["']?dplogid["']?)\\s*[:=]\\s*["']?([0-9]+)["']?/i;
            const match = html.match(re);
            if (match?.[1]) return match[1];
          }
          return null;
        };

        const jsToken = (window as any).jsToken || find(["jsToken", "jstoken", "js_token"]);
        const dpLogId = find(["dp-logid", "dp_logid", "dplogid"]) || String(Date.now());

        if (!jsToken) {
          return { dlink: null, error: "NO_JS_TOKEN" };
        }

        const listUrl = new URL("/share/list", location.origin);
        listUrl.search = new URLSearchParams({
          app_id: "250528",
          web: "1",
          channel: "0",
          jsToken: String(jsToken),
          "dp-logid": dpLogId,
          page: "1",
          num: "20",
          by: "name",
          order: "asc",
          site_referer: "",
          shorturl: shorturl.replace(/^1/, ""),
          root: "1"
        }).toString();

        const listRes = await fetch(listUrl.toString(), {
          credentials: "include",
          headers: { accept: "application/json, text/plain, */*" }
        });
        const info = await listRes.json() as any;
        const file = (info.list || info.data?.list || []).find((x: any) => Number(x.isdir ?? 0) === 0);
        if (!file) return { dlink: null, error: info.errmsg || "NO_FILE" };
        if (file.dlink) return { dlink: file.dlink };

        const shareid = String(info.shareid ?? info.data?.shareid ?? "");
        const uk = String(info.uk ?? info.data?.uk ?? "");
        const sign = String(info.sign ?? info.data?.sign ?? "");
        const timestamp = String(info.timestamp ?? info.data?.timestamp ?? "");
        const fsId = String(file.fs_id ?? file.fid ?? file.fid_id ?? "");

        if (!shareid || !uk || !sign || !timestamp || !fsId) {
          return { dlink: null, error: info.errmsg || "MISSING_DOWNLOAD_DATA" };
        }

        const downloadUrl = new URL("/share/download", location.origin);
        downloadUrl.search = new URLSearchParams({
          app_id: "250528",
          web: "1",
          channel: "0",
          jsToken: String(jsToken),
          "dp-logid": dpLogId,
          sign,
          timestamp,
          shareid,
          uk,
          primaryid: shareid,
          fid_list: "[" + fsId + "]",
          encrypt: "0",
          product: "share",
          nozip: "0"
        }).toString();

        const downloadRes = await fetch(downloadUrl.toString(), {
          credentials: "include",
          headers: { accept: "application/json, text/plain, */*" }
        });
        const download = await downloadRes.json() as any;
        const dlink =
          download.dlink ||
          download.data?.dlink ||
          (download.list || download.data?.list || []).find((x: any) => x.dlink)?.dlink ||
          null;

        return { dlink, error: download.errmsg || null };
      }, surl);

      if (!result?.dlink) {
        throw new ResolverError(
          "RESOLUTION_UNSUPPORTED",
          "TeraBox did not expose a public download URL."
        );
      }

      return {
        ok: true,
        providerId: this.meta.id,
        destinationUrl: new URL(result.dlink).toString()
      };
    } finally {
      await browser.close();
    }
  }
}

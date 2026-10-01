import { ResolverError } from "../../core/errors.js";
import type { Provider, ProviderContext } from "../../core/provider.js";
import type { ResolutionSuccess } from "../../core/types.js";

const HOSTNAMES = [
  "terabox.com",
  "teraboxapp.com",
  "1024terabox.com",
  "terabox.app"
] as const;

interface ShareInfo {
  errno?: number;
  errmsg?: string;
  sign?: string | number;
  timestamp?: string | number;
  shareid?: string | number;
  share_id?: string | number;
  uk?: string | number;
  list?: Array<{
    isdir?: string | number;
    fs_id?: string | number;
    server_filename?: string;
  }>;
}

interface DownloadInfo {
  errno?: number;
  errmsg?: string;
  dlink?: string | Array<{ dlink?: string }>;
  list?: Array<{ dlink?: string }>;
  info?: Array<{ dlink?: string }>;
}

function sameHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return HOSTNAMES.some((candidate) => host === candidate || host.endsWith("." + candidate));
}

function extractSurl(url: URL): string | null {
  const query = url.searchParams.get("surl") || url.searchParams.get("shorturl");
  if (query) return query.replace(/^1/, "");

  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === "s");
  const value = index >= 0 ? parts[index + 1] : undefined;
  if (value) {
    return value.replace(/^1/, "");
  }

  return null;
}

function extractDlink(data: DownloadInfo): string | null {
  if (typeof data.dlink === "string") return data.dlink;
  return data.dlink?.[0]?.dlink ??
    data.list?.[0]?.dlink ??
    data.info?.[0]?.dlink ??
    null;
}

export class TeraboxProvider implements Provider {
  readonly meta = {
    id: "terabox",
    label: "TeraBox",
    hostnames: HOSTNAMES,
    enabled: false,
    requiresBrowser: false
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

    const shorturlVariants = [surl, "1" + surl];
    let info: ShareInfo | null = null;

    for (const shorturl of shorturlVariants) {
      const apiUrl = new URL("https://www.terabox.com/api/shorturlinfo");
      apiUrl.search = new URLSearchParams({
        app_id: "250528",
        web: "1",
        channel: "dubox",
        clienttype: "0",
        shorturl,
        root: "1"
      }).toString();

      const response = await ctx.http.fetchText(apiUrl, ctx.deadline, {
        headers: {
          accept: "application/json, text/plain, */*",
          referer: resolved.toString()
        }
      });

      try {
        const parsed = JSON.parse(response.body) as ShareInfo;
        if (!parsed.errno && parsed.list?.length) {
          info = parsed;
          break;
        }
      } catch {}
    }

    if (!info) {
      throw new ResolverError(
        "RESOLUTION_UNSUPPORTED",
        "TeraBox did not expose a public download record."
      );
    }

    const file = info.list?.find((entry) =>
      Number(entry.isdir ?? 0) === 0 && Boolean(entry.fs_id)
    );

    if (!file?.fs_id) {
      throw new ResolverError(
        "DESTINATION_NOT_FOUND",
        "TeraBox share contains no downloadable file."
      );
    }

    const shareid = String(info.shareid ?? info.share_id ?? "");
    const uk = String(info.uk ?? "");
    const sign = String(info.sign ?? "");
    const timestamp = String(info.timestamp ?? "");

    if (!shareid || !uk || !sign || !timestamp) {
      throw new ResolverError(
        "RESOLUTION_UNSUPPORTED",
        "TeraBox did not provide the signature needed for a fresh download link."
      );
    }

    const downloadUrl = new URL("https://www.terabox.com/share/download");
    downloadUrl.search = new URLSearchParams({
      app_id: "250528",
      web: "1",
      channel: "dubox",
      clienttype: "0",
      sign,
      timestamp,
      shareid,
      uk,
      primaryid: shareid,
      fid_list: "[" + String(file.fs_id) + "]",
      encrypt: "0",
      product: "share",
      nozip: "0",
      "dp-logid": String(Date.now())
    }).toString();

    const downloadResponse = await ctx.http.fetchText(
      downloadUrl,
      ctx.deadline,
      {
        headers: {
          accept: "application/json, text/plain, */*",
          referer: resolved.toString()
        }
      }
    );

    let data: DownloadInfo;
    try {
      data = JSON.parse(downloadResponse.body) as DownloadInfo;
    } catch {
      throw new ResolverError(
        "PROVIDER_CHANGED",
        "TeraBox returned an unexpected download response."
      );
    }

    if (data.errno) {
      throw new ResolverError(
        "RESOLUTION_UNSUPPORTED",
        data.errmsg || "TeraBox rejected the download-link request."
      );
    }

    const dlink = extractDlink(data);
    if (!dlink) {
      throw new ResolverError(
        "DESTINATION_NOT_FOUND",
        "TeraBox did not return a download URL."
      );
    }

    return {
      ok: true,
      providerId: this.meta.id,
      destinationUrl: new URL(dlink).toString(),
      meta: {
        filename: file.server_filename || "unknown"
      }
    };
  }
}

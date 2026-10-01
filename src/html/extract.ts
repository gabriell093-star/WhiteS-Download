export interface AnchorInfo {
  href: string;
  text: string;
}

const ANCHOR_RE = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;

export function extractAnchors(html: string): AnchorInfo[] {
  const anchors: AnchorInfo[] = [];

  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = match[1] ?? match[2] ?? match[3] ?? "";
    const text = (match[4] ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

    if (href) {
      anchors.push({
        href: decodeEntities(href),
        text
      });
    }
  }

  return anchors;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#0?39;|&apos;/g, "'");
}
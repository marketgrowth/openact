import { HttpError, type Env } from "@openact/core/server";
import { cleanUrl, siteOf, videoOf, type FeedEntry, type FeedPreview, type Format } from "../shared/rules.ts";

/*
 * Reads other sites: a page for its title and image, a feed for new entries, a file for its text.
 * Everything that comes back is untrusted. It is cut to a safe length, its tags are dropped,
 * and it goes to a model only as labeled data.
 */

const TIMEOUT_MS = 8000;
const MAX_PAGE_BYTES = 1_500_000;
const UA = "OpenAct-Library/1.0 (+https://openact.ing)";

/** True for hosts that are not public sites: localhost, private and link-local addresses. */
function privateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return h.includes(":"); // An IPv6 literal. Public sites use names.
}

export interface Fetched {
  url: string;
  contentType: string;
  text: string;
}

/** Fetches a public https page and reads up to `max` bytes of it as text. */
export async function fetchPublic(rawUrl: string, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5", max = MAX_PAGE_BYTES): Promise<Fetched> {
  const clean = cleanUrl(rawUrl);
  if ("problem" in clean || !clean.url) throw new HttpError(400, "problem" in clean ? clean.problem : "Add a link.");
  const u = new URL(clean.url);
  if (privateHost(u.hostname)) throw new HttpError(400, "The link must point to a public website.");
  let res: Response;
  try {
    res = await fetch(u.toString(), { headers: { Accept: accept, "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, `${u.hostname} did not answer. Check the link and try again.`);
  }
  if (!res.ok) throw new HttpError(502, `${u.hostname} answered with error ${res.status}. Check the link.`);
  const finalUrl = res.url && res.url.startsWith("https://") ? res.url : u.toString();
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (/^(image|audio|video)\//.test(contentType) || contentType.includes("pdf") || contentType.includes("octet-stream")) {
    await res.body?.cancel().catch(() => undefined);
    return { url: finalUrl, contentType, text: "" };
  }
  const reader = res.body?.getReader();
  if (!reader) return { url: finalUrl, contentType, text: "" };
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.byteLength;
    if (n >= max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    all.set(p.subarray(0, Math.min(p.byteLength, n - o)), o);
    o += p.byteLength;
    if (o >= n) break;
  }
  return { url: finalUrl, contentType, text: new TextDecoder().decode(all) };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", mdash: "-", ndash: "-" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text from HTML: no scripts, styles or tags, and one space between words. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<(script|style|noscript|svg|template|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

const attr = (tag: string, name: string): string => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
};

function metaTags(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const head = html.slice(0, 300000);
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], "property") || attr(m[0], "name")).toLowerCase();
    const content = attr(m[0], "content");
    if (key && content && !out.has(key)) out.set(key, content);
  }
  return out;
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function absolute(maybe: string, base: string): string {
  if (!maybe) return "";
  try {
    const u = new URL(maybe, base);
    return u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

export interface PagePreview {
  format: Format;
  title: string;
  summary: string;
  imageUrl: string;
  siteName: string;
  sourceUrl: string;
  text: string;
}

/** Reads a page for its title, summary, image and text. A YouTube or Vimeo link becomes a video, a PDF a document. */
export async function previewPage(rawUrl: string): Promise<PagePreview> {
  const page = await fetchPublic(rawUrl);
  const video = videoOf(page.url) ?? videoOf(rawUrl);
  const isPdf = page.contentType.includes("pdf") || /\.pdf(\?|$)/i.test(page.url);
  const meta = metaTags(page.text);
  const titleTag = page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = cut(htmlToText(meta.get("og:title") || meta.get("twitter:title") || titleTag), 200);
  const summary = cut(htmlToText(meta.get("og:description") || meta.get("twitter:description") || meta.get("description") || ""), 600);
  let imageUrl = absolute(meta.get("og:image") || meta.get("twitter:image") || "", page.url);
  if (video?.provider === "youtube" && !imageUrl) imageUrl = `https://i.ytimg.com/vi/${video.ref}/hqdefault.jpg`;
  const main = page.text.match(/<(article|main)\b[\s\S]*?<\/\1>/i)?.[0] ?? page.text.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? "";
  return {
    format: video ? "video" : isPdf ? "document" : "link",
    title: title || (isPdf ? decodeURIComponent(new URL(page.url).pathname.split("/").pop() ?? "") : "") || siteOf(page.url),
    summary,
    imageUrl,
    siteName: cut(htmlToText(meta.get("og:site_name") || ""), 80) || siteOf(page.url),
    sourceUrl: page.url,
    text: video ? summary : cut(htmlToText(main), 60000)
  };
}

/* Feeds */

function tagText(block: string, names: string[]): string {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)<\\/${n}>`, "i"));
    // Feeds often hold escaped HTML, such as &lt;p&gt;. Decode it first, then drop the tags.
    if (m) return htmlToText(decodeEntities(m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")));
  }
  return "";
}

/** Entries of an RSS or Atom feed, newest first as the feed gives them. */
export function parseFeed(xml: string, base: string): { title: string; entries: FeedEntry[] } {
  const channel = xml.replace(/<(item|entry)\b[\s\S]*?<\/\1>/gi, "");
  const title = cut(tagText(channel, ["title"]), 200);
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const entries: FeedEntry[] = [];
  for (const b of blocks.slice(0, 50)) {
    let link = "";
    for (const m of b.matchAll(/<link\b[^>]*>/gi)) {
      const rel = attr(m[0], "rel");
      const href = attr(m[0], "href");
      if (href && (!rel || rel === "alternate")) {
        link = href;
        break;
      }
    }
    if (!link) link = tagText(b, ["link", "guid"]);
    const url = absolute(link.trim(), base);
    if (!url) continue;
    const date = tagText(b, ["pubDate", "published", "updated", "dc:date"]);
    const t = Date.parse(date);
    const img = b.match(/<media:thumbnail\b[^>]*>/i)?.[0] ?? b.match(/<media:content\b[^>]*medium="image"[^>]*>/i)?.[0] ?? b.match(/<enclosure\b[^>]*type="image[^>]*>/i)?.[0] ?? "";
    entries.push({
      url,
      title: cut(tagText(b, ["title"]), 200) || siteOf(url),
      summary: cut(tagText(b, ["description", "summary", "media:description", "content:encoded", "content"]), 600),
      date: Number.isFinite(t) ? new Date(t).toISOString() : null,
      imageUrl: absolute(attr(img, "url"), url)
    });
  }
  return { title, entries };
}

const looksLikeFeed = (f: Fetched) => /xml|rss|atom/.test(f.contentType) || /^\s*(<\?xml[^>]*>\s*)?<(rss|feed|rdf:RDF)\b/i.test(f.text);

/** Finds the feed for a feed or blog address, or for a YouTube channel, and reads its latest entries. */
export async function findFeed(kind: "feed" | "video_channel", rawUrl: string): Promise<FeedPreview> {
  const accept = "application/rss+xml,application/atom+xml,application/xml;q=0.9,text/html;q=0.8,*/*;q=0.5";
  let feedUrl = "";
  if (kind === "video_channel") {
    const u = new URL(cleanUrlOr400(rawUrl));
    const host = u.hostname.replace(/^(www|m)\./, "");
    if (host !== "youtube.com") throw new HttpError(400, "Use a YouTube channel link, such as https://www.youtube.com/@example.");
    const direct = u.pathname.match(/^\/channel\/(UC[\w-]{22})/)?.[1] ?? u.searchParams.get("channel_id");
    let channelId = direct ?? "";
    if (!channelId) {
      const page = await fetchPublic(u.toString());
      channelId = page.text.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/)?.[1] ?? page.text.match(/\/channel\/(UC[\w-]{22})/)?.[1] ?? "";
    }
    if (!channelId) throw new HttpError(400, "That page is not a YouTube channel. Open the channel and copy its address.");
    feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  } else {
    const first = await fetchPublic(rawUrl, accept);
    if (looksLikeFeed(first)) feedUrl = first.url;
    else {
      const link = [...first.text.slice(0, 300000).matchAll(/<link\b[^>]*>/gi)]
        .map((m) => m[0])
        .find((t) => /alternate/i.test(attr(t, "rel")) && /(rss|atom)\+xml/i.test(attr(t, "type")));
      feedUrl = link ? absolute(attr(link, "href"), first.url) : "";
      if (!feedUrl) throw new HttpError(400, "No feed found at that address. Use the feed link (RSS or Atom) of the site.");
    }
  }
  const feed = await fetchPublic(feedUrl, accept);
  if (!looksLikeFeed(feed)) throw new HttpError(400, "That address does not give an RSS or Atom feed.");
  const parsed = parseFeed(feed.text, feed.url);
  return { feedUrl, feedTitle: parsed.title, entries: parsed.entries };
}

function cleanUrlOr400(raw: string): string {
  const c = cleanUrl(raw);
  if ("problem" in c) throw new HttpError(400, c.problem);
  if (!c.url) throw new HttpError(400, "Add the address.");
  return c.url;
}

/* Files */

/** Text of an uploaded document, for the Ask index. Uses Workers AI when the deploy has it. Empty when it cannot read the file. */
export async function fileText(env: Env, name: string, type: string, bytes: ArrayBuffer): Promise<string> {
  if (type.startsWith("text/")) return new TextDecoder().decode(bytes).slice(0, 200000);
  const ai = env.AI as unknown as { toMarkdown?: (f: { name: string; blob: Blob }) => Promise<{ format: string; data?: string }> } | undefined;
  if (!ai?.toMarkdown || type.startsWith("video/") || type.startsWith("image/")) return "";
  try {
    const out = await ai.toMarkdown({ name, blob: new Blob([bytes], { type }) });
    return out.format === "markdown" && out.data ? out.data.slice(0, 200000) : "";
  } catch (err) {
    console.error(`[library] could not read the text of a ${type} file: ${(err as Error).message}`);
    return "";
  }
}

/* Images */

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif)$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Gets a resource's image from its site, so the web app can show it under the site's strict image policy (img-src 'self').
 * Only the stored image of a resource goes through here, never an address from the request. No SVG: it can hold scripts.
 */
export async function fetchImage(rawUrl: string): Promise<Response> {
  const clean = cleanUrl(rawUrl);
  if ("problem" in clean || !clean.url) throw new HttpError(404, "This resource has no image.");
  const u = new URL(clean.url);
  if (privateHost(u.hostname)) throw new HttpError(404, "This resource has no image.");
  let res: Response;
  try {
    res = await fetch(u.toString(), { headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif", "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, "The image did not load.");
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const size = Number(res.headers.get("content-length") ?? "0");
  if (!res.ok || !IMAGE_TYPES.test(type) || size > MAX_IMAGE_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(404, "The image did not load.");
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(404, "The image is too large.");
  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'"
    }
  });
}

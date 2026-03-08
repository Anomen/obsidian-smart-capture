export const DEFAULT_LINK_SEPARATOR = "__OSC_SEP__";
export const DEFAULT_REQUEST_TIMEOUT_MS = 6000;
export const DEFAULT_FETCH_RETRIES = 2;
export const DEFAULT_MAX_PAGE_CONTENT_CHARS = 12000;

export interface FetchResult {
  content: string;
  warning?: string;
}

interface RetryOptions {
  timeoutMs?: number;
  retries?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizePath(path: string | undefined) {
  return (path || "").trim().replace(/^\/+|\/+$/g, "");
}

export function sanitizeFileName(name: string | undefined) {
  const raw = (name || "").trim();
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "");

  return cleaned || `Capture ${new Date().toISOString().slice(0, 10)}`;
}

export function parseLinkInfo(linkInfoStr: string, separator = DEFAULT_LINK_SEPARATOR) {
  const idx = linkInfoStr.indexOf(separator);
  if (idx === -1) {
    return { url: "", title: "" };
  }

  return {
    url: linkInfoStr.slice(0, idx).trim(),
    title: linkInfoStr.slice(idx + separator.length).trim(),
  };
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, num: string) => String.fromCharCode(Number(num)));
}

function stripHtml(input: string) {
  return decodeHtmlEntities(input)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchTagContent(html: string, tag: string) {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = html.match(pattern);
  return match ? stripHtml(match[1]) : "";
}

function matchMetaContent(html: string, key: string, attr: "name" | "property") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta[^>]*${attr}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]).trim() : "";
}

function extractMainHtml(html: string) {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];

  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1];

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

function cleanMainHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

function truncateContent(content: string, maxChars: number) {
  if (content.length <= maxChars) return { text: content, truncated: false };
  return {
    text: `${content.slice(0, maxChars)}\n\n[Truncated: content exceeded ${maxChars} characters]`,
    truncated: true,
  };
}

function buildMetadataBlock(url: string, html: string) {
  const title = matchTagContent(html, "title") || matchMetaContent(html, "og:title", "property") || "";
  const description =
    matchMetaContent(html, "description", "name") || matchMetaContent(html, "og:description", "property") || "";
  const author = matchMetaContent(html, "author", "name") || "";
  const published =
    matchMetaContent(html, "article:published_time", "property") ||
    matchMetaContent(html, "date", "name") ||
    matchMetaContent(html, "pubdate", "name") ||
    "";

  const lines = [`Source: ${url}`];
  if (title) lines.push(`Title: ${title}`);
  if (author) lines.push(`Author: ${author}`);
  if (published) lines.push(`Published: ${published}`);
  if (description) lines.push(`Description: ${description}`);

  return lines.join("\n");
}

export function classifyFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

  if (message === "UNSUPPORTED_CONTENT_TYPE") {
    return "Page content unavailable (unsupported format). Captured metadata only.";
  }

  if (message.startsWith("HTTP_403") || message.startsWith("HTTP_401")) {
    return "Page blocked content fetch (auth/permission). Captured metadata only.";
  }

  if (message.startsWith("HTTP_")) {
    return `Page fetch failed (${message.replace("HTTP_", "HTTP ")}). Captured metadata only.`;
  }

  if (message.includes("aborted")) {
    return "Page fetch timed out. Captured metadata only.";
  }

  return "Failed to fetch page content. Captured metadata only.";
}

export function extractReadablePageContentFromHtml(
  url: string,
  html: string,
  maxChars = DEFAULT_MAX_PAGE_CONTENT_CHARS
) {
  const metadata = buildMetadataBlock(url, html);
  const mainHtml = cleanMainHtml(extractMainHtml(html));
  const extracted = stripHtml(mainHtml);

  if (!extracted || extracted.length < 120) {
    return {
      content: `${metadata}\n\n[No readable main content found]`,
      warning: "No readable main content found. Captured metadata only.",
    } as FetchResult;
  }

  const truncated = truncateContent(extracted, maxChars);
  const warning = truncated.truncated ? "Page content was truncated to fit capture limits." : undefined;

  return {
    content: `${metadata}\n\n---\n\n${truncated.text}`,
    warning,
  } as FetchResult;
}

export async function fetchHtmlWithRetries(url: string, options: RetryOptions = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_FETCH_RETRIES;
  let lastError: unknown = undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new Error("UNSUPPORTED_CONTENT_TYPE");
      }

      return await response.text();
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < retries) {
        await sleep(250 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

export async function fetchPageContent(url: string) {
  const html = await fetchHtmlWithRetries(url);
  return extractReadablePageContentFromHtml(url, html);
}

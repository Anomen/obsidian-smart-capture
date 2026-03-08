import { describe, expect, it } from "vitest";
import {
  classifyFetchError,
  extractReadablePageContentFromHtml,
  normalizePath,
  parseLinkInfo,
  sanitizeFileName,
} from "./web-capture";

describe("web-capture utils", () => {
  it("normalizes paths", () => {
    expect(normalizePath(" /inbox/captures/ ")).toBe("inbox/captures");
    expect(normalizePath("")).toBe("");
  });

  it("sanitizes invalid filename characters", () => {
    expect(sanitizeFileName(' A/B:C*D?"E<F>G| ')).toBe("A-B-C-D--E-F-G-");
  });

  it("parses link info with separator", () => {
    expect(parseLinkInfo("https://example.com__OSC_SEP__Example")).toEqual({
      url: "https://example.com",
      title: "Example",
    });
  });

  it("returns blanks when link info separator is missing", () => {
    expect(parseLinkInfo("no-separator-here")).toEqual({ url: "", title: "" });
  });

  it("classifies common fetch errors", () => {
    expect(classifyFetchError(new Error("HTTP_403"))).toContain("auth/permission");
    expect(classifyFetchError(new Error("HTTP_500"))).toContain("HTTP 500");
    expect(classifyFetchError(new Error("aborted"))).toContain("timed out");
    expect(classifyFetchError(new Error("random"))).toContain("Failed to fetch");
  });

  it("extracts readable content with metadata", () => {
    const body = "Readable content ".repeat(20);
    const html = `<html><head><title>Page Title</title><meta name="description" content="Desc"></head><body><article>${body}</article></body></html>`;
    const result = extractReadablePageContentFromHtml("https://example.com", html);

    expect(result.warning).toBeUndefined();
    expect(result.content).toContain("Source: https://example.com");
    expect(result.content).toContain("Title: Page Title");
    expect(result.content).toContain("Description: Desc");
    expect(result.content).toContain("Readable content");
  });

  it("falls back to metadata when readable content is too short", () => {
    const html = "<html><head><title>Short</title></head><body><article>tiny</article></body></html>";
    const result = extractReadablePageContentFromHtml("https://example.com/short", html);

    expect(result.warning).toContain("No readable main content");
    expect(result.content).toContain("Source: https://example.com/short");
    expect(result.content).toContain("[No readable main content found]");
  });

  it("truncates long content", () => {
    const html = `<html><body><article>${"x".repeat(300)}</article></body></html>`;
    const result = extractReadablePageContentFromHtml("https://example.com/long", html, 100);

    expect(result.warning).toContain("truncated");
    expect(result.content).toContain("[Truncated: content exceeded 100 characters]");
  });
});

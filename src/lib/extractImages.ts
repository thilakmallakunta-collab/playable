import * as cheerio from "cheerio";

export interface ExtractedImage {
  id: string;
  dataUri: string;
  mimeType: string;
  sizeBytes: number;
  source: string; // where the image was found
  width?: number;
  height?: number;
}

/**
 * Extracts all embedded images from an HTML playable ad file.
 * Playable ads typically embed images as base64 data URIs in:
 * - <img> tag src attributes
 * - CSS background-image properties (inline styles & <style> blocks)
 * - JavaScript string literals
 * - Any other data:image/... URI in the raw HTML
 */
export function extractImages(htmlContent: string): ExtractedImage[] {
  const imageMap = new Map<string, ExtractedImage>();
  let idCounter = 0;

  function addImage(dataUri: string, source: string) {
    // Normalize: trim whitespace, remove line breaks inside the data URI
    const cleaned = dataUri.replace(/\s+/g, "");

    // Skip tiny images (likely tracking pixels) under 100 bytes of base64 data
    const base64Part = cleaned.split(",")[1];
    if (!base64Part || base64Part.length < 100) return;

    // Deduplicate by the base64 content hash (first 200 chars is enough)
    const dedupeKey = base64Part.substring(0, 200);
    if (imageMap.has(dedupeKey)) return;

    const mimeMatch = cleaned.match(/^data:(image\/[^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";

    // Estimate raw size from base64 length
    const sizeBytes = Math.floor((base64Part.length * 3) / 4);

    imageMap.set(dedupeKey, {
      id: `img-${idCounter++}`,
      dataUri: cleaned,
      mimeType,
      sizeBytes,
      source,
    });
  }

  // Strategy 1: Parse <img> tags with cheerio
  try {
    const $ = cheerio.load(htmlContent);

    $("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src && src.startsWith("data:image")) {
        addImage(src, "img-tag");
      }
    });

    // Strategy 2: CSS background-image in inline styles
    const cssUrlRegex = /url\(\s*["']?(data:image\/[^"')]+)["']?\s*\)/gi;

    $("[style]").each((_, el) => {
      const style = $(el).attr("style") || "";
      let cssMatch;
      const re1 = new RegExp(cssUrlRegex.source, cssUrlRegex.flags);
      while ((cssMatch = re1.exec(style)) !== null) {
        addImage(cssMatch[1], "inline-style");
      }
    });

    // Strategy 3: <style> blocks
    $("style").each((_, el) => {
      const cssText = $(el).text();
      let cssMatch;
      const re2 = new RegExp(cssUrlRegex.source, cssUrlRegex.flags);
      while ((cssMatch = re2.exec(cssText)) !== null) {
        addImage(cssMatch[1], "style-block");
      }
    });
  } catch {
    // If cheerio parsing fails, we'll still catch images via regex below
  }

  // Strategy 4: Global regex sweep for any data:image URI in the raw HTML
  // This catches images inside <script> tags, JSON data, template literals, etc.
  const globalRegex =
    /data:image\/(?:png|jpe?g|gif|webp|svg\+xml|bmp|ico);base64,[A-Za-z0-9+/=]+/g;
  let match;
  while ((match = globalRegex.exec(htmlContent)) !== null) {
    addImage(match[0], "raw-scan");
  }

  return Array.from(imageMap.values());
}

/**
 * Returns a human-readable file size string
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

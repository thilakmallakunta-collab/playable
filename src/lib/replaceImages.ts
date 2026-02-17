/**
 * Replaces an image in the HTML content by finding the original base64 data
 * and swapping it with the new data URI.
 *
 * Since extracted images have their whitespace stripped during extraction,
 * we use a unique prefix of the base64 data to locate the original in the HTML.
 */
export function replaceImageInHtml(
  html: string,
  oldDataUri: string,
  newDataUri: string
): string {
  // Extract the base64 portion from the old data URI
  const commaIndex = oldDataUri.indexOf(",");
  if (commaIndex === -1) return html;

  const base64Data = oldDataUri.substring(commaIndex + 1);

  // Use a unique chunk of the base64 to find it in the HTML
  // Take first 60 chars — enough to be unique
  const searchChunk = base64Data.substring(0, 60);

  // Build a regex that matches the full data:image URI containing this chunk
  // Allow for optional whitespace/newlines in the original HTML
  const searchChunkWithWhitespace = searchChunk
    .split("")
    .map((ch) => escapeRegex(ch) + "\\s*")
    .join("");

  const pattern = new RegExp(
    `data:image\\/[^;]+;base64,\\s*[A-Za-z0-9+/\\s]*${searchChunkWithWhitespace}[A-Za-z0-9+/=\\s]*`,
    "g"
  );

  // Replace first occurrence
  let replaced = false;
  const result = html.replace(pattern, (match) => {
    if (replaced) return match;
    replaced = true;
    return newDataUri;
  });

  // Fallback: if regex didn't match (rare), try simple string replace
  if (!replaced) {
    // Try direct replacement with the cleaned data URI
    const directResult = html.replace(oldDataUri, newDataUri);
    if (directResult !== html) {
      return directResult;
    }

    // Try with just the base64 search chunk
    const shortChunk = base64Data.substring(0, 40);
    const idx = html.indexOf(shortChunk);
    if (idx !== -1) {
      // Find the start of this data URI
      const beforeChunk = html.substring(Math.max(0, idx - 200), idx);
      const dataStart = beforeChunk.lastIndexOf("data:image");
      if (dataStart !== -1) {
        const absoluteStart = Math.max(0, idx - 200) + dataStart;
        // Find the end (next quote, paren, or whitespace after base64)
        const afterStart = html.substring(absoluteStart);
        const endMatch = afterStart.match(
          /^data:image\/[^;]+;base64,[A-Za-z0-9+/=\s]+/
        );
        if (endMatch) {
          return (
            html.substring(0, absoluteStart) +
            newDataUri +
            html.substring(absoluteStart + endMatch[0].length)
          );
        }
      }
    }
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

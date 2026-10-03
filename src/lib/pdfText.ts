import "server-only";
import type { PDFFont } from "pdf-lib";

// pdf-lib's StandardFonts (Helvetica) can only encode WinAnsi/CP1252 — any
// stray Unicode char in a product name or address (e.g. a non-breaking hyphen
// or a "″" inch mark pasted from a vendor sheet) throws "WinAnsi cannot
// encode". Every string must pass through toWinAnsi() before drawText / width
// measuring. Mirrors lib/pdf-text.ts in the web store.
const CP1252_EXTRA = new Set("ŒœŠšŸŽžƒˆ˜" + "–—‘’‚“”„†‡" + "•…‰‹›€™");
const REPLACEMENTS: Record<string, string> = {
  "\t": " ",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
  " ": " ", " ": " ", " ": " ", " ": " ", "　": " ",
  "​": "", "‌": "", "‍": "", "﻿": "",
  "‐": "-", "‑": "-", "‒": "-", "―": "-", "−": "-",
  "′": "'", "‵": "'", "″": '"', "‶": '"',
  "⁄": "/", "ı": "i", "ﬁ": "fi", "ﬂ": "fl",
  "×": "x", // "2× Item" — U+00D7 is encodable but prints oddly in Helvetica at small sizes
};
const encodable = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (c >= 0x20 && c <= 0xff && !(c >= 0x7f && c <= 0x9f)) || c === 0x0a || c === 0x0d || CP1252_EXTRA.has(ch);
};

export function toWinAnsi(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const mapped = REPLACEMENTS[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if (encodable(ch)) {
      out += ch;
      continue;
    }
    // Accent fallback (ş→s, ğ→g, İ→I …); still-unencodable chars are dropped.
    const stripped = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out += stripped !== ch && [...stripped].every(encodable) ? stripped : "";
  }
  return out;
}

/**
 * Greedy word-wrap for pdf-lib: at most `maxLines` lines that fit `maxWidth`;
 * anything left over is ellipsized on the last line. maxLines = Infinity wraps
 * everything (used for the fine print).
 */
export function wrapPdfText(s: string, font: PDFFont, size: number, maxWidth: number, maxLines = 2): string[] {
  const words = toWinAnsi(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (!cur || font.widthOfTextAtSize(t, size) <= maxWidth) {
      cur = t;
      continue;
    }
    if (lines.length === maxLines - 1) {
      cur = `${cur}…`;
      while (cur.length > 1 && font.widthOfTextAtSize(cur, size) > maxWidth) cur = `${cur.slice(0, -2)}…`;
      lines.push(cur);
      return lines;
    }
    lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  return lines;
}

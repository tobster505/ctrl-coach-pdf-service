/**
 * CTRL Export Service · fill-template (Coach PDF)
 * Place at: /pages/api/fill-template.js
 * Streams a filled PDF (Content-Type: application/pdf).
 */

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────── utils ───────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (v, fb = "") =>
  String(v ?? fb)
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ").replace(/[•·]/g, "-")
    .replace(/\u2194/g, "<->").replace(/\u2192/g, "->").replace(/\u2190/g, "<-")
    .replace(/\u2191/g, "^").replace(/\u2193/g, "v").replace(/[\u2196-\u2199]/g, "->")
    .replace(/\u21A9/g, "<-").replace(/\u21AA/g, "->").replace(/\u00D7/g, "x")
    .replace(/[\u200B-\u200D\u2060]/g, "").replace(/[\uD800-\uDFFF]/g, "").replace(/[\uE000-\uF8FF]/g, "")
    .replace(/\t/g, " ").replace(/\r\n?/g, "\n").replace(/[ \f\v]+/g, " ").replace(/[ \t]+\n/g, "\n").trim();

function parseDataParam(b64ish) {
  if (!b64ish) return {};
  let s = String(b64ish);
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); }
  catch { return {}; }
}

/* word-wrap draw helper (TL coords → BL inside) */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  const { x=40, y=40, w=540, size=12, lineGap=3, color=rgb(0,0,0), align="left" } = spec;
  const maxLines = (opts.maxLines ?? spec.maxLines ?? 6);
  const hard = norm(text || "");
  const lines = hard.split(/\n/).map(s => s.trim());
  const wrapped = [];
  const widthOf = (s) => font.widthOfTextAtSize(s, Math.max(1, size));
  const wrapLine = (ln) => {
    const words = ln.split(/\s+/); let cur = "";
    for (const w0 of words) {
      const nxt = cur ? `${cur} ${w0}` : w0;
      if (widthOf(nxt) <= w || !cur) cur = nxt;
      else { wrapped.push(cur); cur = w0; }
    }
    wrapped.push(cur);
  };
  for (const ln of lines) wrapLine(ln);

  const out = wrapped.slice(0, maxLines);
  const pageH = page.getHeight();
  const baselineY = pageH - y;
  const lineH = Math.max(1, size) + lineGap;

  let yCursor = baselineY;
  for (const ln of out) {
    let xDraw = x; const wLn = widthOf(ln);
    if (align === "center") xDraw = x + (w - wLn) / 2;
    else if (align === "right") xDraw = x + (w - wLn);
    page.drawText(ln, { x: xDraw, y: yCursor - size, size: Math.max(1, size), font, color });
    yCursor -= lineH;
  }
}

const rectTLtoBL = (page, box, inset = 0) => {
  const H = page.getHeight();
  const x = N(box.x) + inset;
  const w = Math.max(0, N(box.w) - inset * 2);
  const h = Math.max(0, N(box.h) - inset * 2);
  const y = H - N(box.y) - N(box.h) + inset;
  return { x, y, w, h };
};

function resolveDomKey(...candidates) {
  const mapLabel = { concealed:"C", triggered:"T", regulated:"R", lead:"L" };
  for (const c0 of candidates.flat()) {
    const c = String(c0 || "").trim();
    if (!c) continue;
    const u = c.toUpperCase();
    if (["C","T","R","L"].includes(u)) return u;
    const l = c.toLowerCase();
    if (mapLabel[l]) return mapLabel[l];
  }
  return "";
}

function paintStateHighlight(page3, dom, cfg = {}) {
  const b = (cfg.absBoxes && cfg.absBoxes[dom]) || null;
  if (!b) return;
  const radius  = Number.isFinite(+((cfg.styleByState||{})[dom]?.radius)) ? +((cfg.styleByState||{})[dom].radius) : (cfg.highlightRadius ?? 28);
  const inset   = Number.isFinite(+((cfg.styleByState||{})[dom]?.inset))  ? +((cfg.styleByState||{})[dom].inset)  : (cfg.highlightInset  ?? 6);
  const opacity = Number.isFinite(+cfg.fillOpacity) ? +cfg.fillOpacity : 0.45;
  const boxBL = rectTLtoBL(page3, b, inset);
  const shade = rgb(251/255, 236/255, 250/255);
  page3.drawRectangle({ x: boxBL.x, y: boxBL.y, width: boxBL.w, height: boxBL.h, borderRadius: radius, color: shade, opacity });
  const perState = (cfg.labelByState && cfg.labelByState[dom]) || null;
  if (!perState || cfg.labelText == null || cfg.labelSize == null) return;
  return { labelX: perState.x, labelY: perState.y };
}

/* locked coordinates (TL, pages 1-based) — tuned for slim coach template */
const LOCKED = {
  meta: { units: "pt", origin: "TL", pages: "1-based" },
  p1: { name: { x:7, y:473, w:500, size:30, align:"center" }, date: { x:210, y:600, w:500, size:25, align:"left" } },
  p3: {
    domChar:{ x:272,y:640,w:630,size:23,align:"left", maxLines:6 },
    domDesc:{ x: 25,y:685,w:550,size:18,align:"left", maxLines:12 },
    state: {
     
::contentReference[oaicite:0]{index=0}

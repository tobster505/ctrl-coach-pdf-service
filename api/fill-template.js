/**
 * CTRL Coach Export Service · fill-template (Coach flow)
 * Path: /pages/api/fill-template.js
 * Layout: p1 name/date; p2 name header; p3 overview+coach_summary; p4 spiderdesc (+chart);
 *         p5 sequence; p6 themepair; p7 adapt_colleagues; p8 adapt_leaders; p9 tips+acts; p10 name header.
 */
export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────── tiny utils ───────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);

const norm = (v, fb = "") =>
  String(v ?? fb)
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[•·]/g, "-")
    .replace(/\u2194/g, "<->")
    .replace(/\u2192/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/\u2191/g, "^")
    .replace(/\u2193/g, "v")
    .replace(/[\u2196-\u2199]/g, "->")
    .replace(/\u21A9/g, "<-")
    .replace(/\u21AA/g, "->")
    .replace(/\u00D7/g, "x")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/\t/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \f\v]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

async function loadTemplateBytesLocal(filename) {
  const fname = String(filename || "").trim();
  const __file = fileURLToPath(import.meta.url);
  const __dir = path.dirname(__file);
  const candidates = [
    path.join(__dir, "..", "..", "public", fname),
    path.join(__dir, "..", "public", fname),
    path.join(process.cwd(), "public", fname),
  ];
  for (const pth of candidates) {
    try {
      return await fs.readFile(pth);
    } catch {}
  }
  throw new Error("Template not found for /public: " + fname);
}

/* basic text drawing */
function drawTextBox(page, font, text, spec = {}) {
  if (!page || !text) return;
  const { x, y, w, size, align, color = rgb(0, 0, 0), maxLines = 50 } = spec;
  const lineGap = 3;
  const lines = norm(text).split(/\n/);
  const lh = size + lineGap;
  const pageH = page.getHeight();
  let yCursor = pageH - y;
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const ln = lines[i];
    let xDraw = x;
    const wLn = font.widthOfTextAtSize(ln, size);
    if (align === "center") xDraw = x + (w - wLn) / 2;
    else if (align === "right") xDraw = x + (w - wLn);
    page.drawText(ln, { x: xDraw, y: yCursor - size, size, font, color });
    yCursor -= lh;
  }
}

/* safe page getter */
const pageOrNull = (pages, idx) => (pages[idx] ? pages[idx] : null);

/* ───────────── handler ───────────── */
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const tpl = "CTRL_Perspective_Assessment_Profile_template_slim_coach.pdf";

    const pdfBytes = await loadTemplateBytesLocal(tpl);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10] = pages;

    // Layout overrides (your coordinates)
    const L = {
      header: { x: 380, y: 51, w: 400, size: 13, align: "left", maxLines: 1 },
      p1: {
        name: { x: 7, y: 473, w: 500, size: 30, align: "center" },
        date: { x: 210, y: 600, w: 500, size: 25, align: "left" },
      },
      p3: {
        overview: { x: 25, y: 280, w: 540, size: 11, align: "left", maxLines: 50 },
        summary: { x: 25, y: 150, w: 540, size: 11, align: "left", maxLines: 50 },
      },
      p4: {
        spiderdesc: { x: 25, y: 435, w: 550, size: 11, align: "left", maxLines: 50 },
      },
      p5: {
        sequence: { x: 25, y: 240, w: 550, size: 14, align: "left", maxLines: 50 },
      },
      p6: {
        themepair: { x: 25, y: 430, w: 550, size: 12, align: "left", maxLines: 50 },
      },
      p7: {
        adapt_colleagues: { x: 25, y: 180, w: 550, size: 14, align: "left", maxLines: 50 },
      },
      p8: {
        adapt_leaders: { x: 25, y: 180, w: 550, size: 14, align: "left", maxLines: 50 },
      },
      p9: {
        tips: { x: 25, y: 130, w: 550, size: 11, align: "left", maxLines: 50 },
        acts: { x: 25, y: 450, w: 550, size: 11, align: "left", maxLines: 50 },
      },
    };

    const data = req.body || {};

    if (p1 && data.name) drawTextBox(p1, font, data.name, L.p1.name);
    if (p1 && data.dateLbl) drawTextBox(p1, font, data.dateLbl, L.p1.date);

    const putHeader = (page) => {
      if (page && data.name)
        drawTextBox(page, font, data.name, L.header, { maxLines: 1 });
    };
    [p2, p3, p4, p5, p6, p7, p8, p9, p10].forEach(putHeader);

    if (p3 && data.overview) drawTextBox(p3, font, data.overview, L.p3.overview);
    if (p3 && data.coach_summary)
      drawTextBox(p3, font, data.coach_summary, L.p3.summary);
    if (p4 && data.spiderdesc)
      drawTextBox(p4, font, data.spiderdesc, L.p4.spiderdesc);
    if (p5 && data.sequence)
      drawTextBox(p5, font, data.sequence, L.p5.sequence);
    if (p6 && data.themepair)
      drawTextBox(p6, font, data.themepair, L.p6.themepair);
    if (p7 && data.adapt_colleagues)
      drawTextBox(p7, font, data.adapt_colleagues, L.p7.adapt_colleagues);
    if (p8 && data.adapt_leaders)
      drawTextBox(p8, font, data.adapt_leaders, L.p8.adapt_leaders);
    if (p9 && data.tips) drawTextBox(p9, font, data.tips, L.p9.tips);
    if (p9 && data.actions) drawTextBox(p9, font, data.actions, L.p9.acts);

    const bytes = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.end(Buffer.from(bytes));
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
}

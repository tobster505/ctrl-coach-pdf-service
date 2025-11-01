// /api/fill-template.js
// Runtime: Node.js on Vercel (ESM). package.json has "type":"module".
export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

// ───────── helpers ─────────
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0)  => (Number.isFinite(+v) ? +v : fb);

// Try to import @vercel/blob only if available (keeps it optional)
async function tryGetBlobPut() {
  try {
    const mod = await import("@vercel/blob");
    return typeof mod.put === "function" ? mod.put : null;
  } catch {
    return null;
  }
}

// Load a template from /public at runtime
async function loadTemplateBytesLocal(name) {
  const tplPath = path.join(process.cwd(), "public", name);
  const buf = await fs.readFile(tplPath);
  return new Uint8Array(buf);
}

// Map incoming payload into fields your draw calls expect
function normaliseInput(src = {}) {
  return {
    // p1
    name:      S(src?.person?.fullName || src?.name || src?.["p1:n"]),
    dateLbl:   S(src?.person?.dateLabel || src?.dateLabel || src?.["p1:d"]),
    // p3
    domChar:   S(src?.domChar || src?.domchar),
    domDesc:   S(src?.domDesc || src?.domdesc),
    // p4
    spiderdesc: S(src?.spiderdescSection || src?.spider?.desc),
    chartUrl:   S(src?.spider?.chartUrl), // reserved if you later draw an image
  };
}

// Very small text-box helper (replace with your full layout utils when ready)
const L = {
  p1: { name: { x: 120, y: 640, w: 360, size: 20 }, date: { x: 120, y: 615, w: 360, size: 12 } },
  p3: { domChar: { x: 60, y: 520, w: 475, size: 11 }, domDesc: { x: 60, y: 490, w: 475, size: 10 } },
  p4: { spider:  { x: 60, y: 560, w: 475, size: 10 } }
};
function drawTextBox(page, font, text, box) {
  if (!text) return;
  const size = box.size ?? 10;
  page.drawText(String(text), {
    x: box.x, y: box.y, maxWidth: box.w,
    font, size, lineHeight: size * 1.25,
  });
}

// Read payload: prefer POST JSON; accept GET ?data=<base64> as fallback
async function readPayload(req) {
  if (req.method === "POST") {
    // On Vercel, req.body may already be an object; otherwise a string
    return typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  }
  const q = req.query || {};
  if (q.data && typeof q.data === "string") {
    try { return JSON.parse(Buffer.from(q.data, "base64").toString("utf8")); } catch {}
  }
  return q || {};
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    // Template & output name (query string only; body stays for data)
    const q   = req.method === "POST" ? (req.query || {}) : (req.query || {});
    const tpl = S(q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim_coach.pdf");
    const out = S(q.out || "Coach_Profile.pdf");

    // Normalise incoming data
    const src = await readPayload(req);
    const P   = normaliseInput(src);

    // Compose PDF
    const pdfBytes = await loadTemplateBytesLocal(tpl);
    const pdfDoc   = await PDFDocument.load(pdfBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages    = pdfDoc.getPages();

    // p1
    drawTextBox(pages[0], font, P.name,    L.p1.name);
    drawTextBox(pages[0], font, P.dateLbl, L.p1.date);

    // p3
    drawTextBox(pages[2], font, P.domChar, L.p3.domChar);
    drawTextBox(pages[2], font, P.domDesc, L.p3.domDesc);

    // p4
    drawTextBox(pages[3], font, P.spiderdesc, L.p4.spider);

    const outBytes = await pdfDoc.save();

    // Prefer: return a short, public URL using Vercel Blob if available
    const put = await tryGetBlobPut();
    if (put) {
      const blob = await put(out, new Blob([outBytes], { type: "application/pdf" }), {
        access: "public",
        addRandomSuffix: true,
      });
      res.status(200).json({ ok: true, url: blob.url, name: out, bytes: outBytes.length, tpl });
      return;
    }

    // Fallback: stream the PDF inline
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${out}"`);
    res.status(200).send(Buffer.from(outBytes));

  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

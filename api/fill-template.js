// /pages/api/fill-template.js
export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts } from "pdf-lib";

// Optional: short-link via @vercel/blob (safe no-op if not installed/allowed)
let putToBlob = null;
try { ({ put: putToBlob } = await import("@vercel/blob")); } catch (_) {}

const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0)  => (Number.isFinite(+v) ? +v : fb);

// --- Load a template from /public (at build time)
async function loadTemplateBytesLocal(name) {
  const url = new URL(`../../public/${name}`, import.meta.url);
  const buf = await (await fetch(url)).arrayBuffer();
  return new Uint8Array(buf);
}

// --- Map incoming payload into fields your draw calls expect
function normaliseInput(src = {}) {
  return {
    name:    S(src?.person?.fullName || src?.name),
    dateLbl: S(src?.person?.dateLabel || src?.dateLabel || src?.["p1:d"]),
    domChar: S(src?.domChar || src?.domchar),
    domDesc: S(src?.domDesc || src?.domdesc),
    spiderdesc: S(src?.spiderdescSection || src?.spider?.desc),
    chartUrl:   S(src?.spider?.chartUrl),
  };
}

// --- Layout stubs (replace with your real coords/utilities)
const L = {
  p1: { name: { x: 120, y: 640, w: 360, size: 20 }, date: { x: 120, y: 615, w: 360, size: 12 } },
  p3: { domChar: { x: 60, y: 520, w: 475, size: 11, maxLines: 3 }, domDesc: { x: 60, y: 490, w: 475, size: 10, maxLines: 9 } },
  p4: { spider:  { x: 60, y: 560, w: 475, size: 10, maxLines: 18 } }
};
function drawTextBox(page, font, text, box) {
  const size = box.size ?? 10;
  page.drawText(String(text), { x: box.x, y: box.y, maxWidth: box.w, font, size, lineHeight: size * 1.25 });
}

// --- Read request payload (POST JSON preferred; GET base64 fallback)
async function readPayload(req) {
  if (req.method === "POST") {
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
    const q   = req.method === "POST" ? (req.body || {}) : (req.query || {});
    // Default to the COACH template
    const tpl = S(q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim_coach.pdf");
    const out = S(q.out || "Coach_Profile.pdf");

    // Normalised payload
    const src = await readPayload(req);
    const P   = normaliseInput(src);

    // Compose PDF
    const pdfBytes = await loadTemplateBytesLocal(tpl);
    const pdfDoc   = await PDFDocument.load(pdfBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages    = pdfDoc.getPages();

    // p1
    if (P.name)    drawTextBox(pages[0], font, P.name,    L.p1.name);
    if (P.dateLbl) drawTextBox(pages[0], font, P.dateLbl, L.p1.date);

    // p3
    if (P.domChar) drawTextBox(pages[2], font, P.domChar, L.p3.domChar);
    if (P.domDesc) drawTextBox(pages[2], font, P.domDesc, L.p3.domDesc);

    // p4
    if (P.spiderdesc) drawTextBox(pages[3], font, P.spiderdesc, L.p4.spider);

    const outBytes = await pdfDoc.save();

    // Prefer returning a short JSON URL (great for Botpress)
    if (putToBlob) {
      const blob = await putToBlob(out, new Blob([outBytes], { type: "application/pdf" }), {
        access: "public",
        addRandomSuffix: true,
      });
      res.status(200).json({ ok: true, url: blob.url, name: out, bytes: outBytes.length, tpl });
      return;
    }

    // Fallback: stream PDF inline
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${out}"`);
    res.status(200).send(Buffer.from(outBytes));
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
}

// /pages/api/fill-template.js  (Node runtime)
export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts } from "pdf-lib";

// ---- OPTIONAL short-link support via @vercel/blob ----
// If you add @vercel/blob and set WRITE access, we will upload and return a URL.
// If not available, we will just stream the PDF back in the response.
let putToBlob = null;
try { ({ put: putToBlob } = await import('@vercel/blob')); } catch (_) {}

const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0)  => (Number.isFinite(+v) ? +v : fb);

// ---- minimal helpers you already had (stubs for brevity) ----
async function loadTemplateBytesLocal(name) {
  // read from /public at build time
  const url = new URL(`../../public/${name}`, import.meta.url);
  const buf = await (await fetch(url)).arrayBuffer();
  return new Uint8Array(buf);
}

function normaliseInput(src = {}) {
  // Map your incoming payload to the fields your draw calls expect.
  return {
    name: S(src?.person?.fullName),
    dateLbl: S(src?.person?.dateLabel || src?.dateLabel),
    dom: S(src?.dom),
    domChar: S(src?.domchar),
    domDesc: S(src?.domdesc || src?.domDesc),
    spiderdesc: S(src?.spiderdescSection || src?.spider?.desc),
    counts: src?.counts,
    chartUrl: S(src?.spider?.chartUrl),
    // …include any other fields you render…
  };
}

// (stub) your existing layout + drawing utilities
const L = {
  p1: { name: { x: 120, y: 640, w: 360, size: 20 }, date: { x: 120, y: 615, w: 360, size: 12 } },
  p3: { domChar: { x: 60, y: 520, w: 475, size: 11, maxLines: 3 }, domDesc: { x: 60, y: 490, w: 475, size: 10, maxLines: 9 } },
  p4: { spider: { x: 60, y: 560, w: 475, size: 10, maxLines: 18 }, chart: { x: 60, y: 300, w: 200, h: 200 } }
};
function drawTextBox(page, font, text, box, opts={}) {
  const size = box.size ?? 10;
  page.drawText(String(text), { x: box.x, y: box.y, maxWidth: box.w, font, size, lineHeight: size * 1.25 });
}
function resolveDomKey() { return null; } // keep your existing
function tuneSpiderDesc(s){ return String(s||''); }

async function readPayload(req) {
  if (req.method === "POST") {
    // Body may already be parsed as JSON by Vercel (Next.js). If not, parse.
    return typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  }
  // For GET fallback we still support base64 ?data=...
  const q = req.query || {};
  if (q.data && typeof q.data === "string") {
    try { return JSON.parse(Buffer.from(q.data, "base64").toString("utf8")); }
    catch { /* ignore */ }
  }
  return q || {};
}

export default async function handler(req, res) {
  try {
    const q    = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const tpl  = S(q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim_coach.pdf"); // default to coach tpl
    const out  = S(q.out || "Coach_Profile.pdf");
    const src  = await readPayload(req);
    const P    = normaliseInput(src);

    // Load template & compose
    const pdfBytes = await loadTemplateBytesLocal(tpl);
    const pdfDoc   = await PDFDocument.load(pdfBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages    = pdfDoc.getPages();

    // p1
    if (P.name)    drawTextBox(pages[0], font, P.name,    L.p1.name);
    if (P.dateLbl) drawTextBox(pages[0], font, P.dateLbl, L.p1.date);

    // p3
    if (P.domChar) drawTextBox(pages[2], font, P.domChar, L.p3.domChar, { maxLines: L.p3.domChar.maxLines });
    if (P.domDesc) drawTextBox(pages[2], font, P.domDesc, L.p3.domDesc, { maxLines: L.p3.domDesc.maxLines });

    // p4
    const tuned = tuneSpiderDesc(P.spiderdesc);
    if (tuned) drawTextBox(pages[3], font, tuned, L.p4.spider, { maxLines: L.p4.spider.maxLines });

    const outBytes = await pdfDoc.save();

    // If Blob is available, upload & return short JSON link (best for Botpress)
    if (putToBlob) {
      const blob = await putToBlob(out, new Blob([outBytes], { type: "application/pdf" }), {
        access: "public",
        addRandomSuffix: true
      });
      res.status(200).json({ ok: true, url: blob.url, name: out, bytes: outBytes.length });
      return;
    }

    // Fallback: stream PDF directly
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${out}"`);
    res.status(200).send(Buffer.from(outBytes));
  } catch (err) {
    res.status(500).json({ ok:false, error: String(err && err.message || err) });
  }
}

// /api/fill-template.js
// Runtime: Node.js on Vercel (ESM). package.json has "type":"module".
export const config = { runtime: "nodejs" };

import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "fs/promises";
import path from "path";

/* ───────────────── helpers ───────────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0)  => (Number.isFinite(+v) ? +v : fb);

const pick = (...vals) => {
  for (const v of vals) if (v != null && String(v).trim() !== "") return String(v).trim();
  return "";
};

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
  const person   = src.person || {};
  const sections = (src.coach && src.coach.sections) || {};

  return {
    /* page 1 */
    name:    pick(person.fullName, src.FullName, src.name, src["p1:n"]),
    dateLbl: pick(person.dateLabel, src.DateLabel, src.dateLabel, src["p1:d"]),

    /* dominant + spider meta (available for drawing if needed) */
    domState:   pick(src.DominantState, src.domState),
    domChar:    pick(src.DominantCharacter, src.domChar, src.domchar),
    spiderKey:  pick(src.SpiderKey),
    spiderFreq: pick(src.SpiderFreq),

    /* narrative used today */
    domDesc:    pick(
      src.domDesc, src.domdesc,
      src.CoachPDF_coach_summary, src.CoachPDF_overview,
      sections.summary, sections.overview
    ),
    spiderdesc: pick(
      src.spiderdescSection, src.SpiderDesc,
      sections.spider, src.CoachPDF_spiderdesc
    ),

    /* extras (ready for future drawText calls) */
    sequence:     pick(src.Sequence, sections.sequence, src.CoachPDF_sequence),
    themePair:    pick(src.ThemePair, sections.themepair, src.CoachPDF_themepair, src.Coach_PDF_thempair),
    themeNotes:   pick(src.ThemeNotes),
    contextNotes: pick(src.ContextNotes),

    tipsDominant:   pick(src.TipsDominant, sections.tips, src.CoachPDF_tips, src.Coach_PDF_tips),
    tipsSpider:     pick(src.TipsSpider),
    actionsPattern: pick(src.ActionsPattern, src.CoachPDF_actions, sections.actions),
    actionsTheme:   pick(src.ActionsTheme),

    withColWork:  pick(src.WorksWith_Colleagues_Work, sections.withPeers, src.CoachPDF_adapt_colleagues),
    withLeadWork: pick(src.WorksWith_Leaders_Work,   sections.withLeads, src.CoachPDF_adapt_leaders),

    /* chart image url hook (if you render images later) */
    chartUrl: pick(src?.spider?.chartUrl)
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
    const q   = req.query || {};
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
    if (pages[0]) {
      drawTextBox(pages[0], font, P.name,    L.p1.name);
      drawTextBox(pages[0], font, P.dateLbl, L.p1.date);
    }

    // p3
    if (pages[2]) {
      drawTextBox(pages[2], font, P.domChar, L.p3.domChar);
      drawTextBox(pages[2], font, P.domDesc, L.p3.domDesc);
    }

    // p4
    if (pages[3]) {
      drawTextBox(pages[3], font, P.spiderdesc, L.p4.spider);
    }

    const outBytes = await pdfDoc.save();

    // Prefer: return a short, public URL using Vercel Blob if available
    const put = await tryGetBlobPut();
    if (put) {
      // On Node 18+, Blob is globally available
      const blob = await put(out, new Blob([outBytes], { type: "application/pdf" }), {
        access: "public",
        addRandomSuffix: true,
      });
      res.status(200).json({ ok: true, url: blob.url, name: out, bytes: outBytes.length, tpl });
      return;
    }

    // Fallback: return a JSON response with a data: URL (instead of streaming)
    const b64 = Buffer.from(outBytes).toString("base64");
    const dataUrl = `data:application/pdf;base64,${b64}`;
    res.status(200).json({ ok: true, url: dataUrl, name: out, bytes: outBytes.length, tpl });

  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

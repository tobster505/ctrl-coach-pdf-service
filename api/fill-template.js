// /api/fill-template.js
// Runtime: Node.js on Vercel (ESM)
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

// Try to import @vercel/blob only if available
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
    name:    pick(person.fullName, src.FullName, src.name, src["p1:n"]),
    dateLbl: pick(person.dateLabel, src.DateLabel, src.dateLabel, src["p1:d"]),
    domState:   pick(src.DominantState, src.domState),
    domChar:    pick(src.DominantCharacter, src.domChar, src.domchar),
    spiderKey:  pick(src.SpiderKey),
    spiderFreq: pick(src.SpiderFreq),
    domDesc:    pick(src.domDesc, src.domdesc, src.CoachPDF_coach_summary, src.CoachPDF_overview, sections.summary, sections.overview),
    spiderdesc: pick(src.spiderdescSection, src.SpiderDesc, sections.spider, src.CoachPDF_spiderdesc),
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
    chartUrl: pick(src?.spider?.chartUrl)
  };
}

/* ───────────────── layout helpers ───────────────── */
const L = {
  p1: { name: { x: 120, y: 640, w: 360, size: 20 }, date: { x: 120, y: 615, w: 360, size: 12 } },
  p3: { domChar: { x: 60, y: 520, w: 475, size: 11 }, domDesc: { x: 60, y: 490, w: 475, size: 10 } },
  p4: { spider:  { x: 60, y: 560, w: 475, size: 10 } }
};
function drawTextBox(page, font, text, box) {
  if (!text) return;
  const size = box.size ?? 10;
  page.drawText(String(text), { x: box.x, y: box.y, maxWidth: box.w, font, size, lineHeight: size * 1.25 });
}

/* ───────────────── payload reader ───────────────── */
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

/* ───────────────── main handler ───────────────── */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    // 🧩 DEBUG LOGGING — will appear in Vercel Logs
    console.log("=== [fill-template] DEBUG ===");
    console.log("Method:", req.method);
    console.log("Query:", req.query);
    console.log("Body type:", typeof req.body);
    try {
      console.log("Body preview:", JSON.stringify(req.body).slice(0, 400));
    } catch {
      console.log("Body preview: [unserializable]");
    }

    const q   = req.query || {};
    const tpl = S(q.tpl || "CTRL_Perspective_Assessment_Profile_template_slim_coach.pdf");
    const out = S(q.out || "Coach_Profile.pdf");

    const src = await readPayload(req);
    const P   = normaliseInput(src);

    const pdfBytes = await loadTemplateBytesLocal(tpl);
    const pdfDoc   = await PDFDocument.load(pdfBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages    = pdfDoc.getPages();

    if (pages[0]) {
      drawTextBox(pages[0], font, P.name, L.p1.name);
      drawTextBox(pages[0], font, P.dateLbl, L.p1.date);
    }
    if (pages[2]) {
      drawTextBox(pages[2], font, P.domChar, L.p3.domChar);
      drawTextBox(pages[2], font, P.domDesc, L.p3.domDesc);
    }
    if (pages[3]) {
      drawTextBox(pages[3], font, P.spiderdesc, L.p4.spider);
    }

    const outBytes = await pdfDoc.save();

    const put = await tryGetBlobPut();
    if (put) {
      const blob = await put(out, new Blob([outBytes], { type: "application/pdf" }), {
        access: "public",
        addRandomSuffix: true,
      });
      res.status(200).json({ ok: true, url: blob.url, name: out, bytes: outBytes.length, tpl });
      return;
    }

    const b64 = Buffer.from(outBytes).toString("base64");
    const dataUrl = `data:application/pdf;base64,${b64}`;
    res.status(200).json({ ok: true, url: dataUrl, name: out, bytes: outBytes.length, tpl });

  } catch (err) {
    console.error("[fill-template] ERROR:", err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

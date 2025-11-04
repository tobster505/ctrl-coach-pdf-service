/**
 * CTRL Coach Export Service · fill-template (Coach flow)
 * Path: /pages/api/fill-template.js  (ctrl-coach-pdf-service)
 * Layout: p1 name/date; p2 name header; p3 overview+coach_summary; p4 spiderdesc (+chart);
 *         p5 sequence; p6 themepair; p7 adapt_colleagues; p8 adapt_leaders; p9 tips+acts; p10 name header.
 */
export const config = { runtime: "nodejs" };

/* ───────────── imports ───────────── */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────── tiny utils ───────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0)   => (Number.isFinite(+v) ? +v : fb);

const norm = (v, fb = "") =>
  String(v ?? fb)
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010\u2013\u2014]/g, "-")      // ← added \u2010 here
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[•·]/g, "-")
    // arrows → WinAnsi-safe
    .replace(/\u2194/g, "<->").replace(/\u2192/g, "->").replace(/\u2190/g, "<-")
    .replace(/\u2191/g, "^").replace(/\u2193/g, "v").replace(/[\u2196-\u2199]/g, "->")
    .replace(/\u21A9/g, "<-").replace(/\u21AA/g, "->")
    .replace(/\u00D7/g, "x")
    // zero-width, emoji/PUA
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\uE000-\uF8FF]/g, "")
    // tidy
    .replace(/\t/g, " ").replace(/\r\n?/g, "\n")
    .replace(/[ \f\v]+/g, " ").replace(/[ \t]+\n/g, "\n").trim();

function parseDataParam(b64ish) {
  if (!b64ish) return {};
  let s = String(b64ish);
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); }
  catch { return {}; }
}

/* GET/POST payload reader (supports ?data= and JSON body) */
async function readPayload(req) {
  const q = req.method === "POST" ? (req.body || {}) : (req.query || {});
  if (q.data) return parseDataParam(q.data);
  if (req.method === "POST" && !q.data) {
    try { return typeof req.json === "function" ? await req.json() : (req.body || {}); }
    catch { /* fallthrough */ }
  }
  return {};
}

/* TL → simple textbox (does internal TL->BL conversion) */
function drawTextBox(page, font, text, spec = {}, opts = {}) {
  if (!page) return;
  const {
    x = 40,
    y = 40,
    w = 540,
    size = 12,
    lineGap = 3,
    color = rgb(0, 0, 0),
    align = "left",
    h,               // optional height for auto maxLines
  } = spec;

  const lineHeight = Math.max(1, size) + lineGap;
  const maxLines =
    opts.maxLines ??
    spec.maxLines ??
    (h ? Math.max(1, Math.floor(h / lineHeight)) : 6);

  const hard = norm(text || "");
  if (!hard) return;

  const lines = hard.split(/\n/).map((s) => s.trim());
  const wrapped = [];
  const widthOf = (s) => font.widthOfTextAtSize(s, Math.max(1, size));

  const wrapLine = (ln) => {
    const words = ln.split(/\s+/);
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const nxt = cur ? `${cur} ${words[i]}` : words[i];
      if (widthOf(nxt) <= w || !cur) cur = nxt;
      else {
        wrapped.push(cur);
        cur = words[i];
      }
    }
    wrapped.push(cur);
  };
  for (const ln of lines) wrapLine(ln);

  const out = wrapped.slice(0, maxLines);
  const pageH = page.getHeight();
  const baselineY = pageH - y;

  let yCursor = baselineY;
  for (const ln of out) {
    let xDraw = x;
    const wLn = widthOf(ln);
    if (align === "center") xDraw = x + (w - wLn) / 2;
    else if (align === "right") xDraw = x + (w - wLn);
    page.drawText(ln, {
      x: xDraw,
      y: yCursor - size,
      size: Math.max(1, size),
      font,
      color,
    });
    yCursor -= lineHeight;
  }
}

/* robust /public template loader */
async function loadTemplateBytesLocal(filename) {
  const fname = String(filename || "").trim();
  if (!fname.endsWith(".pdf")) throw new Error(`Invalid template filename: ${fname}`);

  const __file = fileURLToPath(import.meta.url);
  const __dir  = path.dirname(__file);

  const candidates = [
    path.join(__dir, "..", "..", "public", fname),
    path.join(__dir, "..", "public", fname),
    path.join(__dir, "public", fname),
    path.join(process.cwd(), "public", fname),
    path.join(__dir, fname),
  ];

  let lastErr;
  for (const pth of candidates) {
    try { return await fs.readFile(pth); }
    catch (err) { lastErr = err; }
  }
  throw new Error(`Template not found for /public: ${fname} (${lastErr?.message||"no detail"})`);
}

/* helpers for QuickChart spider (optional) */
function parseCountsFromFreq(freqStr = "", fb = {C:0,T:0,R:0,L:0}) {
  const out = { C:0, T:0, R:0, L:0 };
  const s = String(freqStr || "");
  const re = /([CTRL]):\s*([0-9]+)/gi;
  let m;
  while ((m = re.exec(s))) { out[m[1].toUpperCase()] = Number(m[2]) || 0; }
  for (const k of ["C","T","R","L"]) if (!out[k] && Number(fb[k])) out[k] = Number(fb[k]);
  return out;
}
function buildSpiderQuickChartUrlFromCounts(counts) {
  const theme = { stroke:"#4B2E83", fill:"rgba(75,46,131,0.22)", point:"#4B2E83", grid:"rgba(0,0,0,0.14)", labels:"#555" };
  const data = [N(counts.C,0), N(counts.T,0), N(counts.R,0), N(counts.L,0)];
  const cfg = {
    type:"radar",
    data:{ labels:["Concealed","Triggered","Regulated","Lead"], datasets:[{ label:"CTRL", data, fill:true, borderColor:theme.stroke, backgroundColor:theme.fill, pointBackgroundColor:theme.point, pointBorderColor:"#fff", borderWidth:4, pointRadius:4, pointBorderWidth:2 }] },
    options:{ plugins:{legend:{display:false}}, scales:{ r:{ min:0, max:5, ticks:{ stepSize:1, color:theme.labels, font:{size:12}}, grid:{color:theme.grid, circular:true}, pointLabels:{ font:{ size:18, weight:"700"}, color:theme.labels } } } }
  };
  const u = new URL("https://quickchart.io/chart");
  u.searchParams.set("c", JSON.stringify(cfg));
  u.searchParams.set("backgroundColor","transparent");
  u.searchParams.set("width","700");
  u.searchParams.set("height","700");
  u.searchParams.set("v", Date.now().toString(36));
  return u.toString();
}
async function embedRemoteImage(pdfDoc, url) {
  try {
    if (!url || !/^https?:/i.test(url)) return null;
    if (typeof fetch === "undefined") return null;
    const res = await fetch(url); if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdfDoc.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdfDoc.embedJpg(bytes);
    try { return await pdfDoc.embedPng(bytes); } catch { return await pdfDoc.embedJpg(bytes); }
  } catch { return null; }
}

/* safe page getter */
const pageOrNull = (pages, idx0) => (pages[idx0] ?? null);

/* ───────────── handler ───────────── */
export default async function handler(req, res) {
  try {
    const q   = req.method === "POST" ? (req.body || {}) : (req.query || {});
    // default to coach template; allow ?tpl= override
    const defaultTpl = "CTRL_Perspective_Assessment_Profile_template_slim_coach.pdf";
    const tpl   = S(q.tpl || defaultTpl).replace(/[^A-Za-z0-9._-]/g, "");
    const src   = await readPayload(req);

    // expected payload (from your Build_CoachPDF_Link card):
    // person.fullName, dateLbl, overview, coach_summary, spiderdesc, sequence,
    // themepair, adapt_colleagues, adapt_leaders, tips, actions, counts? spiderfreq? chartUrl?
    const P = {
      name:             norm(src?.person?.fullName || src?.fullName || "Perspective"),
      dateLbl:          norm(src?.dateLbl || ""),
      overview:         norm(src?.overview),
      coach_summary:    norm(src?.coach_summary),
      spiderdesc:       norm(src?.spiderdesc),
      sequence:         norm(src?.sequence || src?.seqpat || ""),
      themepair:        norm(src?.themepair),
      adapt_colleagues: norm(src?.adapt_colleagues),
      adapt_leaders:    norm(src?.adapt_leaders),
      tips:             norm(src?.tips),
      actions:          norm(src?.actions),
      counts:           (src?.counts && typeof src.counts === "object") ? src.counts : null,
      spiderfreq:       norm(src?.spiderfreq || ""),
      chartUrl:         S(src?.chartUrl || "")
    };

    // load template
    const pdfBytes = await loadTemplateBytesLocal(tpl);
    const pdfDoc   = await PDFDocument.load(pdfBytes);
    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();
    const p1  = pageOrNull(pages, 0);
    const p2  = pageOrNull(pages, 1);
    const p3  = pageOrNull(pages, 2);
    const p4  = pageOrNull(pages, 3);
    const p5  = pageOrNull(pages, 4);
    const p6  = pageOrNull(pages, 5);
    const p7  = pageOrNull(pages, 6);
    const p8  = pageOrNull(pages, 7);
    const p9  = pageOrNull(pages, 8);
    const p10 = pageOrNull(pages, 9);

    /* ───────────── layout anchors (defaults) ───────────── */
    const L = {
      header:  { x: 380, y: 51, w: 400, size: 13, align: "left", maxLines: 1 },
      p1:      {
        name: { x: 7,  y: 473, w: 500, size: 30, align: "center" },
        date: { x: 210,y: 600, w: 500, size: 25, align: "left" }
      },
      p3:      {
        overview: { x: 25, y: 150, w: 550, size: 11, align: "left", maxLines: 50 },
        summary:  { x: 25, y: 480, w: 550, size: 11, align: "left", maxLines: 50 }
      },
      p4:      {
        spiderdesc: { x: 30, y: 585, w: 550, size: 16, align: "left", maxLines: 15 },
        chart:      { x: 35, y: 180, w: 540, h: 180 }
      },
      p5:      { sequence:       { x: 25, y: 560, w: 550, size: 16, align: "left", maxLines: 20 } },
      p6:      { themepair:      { x: 25, y: 560, w: 550, size: 16, align: "left", maxLines: 20 } },
      p7:      { adapt_colleagues:{ x: 25, y: 560, w: 550, size: 16, align: "left", maxLines: 20 } },
      p8:      { adapt_leaders:  { x: 25, y: 560, w: 550, size: 16, align: "left", maxLines: 20 } },
      p9:      {
        tips: { x: 25, y: 560, w: 550, size: 16, align: "left", maxLines: 10 },
        acts: { x: 25, y: 300, w: 550, size: 16, align: "left", maxLines: 10 }
      }
    };

    /* ───────────── dynamic overrides from URL ───────────── */

    // Generic override helper for text boxes
    const overrideBox = (box, key) => {
      if (!box) return;
      if (q[`${key}x`]   != null) box.x        = N(q[`${key}x`],   box.x);
      if (q[`${key}y`]   != null) box.y        = N(q[`${key}y`],   box.y);
      if (q[`${key}w`]   != null) box.w        = N(q[`${key}w`],   box.w);
      if (q[`${key}h`]   != null) box.h        = N(q[`${key}h`],   box.h || 0);
      if (q[`${key}s`]   != null) box.size     = N(q[`${key}s`],   box.size);
      if (q[`${key}max`] != null) box.maxLines = N(q[`${key}max`], box.maxLines);
      if (q[`${key}align`])       box.align    = String(q[`${key}align`]);
    };

    // Overview (page 3)
    overrideBox(L.p3.overview, "ov");    // ovx, ovy, ovw, ovh, ovs, ovmax, ovalign
    // Coach summary (page 3)
    overrideBox(L.p3.summary,  "cs");    // csx, csy, csw, csh, css, csmax, csalign
    // Spider description (page 4)
    overrideBox(L.p4.spiderdesc, "sd");  // sdx, sdy, sdw, sdh, sds, sdmax, sdalign
    // Sequence (page 5)
    overrideBox(L.p5.sequence, "seq");   // seqx, seqy, seqw, seqh, seqs, seqmax, seqalign
    // Theme pair (page 6)
    overrideBox(L.p6.themepair, "tp");   // tpx, tpy, tpw, tph, tps, tpmax, tpalign
    // Adapt with colleagues (page 7)
    overrideBox(L.p7.adapt_colleagues, "ac"); // acx, acy, acw, ach, acs, acmax, acalign
    // Adapt with leaders (page 8)
    overrideBox(L.p8.adapt_leaders, "al");    // alx, aly, alw, alh, als, almax, alalign
    // Tips (page 9)
    overrideBox(L.p9.tips, "tips");      // tipsx, tipsy, tipsw, tipsh, tipss, tipsmax, tipsalign
    // Actions (page 9)
    overrideBox(L.p9.acts, "acts");      // actsx, actsy, actsw, actsh, actss, actsmax, actsalign

    /* ───────────── p1: full name & date ───────────── */
    if (p1 && P.name)    drawTextBox(p1, font, P.name,    L.p1.name);
    if (p1 && P.dateLbl) drawTextBox(p1, font, P.dateLbl, L.p1.date);

    /* ───────────── page headers (p2..p10) ───────────── */
    const putHeader = (page) => {
      if (!page || !P.name) return;
      drawTextBox(page, font, P.name, L.header, { maxLines: 1 });
    };
    [p2,p3,p4,p5,p6,p7,p8,p9,p10].forEach(putHeader);

    /* ───────────── p3: overview + coach_summary ───────────── */
    if (p3 && P.overview)      drawTextBox(p3, font, P.overview,      L.p3.overview);
    if (p3 && P.coach_summary) drawTextBox(p3, font, P.coach_summary, L.p3.summary);

    /* ───────────── p4: spiderdesc (+ optional chart) ───────────── */
    if (p4 && P.spiderdesc) drawTextBox(p4, font, P.spiderdesc, L.p4.spiderdesc);
    if (p4 && L.p4.chart) {
      let chartUrl = String(P.chartUrl || "");
      if (!chartUrl) {
        const counts = P.counts ? {
          C: N(P.counts.C, 0),
          T: N(P.counts.T, 0),
          R: N(P.counts.R, 0),
          L: N(P.counts.L, 0)
        } : parseCountsFromFreq(P.spiderfreq || "");
        const sum = N(counts.C, 0) + N(counts.T, 0) + N(counts.R, 0) + N(counts.L, 0);
        if (sum > 0) chartUrl = buildSpiderQuickChartUrlFromCounts(counts);
      } else {
        try {
          const u = new URL(chartUrl);
          u.searchParams.set("v", Date.now().toString(36));
          chartUrl = u.toString();
        } catch {}
      }
      if (chartUrl) {
        const img = await embedRemoteImage(pdfDoc, chartUrl);
        if (img) {
          const H = p4.getHeight();
          const { x, y, w, h } = L.p4.chart;
          p4.drawImage(img, { x, y: H - y - h, width: w, height: h });
        }
      }
    }

    /* ───────────── p5: sequence ───────────── */
    if (p5 && P.sequence) drawTextBox(p5, font, P.sequence, L.p5.sequence);

    /* ───────────── p6: themepair ───────────── */
    if (p6 && P.themepair) drawTextBox(p6, font, P.themepair, L.p6.themepair);

    /* ───────────── p7: adapt_colleagues ───────────── */
    if (p7 && P.adapt_colleagues) drawTextBox(p7, font, P.adapt_colleagues, L.p7.adapt_colleagues);

    /* ───────────── p8: adapt_leaders ───────────── */
    if (p8 && P.adapt_leaders) drawTextBox(p8, font, P.adapt_leaders, L.p8.adapt_leaders);

    /* ───────────── p9: tips + acts ───────────── */
    if (p9 && P.tips)    drawTextBox(p9, font, P.tips,    L.p9.tips);
    if (p9 && P.actions) drawTextBox(p9, font, P.actions, L.p9.acts);

    /* ───────── output ───────── */
    const bytes = await pdfDoc.save();
    const outName = S(
      q.out || `CTRL_${P.name || "Coach"}_${P.dateLbl || ""}.pdf`
    ).replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.end(Buffer.from(bytes));
  } catch (err) {
    res.status(400).json({ ok:false, error:`fill-template error: ${err?.message || String(err)}` });
  }
}

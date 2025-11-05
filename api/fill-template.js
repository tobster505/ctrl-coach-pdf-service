/**
 * CTRL Coach Export Service · fill-template (Coach flow)
 * Path: /pages/api/fill-template.js  (ctrl-coach-pdf-service)
 *
 * Layout:
 *   p1: name/date (cover)
 *   p2: name header only
 *   p3: snapshot_overview        (from snapshot_summary)
 *   p4: summary                  (from overview)
 *   p5: frequency + spiderdesc   (plus chart)
 *   p6: sequence
 *   p7: themepair
 *   p8: adapt_colleagues
 *   p9: adapt_leaders
 *   p10: tips
 *   p11: actions / acts
 *
 * Header: full name appears on pages 2–11.
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
    .replace(/[\u2010-\u2014]/g, "-")
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
    try {
      return typeof req.json === "function" ? await req.json() : (req.body || {});
    } catch { /* fallthrough */ }
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
  const theme = {
    stroke:"#4B2E83",
    fill:"rgba(75,46,131,0.22)",
    point:"#4B2E83",
    grid:"rgba(0,0,0,0.14)",
    labels:"#555"
  };
  const data = [N(counts.C,0), N(counts.T,0), N(counts.R,0), N(counts.L,0)];
  const cfg = {
    type:"radar",
    data:{
      labels:["Concealed","Triggered","Regulated","Lead"],
      datasets:[{
        label:"CTRL",
        data,
        fill:true,
        borderColor:theme.stroke,
        backgroundColor:theme.fill,
        pointBackgroundColor:theme.point,
        pointBorderColor:"#fff",
        borderWidth:4,
        pointRadius:4,
        pointBorderWidth:2
      }]
    },
    options:{
      plugins:{legend:{display:false}},
      scales:{
        r:{
          min:0,
          max:5,
          ticks:{ stepSize:1, color:theme.labels, font:{size:12}},
          grid:{color:theme.grid, circular:true},
          pointLabels:{ font:{ size:18, weight:"700"}, color:theme.labels }
        }
      }
    }
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

    // expected payload (from Build_CoachPDF_Link):
    const P = {
      name:             norm(src?.person?.fullName || src?.fullName || "Perspective"),
      dateLbl:          norm(src?.dateLbl || ""),

      // snapshot summary vs overview
      snapshot_overview: norm(src?.snapshot_summary || src?.snapshot_overview || ""),
      summary:           norm(src?.overview || src?.coach_summary || ""),

      // frequency & spider
      freqText:         norm(src?.frequency || src?.freq || src?.spiderfreq || ""),
      spiderdesc:       norm(src?.spiderdesc || ""),

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
    const p11 = pageOrNull(pages, 10);  // actions page

    /* ───────────── layout anchors (defaults) ───────────── */
    const L = {
      header:  { x: 380, y: 51,  w: 400, size: 13, align: "left", maxLines: 1 },
      p1:      {
        name: { x: 7,   y: 473, w: 500, size: 30, align: "center" },
        date: { x: 210, y: 600, w: 500, size: 25, align: "left" }
      },
      // p3: snapshot_overview
      p3: {
        snapshot: { x: 25, y: 150, w: 550, size: 14, align: "left", maxLines: 100 }
      },
      // p4: summary (overview)
      p4: {
        summary: { x: 25, y: 150, w: 530, size: 13, align: "left", maxLines: 100 }
      },
      // p5: frequency + spiderdesc split + chart
      p5: {
        top:    { x: 25, y: 150, w: 260, size: 14, align: "left", maxLines: 100 }, // sd*
        bottom: { x: 25, y: 385, w: 550, size: 14, align: "left", maxLines: 50  }, // sdb*
        chart:  { x: 275, y: 160, w: 380, h: 180 }
      },
      // p6: sequence
      p6: {
        sequence: { x: 25, y: 160, w: 550, size: 15, align: "left", maxLines: 500 }
      },
      // p7: themepair
      p7: {
        themepair: { x: 25, y: 300, w: 550, size: 14, align: "left", maxLines: 50 }
      },
      // p8: adapt_colleagues
      p8: {
        adapt_colleagues: { x: 25, y: 180, w: 550, size: 14, align: "left", maxLines: 50 }
      },
      // p9: adapt_leaders
      p9: {
        adapt_leaders: { x: 25, y: 180, w: 550, size: 14, align: "left", maxLines: 50 }
      },
      // p10: tips
      p10: {
        tips: { x: 25, y: 160, w: 550, size: 15, align: "left", maxLines: 50 }
      },
      // p11: actions
      p11: {
        acts: { x: 25, y: 160, w: 550, size: 15, align: "left", maxLines: 50 }
      }
    };

    /* ───────────── dynamic overrides from URL ───────────── */
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

    // Snapshot overview (page 3) — `cs*`
    overrideBox(L.p3.snapshot, "cs");
    // Backwards-compat: also honour `ov*` for p3
    overrideBox(L.p3.snapshot, "ov");

    // Summary (page 4) — `ov*`
    overrideBox(L.p4.summary, "ov");
    // Backwards-compat: also accept `cs*`
    overrideBox(L.p4.summary, "cs");

    // p5 split: top block uses `sd*`, bottom block uses `sdb*`
    overrideBox(L.p5.top,    "sd");   // sdx, sdy, sdw, sds, sdmax, sdalign
    overrideBox(L.p5.bottom, "sdb");  // sdbx, sdby, sdbw, sdbs, sdbmax, sdbalign
    // Backwards-compat: old `freq*` overrides top block
    overrideBox(L.p5.top, "freq");
    // Chart box
    overrideBox(L.p5.chart, "chart");

    // Sequence (page 6)
    overrideBox(L.p6.sequence, "seq");

    // Theme pair (page 7)
    overrideBox(L.p7.themepair, "tp");

    // Adapt colleagues (page 8)
    overrideBox(L.p8.adapt_colleagues, "ac");

    // Adapt leaders (page 9)
    overrideBox(L.p9.adapt_leaders, "al");

    // Tips (page 10)
    overrideBox(L.p10.tips, "tips");

    // Actions (page 11)
    overrideBox(L.p11.acts, "acts");

    /* ───────────── p1: full name & date ───────────── */
    if (p1 && P.name)    drawTextBox(p1, font, P.name,    L.p1.name);
    if (p1 && P.dateLbl) drawTextBox(p1, font, P.dateLbl, L.p1.date);

    /* ───────────── page headers (p2..p11) ───────────── */
    const putHeader = (page) => {
      if (!page || !P.name) return;
      drawTextBox(page, font, P.name, L.header, { maxLines: 1 });
    };
    [p2,p3,p4,p5,p6,p7,p8,p9,p10,p11].forEach(putHeader);

    /* ───────────── p3: snapshot_overview ───────────── */
    if (p3 && P.snapshot_overview) {
      drawTextBox(p3, font, P.snapshot_overview, L.p3.snapshot);
    }

    /* ───────────── p4: summary / overview ───────────── */
    if (p4 && P.summary) {
      drawTextBox(p4, font, P.summary, L.p4.summary);
    }

    /* ───────────── p5: frequency + spiderdesc + chart ───────────── */
    if (p5) {
      // Build the main frequency text
      const freqParts = [];
      if (P.freqText) {
        freqParts.push(P.freqText);
      } else if (P.spiderfreq) {
        freqParts.push(P.spiderfreq);
      } else if (P.counts) {
        const c = {
          C: N(P.counts.C, 0),
          T: N(P.counts.T, 0),
          R: N(P.counts.R, 0),
          L: N(P.counts.L, 0)
        };
        freqParts.push(`Frequency · C: ${c.C} · T: ${c.T} · R: ${c.R} · L: ${c.L}`);
      }
      const freqText = freqParts.join(" ");

      // Split spiderdesc into top + bottom by first blank line
      let spiderTop = "";
      let spiderBottom = "";
      if (P.spiderdesc) {
        const parts = P.spiderdesc.split(/\n\s*\n/);
        if (parts.length === 1) {
          spiderBottom = parts[0];
        } else {
          spiderTop = parts[0];
          spiderBottom = parts.slice(1).join("\n\n");
        }
      }

      const topCombined    = [freqText, spiderTop].filter(Boolean).join("\n\n");
      const bottomCombined = spiderBottom;

      if (topCombined) {
        drawTextBox(p5, font, topCombined, L.p5.top);
      }
      if (bottomCombined) {
        drawTextBox(p5, font, bottomCombined, L.p5.bottom);
      }

      // Chart
      if (L.p5.chart) {
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
            const H = p5.getHeight();
            const { x, y, w, h } = L.p5.chart;
            p5.drawImage(img, { x, y: H - y - h, width: w, height: h });
          }
        }
      }
    }

    /* ───────────── p6: sequence ───────────── */
    if (p6 && P.sequence) {
      drawTextBox(p6, font, P.sequence, L.p6.sequence);
    }

    /* ───────────── p7: themepair ───────────── */
    if (p7 && P.themepair) {
      drawTextBox(p7, font, P.themepair, L.p7.themepair);
    }

    /* ───────────── p8: adapt_colleagues ───────────── */
    if (p8 && P.adapt_colleagues) {
      drawTextBox(p8, font, P.adapt_colleagues, L.p8.adapt_colleagues);
    }

    /* ───────────── p9: adapt_leaders ───────────── */
    if (p9 && P.adapt_leaders) {
      drawTextBox(p9, font, P.adapt_leaders, L.p9.adapt_leaders);
    }

    /* ───────────── p10: tips ───────────── */
    if (p10 && P.tips) {
      drawTextBox(p10, font, P.tips, L.p10.tips);
    }

    /* ───────────── p11: actions ───────────── */
    if (p11 && P.actions) {
      drawTextBox(p11, font, P.actions, L.p11.acts);
    }

    /* ───────── output ───────── */
    const bytes = await pdfDoc.save();
    const outName = S(
      q.out || `CTRL_${P.name || "Coach"}_${P.dateLbl || ""}.pdf`
    ).replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.end(Buffer.from(bytes));
  } catch (err) {
    res
      .status(400)
      .json({ ok:false, error:`fill-template error: ${err?.message || String(err)}` });
  }
}

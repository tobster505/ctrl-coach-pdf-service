/**
 * CTRL Coach Export Service · fill-template (COACH V1 · 6 pages)
 *
 * Based on fill-template V12.3 (user version) with COACH changes:
 * a) exec_summary -> page 2
 * b) ctrl_overview (+ chart) -> page 3
 * c) ctrl_deepdive -> page 4
 * d) themes -> page 4
 * e) workwith colleagues -> page 5 (collabC coords provided)
 * f) workwith leaders -> page 5 (collabT coords provided)
 * g) ONLY render header fullName on page 6
 * h) total pages = 6 (remove any refs to page 7+ / actions)
 *
 * Reference template code: fill-template v12.3.txt :contentReference[oaicite:0]{index=0}
 */

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────────── small utils ───────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (s) => S(s).replace(/\s+/g, " ").trim();
const okObj = (o) => o && typeof o === "object" && !Array.isArray(o);
const okArr = (a) => Array.isArray(a);

function safeJson(obj) {
  try { return JSON.parse(JSON.stringify(obj)); }
  catch { return {}; }
}

function decodeBase64Json(b64) {
  try {
    const raw = Buffer.from(S(b64 || ""), "base64").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clamp(v, min, max) {
  v = N(v, min);
  return Math.max(min, Math.min(max, v));
}

function splitToTwoParas(txt) {
  const t = S(txt || "").trim();
  if (!t) return ["", ""];
  // Split on blank line if present
  const parts = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  if (parts.length <= 1) return [t, ""];
  // 2 parts max
  const a = parts[0];
  const b = parts.slice(1).join("\n\n");
  return [a, b];
}

/* ───────────── text wrapping ───────────── */
function wrapText(text, font, size, maxWidth) {
  const words = S(text || "").replace(/\r/g, "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextBlock(page, text, font, size, x, y, w, opts = {}) {
  const lineGap = N(opts.lineGap, 2);
  const maxLines = N(opts.maxLines, 999);
  const colour = opts.colour || rgb(0.11, 0.11, 0.11);
  const align = opts.align || "left"; // left | centre
  const bullet = !!opts.bullet;
  const bulletIndent = N(opts.bulletIndent, 14);

  const t = S(text || "").trim();
  if (!t) return { usedLines: 0, remaining: "" };

  const lines = wrapText(t, font, size, w - (bullet ? bulletIndent : 0));
  const used = Math.min(lines.length, maxLines);
  const lh = size + lineGap;

  for (let i = 0; i < used; i++) {
    const line = lines[i];
    const lineY = y - i * lh;
    const textX = x + (bullet ? bulletIndent : 0);

    // bullet only on first line if requested
    if (bullet && i === 0) {
      page.drawText("•", { x, y: lineY, size, font, color: colour });
    }

    const drawW = font.widthOfTextAtSize(line, size);
    const xAligned =
      align === "centre"
        ? textX + (w - (bullet ? bulletIndent : 0) - drawW) / 2
        : textX;

    page.drawText(line, { x: xAligned, y: lineY, size, font, color: colour });
  }

  const remainingLines = lines.slice(used);
  const remaining = remainingLines.join("\n");
  return { usedLines: used, remaining };
}

function drawMultiBlockTwoParas(page, p1, p2, font, size, x, y, w, opts = {}) {
  // Draw para1 then para2 (if any) with a small gap; return used height
  const lineGap = N(opts.lineGap, 2);
  const paraGap = N(opts.paraGap, 6);
  const colour = opts.colour || rgb(0.11, 0.11, 0.11);
  const align = opts.align || "left";

  let cursorY = y;
  let usedTotal = 0;

  const a = drawTextBlock(page, p1, font, size, x, cursorY, w, { lineGap, colour, align });
  usedTotal += a.usedLines;
  cursorY = cursorY - a.usedLines * (size + lineGap);

  if (S(p2 || "").trim()) {
    cursorY -= paraGap;
    const b = drawTextBlock(page, p2, font, size, x, cursorY, w, { lineGap, colour, align });
    usedTotal += b.usedLines;
    cursorY = cursorY - b.usedLines * (size + lineGap);
  }

  const usedHeight = y - cursorY;
  return { usedHeight };
}

/* ───────────── Coach block builders ───────────── */
function buildWorkWithBlock(title, para, qArr) {
  const p0 = S(para).trim();
  const qs = (qArr || []).map((x) => S(x).trim()).filter(Boolean);

  if (!p0 && !qs.length) return "";

  const lines = [];
  if (p0) lines.push(p0);

  if (qs.length) {
    lines.push("Reflection questions:");
    qs.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  }

  // Single block, line breaks for wrapping
  return lines.join("\n");
}

function buildCoachSectionBlock(paragraph, questions) {
  const p = S(paragraph || "").trim();
  const qs = (Array.isArray(questions) ? questions : [])
    .map((q) => S(q || "").trim())
    .filter(Boolean);

  if (!p && !qs.length) return "";

  // Avoid double-newlines so this stays as one block for wrapping.
  const lines = [];
  if (p) lines.push(p);

  if (qs.length) {
    lines.push("Reflection questions:");
    qs.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  }

  return lines.join("\n");
}

/* ───────────── normalisation ───────────── */
function normaliseInput(d = {}) {
  const identity = okObj(d.identity) ? d.identity : {};
  const text = okObj(d.text) ? d.text : {};
  const workWith = okObj(d.workWith) ? d.workWith : {};
  const ctrl = okObj(d.ctrl) ? d.ctrl : {};
  const summary = okObj(ctrl.summary) ? ctrl.summary : {};

  const fullName = S(identity.fullName || d.fullName || d.FullName || summary?.identity?.fullName || "").trim();
  const dateLabel = S(identity.dateLabel || d.dateLbl || d.date || d.Date || summary?.dateLbl || "").trim();

  const bandsRaw =
    (okObj(summary.ctrl12) && Object.keys(summary.ctrl12).length ? summary.ctrl12 : null) ||
    (okObj(d.bands) && Object.keys(d.bands).length ? d.bands : null) ||
    (okObj(ctrl.bands) && Object.keys(ctrl.bands).length ? ctrl.bands : null) ||
    {};

  // Exec / Overview / DeepDive / Themes
  // Coach output needs: 1 paragraph + reflection questions (questions come from debug keys)
  const execBlock = buildCoachSectionBlock(
    text.exec_summary || "",
    [
      text.exec_summary_q1,
      text.exec_summary_q2,
      text.exec_summary_q3,
      text.exec_summary_q4,
      text.exec_summary_q5,
      text.exec_summary_q6,
    ]
  );
  const execA = execBlock;
  const execB = "";

  const ovBlock = buildCoachSectionBlock(
    text.ctrl_overview || "",
    [
      text.ctrl_overview_q1,
      text.ctrl_overview_q2,
      text.ctrl_overview_q3,
      text.ctrl_overview_q4,
      text.ctrl_overview_q5,
    ]
  );
  const ovA = ovBlock;
  const ovB = "";

  const ddBlock = buildCoachSectionBlock(
    text.ctrl_deepdive || "",
    [
      text.ctrl_deepdive_q1,
      text.ctrl_deepdive_q2,
      text.ctrl_deepdive_q3,
      text.ctrl_deepdive_q4,
      text.ctrl_deepdive_q5,
      text.ctrl_deepdive_q6,
    ]
  );
  const ddA = ddBlock;
  const ddB = "";

  const thBlock = buildCoachSectionBlock(
    text.themes || "",
    [
      text.themes_q1,
      text.themes_q2,
      text.themes_q3,
      text.themes_q4,
      text.themes_q5,
    ]
  );
  const thA = thBlock;
  const thB = "";

  // Coach "workwith" comes from text.* fields (preferred), with fallback to d.workWith
  const colleaguesBlock =
    buildWorkWithBlock(
      "colleagues",
      S(text.adapt_with_colleagues || workWith.colleagues || ""),
      [
        text.adapt_with_colleagues_q1,
        text.adapt_with_colleagues_q2,
        text.adapt_with_colleagues_q3,
        text.adapt_with_colleagues_q4,
      ]
    );

  const leadersBlock =
    buildWorkWithBlock(
      "leaders",
      S(text.adapt_with_leaders || workWith.leaders || ""),
      [
        text.adapt_with_leaders_q1,
        text.adapt_with_leaders_q2,
        text.adapt_with_leaders_q3,
        text.adapt_with_leaders_q4,
      ]
    );

  const chartUrl =
    S(d.spiderChartUrl || d.spider_chart_url || d.chartUrl || text.chartUrl || "").trim() ||
    S(d.chart?.spiderUrl || d.chart?.url || "").trim() ||
    S(summary?.chart?.spiderUrl || "").trim();

  return {
    raw: d,
    identity: { fullName, dateLabel },
    bands: bandsRaw,

    exec_summary_para1: execA,
    exec_summary_para2: execB,

    ctrl_overview_para1: ovA,
    ctrl_overview_para2: ovB,

    ctrl_deepdive_para1: ddA,
    ctrl_deepdive_para2: ddB,

    themes_para1: thA,
    themes_para2: thB,

    // Coach workwith (page 5)
    workWith: {
      colleagues: colleaguesBlock,
      leaders: leadersBlock,
    },

    chartUrl,
  };
}

/* ───────────── layout defaults (coach) ───────────── */
const DEFAULT_LAYOUT = {
  // page 2 exec summary
  p2: {
    exec1: { x: 60, y: 640, w: 960, size: 23, lineGap: 3, paraGap: 10, align: "left" },
    exec2: { x: 60, y: 500, w: 960, size: 23, lineGap: 3, paraGap: 10, align: "left" }, // unused for coach; kept for compatibility
  },

  // page 3 ctrl overview + chart
  p3: {
    ov1: { x: 60, y: 640, w: 950, size: 22, lineGap: 3, paraGap: 10, align: "left" },
    ov2: { x: 60, y: 500, w: 950, size: 22, lineGap: 3, paraGap: 10, align: "left" }, // unused for coach
    chart: { x: 980, y: 210, w: 720, h: 420 }, // fallback if template changes; actual image placement handled later
  },

  // page 4 deepdive + themes
  p4: {
    dd1: { x: 60, y: 650, w: 950, size: 21, lineGap: 3, paraGap: 10, align: "left" },
    dd2: { x: 60, y: 520, w: 950, size: 21, lineGap: 3, paraGap: 10, align: "left" }, // unused for coach
    th1: { x: 60, y: 360, w: 950, size: 21, lineGap: 3, paraGap: 10, align: "left" },
    th2: { x: 60, y: 250, w: 950, size: 21, lineGap: 3, paraGap: 10, align: "left" }, // unused for coach
  },

  // page 5 workwith blocks (coords you mentioned: collabC/collabT)
  p5: {
    collabC: { x: 60, y: 660, w: 920, size: 21, lineGap: 3, paraGap: 8, align: "left" },
    collabT: { x: 60, y: 320, w: 920, size: 21, lineGap: 3, paraGap: 8, align: "left" },
  },

  // page 6 header only (fullName)
  p6: {
    headerName: { x: 70, y: 1020, size: 30, align: "left" },
    headerDate: { x: 70, y: 980, size: 18, align: "left" }, // date can remain if you want later; you said only name for now
  },
};

/* ───────────── template loader ───────────── */
async function loadTemplateBytes() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // NOTE: adjust to your template filename if needed
  const templatePath =
    process.env.COACH_TEMPLATE_PATH ||
    path.join(__dirname, "templates", "CTRL_Coach_Template.pdf");

  return fs.readFile(templatePath);
}

/* ───────────── optional chart fetch ───────────── */
async function fetchImageBytes(url) {
  // Node 18+ has fetch in runtime. Keep it safe.
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/* ───────────── main handler ───────────── */
export default async function handler(req, res) {
  try {
    // Data can be passed in as ?data=<base64json> OR JSON body
    const { data: dataB64 } = req.query || {};
    const body = okObj(req.body) ? req.body : {};
    const parsed = dataB64 ? decodeBase64Json(dataB64) : null;
    const payload = okObj(parsed) ? parsed : body;

    const D = normaliseInput(payload || {});
    const L = DEFAULT_LAYOUT;

    const bytes = await loadTemplateBytes();
    const pdfDoc = await PDFDocument.load(bytes);

    // fonts
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pages = pdfDoc.getPages();
    // Expecting 6 pages
    const p2 = pages[1];
    const p3 = pages[2];
    const p4 = pages[3];
    const p5 = pages[4];
    const p6 = pages[5];

    // ── page 2: exec summary
    drawMultiBlockTwoParas(
      p2,
      D.exec_summary_para1,
      D.exec_summary_para2,
      fontRegular,
      L.p2.exec1.size,
      L.p2.exec1.x,
      L.p2.exec1.y,
      L.p2.exec1.w,
      { lineGap: L.p2.exec1.lineGap, paraGap: L.p2.exec1.paraGap, align: L.p2.exec1.align }
    );

    // ── page 3: overview text
    drawMultiBlockTwoParas(
      p3,
      D.ctrl_overview_para1,
      D.ctrl_overview_para2,
      fontRegular,
      L.p3.ov1.size,
      L.p3.ov1.x,
      L.p3.ov1.y,
      L.p3.ov1.w,
      { lineGap: L.p3.ov1.lineGap, paraGap: L.p3.ov1.paraGap, align: L.p3.ov1.align }
    );

    // ── page 3: chart (if url provided)
    if (D.chartUrl) {
      const imgBytes = await fetchImageBytes(D.chartUrl);
      if (imgBytes) {
        let embedded;
        // crude type check
        const isPng = imgBytes.slice(0, 8).toString("hex") === "89504e470d0a1a0a";
        if (isPng) embedded = await pdfDoc.embedPng(imgBytes);
        else embedded = await pdfDoc.embedJpg(imgBytes);

        const { x, y, w, h } = L.p3.chart;
        p3.drawImage(embedded, { x, y, width: w, height: h });
      }
    }

    // ── page 4: deepdive + themes
    drawMultiBlockTwoParas(
      p4,
      D.ctrl_deepdive_para1,
      D.ctrl_deepdive_para2,
      fontRegular,
      L.p4.dd1.size,
      L.p4.dd1.x,
      L.p4.dd1.y,
      L.p4.dd1.w,
      { lineGap: L.p4.dd1.lineGap, paraGap: L.p4.dd1.paraGap, align: L.p4.dd1.align }
    );

    drawMultiBlockTwoParas(
      p4,
      D.themes_para1,
      D.themes_para2,
      fontRegular,
      L.p4.th1.size,
      L.p4.th1.x,
      L.p4.th1.y,
      L.p4.th1.w,
      { lineGap: L.p4.th1.lineGap, paraGap: L.p4.th1.paraGap, align: L.p4.th1.align }
    );

    // ── page 5: work with colleagues + leaders
    drawTextBlock(
      p5,
      D.workWith?.colleagues || "",
      fontRegular,
      L.p5.collabC.size,
      L.p5.collabC.x,
      L.p5.collabC.y,
      L.p5.collabC.w,
      { lineGap: L.p5.collabC.lineGap, align: L.p5.collabC.align }
    );

    drawTextBlock(
      p5,
      D.workWith?.leaders || "",
      fontRegular,
      L.p5.collabT.size,
      L.p5.collabT.x,
      L.p5.collabT.y,
      L.p5.collabT.w,
      { lineGap: L.p5.collabT.lineGap, align: L.p5.collabT.align }
    );

    // ── page 6: header name only (as per coach requirement)
    const name = S(D.identity?.fullName || "").trim();
    if (name) {
      p6.drawText(name, {
        x: L.p6.headerName.x,
        y: L.p6.headerName.y,
        size: L.p6.headerName.size,
        font: fontBold,
        color: rgb(0.05, 0.05, 0.05),
      });
    }

    // Export
    const out = await pdfDoc.save();
    res.setHeader("Content-Type", "application/pdf");
    res.status(200).send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: S(e?.message || e),
    });
  }
}

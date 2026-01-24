/**
 * CTRL Coach Export Service · fill-template (COACH V2 · 6 pages)
 *
 * STRICT RULES (as requested):
 * - NO defaults
 * - NO fallbacks
 * - Template location is EXACT:
 *     <projectRoot>/ctrl-coach-pdf-service/public/CTRL_PoC_Coach_Assessment_Profile_template_<TEMPLATEKEY>.pdf
 * - TEMPLATEKEY must be provided at: payload.ctrl.templateKey (e.g. "RT")
 */

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts } from "pdf-lib";

/* ───────────── small utils ───────────── */
const S = (v) => (v == null ? "" : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (s) => S(s).replace(/\s+/g, " ").trim();
const okObj = (o) => o && typeof o === "object" && !Array.isArray(o);

function safeJson(obj) {
  try { return JSON.parse(JSON.stringify(obj)); }
  catch { return { _error: "Could not serialise debug object" }; }
}

/* ───────── filename helpers ───────── */
function clampStrForFilename(s) {
  return S(s)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_\-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function parseDateLabelToYYYYMMDD(dateLbl) {
  const s = S(dateLbl).trim();
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, "0");
    const monRaw = m[2].toLowerCase();
    const yyyy = m[3];
    const map = {
      jan: "01", january: "01",
      feb: "02", february: "02",
      mar: "03", march: "03",
      apr: "04", april: "04",
      may: "05",
      jun: "06", june: "06",
      jul: "07", july: "07",
      aug: "08", august: "08",
      sep: "09", sept: "09", september: "09",
      oct: "10", october: "10",
      nov: "11", november: "11",
      dec: "12", december: "12",
    };
    const mm = map[monRaw] || map[monRaw.slice(0, 3)];
    if (mm) return `${yyyy}-${mm}-${dd}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return clampStrForFilename(s || "date");
}
function makeOutputFilename(fullName, dateLbl) {
  const parts = S(fullName).trim().split(/\s+/).filter(Boolean);
  const first = parts[0] || "First";
  const last = parts.length > 1 ? parts[parts.length - 1] : "Surname";
  const datePart = parseDateLabelToYYYYMMDD(dateLbl);
  const fn = clampStrForFilename(first);
  const ln = clampStrForFilename(last);
  return `Coach_Profile_${fn}_${ln}_${datePart}.pdf`;
}

/* ───────── text wrapping + drawing ───────── */
function wrapText(font, text, size, w) {
  const raw = S(text);
  const paragraphs = raw.split("\n");
  const lines = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    if (!words.length) { lines.push(""); continue; }
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(test, size);
      if (width <= w) line = test;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function drawTextBox(page, font, text, box, opts = {}) {
  if (!page || !font || !box) return;
  const t0 = S(text);
  if (!t0.trim()) return;

  const pageH = page.getHeight();
  const size = N(opts.size ?? box.size ?? 12);
  const lineGap = N(opts.lineGap ?? box.lineGap ?? 2);
  const maxLines = N(opts.maxLines ?? box.maxLines ?? 999);
  const alignRaw = String(opts.align ?? box.align ?? "left").toLowerCase();
  const align = (alignRaw === "centre") ? "center" : alignRaw;
  const pad = N(opts.pad ?? box.pad ?? 0);

  let x = N(box.x);
  let w = Math.max(0, N(box.w));
  let h = Math.max(0, N(box.h));

  // Convert template-top-left to pdf-lib bottom-left
  const yTop = N(box.y);
  const y = pageH - yTop - h;

  x += pad; w = Math.max(0, w - pad * 2);
  const yInnerTop = y + h - pad;

  const lines = wrapText(font, t0, size, w);
  const toDraw = lines.slice(0, maxLines);

  let cursorY = yInnerTop - size;
  for (const line of toDraw) {
    if (cursorY < y + pad) break;

    let drawX = x;
    if (align === "center") {
      const tw = font.widthOfTextAtSize(line, size);
      drawX = x + (w - tw) / 2;
    } else if (align === "right") {
      const tw = font.widthOfTextAtSize(line, size);
      drawX = x + (w - tw);
    }

    page.drawText(line, { x: drawX, y: cursorY, size, font });
    cursorY -= (size + lineGap);
  }
}

/* ───────── chart helpers ───────── */
function makeSpiderChartUrl12(bandsRaw) {
  // expects keys like: C_low, C_mid, C_high, T_low... etc.
  const keys = [
    "C_low","C_mid","C_high",
    "T_low","T_mid","T_high",
    "R_low","R_mid","R_high",
    "L_low","L_mid","L_high",
  ];

  const displayLabels = [
    "","Concealed","",
    "","Triggered","",
    "","Regulated","",
    "","Lead",""
  ];

  const vals = keys.map((k) => Number(bandsRaw?.[k] || 0));
  const maxVal = Math.max(...vals, 1);
  const data = vals.map((v) => (maxVal > 0 ? v / maxVal : 0));

  const CTRL_COLOURS = {
    C: { low: "rgba(230, 228, 225, 0.55)", mid: "rgba(184, 180, 174, 0.55)", high: "rgba(110, 106, 100, 0.55)" },
    T: { low: "rgba(244, 225, 198, 0.55)", mid: "rgba(211, 155,  74, 0.55)", high: "rgba(154,  94,  26, 0.55)" },
    R: { low: "rgba(226, 236, 230, 0.55)", mid: "rgba(143, 183, 161, 0.55)", high: "rgba( 79, 127, 105, 0.55)" },
    L: { low: "rgba(230, 220, 227, 0.55)", mid: "rgba(164, 135, 159, 0.55)", high: "rgba( 94,  63,  90, 0.55)" },
  };

  const colours = keys.map((k) => {
    const state = k[0];
    const tier = k.split("_")[1];
    return CTRL_COLOURS[state]?.[tier] || "rgba(0,0,0,0.10)";
  });

  const startAngle = -Math.PI / 4;

  const cfg = {
    type: "polarArea",
    data: {
      labels: displayLabels,
      datasets: [{
        data,
        backgroundColor: colours,
        borderWidth: 3,
        borderColor: "rgba(0, 0, 0, 0.20)",
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      startAngle,
      scales: {
        r: {
          startAngle,
          min: 0,
          max: 1,
          ticks: { display: false },
          grid: { display: true },
          angleLines: { display: false },
          pointLabels: {
            display: true,
            padding: 14,
            font: { size: 26, weight: "bold" },
            centerPointLabels: true,
          },
        },
      },
    },
  };

  const enc = encodeURIComponent(JSON.stringify(cfg));
  return `https://quickchart.io/chart?c=${enc}&format=png&width=900&height=900&backgroundColor=transparent&version=4`;
}

async function embedRemoteImage(pdfDoc, url) {
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch chart: ${res.status} ${res.statusText}`);

  const buf = new Uint8Array(await res.arrayBuffer());
  const sig = String.fromCharCode(buf[0], buf[1], buf[2], buf[3] || 0);

  if (sig.startsWith("\x89PNG")) return await pdfDoc.embedPng(buf);
  if (sig.startsWith("\xff\xd8")) return await pdfDoc.embedJpg(buf);

  try { return await pdfDoc.embedPng(buf); }
  catch { return await pdfDoc.embedJpg(buf); }
}

async function embedRadarFromBandsOrUrl(pdfDoc, page, box, bandsRaw, chartUrl) {
  if (!pdfDoc || !page || !box) return;

  let url = S(chartUrl).trim();
  if (!url) {
    const hasAny = bandsRaw && typeof bandsRaw === "object" &&
      Object.values(bandsRaw).some((v) => Number(v) > 0);
    if (!hasAny) return;
    url = makeSpiderChartUrl12(bandsRaw);
  }

  const img = await embedRemoteImage(pdfDoc, url);
  if (!img) return;

  const H = page.getHeight();
  page.drawImage(img, {
    x: box.x,
    y: H - box.y - box.h,
    width: box.w,
    height: box.h
  });
}

/* ───────── DEFAULT LAYOUT (COACH · 6 pages) ───────── */
const DEFAULT_LAYOUT = {
  pages: {
    p1: {
      name: { x: 60, y: 458, w: 500, h: 60, size: 30, align: "center", maxLines: 1 },
      date: { x: 230, y: 613, w: 500, h: 40, size: 25, align: "left", maxLines: 1 },
    },

    // Only page 6 needs header fullName
    p6: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },

    // Page 2 content (exec) uses p3Text boxes
    p3Text: {
      exec1: { x: 25, y: 380, w: 550, h: 250, size: 16, align: "left", maxLines: 13 },
      exec2: { x: 25, y: 590, w: 550, h: 420, size: 16, align: "left", maxLines: 22 },
    },

    // Page 3 content (overview + chart) uses p4Text boxes
    p4Text: {
      ov1: { x: 25, y: 160, w: 200, h: 240, size: 16, align: "left", maxLines: 30 },
      ov2: { x: 25, y: 590, w: 550, h: 420, size: 16, align: "left", maxLines: 23 },
      chart: { x: 250, y: 160, w: 320, h: 320 },
    },

    // Page 4 content (deepdive + themes) uses p5Text boxes
    p5Text: {
      dd1: { x: 25, y: 140, w: 550, h: 240, size: 16, align: "left", maxLines: 13 },
      dd2: { x: 25, y: 270, w: 550, h: 310, size: 16, align: "left", maxLines: 17 },
      th1: { x: 25, y: 540, w: 550, h: 160, size: 16, align: "left", maxLines: 9 },
      th2: { x: 25, y: 670, w: 550, h: 160, size: 16, align: "left", maxLines: 9 },
    },

    // Page 5 workwith blocks
    p6WorkWith: {
      collabC: { x: 30,  y: 300, w: 270, h: 420, size: 14, align: "left", maxLines: 14 },
      collabT: { x: 320, y: 300, w: 260, h: 420, size: 14, align: "left", maxLines: 14 },
    },
  },
};

/* ───────── URL layout overrides (unchanged) ───────── */
function applyLayoutOverridesFromUrl(layoutPages, url) {
  const allowed = new Set(["x", "y", "w", "h", "size", "maxLines", "align"]);
  const applied = [];
  const ignored = [];

  for (const [k, v] of url.searchParams.entries()) {
    if (!k.startsWith("L_")) continue;

    const bits = k.split("_");
    if (bits.length < 4) { ignored.push({ k, v, why: "bad_key_shape" }); continue; }

    const pageKey = bits[1];
    const boxKey = bits[2];
    const prop = bits.slice(3).join("_");

    if (!layoutPages?.[pageKey]) { ignored.push({ k, v, why: "unknown_page", pageKey }); continue; }
    if (!layoutPages?.[pageKey]?.[boxKey]) { ignored.push({ k, v, why: "unknown_box", pageKey, boxKey }); continue; }
    if (!allowed.has(prop)) { ignored.push({ k, v, why: "unsupported_prop", prop }); continue; }

    if (prop === "align") {
      const a0 = String(v || "").toLowerCase();
      const a = (a0 === "centre") ? "center" : a0;
      if (!["left", "center", "right"].includes(a)) { ignored.push({ k, v, why: "bad_align", got: a0 }); continue; }
      layoutPages[pageKey][boxKey][prop] = a;
      applied.push({ k, v, pageKey, boxKey, prop });
      continue;
    }

    const num = Number(v);
    if (!Number.isFinite(num)) { ignored.push({ k, v, why: "not_a_number" }); continue; }

    layoutPages[pageKey][boxKey][prop] = (prop === "maxLines") ? Math.max(0, Math.floor(num)) : num;
    applied.push({ k, v, pageKey, boxKey, prop });
  }

  return { applied, ignored, layoutPages };
}

/* ───────── STRICT template loader (NO defaults, NO fallbacks) ───────── */
async function loadTemplateBytesExact(templateKey) {
  const key = S(templateKey).trim();
  if (!key) throw new Error("payload.ctrl.templateKey is REQUIRED (e.g. 'RT'). No defaults are allowed.");
  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    throw new Error(`payload.ctrl.templateKey '${key}' is invalid. Use only letters, numbers, '_' or '-'.`);
  }

  const fname = `CTRL_PoC_Coach_Assessment_Profile_template_${key}.pdf`;

  // EXACT location (as requested)
  const absolutePath = path.join(
    process.cwd(),
    "ctrl-coach-pdf-service",
    "public",
    fname
  );

  try {
    const bytes = await fs.readFile(absolutePath);
    return { bytes, fname, absolutePath };
  } catch {
    throw new Error(`Template not found at EXACT path: ${absolutePath}`);
  }
}

/* ───────── payload parsing (kept flexible: POST JSON or ?data=base64json) ───────── */
async function readPayload(req) {
  if (req.method === "POST") {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString("utf8") || "{}";
    try { return JSON.parse(raw); } catch { return {}; }
  }

  const url = new URL(req.url, "http://localhost");
  const dataB64 = url.searchParams.get("data") || "";
  if (!dataB64) return {};

  try {
    const raw = Buffer.from(dataB64, "base64").toString("utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/* ───────── Coach block builders (para + numbered questions) ───────── */
function buildCoachSectionBlock(paragraph, questions) {
  const p = S(paragraph).trim();
  const qs = (Array.isArray(questions) ? questions : [])
    .map((q) => S(q).trim())
    .filter(Boolean);

  if (!p && !qs.length) return "";

  const lines = [];
  if (p) lines.push(p);

  if (qs.length) {
    lines.push("Reflection questions:");
    qs.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  }

  return lines.join("\n");
}

function normaliseInput(d = {}) {
  // NOTE: we are NOT defaulting/falling back for template selection.
  // templateKey must be exactly at d.ctrl.templateKey.
  const ctrl = okObj(d.ctrl) ? d.ctrl : {};
  const templateKey = ctrl.templateKey;

  // identity/text can still be absent; templateKey cannot.
  const identity = okObj(d.identity) ? d.identity : {};
  const text = okObj(d.text) ? d.text : {};
  const summary = okObj(ctrl.summary) ? ctrl.summary : {};

  const fullName = S(identity.fullName || summary?.identity?.fullName).trim();
  const dateLabel = S(identity.dateLabel || summary?.dateLbl).trim();

  const bandsRaw = okObj(summary.ctrl12) ? summary.ctrl12 : {};

  // Build: paragraph + questions, keep everything in para1, leave para2 blank.
  const execBlock = buildCoachSectionBlock(text.exec_summary, [
    text.exec_summary_q1, text.exec_summary_q2, text.exec_summary_q3,
    text.exec_summary_q4, text.exec_summary_q5, text.exec_summary_q6,
  ]);

  const ovBlock = buildCoachSectionBlock(text.ctrl_overview, [
    text.ctrl_overview_q1, text.ctrl_overview_q2, text.ctrl_overview_q3,
    text.ctrl_overview_q4, text.ctrl_overview_q5,
  ]);

  const ddBlock = buildCoachSectionBlock(text.ctrl_deepdive, [
    text.ctrl_deepdive_q1, text.ctrl_deepdive_q2, text.ctrl_deepdive_q3,
    text.ctrl_deepdive_q4, text.ctrl_deepdive_q5, text.ctrl_deepdive_q6,
  ]);

  const thBlock = buildCoachSectionBlock(text.themes, [
    text.themes_q1, text.themes_q2, text.themes_q3, text.themes_q4, text.themes_q5,
  ]);

  const colleaguesBlock = buildCoachSectionBlock(text.adapt_with_colleagues, [
    text.adapt_with_colleagues_q1,
    text.adapt_with_colleagues_q2,
    text.adapt_with_colleagues_q3,
    text.adapt_with_colleagues_q4,
  ]);

  const leadersBlock = buildCoachSectionBlock(text.adapt_with_leaders, [
    text.adapt_with_leaders_q1,
    text.adapt_with_leaders_q2,
    text.adapt_with_leaders_q3,
    text.adapt_with_leaders_q4,
  ]);

  const chartUrl = S(text.chartUrl).trim();

  return {
    raw: d,
    ctrl: { templateKey },
    identity: { fullName, dateLabel },
    bands: bandsRaw,

    exec_summary_para1: execBlock,
    exec_summary_para2: "",

    ctrl_overview_para1: ovBlock,
    ctrl_overview_para2: "",

    ctrl_deepdive_para1: ddBlock,
    ctrl_deepdive_para2: "",

    themes_para1: thBlock,
    themes_para2: "",

    workWith: { colleagues: colleaguesBlock, leaders: leadersBlock },
    chartUrl,
  };
}

/* ───────── debug probe ───────── */
function buildProbe(P, tpl, ov, L) {
  return {
    ok: true,
    where: "fill-template:COACH_V2:debug",
    template: safeJson(tpl),
    identity: { fullName: P.identity.fullName, dateLabel: P.identity.dateLabel },
    textLengths: {
      exec1: S(P.exec_summary_para1).length,
      exec2: S(P.exec_summary_para2).length,
      ov1: S(P.ctrl_overview_para1).length,
      ov2: S(P.ctrl_overview_para2).length,
      dd1: S(P.ctrl_deepdive_para1).length,
      dd2: S(P.ctrl_deepdive_para2).length,
      th1: S(P.themes_para1).length,
      th2: S(P.themes_para2).length,
      workwith_colleagues: S(P.workWith?.colleagues).length,
      workwith_leaders: S(P.workWith?.leaders).length,
    },
    layoutOverrides: {
      appliedCount: ov?.applied?.length || 0,
      ignoredCount: ov?.ignored?.length || 0,
      applied: ov?.applied || [],
      ignored: ov?.ignored || [],
      resolvedExamples: {
        p6WorkWith_collabC: safeJson(L?.p6WorkWith?.collabC || {}),
        p6WorkWith_collabT: safeJson(L?.p6WorkWith?.collabT || {}),
        p6_hdrName: safeJson(L?.p6?.hdrName || {}),
      },
    },
  };
}

/* ───────── main handler ───────── */
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const debug = url.searchParams.get("debug") === "1";

    const payload = await readPayload(req);
    const P = normaliseInput(payload);

    // STRICT: must exist
    const { bytes: pdfBytes, fname, absolutePath } = await loadTemplateBytesExact(P.ctrl.templateKey);

    const L = safeJson(DEFAULT_LAYOUT.pages);
    const ov = applyLayoutOverridesFromUrl(L, url);

    if (debug) {
      const tpl = { filename: fname, absolutePath };
      return res.status(200).json(buildProbe(P, tpl, ov, L));
    }

    const pdfDoc = await PDFDocument.load(pdfBytes);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pages = pdfDoc.getPages();

    // total pages = 6
    const p1 = pages[0] || null;
    const p2 = pages[1] || null; // exec_summary
    const p3 = pages[2] || null; // overview + chart
    const p4 = pages[3] || null; // deepdive + themes
    const p5 = pages[4] || null; // workwith
    const p6 = pages[5] || null; // legal (header name only)

    // Page 1: name + date
    if (p1) {
      drawTextBox(p1, fontB, P.identity.fullName, L.p1.name, { maxLines: 1 });
      drawTextBox(p1, font,  P.identity.dateLabel, L.p1.date, { maxLines: 1 });
    }

    // Page 6 header name ONLY
    const headerName = norm(P.identity.fullName);
    if (headerName && p6 && L?.p6?.hdrName) {
      drawTextBox(p6, font, headerName, L.p6.hdrName, { maxLines: 1 });
    }

    // Page 2: Exec summary (para + questions in para1; para2 blank)
    if (p2) {
      drawTextBox(p2, font, P.exec_summary_para1, L.p3Text.exec1);
      drawTextBox(p2, font, P.exec_summary_para2, L.p3Text.exec2);
    }

    // Page 3: Overview + chart
    if (p3) {
      drawTextBox(p3, font, P.ctrl_overview_para1, L.p4Text.ov1);
      drawTextBox(p3, font, P.ctrl_overview_para2, L.p4Text.ov2);

      try {
        await embedRadarFromBandsOrUrl(pdfDoc, p3, L.p4Text.chart, P.bands || {}, P.chartUrl);
      } catch (e) {
        console.warn("[fill-template:COACH_V2] Chart skipped:", e?.message || String(e));
      }
    }

    // Page 4: Deepdive + Themes
    if (p4) {
      drawTextBox(p4, font, P.ctrl_deepdive_para1, L.p5Text.dd1);
      drawTextBox(p4, font, P.ctrl_deepdive_para2, L.p5Text.dd2);
      drawTextBox(p4, font, P.themes_para1, L.p5Text.th1);
      drawTextBox(p4, font, P.themes_para2, L.p5Text.th2);
    }

    // Page 5: Workwith colleagues + leaders (para + numbered questions)
    if (p5) {
      drawTextBox(p5, font, P.workWith?.colleagues, L.p6WorkWith.collabC);
      drawTextBox(p5, font, P.workWith?.leaders,    L.p6WorkWith.collabT);
    }

    const outBytes = await pdfDoc.save();
    const outName = makeOutputFilename(P.identity.fullName, P.identity.dateLabel);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.status(200).send(Buffer.from(outBytes));
  } catch (err) {
    console.error("[fill-template:COACH_V2] CRASH", err);
    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
}

/**
 * CTRL Coach Export Service · fill-template (COACH V3.2)
 *
 * Change in V3.2:
 * - Header FullName is drawn on p2, p3, p4, p5, p6 (not only p6)
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

  const autoExpand = (opts.autoExpand ?? box.autoExpand ?? true) !== false;
  if (autoExpand && Number.isFinite(maxLines) && maxLines > 0) {
    const lineHeight = size + lineGap;
    const hNeeded = (pad * 2) + size + (Math.max(0, maxLines - 1) * lineHeight);
    h = Math.max(h, hNeeded);
  }

  const y = pageH - N(box.y) - h;

  const innerW = Math.max(0, w - pad * 2);
  const lines = wrapText(font, t0.replace(/\r/g, ""), size, innerW).slice(0, maxLines);

  const lineHeight = size + lineGap;
  let cursorY = y + h - pad - size;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let dx = x + pad;
    if (align !== "left") {
      const lw = font.widthOfTextAtSize(ln, size);
      if (align === "center") dx = x + (w - lw) / 2;
      if (align === "right") dx = x + w - pad - lw;
    }
    page.drawText(ln, { x: dx, y: cursorY, size, font });
    cursorY -= (size + lineGap);
  }
}

/* ───────── template loader (SAME PATTERN AS USER V12.3) ───────── */
async function loadTemplateBytesLocal(fname) {
  if (!fname.endsWith(".pdf")) throw new Error(`Invalid template filename: ${fname}`);

  const __file = fileURLToPath(import.meta.url);
  const __dir = path.dirname(__file);

  const candidates = [
    path.join(process.cwd(), "public", fname),
    path.join(__dir, "..", "public", fname),
    path.join(__dir, "public", fname),
    path.join(__dir, fname),
  ];

  let lastErr;
  for (const pth of candidates) {
    try { return await fs.readFile(pth); }
    catch (err) { lastErr = err; }
  }

  throw new Error(
    `Template not found: ${fname}. Tried: ${candidates.join(" | ")}. Last: ${lastErr?.message || "no detail"}`
  );
}

/* ───────── payload parsing ───────── */
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

/* ───────── dom/second detection (STRICT) ───────── */
function resolveStateKey(any) {
  const s = S(any).trim().toUpperCase();
  const c = s.charAt(0);
  if (["C", "T", "R", "L"].includes(c)) return c;

  const low = S(any).toLowerCase();
  if (low.includes("concealed")) return "C";
  if (low.includes("triggered")) return "T";
  if (low.includes("regulated")) return "R";
  if (low.includes("lead")) return "L";
  return null;
}

function computeDomAndSecondKeysStrict(P) {
  const raw = P.raw || {};
  const ctrl = raw.ctrl || {};
  const summary = (ctrl.summary || raw.ctrl?.summary || {}) || {};

  const domKey =
    resolveStateKey(P.domKey) ||
    resolveStateKey(raw.dominantKey) ||
    resolveStateKey(summary.dominant) ||
    resolveStateKey(summary.domState) ||
    resolveStateKey(raw.ctrl?.dominant) ||
    resolveStateKey(raw.domState);

  const secondKey =
    resolveStateKey(P.secondKey) ||
    resolveStateKey(raw.secondKey) ||
    resolveStateKey(summary.secondState) ||
    resolveStateKey(raw.secondState);

  if (!domKey) throw new Error("Missing domKey: could not resolve dominant state key from payload.");
  if (!secondKey) throw new Error("Missing secondKey: could not resolve second state key from payload.");

  return { domKey, secondKey, templateKey: `${domKey}${secondKey}` };
}

/* ───────── chart embed (same as USER V12.3) ───────── */
function makeSpiderChartUrl12(bandsRaw) {
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

/* ───────── DEFAULT COACH LAYOUT (6 pages) ───────── */
const DEFAULT_LAYOUT = {
  pages: {
    p1: {
      name: { x: 60, y: 458, w: 500, h: 60, size: 30, align: "center", maxLines: 1 },
      date: { x: 230, y: 613, w: 500, h: 40, size: 25, align: "left", maxLines: 1 },
    },

    // Header name needs to be on p2–p6
    p2: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p3: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p4: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p5: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p6: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },

    // Page 2 (exec): text + questions
    p3Text: {
      exec1: { x: 25, y: 380, w: 550, h: 180, size: 16, align: "left", maxLines: 9 },
      exec2: { x: 25, y: 560, w: 550, h: 450, size: 16, align: "left", maxLines: 40 },
    },

    // Page 3 (overview + chart): text + questions
    p4Text: {
      ov1:   { x: 25, y: 160, w: 200, h: 210, size: 16, align: "left", maxLines: 14 },
      ov2:   { x: 25, y: 520, w: 550, h: 490, size: 16, align: "left", maxLines: 42 },
      chart: { x: 250, y: 160, w: 320, h: 320 },
    },

    // Page 4 (deepdive + themes): each split
    p5Text: {
      dd1: { x: 25, y: 140, w: 550, h: 170, size: 16, align: "left", maxLines: 10 },
      dd2: { x: 25, y: 310, w: 550, h: 260, size: 16, align: "left", maxLines: 28 },
      th1: { x: 25, y: 540, w: 550, h: 120, size: 16, align: "left", maxLines: 8 },
      th2: { x: 25, y: 660, w: 550, h: 190, size: 16, align: "left", maxLines: 22 },
    },

    // Page 5 work-with: split each column into text + questions
    p6WorkWith: {
      collabC_text: { x: 30,  y: 300, w: 270, h: 110, size: 14, align: "left", maxLines: 7 },
      collabC_q:    { x: 30,  y: 410, w: 270, h: 310, size: 14, align: "left", maxLines: 24 },
      collabT_text: { x: 320, y: 300, w: 260, h: 110, size: 14, align: "left", maxLines: 7 },
      collabT_q:    { x: 320, y: 410, w: 260, h: 310, size: 14, align: "left", maxLines: 24 },
    },
  },
};

/* ───────── URL layout overrides ───────── */
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

/* ───────── input normaliser (coach v2 text + questions) ───────── */
function normaliseInput(d = {}) {
  const identity = okObj(d.identity) ? d.identity : {};
  const text = okObj(d.text) ? d.text : {};
  const ctrl = okObj(d.ctrl) ? d.ctrl : {};
  const summary = okObj(ctrl.summary) ? ctrl.summary : {};

  const fullName = S(identity.fullName || d.fullName || d.FullName || summary?.identity?.fullName || "").trim();
  const dateLabel = S(identity.dateLabel || d.dateLbl || d.date || d.Date || summary?.dateLbl || "").trim();

  const bandsRaw =
    (okObj(summary.ctrl12) && Object.keys(summary.ctrl12).length ? summary.ctrl12 : null) ||
    (okObj(d.bands) && Object.keys(d.bands).length ? d.bands : null) ||
    (okObj(ctrl.bands) && Object.keys(ctrl.bands).length ? ctrl.bands : null) ||
    {};

  const chartUrl =
    S(d.spiderChartUrl || d.spider_chart_url || d.chartUrl || text.chartUrl || "").trim() ||
    S(d.chart?.spiderUrl || d.chart?.url || "").trim() ||
    S(summary?.chart?.spiderUrl || "").trim();

  return {
    raw: d,
    identity: { fullName, dateLabel },
    bands: bandsRaw,

    exec_summary_text: S(text.exec_summary_text).trim(),
    exec_summary_questions: S(text.exec_summary_questions).trim(),

    ctrl_overview_text: S(text.ctrl_overview_text).trim(),
    ctrl_overview_questions: S(text.ctrl_overview_questions).trim(),

    ctrl_deepdive_text: S(text.ctrl_deepdive_text).trim(),
    ctrl_deepdive_questions: S(text.ctrl_deepdive_questions).trim(),

    themes_text: S(text.themes_text).trim(),
    themes_questions: S(text.themes_questions).trim(),

    adapt_with_colleagues_text: S(text.adapt_with_colleagues_text).trim(),
    adapt_with_colleagues_questions: S(text.adapt_with_colleagues_questions).trim(),

    adapt_with_leaders_text: S(text.adapt_with_leaders_text).trim(),
    adapt_with_leaders_questions: S(text.adapt_with_leaders_questions).trim(),

    chartUrl,
  };
}

/* ───────── debug probe ───────── */
function buildProbe(P, domSecond, tpl, ov, L) {
  return {
    ok: true,
    where: "fill-template:COACH_V3.2:debug",
    template: tpl,
    domSecond: safeJson(domSecond),
    identity: { fullName: P.identity.fullName, dateLabel: P.identity.dateLabel },
    headerBoxes: {
      p2: safeJson(L?.p2?.hdrName || null),
      p3: safeJson(L?.p3?.hdrName || null),
      p4: safeJson(L?.p4?.hdrName || null),
      p5: safeJson(L?.p5?.hdrName || null),
      p6: safeJson(L?.p6?.hdrName || null),
    },
    textLengths: {
      exec_text: S(P.exec_summary_text).length,
      exec_q: S(P.exec_summary_questions).length,
      ov_text: S(P.ctrl_overview_text).length,
      ov_q: S(P.ctrl_overview_questions).length,
      dd_text: S(P.ctrl_deepdive_text).length,
      dd_q: S(P.ctrl_deepdive_questions).length,
      th_text: S(P.themes_text).length,
      th_q: S(P.themes_questions).length,
      wwC_text: S(P.adapt_with_colleagues_text).length,
      wwC_q: S(P.adapt_with_colleagues_questions).length,
      wwL_text: S(P.adapt_with_leaders_text).length,
      wwL_q: S(P.adapt_with_leaders_questions).length,
    },
    layoutOverrides: {
      appliedCount: ov?.applied?.length || 0,
      ignoredCount: ov?.ignored?.length || 0,
      applied: ov?.applied || [],
      ignored: ov?.ignored || [],
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

// STRICT dom/second resolution (no fallbacks)
const domSecond = computeDomAndSecondKeysStrict({
  raw: payload,
  domKey: payload?.ctrl?.dominantKey,
  secondKey: payload?.ctrl?.secondKey
});

// STRICT template selection (no safe default)
const validCombos = new Set(["CT","CL","CR","TC","TR","TL","RC","RT","RL","LC","LR","LT"]);
if (!validCombos.has(domSecond.templateKey)) {
  throw new Error(
    `Invalid templateKey '${domSecond.templateKey}'. Expected one of: ${Array.from(validCombos).join(", ")}`
  );
}

const tpl = {
  combo: domSecond.templateKey,
  safeCombo: domSecond.templateKey,
  tpl: `CTRL_PoC_Coach_Assessment_Profile_template_${domSecond.templateKey}.pdf`,
};


    const L = safeJson(DEFAULT_LAYOUT.pages);
    const ov = applyLayoutOverridesFromUrl(L, url);

    if (debug) return res.status(200).json(buildProbe(P, domSecond, tpl, ov, L));

    const pdfBytes = await loadTemplateBytesLocal(tpl.tpl);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pages = pdfDoc.getPages();

    // Coach template expected: 6 pages
    const p1 = pages[0] || null;
    const p2 = pages[1] || null; // exec
    const p3 = pages[2] || null; // overview + chart
    const p4 = pages[3] || null; // deepdive + themes
    const p5 = pages[4] || null; // workwith
    const p6 = pages[5] || null; // legal / footer

    // Page 1: name + date
    if (p1) {
      drawTextBox(p1, fontB, P.identity.fullName, L.p1.name, { maxLines: 1 });
      drawTextBox(p1, font,  P.identity.dateLabel, L.p1.date, { maxLines: 1 });
    }

    // Header name on pages 2–6
    const headerName = norm(P.identity.fullName);
    if (headerName) {
      if (p2 && L?.p2?.hdrName) drawTextBox(p2, font, headerName, L.p2.hdrName, { maxLines: 1 });
      if (p3 && L?.p3?.hdrName) drawTextBox(p3, font, headerName, L.p3.hdrName, { maxLines: 1 });
      if (p4 && L?.p4?.hdrName) drawTextBox(p4, font, headerName, L.p4.hdrName, { maxLines: 1 });
      if (p5 && L?.p5?.hdrName) drawTextBox(p5, font, headerName, L.p5.hdrName, { maxLines: 1 });
      if (p6 && L?.p6?.hdrName) drawTextBox(p6, font, headerName, L.p6.hdrName, { maxLines: 1 });
    }

    // Page 2: Exec
    if (p2) {
      drawTextBox(p2, font, P.exec_summary_text,      L.p3Text.exec1);
      drawTextBox(p2, font, P.exec_summary_questions, L.p3Text.exec2);
    }

    // Page 3: Overview + chart
    if (p3) {
      drawTextBox(p3, font, P.ctrl_overview_text,      L.p4Text.ov1);
      drawTextBox(p3, font, P.ctrl_overview_questions, L.p4Text.ov2);
      try {
        await embedRadarFromBandsOrUrl(pdfDoc, p3, L.p4Text.chart, P.bands || {}, P.chartUrl);
      } catch (e) {
        console.warn("[fill-template:COACH_V3.2] Chart skipped:", e?.message || String(e));
      }
    }

    // Page 4: Deepdive + Themes
    if (p4) {
      drawTextBox(p4, font, P.ctrl_deepdive_text,      L.p5Text.dd1);
      drawTextBox(p4, font, P.ctrl_deepdive_questions, L.p5Text.dd2);

      drawTextBox(p4, font, P.themes_text,      L.p5Text.th1);
      drawTextBox(p4, font, P.themes_questions, L.p5Text.th2);
    }

    // Page 5: Work-with
    if (p5) {
      drawTextBox(p5, font, P.adapt_with_colleagues_text,      L.p6WorkWith.collabC_text);
      drawTextBox(p5, font, P.adapt_with_colleagues_questions, L.p6WorkWith.collabC_q);

      drawTextBox(p5, font, P.adapt_with_leaders_text,      L.p6WorkWith.collabT_text);
      drawTextBox(p5, font, P.adapt_with_leaders_questions, L.p6WorkWith.collabT_q);
    }

    const outBytes = await pdfDoc.save();
    const outName = makeOutputFilename(P.identity.fullName, P.identity.dateLabel);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.status(200).send(Buffer.from(outBytes));
  } catch (err) {
    console.error("[fill-template:COACH_V3.2] CRASH", err);
    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
}

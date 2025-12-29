/**
 * CTRL Coach Export Service · fill-template (COACH V4 · 12 templates + chart + 3 act boxes + QUESTION BOXES)
 *
 * Based on: COACH V3
 * V4 changes (ONLY):
 * - Adds WinAnsi-safe normalisation to prevent "WinAnsi cannot encode" crashes (e.g., U+2010 hyphen)
 * - Applies normalisation in wrapText, drawTextBox, and bulletQ
 */

export const config = { runtime: "nodejs" };

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ───────── template naming (COACH) ───────── */
const TEMPLATE_PREFIX = "CTRL_PoC_Coach_Assessment_Profile_template_";

/* ───────────── small utils ───────────── */
const S = (v, fb = "") => (v == null ? String(fb) : String(v));
const N = (v, fb = 0) => (Number.isFinite(+v) ? +v : fb);
const norm = (s) => S(s).replace(/\s+/g, " ").trim();
const okObj = (o) => o && typeof o === "object" && !Array.isArray(o);

function safeJson(obj) {
  try { return JSON.parse(JSON.stringify(obj)); }
  catch { return { _error: "Could not serialise debug object" }; }
}

/* ───────── WinAnsi-safe text normaliser (V4) ───────── */
function winAnsiSafe(input) {
  let s = String(input ?? "");

  // Hyphens / dashes
  s = s
    .replace(/\u2010/g, "-")  // ‐ hyphen
    .replace(/\u2011/g, "-")  // non-breaking hyphen
    .replace(/\u2012/g, "-")  // figure dash
    .replace(/\u2013/g, "-")  // en dash
    .replace(/\u2014/g, "-")  // em dash
    .replace(/\u2212/g, "-"); // minus sign

  // Quotes
  s = s
    .replace(/\u2018|\u2019|\u201A|\u201B/g, "'") // ‘ ’ ‚ ‛
    .replace(/\u201C|\u201D|\u201E|\u201F/g, '"'); // “ ” „ ‟

  // Ellipsis
  s = s.replace(/\u2026/g, "..."); // …

  // Spaces
  s = s
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/\u2007/g, " ")
    .replace(/\u202F/g, " ");

  return s;
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
  const raw = winAnsiSafe(S(text)); // V4
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
  const t0 = winAnsiSafe(S(text)); // V4
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
    page.drawText(ln, { x: dx, y: cursorY, size, font, color: rgb(0, 0, 0) });
    cursorY -= lineHeight;
  }
}

/* ───────── paragraph splitting ───────── */
function splitToTwoParas(s) {
  const raw = S(s).replace(/\r/g, "").trim();
  if (!raw) return ["", ""];
  const parts = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join("\n\n")];
  const sentences = raw.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= 2) {
    const mid = Math.ceil(sentences.length / 2);
    return [sentences.slice(0, mid).join(" ").trim(), sentences.slice(mid).join(" ").trim()];
  }
  return [raw, ""];
}

function splitToThreeChunks(s) {
  const raw = S(s).replace(/\r/g, "").trim();
  if (!raw) return ["", "", ""];

  const paras = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 3) return [paras[0], paras[1], paras.slice(2).join("\n\n")];
  if (paras.length === 2) return [paras[0], paras[1], ""];

  const sentences = raw.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= 3) {
    const n = sentences.length;
    const a = Math.ceil(n / 3);
    const b = Math.ceil((n - a) / 2);
    const s1 = sentences.slice(0, a).join(" ").trim();
    const s2 = sentences.slice(a, a + b).join(" ").trim();
    const s3 = sentences.slice(a + b).join(" ").trim();
    return [s1, s2, s3];
  }

  return [raw, "", ""];
}

/* ───────── template loader ───────── */
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

/* ───────── dom/second detection ───────── */
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

function computeDomAndSecondKeys(P) {
  const raw = P.raw || {};
  const ctrl = raw.ctrl || {};
  const summary = (ctrl.summary || raw.ctrl?.summary || {}) || {};

  const domKey =
    resolveStateKey(P.domKey) ||
    resolveStateKey(raw.dominantKey) ||
    resolveStateKey(summary.dominant) ||
    resolveStateKey(summary.domState) ||
    resolveStateKey(raw.ctrl?.dominant) ||
    resolveStateKey(raw.domState) ||
    "R";

  const secondKey =
    resolveStateKey(P.secondKey) ||
    resolveStateKey(raw.secondKey) ||
    resolveStateKey(summary.secondState) ||
    resolveStateKey(raw.secondState) ||
    (domKey === "R" ? "T" : "R");

  return { domKey, secondKey, templateKey: `${domKey}${secondKey}` };
}

/* ───────── chart embed (UNCHANGED) ───────── */
// (kept exactly as your V2)
function makeSpiderChartUrl12(bandsRaw) {
  const keys = [
    "C_low","C_mid","C_high",
    "T_low","T_mid","T_high",
    "R_low","R_mid","R_high",
    "L_low","L_mid","L_high",
  ];

  const displayLabels = [
    "", "Concealed", "",
    "", "Triggered", "",
    "", "Regulated", "",
    "", "Lead", ""
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

/* ───────── DEFAULT LAYOUT ───────── */
const DEFAULT_LAYOUT = {
  pages: {
    p1: {
      name: { x: 60, y: 458, w: 500, h: 60, size: 30, align: "center", maxLines: 1 },
      date: { x: 230, y: 613, w: 500, h: 40, size: 25, align: "left", maxLines: 1 },
    },

    p2: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p3: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p4: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p5: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p6: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p7: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },
    p8: { hdrName: { x: 380, y: 51, w: 400, h: 24, size: 13, align: "left", maxLines: 1 } },

    p3Text: {
      exec1: { x: 25, y: 380, w: 550, h: 250, size: 17, align: "left", maxLines: 13 },
      exec2: { x: 25, y: 590, w: 550, h: 420, size: 17, align: "left", maxLines: 22 },
    },

    p4Text: {
      ov1: { x: 25, y: 160, w: 200, h: 240, size: 17, align: "left", maxLines: 20 },
      ov2: { x: 25, y: 560, w: 550, h: 420, size: 17, align: "left", maxLines: 23 },
      chart: { x: 250, y: 160, w: 320, h: 320 },
    },

    p5Text: {
      dd1: { x: 25, y: 140, w: 550, h: 240, size: 16, align: "left", maxLines: 13 },
      dd2: { x: 25, y: 270, w: 550, h: 310, size: 16, align: "left", maxLines: 17 },
      th1: { x: 25, y: 540, w: 550, h: 160, size: 16, align: "left", maxLines: 9 },
      th2: { x: 25, y: 670, w: 550, h: 160, size: 16, align: "left", maxLines: 9 },
    },

    p6WorkWith: {
      collabC: { x: 30, y: 300, w: 270, h: 420, size: 14, align: "left", maxLines: 14 },
      collabT: { x: 320, y: 300, w: 260, h: 420, size: 14, align: "left", maxLines: 14 },
      collabR: { x: 30, y: 575, w: 260, h: 420, size: 14, align: "left", maxLines: 14 },
      collabL: { x: 320, y: 575, w: 260, h: 420, size: 14, align: "left", maxLines: 14 },
    },

    p7Actions: {
      act1: { x: 50,  y: 380, w: 440, h: 95, size: 17, align: "left", maxLines: 5 },
      act2: { x: 100, y: 530, w: 440, h: 95, size: 17, align: "left", maxLines: 5 },
      act3: { x: 50,  y: 670, w: 440, h: 95, size: 17, align: "left", maxLines: 5 },
    },

    /* ───────── NEW: Coach questions layout blocks ───────── */

    // Page 3: Exec Summary (4 questions)
    p3Q: {
      exec_q1: { x: 25, y: 1010, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
      exec_q2: { x: 25, y: 1050, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
      exec_q3: { x: 25, y: 1090, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
      exec_q4: { x: 25, y: 1130, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
    },

    // Page 4: Overview (2 questions)
    p4Q: {
      ov_q1: { x: 25, y: 920, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
      ov_q2: { x: 25, y: 960, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
    },

    // Page 5: Deep dive (2) + Themes (2)
    p5Q: {
      dd_q1: { x: 25, y: 830, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
      dd_q2: { x: 25, y: 870, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
      th_q1: { x: 25, y: 910, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
      th_q2: { x: 25, y: 950, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
    },

    // Page 6: Adapt questions (colleagues + leaders)
    p6Q: {
      col_q1:  { x: 30, y: 760, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
      lead_q1: { x: 30, y: 800, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
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

/* ───────── question formatter (BULLET POINTS) ───────── */
function bulletQ(s) {
  const t = winAnsiSafe(S(s)).replace(/\r/g, "").trim(); // V4
  if (!t) return "";
  if (t.startsWith("•")) return norm(t);
  return `• ${norm(t)}`;
}

/* ───────── input normaliser (COACH) ───────── */
function normaliseInput(d = {}) {
  const identity = okObj(d.identity) ? d.identity : {};
  const text = okObj(d.text) ? d.text : {};
  const ctrl = okObj(d.ctrl) ? d.ctrl : {};
  const summary = okObj(ctrl.summary) ? ctrl.summary : {};

  const fullName = S(identity.fullName || d.fullName || d.FullName || summary?.identity?.fullName || "").trim();
  const dateLabel = S(identity.dateLabel || d.dateLbl || d.date || d.Date || summary?.dateLbl || "").trim();

  const bandsRaw =
    (okObj(ctrl.bands) && Object.keys(ctrl.bands).length ? ctrl.bands : null) ||
    (okObj(d.bands) && Object.keys(d.bands).length ? d.bands : null) ||
    (okObj(summary.ctrl12) && Object.keys(summary.ctrl12).length ? summary.ctrl12 : null) ||
    {};

  const [execA, execB] = splitToTwoParas(S(text.exec_summary || ""));
  const [ovA, ovB] = splitToTwoParas(S(text.ctrl_overview || ""));
  const [ddA, ddB] = splitToTwoParas(S(text.ctrl_deepdive || ""));
  const [thA, thB] = splitToTwoParas(S(text.themes || ""));

  const adaptC = S(text.adapt_with_colleagues || "");
  const adaptL = S(text.adapt_with_leaders || "");

  // Actions now come as Act1/2/3 in your payload too, but keep fallback
  const act1 = S(d.Act1 || text.actions1 || "");
  const act2 = S(d.Act2 || text.actions2 || "");
  const act3 = S(d.Act3 || text.actions3 || "");

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

    // NEW: questions, bullet formatted
    exec_q1: bulletQ(text.exec_summary_q1),
    exec_q2: bulletQ(text.exec_summary_q2),
    exec_q3: bulletQ(text.exec_summary_q3),
    exec_q4: bulletQ(text.exec_summary_q4),

    ov_q1: bulletQ(text.ctrl_overview_q1),
    ov_q2: bulletQ(text.ctrl_overview_q2),

    dd_q1: bulletQ(text.ctrl_deepdive_q1),
    dd_q2: bulletQ(text.ctrl_deepdive_q2),

    th_q1: bulletQ(text.themes_q1),
    th_q2: bulletQ(text.themes_q2),

    col_q1: bulletQ(text.adapt_with_colleagues_q1),

    // Note: your schema uses adapt_with_leaders_q2 for the single leader question
    lead_q1: bulletQ(text.adapt_with_leaders_q2),

    workWith: {
      concealed: adaptC,
      triggered: adaptL,
      regulated: "",
      lead: ""
    },

    Act1: act1,
    Act2: act2,
    Act3: act3,

    chartUrl,
  };
}

/* ───────── debug probe ───────── */
function buildProbe(P, domSecond, tpl, ov) {
  return {
    ok: true,
    where: "fill-template:COACH:debug",
    template: tpl,
    domSecond: safeJson(domSecond),
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
      adapt_colleagues: S(P.workWith?.concealed).length,
      adapt_leaders: S(P.workWith?.triggered).length,
      act1: S(P.Act1).length,
      act2: S(P.Act2).length,
      act3: S(P.Act3).length,

      // NEW: question lens
      exec_q1: S(P.exec_q1).length,
      exec_q2: S(P.exec_q2).length,
      exec_q3: S(P.exec_q3).length,
      exec_q4: S(P.exec_q4).length,
      ov_q1: S(P.ov_q1).length,
      ov_q2: S(P.ov_q2).length,
      dd_q1: S(P.dd_q1).length,
      dd_q2: S(P.dd_q2).length,
      th_q1: S(P.th_q1).length,
      th_q2: S(P.th_q2).length,
      col_q1: S(P.col_q1).length,
      lead_q1: S(P.lead_q1).length,
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

    // FIX: secondKey fallback should not reuse dominantKey
    const domSecond = computeDomAndSecondKeys({
      raw: payload,
      domKey: payload?.ctrl?.dominantKey || payload?.dominantKey,
      secondKey: payload?.ctrl?.secondKey || payload?.secondKey
    });

    const validCombos = new Set(["CT","CL","CR","TC","TR","TL","RC","RT","RL","LC","LR","LT"]);
    const safeCombo = validCombos.has(domSecond.templateKey) ? domSecond.templateKey : "CT";

    const tpl = {
      combo: domSecond.templateKey,
      safeCombo,
      tpl: `${TEMPLATE_PREFIX}${safeCombo}.pdf`
    };

    if (!DEFAULT_LAYOUT || !DEFAULT_LAYOUT.pages) {
      throw new Error("DEFAULT_LAYOUT missing.");
    }

    const L = safeJson(DEFAULT_LAYOUT.pages);
    const ov = applyLayoutOverridesFromUrl(L, url);

    if (debug) return res.status(200).json(buildProbe(P, domSecond, tpl, ov));

    const pdfBytes = await loadTemplateBytesLocal(tpl.tpl);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pages = pdfDoc.getPages();

    // Page 1
    if (pages[0]) {
      drawTextBox(pages[0], fontB, P.identity.fullName, L.p1.name, { maxLines: 1 });
      drawTextBox(pages[0], font,  P.identity.dateLabel, L.p1.date, { maxLines: 1 });
    }

    // Header name pages 2–8
    const headerName = norm(P.identity.fullName);
    if (headerName) {
      for (let i = 1; i < Math.min(pages.length, 8); i++) {
        const pk = `p${i + 1}`;
        const box = L?.[pk]?.hdrName;
        if (box) drawTextBox(pages[i], font, headerName, box, { maxLines: 1 });
      }
    }

    const p3 = pages[2] || null;
    const p4 = pages[3] || null;
    const p5 = pages[4] || null;
    const p6 = pages[5] || null;
    const p7 = pages[6] || null;

    if (p3) {
      drawTextBox(p3, font, P.exec_summary_para1, L.p3Text.exec1);
      drawTextBox(p3, font, P.exec_summary_para2, L.p3Text.exec2);

      // NEW: Exec questions
      drawTextBox(p3, font, P.exec_q1, L.p3Q.exec_q1);
      drawTextBox(p3, font, P.exec_q2, L.p3Q.exec_q2);
      drawTextBox(p3, font, P.exec_q3, L.p3Q.exec_q3);
      drawTextBox(p3, font, P.exec_q4, L.p3Q.exec_q4);
    }

    if (p4) {
      drawTextBox(p4, font, P.ctrl_overview_para1, L.p4Text.ov1);
      drawTextBox(p4, font, P.ctrl_overview_para2, L.p4Text.ov2);
      try {
        await embedRadarFromBandsOrUrl(pdfDoc, p4, L.p4Text.chart, P.bands || {}, P.chartUrl);
      } catch (e) {
        console.warn("[fill-template:COACH] Chart skipped:", e?.message || String(e));
      }

      // NEW: Overview questions
      drawTextBox(p4, font, P.ov_q1, L.p4Q.ov_q1);
      drawTextBox(p4, font, P.ov_q2, L.p4Q.ov_q2);
    }

    if (p5) {
      drawTextBox(p5, font, P.ctrl_deepdive_para1, L.p5Text.dd1);
      drawTextBox(p5, font, P.ctrl_deepdive_para2, L.p5Text.dd2);
      drawTextBox(p5, font, P.themes_para1, L.p5Text.th1);
      drawTextBox(p5, font, P.themes_para2, L.p5Text.th2);

      // NEW: Deep dive + Themes questions
      drawTextBox(p5, font, P.dd_q1, L.p5Q.dd_q1);
      drawTextBox(p5, font, P.dd_q2, L.p5Q.dd_q2);
      drawTextBox(p5, font, P.th_q1, L.p5Q.th_q1);
      drawTextBox(p5, font, P.th_q2, L.p5Q.th_q2);
    }

    // Page 6
    if (p6) {
      drawTextBox(p6, font, P.workWith?.concealed, L.p6WorkWith.collabC);
      drawTextBox(p6, font, P.workWith?.triggered, L.p6WorkWith.collabT);
      drawTextBox(p6, font, P.workWith?.regulated, L.p6WorkWith.collabR);
      drawTextBox(p6, font, P.workWith?.lead,      L.p6WorkWith.collabL);

      // NEW: Adapt questions
      drawTextBox(p6, font, P.col_q1,  L.p6Q.col_q1);
      drawTextBox(p6, font, P.lead_q1, L.p6Q.lead_q1);
    }

    // Page 7
    if (p7) {
      drawTextBox(p7, font, P.Act1, L.p7Actions.act1);
      drawTextBox(p7, font, P.Act2, L.p7Actions.act2);
      drawTextBox(p7, font, P.Act3, L.p7Actions.act3);
    }

    const outBytes = await pdfDoc.save();
    const outName = makeOutputFilename(P.identity.fullName, P.identity.dateLabel);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    res.status(200).send(Buffer.from(outBytes));
  } catch (err) {
    console.error("[fill-template:COACH] CRASH", err);
    res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      stack: err?.stack || null,
    });
  }
}

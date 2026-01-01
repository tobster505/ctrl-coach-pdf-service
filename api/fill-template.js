/** 
 * CTRL Coach Export Service · fill-template (COACH V5 · ... .replace(/\u202F/g, " ");
 *
 * NOTE (V6):
 * - DEFAULT_LAYOUT updated to match the co-ordinates you pasted in chat.
 * - Added p7Actions act4/act5/act6 blocks (even if not yet drawn by renderer).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* ──────────────────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────────────────── */

function toStr(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") return v;
  try {
    return String(v);
  } catch {
    return fallback;
  }
}

function clampInt(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(x)));
}

function safeJsonParse(s, fallback = null) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function sanitiseText(s) {
  // Keep things safe for PDF rendering.
  // - Convert non-breaking spaces / narrow no-break spaces
  // - Replace curly quotes etc if needed
  // - Trim
  if (s === null || s === undefined) return "";
  let out = toStr(s, "");
  out = out.replace(/\u00A0/g, " ");
  out = out.replace(/\u202F/g, " ");
  return out.trim();
}

function makeOutputFilename(fullName, dateLabel) {
  const base = (fullName || "CTRL_Coach_Report").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_");
  const dt = (dateLabel || "date").replace(/[^\w\-]+/g, "");
  return `${base}_CoachReport_${dt}.pdf`;
}

/* ──────────────────────────────────────────────────────────────────────────
   Template loading
────────────────────────────────────────────────────────────────────────── */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadTemplateBytesLocal(templateFileName) {
  const tried = [];

  // Common locations for Vercel functions:
  const candidates = [
    path.join(process.cwd(), "public", templateFileName),
    path.join(__dirname, "..", "public", templateFileName),
    path.join(__dirname, "public", templateFileName),
    path.join(__dirname, templateFileName),
  ];

  for (const fp of candidates) {
    tried.push(fp);
    try {
      const bytes = await fs.readFile(fp);
      return { ok: true, bytes, tried };
    } catch (e) {
      // keep trying
    }
  }

  const last = tried[tried.length - 1];
  const err = new Error(`Template not found: ${templateFileName}. Tried: ${tried.join(" | ")}. Last: ENOENT: no such file or directory, open '${last}'`);
  err.tried = tried;
  throw err;
}

/* ──────────────────────────────────────────────────────────────────────────
   Layout defaults
────────────────────────────────────────────────────────────────────────── */

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
      exec1: { x: 25, y: 360, w: 550, h: 250, size: 14, align: "left", maxLines: 13 },
      exec2: { x: 25, y: 520, w: 550, h: 420, size: 14, align: "left", maxLines: 22 },
    },

    p4Text: {
      ov1: { x: 25, y: 160, w: 200, h: 240, size: 14, align: "left", maxLines: 25 },
      ov2: { x: 25, y: 520, w: 550, h: 420, size: 14, align: "left", maxLines: 23 },
      chart: { x: 250, y: 160, w: 320, h: 320 },
    },

    p5Text: {
      dd1: { x: 25, y: 140, w: 550, h: 240, size: 13, align: "left", maxLines: 13 },
      dd2: { x: 25, y: 240, w: 550, h: 310, size: 13, align: "left", maxLines: 17 },
      th1: { x: 25, y: 540, w: 550, h: 160, size: 13, align: "left", maxLines: 9 },
      th2: { x: 25, y: 620, w: 550, h: 160, size: 13, align: "left", maxLines: 9 },
    },

    /* ───────── PAGE 6 (UPDATED to match your pasted layout) ───────── */
    p6WorkWith: {
      collabC: { x: 30, y: 300, w: 270, h: 420, size: 14, align: "left", maxLines: 14 },
      collabT: { x: 320, y: 300, w: 260, h: 420, size: 14, align: "left", maxLines: 14 },
    },

    p6Q: {
      col_q1: { x: 30, y: 550, w: 270, h: 40, size: 14, align: "left", maxLines: 2 },
      lead_q1: { x: 320, y: 550, w: 260, h: 40, size: 14, align: "left", maxLines: 2 },
    },
    /* ───────── END PAGE 6 ───────── */

    p7Actions: {
      act1: { x: 50, y: 380, w: 440, h: 95, size: 16, align: "left", maxLines: 5 },
      act2: { x: 100, y: 530, w: 440, h: 95, size: 16, align: "left", maxLines: 5 },
      act3: { x: 50, y: 670, w: 440, h: 95, size: 16, align: "left", maxLines: 5 },

      // Added (per your pasted co-ords)
      act4: { x: 30, y: 920, w: 550, h: 95, size: 16, align: "left", maxLines: 5 },
      act5: { x: 30, y: 900, w: 550, h: 95, size: 17, align: "left", maxLines: 5 },
      act6: { x: 30, y: 765, w: 550, h: 95, size: 17, align: "left", maxLines: 5 },
    },

    /* ───────── Coach questions layout blocks ───────── */

    p3Q: {
      exec_q1: { x: 25, y: 630, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
      exec_q2: { x: 25, y: 670, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
      exec_q3: { x: 25, y: 710, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
      exec_q4: { x: 25, y: 750, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
    },

    p4Q: {
      ov_q1: { x: 25, y: 650, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
      ov_q2: { x: 25, y: 700, w: 550, h: 40, size: 14, align: "left", maxLines: 2 },
    },

    p5Q: {
      dd_q1: { x: 25, y: 310, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
      dd_q2: { x: 25, y: 350, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
      th_q1: { x: 25, y: 710, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
      th_q2: { x: 25, y: 750, w: 550, h: 40, size: 13, align: "left", maxLines: 2 },
    },
  },
};

function mergeLayoutOverrides(defaultPages, url) {
  const allowed = new Set(["x", "y", "w", "h", "size", "align", "maxLines"]);
  const u = new URL(url);
  const params = u.searchParams;

  // Layout override format expected by your build-PDF link:
  // &L_p1_name_x=60 etc.
  const pages = structuredClone(defaultPages);

  for (const [k, v] of params.entries()) {
    if (!k.startsWith("L_")) continue;
    // Example: L_p1_name_x
    const parts = k.split("_"); // ["L","p1","name","x"]
    if (parts.length < 4) continue;

    const pageKey = parts[1];     // p1
    const boxKey = parts[2];      // name / hdrName / exec1 / ...
    const prop = parts.slice(3).join("_"); // x / y / maxLines etc

    if (!allowed.has(prop)) continue;
    if (!pages[pageKey]) pages[pageKey] = {};
    if (!pages[pageKey][boxKey]) pages[pageKey][boxKey] = {};

    // number vs string
    const numProps = new Set(["x", "y", "w", "h", "size", "maxLines"]);
    pages[pageKey][boxKey][prop] = numProps.has(prop) ? Number(v) : String(v);
  }

  return pages;
}

function drawTextBox(page, font, text, box) {
  if (!page || !box) return;

  const raw = sanitiseText(text);
  if (!raw) return;

  const x = Number(box.x ?? 0);
  const y = Number(box.y ?? 0);
  const w = Number(box.w ?? 100);
  const h = Number(box.h ?? 20);
  const size = Number(box.size ?? 12);
  const align = (box.align ?? "left").toLowerCase();
  const maxLines = clampInt(box.maxLines ?? 99, 1, 99);

  // Basic wrapping: split on spaces into lines that fit width.
  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  const widthOf = (s) => font.widthOfTextAtSize(s, size);

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (widthOf(test) <= w) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);

  const lineHeight = size * 1.15;
  let cursorY = y;

  for (const ln of lines) {
    if (cursorY + lineHeight > y + h) break;

    let drawX = x;
    if (align === "center") drawX = x + (w - widthOf(ln)) / 2;
    if (align === "right") drawX = x + (w - widthOf(ln));

    page.drawText(ln, { x: drawX, y: cursorY, size, font, color: rgb(0, 0, 0) });
    cursorY += lineHeight;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
   Handler
────────────────────────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  try {
    const url = req.url || "";
    const u = new URL(url, "http://localhost");

    const tplParam = u.searchParams.get("pdfTpl");
    const comboParam = u.searchParams.get("combo") || u.searchParams.get("stateCombo") || "";

    // Determine template filename
    const safeCombo = (comboParam || "fallback").replace(/[^A-Za-z0-9_]/g, "");
    const templateFileName =
      tplParam && tplParam.trim()
        ? tplParam.trim()
        : `CTRL_PoC_Coach_Assessment_Profile_template_${safeCombo}.pdf`;

    // Optional debug
    if (u.searchParams.get("debug") === "1") {
      return res.status(200).json({
        ok: true,
        debug: true,
        templateFileName,
        safeCombo,
        cwd: process.cwd(),
      });
    }

    // Load template
    const tpl = await loadTemplateBytesLocal(templateFileName);

    // Payload is base64 JSON in ?data=
    const dataB64 = u.searchParams.get("data") || "";
    const dataJson = Buffer.from(dataB64, "base64").toString("utf8");
    const payload = safeJsonParse(dataJson, {}) || {};

    const identity = payload.identity || {};
    const fullName = sanitiseText(identity.fullName || payload.fullName || "Anonymous");
    const dateLabel = sanitiseText(identity.dateLabel || payload.dateLabel || "");

    // Text inputs
    const P = {
      identity: {
        fullName,
        dateLabel,
      },

      // Page 3
      exec1: sanitiseText(payload.exec_summary_para1 || payload.exec1 || ""),
      exec2: sanitiseText(payload.exec_summary_para2 || payload.exec2 || ""),

      exec_q1: sanitiseText(payload.exec_q1 || ""),
      exec_q2: sanitiseText(payload.exec_q2 || ""),
      exec_q3: sanitiseText(payload.exec_q3 || ""),
      exec_q4: sanitiseText(payload.exec_q4 || ""),

      // Page 4
      ov1: sanitiseText(payload.ctrl_overview_para1 || payload.ov1 || ""),
      ov2: sanitiseText(payload.ctrl_overview_para2 || payload.ov2 || ""),

      ov_q1: sanitiseText(payload.ov_q1 || ""),
      ov_q2: sanitiseText(payload.ov_q2 || ""),

      // Page 5
      dd1: sanitiseText(payload.ctrl_deepdive_para1 || payload.dd1 || ""),
      dd2: sanitiseText(payload.ctrl_deepdive_para2 || payload.dd2 || ""),
      th1: sanitiseText(payload.themes_para1 || payload.th1 || ""),
      th2: sanitiseText(payload.themes_para2 || payload.th2 || ""),

      dd_q1: sanitiseText(payload.dd_q1 || ""),
      dd_q2: sanitiseText(payload.dd_q2 || ""),
      th_q1: sanitiseText(payload.th_q1 || ""),
      th_q2: sanitiseText(payload.th_q2 || ""),

      // Page 6 (WorkWith)
      WorkWithC: sanitiseText(payload.workwith_collabC || payload.WorkWithC || ""),
      WorkWithT: sanitiseText(payload.workwith_collabT || payload.WorkWithT || ""),
      col_q1: sanitiseText(payload.col_q1 || ""),
      lead_q1: sanitiseText(payload.lead_q1 || ""),

      // Page 7 actions
      Act1: sanitiseText(payload.act1 || payload.Act1 || ""),
      Act2: sanitiseText(payload.act2 || payload.Act2 || ""),
      Act3: sanitiseText(payload.act3 || payload.Act3 || ""),
      Act4: sanitiseText(payload.act4 || payload.Act4 || ""),
      Act5: sanitiseText(payload.act5 || payload.Act5 || ""),
      Act6: sanitiseText(payload.act6 || payload.Act6 || ""),
    };

    // Merge optional overrides from URL
    const L = mergeLayoutOverrides(DEFAULT_LAYOUT.pages, u.href);

    // Render
    const pdfDoc = await PDFDocument.load(tpl.bytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const pages = pdfDoc.getPages();

    // Page indexes (0-based)
    const p1 = pages[0];
    const p2 = pages[1];
    const p3 = pages[2];
    const p4 = pages[3];
    const p5 = pages[4];
    const p6 = pages[5];
    const p7 = pages[6];
    const p8 = pages[7];

    if (p1) {
      drawTextBox(p1, font, P.identity.fullName, L.p1.name);
      drawTextBox(p1, font, P.identity.dateLabel, L.p1.date);
    }

    // Headers p2..p8
    if (p2) drawTextBox(p2, font, P.identity.fullName, L.p2.hdrName);
    if (p3) drawTextBox(p3, font, P.identity.fullName, L.p3.hdrName);
    if (p4) drawTextBox(p4, font, P.identity.fullName, L.p4.hdrName);
    if (p5) drawTextBox(p5, font, P.identity.fullName, L.p5.hdrName);
    if (p6) drawTextBox(p6, font, P.identity.fullName, L.p6.hdrName);
    if (p7) drawTextBox(p7, font, P.identity.fullName, L.p7.hdrName);
    if (p8) drawTextBox(p8, font, P.identity.fullName, L.p8.hdrName);

    // Page 3 text + questions
    if (p3) {
      drawTextBox(p3, font, P.exec1, L.p3Text.exec1);
      drawTextBox(p3, font, P.exec2, L.p3Text.exec2);

      drawTextBox(p3, font, P.exec_q1, L.p3Q.exec_q1);
      drawTextBox(p3, font, P.exec_q2, L.p3Q.exec_q2);
      drawTextBox(p3, font, P.exec_q3, L.p3Q.exec_q3);
      drawTextBox(p3, font, P.exec_q4, L.p3Q.exec_q4);
    }

    // Page 4 text + questions (chart image handling omitted here as in V5)
    if (p4) {
      drawTextBox(p4, font, P.ov1, L.p4Text.ov1);
      drawTextBox(p4, font, P.ov2, L.p4Text.ov2);

      drawTextBox(p4, font, P.ov_q1, L.p4Q.ov_q1);
      drawTextBox(p4, font, P.ov_q2, L.p4Q.ov_q2);
    }

    // Page 5 text + questions
    if (p5) {
      drawTextBox(p5, font, P.dd1, L.p5Text.dd1);
      drawTextBox(p5, font, P.dd2, L.p5Text.dd2);
      drawTextBox(p5, font, P.th1, L.p5Text.th1);
      drawTextBox(p5, font, P.th2, L.p5Text.th2);

      drawTextBox(p5, font, P.dd_q1, L.p5Q.dd_q1);
      drawTextBox(p5, font, P.dd_q2, L.p5Q.dd_q2);
      drawTextBox(p5, font, P.th_q1, L.p5Q.th_q1);
      drawTextBox(p5, font, P.th_q2, L.p5Q.th_q2);
    }

    // Page 6 WorkWith + questions
    if (p6) {
      drawTextBox(p6, font, P.WorkWithC, L.p6WorkWith.collabC);
      drawTextBox(p6, font, P.WorkWithT, L.p6WorkWith.collabT);

      drawTextBox(p6, font, P.col_q1, L.p6Q.col_q1);
      drawTextBox(p6, font, P.lead_q1, L.p6Q.lead_q1);
    }

    // Page 7 actions
    if (p7) {
      drawTextBox(p7, font, P.Act1, L.p7Actions.act1);
      drawTextBox(p7, font, P.Act2, L.p7Actions.act2);
      drawTextBox(p7, font, P.Act3, L.p7Actions.act3);

      // NOTE: These will only appear if your PDF template actually has room for them.
      // They are included because you asked for the co-ordinates to be present.
      drawTextBox(p7, font, P.Act4, L.p7Actions.act4);
      drawTextBox(p7, font, P.Act5, L.p7Actions.act5);
      drawTextBox(p7, font, P.Act6, L.p7Actions.act6);
    }

    const outBytes = await pdfDoc.save();
    const outName = makeOutputFilename(P.identity.fullName, P.identity.dateLabel);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${outName}"`);
    return res.status(200).send(Buffer.from(outBytes));
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
      stack: err?.stack || null,
    });
  }
}

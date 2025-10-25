// api/fill-template.js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------- util: __dirname (ESM) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------- helpers ----------
const S  = (v, fb = '') => (v == null ? String(fb) : String(v));
const N  = (v, fb = 0)  => (Number.isFinite(+v) ? +v : +fb);
const A  = (v) => (Array.isArray(v) ? v : []);
const G  = (o, k, fb = '') => S((o && o[k]) ?? fb, fb);

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Draw text if non-empty (simple wrap). Returns final y used. */
function drawText(page, text, opts = {}) {
  const {
    x = 40,
    y = 700,
    font,
    size = 12,
    maxWidth = 500,
    lineHeight = size * 1.2,
    color = rgb(0, 0, 0),
    maxLines = 14
  } = opts;

  const t = S(text, '').trim();
  if (!t) return y;

  // crude wrapping by splitting on spaces
  const words = t.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width <= maxWidth) {
      line = test;
    } else {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  let yy = y;
  for (const ln of lines) {
    page.drawText(ln, { x, y: yy, size, font, color });
    yy -= lineHeight;
    if (yy < 0) break;
  }
  return yy;
}

/** Draw a bulleted list (array of strings). Returns final y. */
function drawList(page, items, opts = {}) {
  const {
    x = 40, y = 700, bullet = '•', gap = 6,
    font, size = 11, maxWidth = 480, lineHeight = size * 1.3,
    maxItems = 6
  } = opts;

  const arr = A(items).slice(0, maxItems).map(S).filter(Boolean);
  let yy = y;
  for (const it of arr) {
    page.drawText(bullet, { x, y: yy, size, font });
    yy = drawText(page, it, { x: x + 14, y: yy, font, size, maxWidth, lineHeight, maxLines: 4 }) - gap;
    if (yy < 40) break;
  }
  return yy;
}

/** Try to fetch and embed a PNG image (best-effort). */
async function embedPngFromUrl(pdfDoc, url) {
  try {
    if (!url) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return await pdfDoc.embedPng(buf);
  } catch {
    return null;
  }
}

/** Safe loader for a file inside /public */
async function loadTemplateBytes(tplName) {
  const abs = path.resolve(__dirname, '..', 'public', tplName);
  return await fs.readFile(abs);
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    // ---- 1) Params ---------------------------------------------------------
    const method = req.method || 'GET';
    const isPost = method === 'POST';

    const tpl = S(isPost ? req.body?.tpl : req.query?.tpl).trim();
    if (!tpl) {
      res.statusCode = 400;
      return res.end('Missing tpl');
    }

    const raw = Boolean(isPost ? req.body?.raw : req.query?.raw);

    const b64 = S(isPost ? req.body?.data : req.query?.data).trim();
    let data = {};
    if (b64) {
      try {
        const json = Buffer.from(b64, 'base64').toString('utf8');
        data = JSON.parse(json || '{}');
      } catch {
        data = {};
      }
    }

    // ---- 2) Load template --------------------------------------------------
    const tplBytes = await loadTemplateBytes(tpl);

    // if raw=1, just stream the untouched template
    if (raw) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 200;
      return res.end(tplBytes);
    }

    // ---- 3) Paint with guards ---------------------------------------------
    let outBytes = null;

    try {
      const pdfDoc = await PDFDocument.load(tplBytes);
      const pages = pdfDoc.getPages();
      const font  = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // unpack payload safely
      const p = {
        fullName:  G(data?.person, 'fullName', ''),
        email:     G(data?.person, 'email', ''),
        dateLbl:   S(data?.dateLbl, ''),
        dom:       S(data?.dom, ''),
        domchar:   S(data?.domchar, ''),
        domdesc:   S(data?.domdesc, ''),
        spiderdesc:S(data?.spiderdesc, ''),
        seqpat:    S(data?.seqpat, ''),
        theme:     S(data?.theme, ''),
        themeExpl: S(data?.themeExpl, ''),
        workwcol:  A(data?.workwcol).slice(0, 4),
        workwlead: A(data?.workwlead).slice(0, 4),
        tips:      A(data?.tips).slice(0, 2),
        actions:   A(data?.actions).slice(0, 2),
        chartUrl:  S(data?.chartUrl, '')
      };

      // ---------- Page 1: name/date (adjust coords if needed) ----------
      if (pages[0]) {
        drawText(pages[0], p.fullName, { x: 60, y: 760, font, size: 22, maxWidth: 470, maxLines: 1 });
        drawText(pages[0], p.dateLbl,  { x: 430, y: 785, font, size: 12, maxWidth: 140, maxLines: 1 });
      }

      // ---------- Page 3: dominant description ----------
      if (pages[2]) {
        drawText(pages[2], p.domdesc, { x: 30, y: 685, font, size: 13, maxWidth: 550, lineHeight: 16, maxLines: 20 });
      }

      // ---------- Page 4: spider explanation ----------
      if (pages[3]) {
        drawText(pages[3], p.spiderdesc, { x: 30, y: 585, font, size: 13, maxWidth: 550, lineHeight: 16, maxLines: 18 });
      }

      // ---------- Page 5: sequence narrative ----------
      if (pages[4]) {
        drawText(pages[4], p.seqpat, { x: 25, y: 520, font, size: 13, maxWidth: 550, lineHeight: 16, maxLines: 18 });
      }

      // ---------- Page 6: theme & explanation ----------
      if (pages[5]) {
        drawText(pages[5], p.theme ? `Theme: ${p.theme}` : '', { x: 25, y: 540, font, size: 12, maxWidth: 550, maxLines: 1 });
        drawText(pages[5], p.themeExpl, { x: 25, y: 520, font, size: 13, maxWidth: 550, lineHeight: 16, maxLines: 18 });
      }

      // ---------- Page 7–8: work with colleagues & leaders ----------
      // Layout: two columns per page (Look / Work)
      const drawWorkPairs = (page, pairs, topY) => {
        let y = topY;
        for (const pair of A(pairs)) {
          const look = S(pair?.look, '');
          const work = S(pair?.work, '');
          if (!look && !work) continue;

          // left column: LOOK
          drawText(page, look, { x: 30, y, font, size: 12, maxWidth: 240, lineHeight: 15, maxLines: 5 });
          // right column: WORK
          drawText(page, work, { x: 320, y, font, size: 12, maxWidth: 240, lineHeight: 15, maxLines: 5 });

          y -= 80;
          if (y < 70) break;
        }
      };

      if (pages[6]) drawWorkPairs(pages[6], p.workwcol, 440);   // page 7
      if (pages[7]) drawWorkPairs(pages[7], p.workwlead, 440);  // page 8

      // ---------- Page 9–10–11: tips / actions ----------
      // Page 9: tips (left) + actions (right) as lists
      if (pages[8]) {
        drawList(pages[8], p.tips,    { x: 30,  y: 450, font, size: 12, maxWidth: 250, lineHeight: 15, maxItems: 6 });
        drawList(pages[8], p.actions, { x: 320, y: 450, font, size: 12, maxWidth: 250, lineHeight: 15, maxItems: 6 });
      }

      // Optional: Page 4 (or anywhere): embed chart image if provided
      if (p.chartUrl) {
        const png = await embedPngFromUrl(pdfDoc, p.chartUrl);
        if (png && pages[3]) {
          const { width, height } = png.scale(0.75);
          pages[3].drawImage(png, { x: 32, y: 260, width: clamp(width, 100, 560), height: clamp(height, 80, 280) });
        }
      }

      outBytes = await pdfDoc.save();
    } catch (paintErr) {
      // Any paint error falls back to returning the raw template instead of 500
      console.error('fill-template: paint error', paintErr);
      outBytes = tplBytes;
    }

    // ---- 4) Respond --------------------------------------------------------
    res.setHeader('Content-Type', 'application/pdf');
    // If you want forced download, uncomment:
    // const outName = S(isPost ? req.body?.out : req.query?.out, 'ctrl.pdf').replace(/[^\w.\-]+/g, '_');
    // res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    return res.end(outBytes);
  } catch (e) {
    console.error('fill-template: fatal', e);
    // As a last resort try to stream the template if available
    try {
      const tpl = S(req.method === 'POST' ? req.body?.tpl : req.query?.tpl).trim();
      if (tpl) {
        const bytes = await loadTemplateBytes(tpl);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Cache-Control', 'no-store');
        res.statusCode = 200;
        return res.end(bytes);
      }
    } catch {}
    res.statusCode = 500;
    return res.end('fill-template failed');
  }
}

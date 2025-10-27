// api/fill-template.js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------- util: __dirname (ESM) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------- tiny helpers ----------
const S  = (v, fb = '') => (v == null ? String(fb) : String(v));
const N  = (v, fb = 0)  => (Number.isFinite(+v) ? +v : +fb);
const A  = (v) => (Array.isArray(v) ? v : []);
const G  = (o, k, fb = '') => S((o && o[k]) ?? fb, fb);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const okObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

// ---------- DEFAULT COORDS (BAKED FROM USER PDF) ----------
/*
  Naming: p{page}.{field} = { x,y,w,h?, size, maxLines, lineHeight? }
  You can override ANY of these at runtime using URL params:
    &p3_domDesc_x=72&p3_domDesc_y=700&p3_domDesc_w=630&p3_domDesc_size=11
  or by sending a layout object in data.layoutV6 (same keys).
*/
const LOCKED = {
  // PAGE 1
  p1: {
    name: { x: 60,  y: 760, w: 470, size: 22, maxLines: 1 },
    date: { x: 430, y: 785, w: 140, size: 12, maxLines: 1 },
  },
  // PAGE 2 (OPTIONAL HEADER REPEAT)
  p2: { name: { x: 60, y: 785, w: 470, size: 10, maxLines: 1 }, date: { x: 430, y: 785, w: 140, size: 10, maxLines: 1 } },
  p3: {
    // Dominant character & description
    domChar: { x: 265, y: 640, w: 630, size: 25, maxLines: 1 },
    domDesc: { x: 72,  y: 700, w: 630, size: 11, maxLines: 28, lineHeight: 13.5 },
    name:    { x: 60,  y: 785, w: 470, size: 10, maxLines: 1 }, // optional header repeat
    date:    { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  p4: {
    // Spider narrative + chart image
    spiderDesc: { x: 80,  y: 340, w: 260, size: 11, maxLines: 24, lineHeight: 13.5 },
    chart:      { x: 355, y: 315, w: 270, h: 250 },
    name:       { x: 60,  y: 785, w: 470, size: 10, maxLines: 1 },
    date:       { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  p5: {
    seqpat: { x: 70, y: 170, w: 630, size: 11, maxLines: 26, lineHeight: 13.5 },
    name:   { x: 60, y: 785, w: 470, size: 10, maxLines: 1 },
    date:   { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  p6: {
    theme:     { x: 70,  y: 170, w: 630, size: 11, maxLines: 1 },
    themeExpl: { x: 70,  y: 150, w: 630, size: 11, maxLines: 20, lineHeight: 13.5 }, // sits just under theme line
    name:      { x: 60,  y: 785, w: 470, size: 10, maxLines: 1 },
    date:      { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  // P7 / P8: Coach template uses “work with colleagues / leaders” pairs.
  // We keep a simple two-column layout, but you can still set a topY here.
  p7: {
    workPairsTopY: { y: 440 }, // starting Y for pairs
    leftColX: 30, rightColX: 320, colW: 240, size: 12, lineHeight: 15,
    name: { x: 60, y: 785, w: 470, size: 10, maxLines: 1 },
    date: { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  p8: {
    workPairsTopY: { y: 440 },
    leftColX: 30, rightColX: 320, colW: 240, size: 12, lineHeight: 15,
    name: { x: 60, y: 785, w: 470, size: 10, maxLines: 1 },
    date: { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  // P9: Tips & Actions (two vertical lists)
  p9: {
    tipsHdr: { x: 70,  y: 122, w: 320, size: 12, maxLines: 1 },    // optional, we draw list items mainly
    actsHdr: { x: 400, y: 122, w: 320, size: 12, maxLines: 1 },
    tipsBox: { x: 70,  y: 155, w: 315, size: 11, maxLines: 24, lineHeight: 13.5 },
    actsBox: { x: 400, y: 155, w: 315, size: 11, maxLines: 24, lineHeight: 13.5 },
    // list drawing below uses separate routine; these boxes set the starting coordinates
    list:    { bulletGap: 6, itemMaxLines: 4, maxItems: 6 },
    name:    { x: 60,  y: 785, w: 470, size: 10, maxLines: 1 },
    date:    { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  }
};

// ---------- URL override parser (pX_field_prop=...) ----------
function parseUrlOverrides(q) {
  const out = {};
  const entries = Object.entries(q || {});
  for (const [key, val] of entries) {
    const m = key.match(/^p(\d+)_([A-Za-z0-9]+)_(x|y|w|h|size|max|maxLines|lineHeight)$/);
    if (!m) continue;
    const page = `p${m[1]}`;
    const field = m[2];
    const prop  = (m[3] === 'max') ? 'maxLines' : m[3];
    out[page] = out[page] || {};
    out[page][field] = out[page][field] || {};
    const numProps = new Set(['x','y','w','h','size','maxLines','lineHeight']);
    out[page][field][prop] = numProps.has(prop) ? N(val) : S(val);
  }
  // Special cases for p7/p8 pair layout columns/topY (friendly keys)
  for (const [key, val] of entries) {
    const m2 = key.match(/^p(7|8)_(leftColX|rightColX|colW|size|lineHeight|workPairsTopY)$/);
    if (!m2) continue;
    const page = `p${m2[1]}`;
    out[page] = out[page] || {};
    if (m2[2] === 'workPairsTopY') out[page].workPairsTopY = { y: N(val) };
    else out[page][m2[2]] = N(val);
  }
  return out;
}

// ---------- deep merge ----------
function deepMerge(a, b) {
  if (!okObj(b)) return a;
  if (!okObj(a)) a = {};
  for (const k of Object.keys(b)) {
    const av = a[k], bv = b[k];
    if (okObj(bv) && !Array.isArray(bv)) {
      a[k] = deepMerge(okObj(av) ? av : {}, bv);
    } else {
      a[k] = bv;
    }
  }
  return a;
}

// ---------- draw helpers ----------
function drawText(page, text, opts = {}) {
  const {
    x = 40, y = 700, font, size = 12,
    maxWidth = 500, lineHeight = size * 1.2,
    color = rgb(0,0,0), maxLines = 14
  } = opts;
  const t = S(text, '').trim();
  if (!t) return y;
  const words = t.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test  = line ? line + ' ' + w : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
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

function drawList(page, items, box, font) {
  const { x, y, w, size = 11, lineHeight = size * 1.3, maxLines = 24 } = box;
  const bulletGap = N(box.bulletGap, 6);
  const itemMax   = N(box.maxItems, 6);
  const arr = A(items).slice(0, itemMax).map(S).filter(Boolean);
  let yy = y;
  for (const it of arr) {
    page.drawText('•', { x, y: yy, size, font });
    yy = drawText(page, it, {
      x: x + 14, y: yy, font, size, maxWidth: w - 18,
      lineHeight, maxLines: N(box.itemMaxLines, 4)
    }) - bulletGap;
    if (yy < 40) break;
  }
  return yy;
}

async function embedPngFromUrl(pdfDoc, url) {
  try {
    if (!url) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return await pdfDoc.embedPng(buf);
  } catch { return null; }
}

async function loadTemplateBytes(tplName) {
  const abs = path.resolve(__dirname, '..', 'public', tplName);
  return await fs.readFile(abs);
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    const method = req.method || 'GET';
    const isPost = method === 'POST';

    const tpl = S(isPost ? req.body?.tpl : req.query?.tpl).trim();
    if (!tpl) { res.statusCode = 400; return res.end('Missing tpl'); }

    const raw = Boolean(isPost ? req.body?.raw : req.query?.raw);

    const b64 = S(isPost ? req.body?.data : req.query?.data).trim();
    let data = {};
    if (b64) {
      try {
        const json = Buffer.from(b64, 'base64').toString('utf8');
        data = JSON.parse(json || '{}');
      } catch { data = {}; }
    }

    // Unstructured URL overrides (pX_field_prop=…)
    const urlOverrides = parseUrlOverrides(req.query || {});
    // Structured layout overrides in payload
    const layoutV6     = okObj(data?.layoutV6) ? data.layoutV6 : {};
    // Merge: LOCKED <- urlOverrides <- layoutV6  (layoutV6 wins over URL if both present)
    const L = deepMerge(deepMerge(JSON.parse(JSON.stringify(LOCKED)), urlOverrides), layoutV6);

    const tplBytes = await loadTemplateBytes(tpl);
    if (raw) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 200;
      return res.end(tplBytes);
    }

    // -------- paint --------
    let outBytes = null;
    try {
      const pdfDoc = await PDFDocument.load(tplBytes);
      const pages  = pdfDoc.getPages();
      const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);

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
        tips:      A(data?.tips).slice(0, 8),
        actions:   A(data?.actions).slice(0, 8),
        chartUrl:  S(data?.chartUrl, '')
      };

      // --- Page headers (P1 + optional repeats on P2–P10) ---
      const drawPageHeader = (i) => {
        const key = `p${i}`;
        if (!pages[i-1] || !L[key]) return;
        if (L[key].name) drawText(pages[i-1], p.fullName, { font, ...L[key].name });
        if (L[key].date) drawText(pages[i-1], p.dateLbl, { font, ...L[key].date });
      };

      // P1
      drawPageHeader(1);

      // P3 dominant character / description
      if (pages[2] && L.p3) {
        drawPageHeader(3);
        if (L.p3.domChar) drawText(pages[2], p.domchar, { font, ...L.p3.domChar });
        if (L.p3.domDesc) drawText(pages[2], p.domdesc, { font, ...L.p3.domDesc });
      }

      // P4 spider text + chart
      if (pages[3] && L.p4) {
        drawPageHeader(4);
        if (L.p4.spiderDesc) drawText(pages[3], p.spiderdesc, { font, ...L.p4.spiderDesc });
        if (p.chartUrl && L.p4.chart) {
          const png = await embedPngFromUrl(pdfDoc, p.chartUrl);
          if (png) {
            const w = N(L.p4.chart.w, 270), h = N(L.p4.chart.h, 250);
            pages[3].drawImage(png, {
              x: N(L.p4.chart.x, 355),
              y: N(L.p4.chart.y, 315),
              width: clamp(w, 100, 560),
              height: clamp(h, 80,  560)
            });
          }
        }
      }

      // P5 sequence pattern
      if (pages[4] && L.p5?.seqpat) {
        drawPageHeader(5);
        drawText(pages[4], p.seqpat, { font, ...L.p5.seqpat });
      }

      // P6 theme + explanation
      if (pages[5] && L.p6) {
        drawPageHeader(6);
        if (L.p6.theme)     drawText(pages[5], p.theme ? `Theme: ${p.theme}` : '', { font, ...L.p6.theme });
        if (L.p6.themeExpl) drawText(pages[5], p.themeExpl, { font, ...L.p6.themeExpl });
      }

      // P7: Work with colleagues (pairs)
      if (pages[6] && L.p7) {
        drawPageHeader(7);
        const topY = N(L.p7.workPairsTopY?.y, 440);
        let y = topY;
        for (const pair of p.workwcol) {
          const look = S(pair?.look, ''), work = S(pair?.work, '');
          if (!look && !work) continue;
          drawText(pages[6], look, { font, x: N(L.p7.leftColX, 30),  y, w: N(L.p7.colW, 240), size: N(L.p7.size, 12), maxLines: 5, lineHeight: N(L.p7.lineHeight, 15) });
          drawText(pages[6], work, { font, x: N(L.p7.rightColX, 320), y, w: N(L.p7.colW, 240), size: N(L.p7.size, 12), maxLines: 5, lineHeight: N(L.p7.lineHeight, 15) });
          y -= 80; if (y < 70) break;
        }
      }

      // P8: Work with leaders (pairs)
      if (pages[7] && L.p8) {
        drawPageHeader(8);
        const topY = N(L.p8.workPairsTopY?.y, 440);
        let y = topY;
        for (const pair of p.workwlead) {
          const look = S(pair?.look, ''), work = S(pair?.work, '');
          if (!look && !work) continue;
          drawText(pages[7], look, { font, x: N(L.p8.leftColX, 30),  y, w: N(L.p8.colW, 240), size: N(L.p8.size, 12), maxLines: 5, lineHeight: N(L.p8.lineHeight, 15) });
          drawText(pages[7], work, { font, x: N(L.p8.rightColX, 320), y, w: N(L.p8.colW, 240), size: N(L.p8.size, 12), maxLines: 5, lineHeight: N(L.p8.lineHeight, 15) });
          y -= 80; if (y < 70) break;
        }
      }

      // P9: Tips (left) + Actions (right)
      if (pages[8] && L.p9) {
        drawPageHeader(9);
        if (L.p9.tipsHdr) drawText(pages[8], 'Tips',    { font, ...L.p9.tipsHdr });
        if (L.p9.actsHdr) drawText(pages[8], 'Actions', { font, ...L.p9.actsHdr });
        if (L.p9.tipsBox) drawList(pages[8], p.tips,    { ...L.p9.tipsBox, ...L.p9.list }, font);
        if (L.p9.actsBox) drawList(pages[8], p.actions, { ...L.p9.actsBox, ...L.p9.list }, font);
      }

      // Optional: draw the small header on P2, P10 if pages exist
      drawPageHeader(2);
      drawPageHeader(10);

      outBytes = await pdfDoc.save();
    } catch (paintErr) {
      console.error('fill-template: paint error', paintErr);
      outBytes = tplBytes; // graceful fallback
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 200;
    return res.end(outBytes);
  } catch (e) {
    console.error('fill-template: fatal', e);
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

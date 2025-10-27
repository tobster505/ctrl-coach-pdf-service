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

// ---------- DEFAULT COORDS (BAKED FROM USER PDF; TOP-LEFT ORIGIN) ----------
/*
  IMPORTANT:
  - These defaults are in **Top-Left (TL)** origin to match your “User” service.
  - We’ll convert TL -> BL at draw time so you can keep reusing your old URL params.
  - You can override ANY of these at runtime using URL params, e.g.:
      &p3_domDesc_x=72&p3_domDesc_y=700&p3_domDesc_w=630&p3_domDesc_size=11
  - Or via a payload object: data.layoutV6 = { p3: { domDesc: { x,y,w,size,maxLines,... } }, meta:{ origin:"TL" } }
*/
const LOCKED_TL = {
  // PAGE 1
  p1: {
    name: { x: 7,   y: 473, w: 500, size: 30, maxLines: 1 },  // User header style
    date: { x: 210, y: 600, w: 500, size: 25, maxLines: 1 },  // User header style
  },
  // PAGE 2 (OPTIONAL HEADER REPEAT)
  p2: {
    name: { x: 60,  y: 785, w: 470, size: 10, maxLines: 1 },
    date: { x: 430, y: 785, w: 140, size: 10, maxLines: 1 }
  },
  p3: {
    domChar: { x: 265, y: 640, w: 630, size: 25, maxLines: 1 },                    // from User
    domDesc: { x: 72,  y: 700, w: 630, size: 11, maxLines: 28, lineHeight: 13.5 }, // from User
    name:    { x: 60,  y: 785, w: 470, size: 10, maxLines: 1 },
    date:    { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  p4: {
    // You asked for the chart to match the User PDF look
    chart:      { x: 20,  y: 225, w: 570, h: 280 },          // User chart box
    spiderDesc: { x: 80,  y: 340, w: 260, size: 11, maxLines: 24, lineHeight: 13.5 }, // User
    name:       { x: 60,  y: 785, w: 470, size: 10, maxLines: 1 },
    date:       { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  p5: {
    seqpat: { x: 70, y: 170, w: 630, size: 11, maxLines: 26, lineHeight: 13.5 }, // User
    name:   { x: 60, y: 785, w: 470, size: 10, maxLines: 1 },
    date:   { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  p6: {
    theme:     { x: 70,  y: 170, w: 630, size: 11, maxLines: 1 },                 // User
    themeExpl: { x: 70,  y: 150, w: 630, size: 11, maxLines: 20, lineHeight: 13.5 }, // User
    name:      { x: 60,  y: 785, w: 470, size: 10, maxLines: 1 },
    date:      { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  // P7 / P8: pairs (two columns)
  p7: {
    workPairsTopY: { y: 440 },
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
    tipsHdr: { x: 70,  y: 122, w: 320, size: 12, maxLines: 1 },    // headers optional
    actsHdr: { x: 400, y: 122, w: 320, size: 12, maxLines: 1 },
    tipsBox: { x: 70,  y: 155, w: 315, size: 11, maxLines: 24, lineHeight: 13.5 },
    actsBox: { x: 400, y: 155, w: 315, size: 11, maxLines: 24, lineHeight: 13.5 },
    list:    { bulletGap: 6, itemMaxLines: 4, maxItems: 6 },
    name:    { x: 60,  y: 785, w: 470, size: 10, maxLines: 1 },
    date:    { x: 430, y: 785, w: 140, size: 10, maxLines: 1 },
  },
  // Meta: default origin to TL to match User coordinates
  meta: { origin: 'TL' }
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
  // Friendly keys for pair layout
  for (const [key, val] of entries) {
    const m2 = key.match(/^p(7|8)_(leftColX|rightColX|colW|size|lineHeight|workPairsTopY)$/);
    if (!m2) continue;
    const page = `p${m2[1]}`;
    out[page] = out[page] || {};
    if (m2[2] === 'workPairsTopY') out[page].workPairsTopY = { y: N(val) };
    else out[page][m2[2]] = N(val);
  }
  // Optional global origin override via URL: &origin=TL or &origin=BL
  if (q && typeof q.origin === 'string') {
    out.meta = out.meta || {};
    out.meta.origin = q.origin.toUpperCase() === 'TL' ? 'TL' : 'BL';
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

// ---------- origin conversion ----------
const isTL = (meta) => (S(meta?.origin, 'TL').toUpperCase() === 'TL');
const toBLy = (page, yTL) => page.getHeight() - yTL;

// Convert a box or field (with x,y, etc.) from TL to BL if needed
function resolveBox(page, box, useTL) {
  if (!box) return null;
  const out = { ...box };
  if (useTL && typeof out.y === 'number') {
    out.y = toBLy(page, out.y);
  }
  return out;
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
    // Merge: LOCKED_TL <- urlOverrides <- layoutV6  (layoutV6 wins over URL if both present)
    const L = deepMerge(deepMerge(JSON.parse(JSON.stringify(LOCKED_TL)), urlOverrides), layoutV6);

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

      // Decide origin once (URL overrides can set &origin=TL or BL; payload can set layoutV6.meta.origin)
      const originTL = isTL(L.meta);

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

      // --- helper to draw page header for any page ---
      const drawPageHeader = (i) => {
        const key = `p${i}`;
        const page = pages[i-1];
        if (!page || !L[key]) return;
        if (L[key].name) {
          const box = resolveBox(page, L[key].name, originTL);
          drawText(page, p.fullName, { font, ...box });
        }
        if (L[key].date) {
          const box = resolveBox(page, L[key].date, originTL);
          drawText(page, p.dateLbl, { font, ...box });
        }
      };

      // P1 header
      drawPageHeader(1);

      // P3 dominant character / description
      if (pages[2] && L.p3) {
        drawPageHeader(3);
        if (L.p3.domChar) {
          const box = resolveBox(pages[2], L.p3.domChar, originTL);
          drawText(pages[2], p.domchar, { font, ...box });
        }
        if (L.p3.domDesc) {
          const box = resolveBox(pages[2], L.p3.domDesc, originTL);
          drawText(pages[2], p.domdesc, { font, ...box });
        }
      }

      // P4 spider text + chart
      if (pages[3] && L.p4) {
        drawPageHeader(4);
        if (L.p4.spiderDesc) {
          const box = resolveBox(pages[3], L.p4.spiderDesc, originTL);
          drawText(pages[3], p.spiderdesc, { font, ...box });
        }
        if (p.chartUrl && L.p4.chart) {
          const png = await embedPngFromUrl(pdfDoc, p.chartUrl);
          if (png) {
            const rawBox = L.p4.chart;
            const box = resolveBox(pages[3], rawBox, originTL);
            const w = N(box.w, 270), h = N(box.h, 250);
            pages[3].drawImage(png, {
              x: N(box.x, 355),
              y: N(box.y, 315),
              width: clamp(w, 100, 560),
              height: clamp(h, 80,  560)
            });
          }
        }
      }

      // P5 sequence pattern
      if (pages[4] && L.p5?.seqpat) {
        drawPageHeader(5);
        const box = resolveBox(pages[4], L.p5.seqpat, originTL);
        drawText(pages[4], p.seqpat, { font, ...box });
      }

      // P6 theme + explanation
      if (pages[5] && L.p6) {
        drawPageHeader(6);
        if (L.p6.theme) {
          const box = resolveBox(pages[5], L.p6.theme, originTL);
          drawText(pages[5], p.theme ? `Theme: ${p.theme}` : '', { font, ...box });
        }
        if (L.p6.themeExpl) {
          const box = resolveBox(pages[5], L.p6.themeExpl, originTL);
          drawText(pages[5], p.themeExpl, { font, ...box });
        }
      }

      // P7: Work with colleagues (pairs)
      if (pages[6] && L.p7) {
        drawPageHeader(7);
        const rawTop = L.p7.workPairsTopY?.y ?? 440;
        const topY = originTL ? toBLy(pages[6], rawTop) : rawTop;
        let y = topY;
        for (const pair of p.workwcol) {
          const look = S(pair?.look, ''), work = S(pair?.work, '');
          if (!look && !work) continue;
          const leftX  = N(L.p7.leftColX, 30);
          const rightX = N(L.p7.rightColX, 320);
          const colW   = N(L.p7.colW, 240);
          const size   = N(L.p7.size, 12);
          const lh     = N(L.p7.lineHeight, 15);
          drawText(pages[6], look, { font, x: leftX,  y, w: colW, size, maxLines: 5, lineHeight: lh });
          drawText(pages[6], work, { font, x: rightX, y, w: colW, size, maxLines: 5, lineHeight: lh });
          y -= 80; if (y < 70) break;
        }
      }

      // P8: Work with leaders (pairs)
      if (pages[7] && L.p8) {
        drawPageHeader(8);
        const rawTop = L.p8.workPairsTopY?.y ?? 440;
        const topY = originTL ? toBLy(pages[7], rawTop) : rawTop;
        let y = topY;
        for (const pair of p.workwlead) {
          const look = S(pair?.look, ''), work = S(pair?.work, '');
          if (!look && !work) continue;
          const leftX  = N(L.p8.leftColX, 30);
          const rightX = N(L.p8.rightColX, 320);
          const colW   = N(L.p8.colW, 240);
          const size   = N(L.p8.size, 12);
          const lh     = N(L.p8.lineHeight, 15);
          drawText(pages[7], look, { font, x: leftX,  y, w: colW, size, maxLines: 5, lineHeight: lh });
          drawText(pages[7], work, { font, x: rightX, y, w: colW, size, maxLines: 5, lineHeight: lh });
          y -= 80; if (y < 70) break;
        }
      }

      // P9: Tips (left) + Actions (right)
      if (pages[8] && L.p9) {
        drawPageHeader(9);
        if (L.p9.tipsHdr) {
          const box = resolveBox(pages[8], L.p9.tipsHdr, originTL);
          drawText(pages[8], 'Tips', { font, ...box });
        }
        if (L.p9.actsHdr) {
          const box = resolveBox(pages[8], L.p9.actsHdr, originTL);
          drawText(pages[8], 'Actions', { font, ...box });
        }
        if (L.p9.tipsBox) {
          const box = resolveBox(pages[8], L.p9.tipsBox, originTL);
          drawList(pages[8], p.tips, { ...box, ...L.p9.list }, font);
        }
        if (L.p9.actsBox) {
          const box = resolveBox(pages[8], L.p9.actsBox, originTL);
          drawList(pages[8], p.actions, { ...box, ...L.p9.list }, font);
        }
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

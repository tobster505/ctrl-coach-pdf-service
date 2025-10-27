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

// Deep merge (for layout objects)
function deepMerge(a, b) {
  if (!b) return a;
  if (!a || typeof a !== 'object' || Array.isArray(a)) a = {};
  for (const k of Object.keys(b)) {
    const av = a[k], bv = b[k];
    if (bv && typeof bv === 'object' && !Array.isArray(bv)) {
      a[k] = deepMerge(av && typeof av === 'object' && !Array.isArray(av) ? av : {}, bv);
    } else {
      a[k] = bv;
    }
  }
  return a;
}

// Parse modern compact layout QS:
//   layoutQS=p3.domDesc:x=72,y=700,w=630,size=11; p4.chart:x=355,y=315,w=270,h=250
function parseLayoutQS(qs) {
  const out = {};
  if (!qs || typeof qs !== 'string') return out;
  const blocks = qs.split(';').map(s => s.trim()).filter(Boolean);
  for (const block of blocks) {
    const [path, kvs] = block.split(':');
    if (!path || !kvs) continue;
    const [pageKey, fieldKey] = path.trim().split('.');
    if (!pageKey || !fieldKey) continue;
    const cfg = {};
    for (const kv of kvs.split(',').map(s => s.trim()).filter(Boolean)) {
      const [kRaw, vRaw] = kv.split('=').map(s => s && s.trim());
      if (!kRaw) continue;
      const mapKey = ({ lines: 'maxLines', max: 'maxLines', fontsize: 'size' }[kRaw.toLowerCase()]) || kRaw;
      let v = vRaw;
      if (['x','y','w','h','size','maxLines'].includes(mapKey)) {
        const n = Number(vRaw); if (!Number.isNaN(n)) v = n;
      }
      if (mapKey === 'align') {
        const m = { l:'left', left:'left', c:'center', centre:'center', center:'center', r:'right', right:'right', j:'justify', justify:'justify' };
        v = m[String(vRaw||'').toLowerCase()] || vRaw;
      }
      cfg[mapKey] = v;
    }
    out[pageKey] = out[pageKey] || {};
    out[pageKey][fieldKey] = Object.assign(out[pageKey][fieldKey] || {}, cfg);
  }
  return out;
}

// Parse legacy flat QS (your old style):
//   p3_domDesc_x=72&p3_domDesc_y=700&p3_domDesc_w=630&p3_domDesc_size=11
function parseLegacyFlatQS(queryObj) {
  const out = {};
  if (!queryObj || typeof queryObj !== 'object') return out;
  for (const [k, v] of Object.entries(queryObj)) {
    const m = /^p(\d+)_([a-zA-Z0-9]+)_(x|y|w|h|size|max|lines|align)$/.exec(k);
    if (!m) continue;
    const [, pageNum, fieldRaw, prop] = m;
    const pageKey  = 'p' + pageNum;
    const fieldKey = fieldRaw;
    const keyNorm  = (prop === 'lines' || prop === 'max') ? 'maxLines' : prop;
    let val = v;
    if (['x','y','w','h','size','maxLines'].includes(keyNorm)) {
      const n = Number(v); if (!Number.isNaN(n)) val = n;
    } else if (keyNorm === 'align') {
      const m2 = { l:'left', left:'left', c:'center', centre:'center', center:'center', r:'right', right:'right', j:'justify', justify:'justify' };
      val = m2[String(v||'').toLowerCase()] || v;
    }
    out[pageKey] = out[pageKey] || {};
    out[pageKey][fieldKey] = Object.assign(out[pageKey][fieldKey] || {}, { [keyNorm]: val });
  }
  return out;
}

/** Draw text with wrapping + simple alignment. Returns final y used. */
function drawText(page, text, opts = {}) {
  const {
    x = 40,
    y = 700,
    font,
    size = 12,
    maxWidth = 500,
    lineHeight = size * 1.2,
    color = rgb(0, 0, 0),
    maxLines = 14,
    align = 'left'
  } = opts;

  const t = S(text, '').trim();
  if (!t) return y;

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
    let xx = x;
    if (align !== 'left') {
      const lw = font.widthOfTextAtSize(ln, size);
      if (align === 'center') xx = x + (maxWidth - lw) / 2;
      else if (align === 'right') xx = x + (maxWidth - lw);
      // (justify omitted for simplicity; left/center/right covered)
    }
    page.drawText(ln, { x: xx, y: yy, size, font, color });
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
    maxItems = 6, maxLines = 4, align = 'left'
  } = opts;

  const arr = A(items).slice(0, maxItems).map(S).filter(Boolean);
  let yy = y;
  for (const it of arr) {
    page.drawText(bullet, { x, y: yy, size, font });
    yy = drawText(page, it, { x: x + 14, y: yy, font, size, maxWidth, lineHeight, maxLines, align }) - gap;
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

// Convenience to read a field config from layout with defaults
function conf(layout, pageKey, fieldKey, defaults = {}) {
  const node = layout?.[pageKey]?.[fieldKey] || {};
  return { ...defaults, ...node };
}

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

    // ---- 2) Gather layout overrides ---------------------------------------
    // Base from payload
    let layoutV6 = (data && data.layoutV6 && typeof data.layoutV6 === 'object') ? data.layoutV6 : {};

    // Modern compact QS
    const layoutFromQS = parseLayoutQS(String(isPost ? (req.body?.layoutQS || '') : (req.query?.layoutQS || '')));

    // Legacy flat QS (p3_domDesc_x etc.)
    const legacyQS = parseLegacyFlatQS(isPost ? (req.body || {}) : (req.query || {}));

    // Merge in increasing priority: payload < layoutQS < legacy flat
    layoutV6 = deepMerge(layoutV6, layoutFromQS);
    layoutV6 = deepMerge(layoutV6, legacyQS);

    // ---- 3) Load template --------------------------------------------------
    const tplBytes = await loadTemplateBytes(tpl);

    // if raw=1, just stream the untouched template
    if (raw) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 200;
      return res.end(tplBytes);
    }

    // ---- 4) Paint with guards ---------------------------------------------
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

      // ---------- Page 1: name/date ----------
      if (pages[0]) {
        const cName = conf(layoutV6, 'p1', 'name', { x: 60,  y: 760, w: 470, size: 22, maxLines: 1, align: 'left' });
        const cDate = conf(layoutV6, 'p1', 'date', { x: 430, y: 785, w: 140, size: 12, maxLines: 1, align: 'left' });
        drawText(pages[0], p.fullName, { x: cName.x, y: cName.y, maxWidth: cName.w, size: cName.size, maxLines: cName.maxLines, align: cName.align, font });
        drawText(pages[0], p.dateLbl,  { x: cDate.x, y: cDate.y, maxWidth: cDate.w, size: cDate.size, maxLines: cDate.maxLines, align: cDate.align, font });
      }

      // ---------- Page 3: dominant description ----------
      if (pages[2]) {
        const c = conf(layoutV6, 'p3', 'domDesc', { x: 30, y: 685, w: 550, size: 13, lineHeight: 16, maxLines: 20, align: 'left' });
        drawText(pages[2], p.domdesc, { x: c.x, y: c.y, font, size: c.size, maxWidth: c.w, lineHeight: c.lineHeight, maxLines: c.maxLines, align: c.align });
      }

      // ---------- Page 4: spider explanation + optional chart ----------
      if (pages[3]) {
        const c = conf(layoutV6, 'p4', 'spiderDesc', { x: 30, y: 585, w: 550, size: 13, lineHeight: 16, maxLines: 18, align: 'left' });
        drawText(pages[3], p.spiderdesc, { x: c.x, y: c.y, font, size: c.size, maxWidth: c.w, lineHeight: c.lineHeight, maxLines: c.maxLines, align: c.align });

        if (p.chartUrl) {
          const png = await embedPngFromUrl(pdfDoc, p.chartUrl);
          if (png) {
            const def = { x: 32, y: 260, w: null, h: null }; // defaults if no overrides
            const cfg = conf(layoutV6, 'p4', 'chart', def);
            if (cfg.w && cfg.h) {
              pages[3].drawImage(png, { x: cfg.x, y: cfg.y, width: cfg.w, height: cfg.h });
            } else {
              const scaled = png.scale(0.75);
              const w = clamp(scaled.width,  100, 560);
              const h = clamp(scaled.height,  80, 280);
              pages[3].drawImage(png, { x: cfg.x, y: cfg.y, width: w, height: h });
            }
          }
        }
      }

      // ---------- Page 5: sequence narrative ----------
      if (pages[4]) {
        const c = conf(layoutV6, 'p5', 'seqpat', { x: 25, y: 520, w: 550, size: 13, lineHeight: 16, maxLines: 18, align: 'left' });
        drawText(pages[4], p.seqpat, { x: c.x, y: c.y, font, size: c.size, maxWidth: c.w, lineHeight: c.lineHeight, maxLines: c.maxLines, align: c.align });
      }

      // ---------- Page 6: theme & explanation ----------
      if (pages[5]) {
        const cTheme = conf(layoutV6, 'p6', 'theme',     { x: 25, y: 540, w: 550, size: 12, maxLines: 1, align: 'left' });
        const cExpl  = conf(layoutV6, 'p6', 'themeExpl', { x: 25, y: 520, w: 550, size: 13, lineHeight: 16, maxLines: 18, align: 'left' });
        drawText(pages[5], p.theme ? `Theme: ${p.theme}` : '', { x: cTheme.x, y: cTheme.y, font, size: cTheme.size, maxWidth: cTheme.w, maxLines: cTheme.maxLines, align: cTheme.align });
        drawText(pages[5], p.themeExpl, { x: cExpl.x, y: cExpl.y, font, size: cExpl.size, maxWidth: cExpl.w, lineHeight: cExpl.lineHeight, maxLines: cExpl.maxLines, align: cExpl.align });
      }

      // ---------- Page 7–8: work with colleagues & leaders (two columns) ----------
      const drawWorkPairs = (page, pairs, cLook, cWork) => {
        let yLook = cLook.y;
        let yWork = cWork.y;
        for (const pair of A(pairs)) {
          const look = S(pair?.look, '');
          const work = S(pair?.work, '');
          if (!look && !work) continue;

          // left column: LOOK
          const yAfterLook = drawText(page, look, {
            x: cLook.x, y: yLook, font,
            size: cLook.size, maxWidth: cLook.w,
            lineHeight: cLook.lineHeight, maxLines: cLook.maxLines, align: cLook.align
          });

          // right column: WORK
          const yAfterWork = drawText(page, work, {
            x: cWork.x, y: yWork, font,
            size: cWork.size, maxWidth: cWork.w,
            lineHeight: cWork.lineHeight, maxLines: cWork.maxLines, align: cWork.align
          });

          // move down by fixed block gap
          yLook = Math.min(yAfterLook, yAfterWork) - (cLook.gap || 10);
          yWork = yLook;
          if (yLook < 70) break;
        }
      };

      if (pages[6]) {
        const cLook = conf(layoutV6, 'p7', 'look', { x: 30,  y: 440, w: 240, size: 12, lineHeight: 15, maxLines: 5, align: 'left', gap: 8 });
        const cWork = conf(layoutV6, 'p7', 'work', { x: 320, y: 440, w: 240, size: 12, lineHeight: 15, maxLines: 5, align: 'left', gap: 8 });
        drawWorkPairs(pages[6], p.workwcol, cLook, cWork);
      }
      if (pages[7]) {
        const cLook = conf(layoutV6, 'p8', 'look', { x: 30,  y: 440, w: 240, size: 12, lineHeight: 15, maxLines: 5, align: 'left', gap: 8 });
        const cWork = conf(layoutV6, 'p8', 'work', { x: 320, y: 440, w: 240, size: 12, lineHeight: 15, maxLines: 5, align: 'left', gap: 8 });
        drawWorkPairs(pages[7], p.workwlead, cLook, cWork);
      }

      // ---------- Page 9: tips / actions ----------
      if (pages[8]) {
        const cTips = conf(layoutV6, 'p9', 'tips',    { x: 30,  y: 450, w: 250, size: 12, lineHeight: 15, maxItems: 6, maxLines: 4, align: 'left' });
        const cActs = conf(layoutV6, 'p9', 'actions', { x: 320, y: 450, w: 250, size: 12, lineHeight: 15, maxItems: 6, maxLines: 4, align: 'left' });
        drawList(pages[8], p.tips,    { x: cTips.x, y: cTips.y, font, size: cTips.size, maxWidth: cTips.w, lineHeight: cTips.lineHeight, maxItems: cTips.maxItems, maxLines: cTips.maxLines, align: cTips.align });
        drawList(pages[8], p.actions, { x: cActs.x, y: cActs.y, font, size: cActs.size, maxWidth: cActs.w, lineHeight: cActs.lineHeight, maxItems: cActs.maxItems, maxLines: cActs.maxLines, align: cActs.align });
      }

      // Done
      outBytes = await pdfDoc.save();
    } catch (paintErr) {
      console.error('fill-template: paint error', paintErr);
      outBytes = tplBytes; // fallback to raw template
    }

    // ---- 5) Respond --------------------------------------------------------
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

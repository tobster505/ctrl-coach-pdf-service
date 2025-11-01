// pages/api/fill-template.js
export const config = { runtime: "nodejs" };

/**
 * Wrapper that:
 *  - Accepts POST (JSON) and GET (query) inputs
 *  - Safely decodes base64 -> JSON
 *  - Enforces sensible limits & friendly errors
 *  - Calls your existing core PDF filler with a clean { tpl, data, out }
 */
import { URL } from "url";

const MAX_QS_LEN = 8000; // guard for GETs passing through proxies

function bad(res, code, msg, extra = {}) {
  res.status(code).json({ ok: false, error: msg, ...extra });
}

function ok(res, body) {
  // If your core returns a Buffer (the PDF), stream it here:
  if (body && Buffer.isBuffer(body.pdf)) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${body.out || "report.pdf"}"`);
    return res.status(200).send(body.pdf);
  }
  // Otherwise return JSON (e.g., a signed URL your app generated)
  return res.status(200).json({ ok: true, ...body });
}

function decodeB64Json(b64) {
  const raw = Buffer.from(String(b64 || ""), "base64").toString("utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error("Invalid base64 JSON in 'data' parameter.");
  }
}

async function getInput(req) {
  // Support CORS preflight
  if (req.method === "OPTIONS") return { preflight: true };

  // POST path (preferred for large payloads)
  if (req.method === "POST") {
    if (!req.headers["content-type"]?.includes("application/json")) {
      throw Object.assign(new Error("POST body must be application/json."), { status: 415 });
    }
    const { tpl, data, out } = req.body || {};
    if (!tpl) throw Object.assign(new Error("Missing 'tpl'."), { status: 400 });
    if (!data) throw Object.assign(new Error("Missing 'data' (base64 JSON)."), { status: 400 });
    const parsed = decodeB64Json(data);
    return { tpl, out, payload: parsed };
  }

  // GET path (kept for smoke tests and simple links)
  if (req.method === "GET") {
    const fullUrl = new URL(req.url, "http://x");
    const qs = fullUrl.search || "";
    if (qs.length > MAX_QS_LEN) {
      throw Object.assign(
        new Error(`Query string too long (${qs.length}). Use POST.`),
        { status: 414 }
      );
    }
    const tpl = fullUrl.searchParams.get("tpl");
    const dataB64 = fullUrl.searchParams.get("data");
    const out = fullUrl.searchParams.get("out") || "report.pdf";
    if (!tpl) throw Object.assign(new Error("Missing 'tpl'."), { status: 400 });
    if (!dataB64) throw Object.assign(new Error("Missing 'data'."), { status: 400 });
    const payload = decodeB64Json(dataB64);
    return { tpl, out, payload };
  }

  throw Object.assign(new Error(`Method ${req.method} not allowed.`), { status: 405 });
}

/**
 * 👉 Paste your current PDF generation code inside fillTemplateCore
 *    and make it return ONE of the following:
 *      - { pdf: Buffer, out: string }  // stream the PDF back
 *      - { url: string, out?: string } // return an accessible URL (signed, public, etc.)
 */
async function fillTemplateCore({ tpl, out, payload }) {
  // ==== START of your existing logic ====
  // Example structure (replace with your current implementation):
  //
  // import path from "path";
  // import fs from "fs/promises";
  // import { PDFDocument } from "pdf-lib";
  //
  // const templatePath = path.join(process.cwd(), "public", "templates", tpl);
  // const templateBytes = await fs.readFile(templatePath);  // throws if missing
  // const pdfDoc = await PDFDocument.load(templateBytes);
  //
  // // ... write payload fields onto pdfDoc pages ...
  //
  // const pdf = await pdfDoc.save();
  // return { pdf, out };
  //
  // If you instead upload to storage (S3/Vercel Blob) and return a link, do:
  // const url = await uploadSomewhere(pdf);
  // return { url, out };
  // ==== END of your existing logic ====

  // TEMP safe placeholder so this file runs even before you wire your core:
  return { url: `/api/_dev-ok?file=${encodeURIComponent(out || "coach.pdf")}` };
}

export default async function handler(req, res) {
  // CORS (Botpress calls from browser)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  try {
    const input = await getInput(req);
    if (input?.preflight) return res.status(204).end();

    const body = await fillTemplateCore(input);
    if (!body || (typeof body !== "object")) {
      return bad(res, 500, "Template core returned no result.");
    }
    return ok(res, body);
  } catch (err) {
    const code = err.status || 500;
    return bad(res, code, err.message || "Internal error.", {
      hint: code === 414 ? "Switch to POST with JSON body." : undefined
    });
  }
}

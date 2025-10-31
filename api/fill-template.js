/* Build Coach PDF Link — V4 (aligned to coach fill-template)
   Place AFTER your “splitter” card (which sets workflow.CoachPDF_* vars).
   Endpoint: https://ctrl-coach-pdf-service.vercel.app/api/fill-template
   Template: CTRL_Perspective_Assessment_Profile_template_slim_coach.pdf
*/
(function buildCoachPdfLinkV4 () {
  const W = (typeof workflow === 'object' && workflow) || (globalThis.workflow = {});
  const S = (typeof session  === 'object' && session)  || (globalThis.session  = {});

  // Idempotence
  if (W._coach_building) return;
  if (W.coachPdfUrl)     return;
  W._coach_building = true;

  // Small helpers
  const first = (...xs) => xs.find(v => v != null && String(v).trim()) || '';
  const safe  = (v) => String(v ?? '').trim();
  const splitBullets = (txt) => {
    const t = safe(txt);
    if (!t) return [];
    // split by newlines or bullets; trim empties
    return t.split(/\n+|•\s*/g).map(s => s.trim()).filter(Boolean);
  };

  // Inputs (your existing variables)
  const fullName   = first(W?.Pers_PoC_State_Summary?.identity?.fullName, W.FullName, S.FullName, 'Perspective');
  const dateLbl    = first(W.dateLabel, W.DateLabel);

  const dom        = first(W.Dominant_Label, W['p3:dom']);
  const domchar    = first(W.Dominant_Char,  W['p3:domchar']);

  // Long sections from splitter
  const coachSummary   = safe(W.CoachPDF_coach_summary);   // good candidate for p3:domdesc
  const spiderdescLong = safe(W.CoachPDF_spiderdesc);
  const sequenceLong   = safe(W.CoachPDF_sequence);
  const themepairLong  = safe(W.CoachPDF_themepair);
  const adaptColLong   = safe(W.CoachPDF_adapt_colleagues);
  const adaptLdrLong   = safe(W.CoachPDF_adapt_leaders);
  const tipsLong       = safe(W.CoachPDF_tips);
  const actionsLong    = safe(W.CoachPDF_actions);

  // Short prescriptive fields
  const themePair    = safe(W.themePair);
  const themeNotes   = safe(W.themeNotes);

  // Lists (tips/actions) – split to arrays
  const tipsArr    = splitBullets(W.tipsspider || W.tipsdom || tipsLong).slice(0, 8);
  const actionsArr = splitBullets(W.actionspattern || W.actionstheme || actionsLong).slice(0, 8);

  // “Work with …” expects array of { look, work }. If you already have structured data, map it here.
  // For now, seed from your long sections or single strings so the page is never empty.
  const workwcol = [
    { look: 'What to notice', work: safe(W['workswith_col_work'] || adaptColLong) }
  ].filter(p => p.look || p.work).slice(0, 4);

  const workwlead = [
    { look: 'What leaders will notice', work: safe(W['workswith_ldr_work'] || adaptLdrLong) }
  ].filter(p => p.look || p.work).slice(0, 4);

  // Optional chart
  const chartUrl = first(W['p4:chart'], W.spiderChartUrl, W?.Pers_PoC_State_Summary?.spider?.chartUrl, '');

  // Build the EXACT data shape the handler reads
  const data = {
    person: { fullName },
    dateLbl,                     // NOTE: top-level (not inside person)
    dom,
    domchar,
    domdesc: coachSummary,       // p3 body text
    spiderdesc: spiderdescLong,  // p4 body text
    seqpat: sequenceLong,        // p5 body text
    theme: themePair,            // p6 header line
    themeExpl: themepairLong || themeNotes,  // p6 paragraph
    workwcol,
    workwlead,
    tips: tipsArr,
    actions: actionsArr,
    chartUrl
  };

  // Encode to base64
  const toB64 = (obj) => {
    try { return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); }
    catch { return 'e30='; } // {}
  };
  const b64 = toB64(data);

  // Assemble URL
  const ENDPOINT = 'https://ctrl-coach-pdf-service.vercel.app/api/fill-template';
  const TPL_FILE = 'CTRL_Perspective_Assessment_Profile_template_slim_coach.pdf';
  const safeName = String(fullName || 'Perspective').replace(/[^\w.-]+/g, '_');
  const outName  = `${safeName}_${dateLbl || 'TODAY'}_COACH.pdf`;

  const qs = new URLSearchParams({ tpl: TPL_FILE, data: b64, out: outName }).toString();
  const url = `${ENDPOINT}?${qs}`;

  // Publish for downstream cards
  W.coachPdfUrl = url;
  W.Pers_PoC_CoachPdfLink = url;

  // Quick probe
  W._coach_link_probe = `coachPdfUrl set · tips=${data.tips.length} · actions=${data.actions.length} · colPairs=${data.workwcol.length} · ldrPairs=${data.workwlead.length}`;

  W._coach_building = false;
})();

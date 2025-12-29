/* =========================
   COACH fill-template V4.1
   (Option A for Page 6)
   ========================= */

/* ─────────────────────────
   1) DEFAULT_LAYOUT.pages — replace ONLY p6WorkWith + p6Q
   ───────────────────────── */

const DEFAULT_LAYOUT = {
  pages: {
    // ... keep everything else unchanged ...

    p6WorkWith: {
      // ONLY 2 boxes now
      collabC: { x: 30,  y: 300, w: 270, h: 420, size: 14, align: "left", maxLines: 14 },
      collabT: { x: 320, y: 300, w: 260, h: 420, size: 14, align: "left", maxLines: 14 },
    },

    // Page 6: bottom questions (separate from the big text boxes)
    p6Q: {
      workwith_colleagues_q: { x: 40, y: 990,  w: 520, h: 40, size: 13, align: "left", maxLines: 2 },
      workwith_leaders_q:    { x: 40, y: 1040, w: 520, h: 40, size: 13, align: "left", maxLines: 2 },
    },

    // ... keep everything else unchanged ...
  },
};


/* ─────────────────────────
   2) normaliseInput — add these 2 fields + remove old p6 question fields
   ───────────────────────── */

function normaliseInput(d = {}) {
  const identity = okObj(d.identity) ? d.identity : {};
  const text = okObj(d.text) ? d.text : {};
  const ctrl = okObj(d.ctrl) ? ctrl : (okObj(d.ctrl) ? d.ctrl : {});
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

    // existing page 3/4/5 questions unchanged...
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

    // ✅ NEW: Page 6 bottom questions (bullets)
    workwith_colleagues_q: bulletQ(text.adapt_with_colleagues_q1),
    workwith_leaders_q:    bulletQ(text.adapt_with_leaders_q2),

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


/* ─────────────────────────
   3) Page 6 drawing — replace ONLY the Page 6 block
   ───────────────────────── */

// Page 6
if (p6) {
  // ONLY 2 workwith text boxes now
  drawTextBox(p6, font, P.workWith?.concealed, L.p6WorkWith.collabC);
  drawTextBox(p6, font, P.workWith?.triggered, L.p6WorkWith.collabT);

  // ✅ NEW: bottom questions (bulleted)
  drawTextBox(p6, font, P.workwith_colleagues_q, L.p6Q.workwith_colleagues_q);
  drawTextBox(p6, font, P.workwith_leaders_q,    L.p6Q.workwith_leaders_q);
}

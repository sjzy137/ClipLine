"use strict";
/* Turns a group notice ("@全体成员 请各单位于11月27日前反馈…") into a note
 * with to-dos and a reminder. Offline and rule-based — no model, no network.
 *
 *   NOTICE.looks(text)            → true if it reads like a notice with something to do
 *   NOTICE.parse(text, ref, opt)  → { title, tasks:[{text, due}], body, remindAt, firstDue }
 *
 * ref = when the text was copied (ms): "今天 / 明天 / 本周五" count from there.
 * opt = { noonOff:"12:00", workOff:"17:30", leadMin:60, dateDays:0, dateTime:"09:00", now,
 *         verbs, prefixes, times }  — the user's own words, one per line (Settings → Notes):
 *   verbs     extra action words ("报账")
 *   prefixes  addressees to drop from the start of a to-do ("各项目部")
 *   times     "交班前 = 08:00" / "例会前 = 周日 07:30"
 *
 * Matching runs on a normalised copy (full-width digits / colon → ASCII); the
 * replacement is one char for one char, so match positions slice the original.
 */
(function (g) {
  const DAY = 86400000;
  const WD = ["日", "一", "二", "三", "四", "五", "六"];
  const WDN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 七: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0 };

  const VERB = /报送|上报|报给|报来|提交|填报|填写|报名|反馈|发送|发至|发给|领取|参加|参会|出席|缴费|缴纳|交费|核对|梳理|完成|准备|告知|回复|确认|签字|签名|审核|整改|学习|观看|录入|上传|下载|转发|落实|汇总|报到|集合|到场|检查|自查|打卡|登记|备案|更新|修改|补充|领回|交回|上交|交至|送至|带上|携带|思考/;
  const EVENT = /会议|会议室|开会|召开|座谈|务虚|培训|讲座|活动|集合|参会|出席|报到|考试|宣讲|观摩/;
  const COND = /^(注意|如有|如无|如需|若有|若无|参见|参考|附件|备注|说明|测算时|其中|另外，?如)/;
  const BOOST = /@全体成员|@所有人|^\s*【?通知】?[:：]?|请各|务必|及时|尽快|按时|截止|截至/;

  /* ---------- the user's own words ---------- */
  let CUR = { verbs: [], prefixes: [], times: [] };
  const lines = (t) => String(t || "").split(/[\n,，、;；]+/).map((x) => norm(x).trim()).filter(Boolean);
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /* "交班前 = 08:00", "例会前 = 周日 07:30", "晚班前＝19点半" → {word, wd|null, h, mi}; bad lines come back separately. */
  function parseTimes(text) {
    const ok = [], bad = [];
    String(text || "").split("\n").forEach((raw) => {
      const l = norm(raw).trim(); if (!l) return;
      const m = l.match(/^(.+?)\s*[=＝]\s*(?:(?:周|星期|礼拜)\s*([一二三四五六日天1-7])\s*)?(\d{1,2})(?::(\d{2})|点(半|(\d{1,2})分?)?)?$/);
      const h = m ? +m[3] : 99, mi = m ? (m[4] ? +m[4] : m[5] === "半" ? 30 : m[6] ? +m[6] : 0) : 99;
      if (!m || h > 23 || mi > 59 || !m[1].trim()) { bad.push(raw.trim()); return; }
      ok.push({ word: m[1].trim(), wd: m[2] ? WDN[m[2]] : null, h, mi });
    });
    ok.sort((a, b) => b.word.length - a.word.length); // longest first: "晚班前" before "晚班"
    return { ok, bad };
  }
  function useOpts(o) {
    CUR = {
      verbs: lines(o && o.verbs),
      prefixes: lines(o && o.prefixes).map((x) => x.replace(/^请/, "")),
      times: parseTimes(o && o.times).ok,
    };
  }
  function hasVerb(n) { return VERB.test(n) || CUR.verbs.some((v) => n.includes(v)); }
  /* First custom time phrase in `s` → {index, len, t}. */
  function customAt(s) {
    let best = null;
    CUR.times.forEach((c) => {
      const i = s.indexOf(c.word);
      if (i >= 0 && (!best || i < best.index)) best = { index: i, len: c.word.length, t: c };
    });
    return best;
  }

  /* ---------- small helpers ---------- */
  function norm(s) {
    return String(s || "")
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/：/g, ":").replace(/．/g, ".").replace(/／/g, "/")
      .replace(/[ 　]/g, " ");
  }
  function hm(s, dflt) {
    const m = String(s || dflt || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? [Math.min(23, +m[1]), Math.min(59, +m[2])] : hm(dflt || "09:00");
  }
  function at(d, h, mi) { const x = new Date(d); x.setHours(h, mi, 0, 0); return x; }
  function dayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  /* Monday-based week: the date of weekday `w` (0 = Sun) in the week of `d`. */
  function inWeek(d, w) { const dow = (d.getDay() + 6) % 7; const want = (w + 6) % 7; return addDays(d, want - dow); }
  function valid(y, m, dd) { const x = new Date(y, m - 1, dd); return x.getMonth() === m - 1 && x.getDate() === dd ? x : null; }
  function nearest(cands, ref) {
    let best = null, bd = Infinity;
    cands.forEach((c) => { if (!c) return; const dd = Math.abs(c - ref); if (dd < bd) { bd = dd; best = c; } });
    return best;
  }

  /* Lines that are not the notice: WeChat multi-copy headers, stickers… */
  function stripNoise(src) {
    return String(src || "").replace(/\r/g, "").split("\n").filter((l) => {
      const n = norm(l).trim();
      if (!n) return true;
      if (/^\[?\d{1,2}:\d{2}(:\d{2})?\]?$/.test(n)) return false;
      if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s+\d{1,2}:\d{2}(:\d{2})?$/.test(n)) return false;
      if (/^[^\s，。,:]{1,16}\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+)?\d{1,2}:\d{2}(:\d{2})?$/.test(n)) return false;
      if (/^\[(图片|文件|表情|动画表情|语音|视频|链接)\]$/.test(n)) return false;
      return true;
    }).join("\n");
  }
  function stripHead(s) {
    return s.replace(/@(全体成员|所有人)\s*/g, "").replace(/^\s*【?(紧急)?通知】?\s*[:：]\s*/, "").replace(/^\s*【(紧急)?通知】\s*/, "");
  }

  /* ---------- time expressions ---------- */
  const R_FULL = /(\d{4})\s*(?:年|-|\/|\.)\s*(\d{1,2})\s*(?:月|-|\/|\.)\s*(\d{1,2})\s*[日号]?/g;
  const R_MD = /(?<![\d.])(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?|(?<![\d.\/年-])(\d{1,2})[.\/](\d{1,2})(?=\s*(?:日|号|前|之前|以前|（|\(|周|星期|上午|下午|中午|晚|下班|\d{1,2}:))/g;
  const R_D = /(?<![\d月.\/-])(\d{1,2})\s*[日号](?=\s*(?:前|之前|以前|（|\(|周|星期|礼拜|上午|下午|中午|早|晚|下班|\d{1,2}[:点时]|，|,|。|；|\s|$))/g;
  const R_REL = /今天|今日|当天|当日|明天|明日|后天|大后天/g;
  const R_WEEK = /(本|这|下个?|上)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])(?=\s*(?:前|之前|以前|（|\(|上午|下午|中午|早|晚|下班|\d|，|,|。|；|\s|$|[)）]))/g;
  // "本周内 / 本周尽快 / 下周前" is a deadline; "本周数据 / 本周工作" is not.
  const R_WEEK0 = /(本周|这周|本星期|这个星期|下周|下星期)(?=\s*(?:内|之内|前|之前|以前|尽快|务必|抓紧|完成|下班|结束|，|,|。|；|;|\s|$))/g;
  const R_MEND = /(?:本月|这个月)(?:底|末)|月底|月末|年底|年末/g;
  const R_TIME = /(上午|早上|早晨|中午|下午|傍晚|晚上|今晚)?\s*(\d{1,2})\s*(?::\s*(\d{2})|[点时]\s*(半|(\d{1,2})\s*分?)?)|(上午下班|午饭|中午下班)\s*(?:前|之前)|(下午下班|下班)\s*(?:前|之前)?|(中午)\s*(?:前|之前|12点)|(上午|下午)(?=\s*(?:前|之前))/g;

  function findDates(n, ref) {
    const out = [];
    const r = new Date(ref);
    const push = (i, len, date, kind) => {
      if (!date) return;
      if (out.some((o) => i < o.i + o.len && o.i < i + len)) return;
      out.push({ i, len, date, kind });
    };
    let m;
    for (const re of [R_FULL, R_MD, R_D, R_REL, R_WEEK, R_WEEK0, R_MEND]) re.lastIndex = 0;
    while ((m = R_FULL.exec(n))) push(m.index, m[0].length, valid(+m[1], +m[2], +m[3]), "full");
    while ((m = R_MD.exec(n))) {
      const mo = +(m[1] || m[3]), dd = +(m[2] || m[4]);
      if (mo < 1 || mo > 12) continue;
      const y = r.getFullYear();
      push(m.index, m[0].length, nearest([valid(y - 1, mo, dd), valid(y, mo, dd), valid(y + 1, mo, dd)], dayStart(ref)), "md");
    }
    while ((m = R_D.exec(n))) {
      const dd = +m[1]; if (dd < 1 || dd > 31) continue;
      const y = r.getFullYear(), mo = r.getMonth() + 1;
      const cands = [valid(y, mo - 1, dd) || null, valid(y, mo, dd), mo === 12 ? valid(y + 1, 1, dd) : valid(y, mo + 1, dd)];
      if (mo === 1) cands[0] = valid(y - 1, 12, dd);
      // "23日（下周一）": a weekday right after the day picks the month.
      const tail = n.slice(m.index + m[0].length, m.index + m[0].length + 8);
      const wm = tail.match(/^\s*[（(]?\s*(?:本|这|下个?|上)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
      let pick = null;
      if (wm) pick = cands.find((c) => c && c.getDay() === WDN[wm[1]]) || null;
      push(m.index, m[0].length, pick || nearest(cands, dayStart(ref)), "d");
    }
    while ((m = R_REL.exec(n))) {
      const off = { 今天: 0, 今日: 0, 当天: 0, 当日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 }[m[0]];
      push(m.index, m[0].length, addDays(dayStart(ref), off), off === 0 ? "today" : "rel");
    }
    while ((m = R_WEEK.exec(n))) {
      const w = WDN[m[2]], pre = (m[1] || "").replace(/\s/g, "");
      const base = dayStart(ref);
      let d = inWeek(base, w);
      if (pre.startsWith("下")) d = addDays(d, 7);
      else if (pre === "上") d = addDays(d, -7);
      else if (!pre && d < base) d = addDays(d, 7);
      push(m.index, m[0].length, d, "week");
    }
    while ((m = R_WEEK0.exec(n))) {
      const base = dayStart(ref);
      let d = inWeek(base, 5);
      if (/^下/.test(m[1])) d = addDays(d, 7);
      else if (d < base) d = base; // weekend: "本周" means today
      push(m.index, m[0].length, d, "weekend");
    }
    while ((m = R_MEND.exec(n))) {
      const b = dayStart(ref);
      const d = /年/.test(m[0]) ? new Date(b.getFullYear(), 11, 31) : new Date(b.getFullYear(), b.getMonth() + 1, 0);
      push(m.index, m[0].length, d, "mend");
    }
    return out.sort((a, b) => a.i - b.i);
  }

  /* A time expression starting near position `from` (after the date and an
   * optional "（周二）"). Returns {i, len, h, mi} or null. */
  function timeNear(n, from, maxGap, o) {
    const seg = n.slice(from, from + maxGap + 24);
    const lead = seg.match(/^\s*(?:[（(]\s*(?:本|这|下个?|上)?\s*(?:周|星期|礼拜)\s*[一二三四五六日天1-7]\s*[）)]|(?:周|星期|礼拜)\s*[一二三四五六日天1-7])?\s*/);
    const skip = lead ? lead[0].length : 0;
    R_TIME.lastIndex = 0;
    const rest = seg.slice(skip);
    const m = R_TIME.exec(rest);
    const c = customAt(rest);
    if (c && c.t.wd === null && c.index <= maxGap && (!m || c.index <= m.index))
      return { skip, t: { i: from + skip + c.index, len: c.len, h: c.t.h, mi: c.t.mi } };
    if (!m || m.index > maxGap) return { skip, t: null };
    const t = timeOf(m, o);
    if (!t) return { skip, t: null };
    return { skip, t: Object.assign({ i: from + skip + m.index, len: m[0].length }, t) };
  }
  function timeOf(m, o) {
    const [nh, nm] = hm(o.noonOff, "12:00"), [wh, wm] = hm(o.workOff, "17:30");
    if (m[6]) return { h: nh, mi: nm };
    if (m[7]) return { h: wh, mi: wm };
    if (m[8]) return { h: 12, mi: 0 };
    if (m[9]) return m[9] === "上午" ? { h: nh, mi: nm } : { h: wh, mi: wm };
    if (!m[2]) return null;
    let h = +m[2];
    const mi = m[3] ? +m[3] : m[4] === "半" ? 30 : m[5] ? +m[5] : 0;
    if (h > 24 || mi > 59) return null;
    // "8点" alone in running text is too loose; need a period word, a colon or "点+前".
    if (!m[1] && !m[3] && !/[点时]/.test(m[0])) return null;
    if (/下午|傍晚|晚上|今晚/.test(m[1] || "") && h < 12) h += 12;
    if (m[1] === "中午" && h < 6) h += 12;
    return { h: Math.min(h, 23), mi };
  }

  /* All due points in a normalised sentence, each with its text span. */
  function dues(n, ref, o) {
    const ds = findDates(n, ref);
    const res = [];
    ds.forEach((d) => {
      const tn = timeNear(n, d.i + d.len, 6, o);
      let end = d.i + d.len + tn.skip, hasTime = false, dt = new Date(d.date);
      if (tn.t) { dt = at(d.date, tn.t.h, tn.t.mi); hasTime = true; end = tn.t.i + tn.t.len; }
      res.push({ i: d.i, end, date: dt, hasTime, kind: d.kind });
    });
    // A time with no date in front of it ("下午3点前上报") means the ref day.
    R_TIME.lastIndex = 0;
    let m;
    while ((m = R_TIME.exec(n))) {
      const i = m.index, j = i + m[0].length;
      if (res.some((r) => i < r.end && r.i < j)) continue;
      const t = timeOf(m, o); if (!t) continue;
      if (!m[1] && !m[6] && !m[7] && !m[8] && !m[9] && !/前|之前/.test(n.slice(j, j + 3))) continue;
      res.push({ i, end: j, date: at(dayStart(ref), t.h, t.mi), hasTime: true, kind: "time" });
    }
    // The user's own phrases with no date in front: "交班前" (next such time), "例会前" (that weekday).
    CUR.times.forEach((c) => {
      let from = 0, i;
      while ((i = n.indexOf(c.word, from)) >= 0) {
        const j = i + c.word.length; from = j;
        if (res.some((r) => i < r.end && r.i < j)) continue;
        const base = dayStart(ref);
        let d;
        if (c.wd !== null) { d = at(inWeek(base, c.wd), c.h, c.mi); if (d < ref) d = addDays(d, 7); }
        else { d = at(base, c.h, c.mi); if (d < ref) d = addDays(d, 1); }
        res.push({ i, end: j, date: d, hasTime: true, kind: "custom", before: /前$/.test(c.word) });
      }
    });
    // Swallow the words around the span: 于 / 在 before, 前 / 之前 after.
    res.forEach((r) => {
      const after = n.slice(r.end).match(/^\s*(?:之内|之前|以前|前|内)/);
      if (after) { r.end += after[0].length; r.before = true; }
      const bef = n.slice(Math.max(0, r.i - 6), r.i).match(/(?:并于|并在|须于|需于|应于|请于|务必于|于|在|截[止至](?:日期|时间)?(?:为|是)?:?)\s*$/);
      if (bef) { r.i -= bef[0].length; if (/截/.test(bef[0])) r.before = true; }
      if (!r.before && /截[止至]/.test(n.slice(Math.max(0, r.i - 8), r.i))) r.before = true;
    });
    // "今日下班前（11月24日）" / "11月24日（今天）": a date in brackets right after a due restates it.
    res.sort((a, b) => a.i - b.i);
    for (let k = 0; k < res.length - 1; k++) {
      const r = res[k], q = res[k + 1];
      const br = n.slice(r.end).match(/^\s*[（(]/);
      if (!br || q.i < r.end || q.i > r.end + br[0].length + 2) continue;
      const close = n.slice(q.end).match(/^[^（()）]{0,4}[）)]/);
      if (!close) continue;
      if (!r.hasTime && q.hasTime) { r.date = q.date; r.hasTime = true; }
      r.end = q.end + close[0].length;
      const after = n.slice(r.end).match(/^\s*(?:之前|以前|前)/);
      if (after) { r.end += after[0].length; r.before = true; }
      res.splice(k + 1, 1); k--;
    }
    return res;
  }
  /* Deadline as an instant: date-only = end of that working day. */
  function dueMs(d, o) {
    if (d.hasTime) return +d.date;
    const [wh, wm] = hm(o.workOff, "17:30");
    return +at(d.date, wh, wm);
  }

  /* ---------- splitting ---------- */
  const R_MARK = /[①-⑳]|(?:^|\n|[。；;])\s*(?:\d{1,2}[.、](?!\d)|[（(]\d{1,2}[）)]|[一二三四五六七八九十]{1,3}、)/g;
  function segments(src) {
    const n = norm(src);
    const marks = [];
    let m; R_MARK.lastIndex = 0;
    while ((m = R_MARK.exec(n))) {
      let i = m.index; const lead = m[0].match(/^[\n。；;\s]*/)[0].length; i += lead;
      marks.push({ i, len: m[0].length - lead });
    }
    if (marks.length < 2 && !(marks.length === 1 && /[①-⑳]/.test(n[marks[0].i]))) return { pre: src, segs: [src] };
    const segs = marks.map((mk, k) => src.slice(mk.i + mk.len, k + 1 < marks.length ? marks[k + 1].i : src.length));
    return { pre: src.slice(0, marks[0].i), segs };
  }
  function sentences(s) {
    const out = []; let buf = "";
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      // WeChat notices often use a space between sentences: one space between two Chinese characters counts.
      const cjk = (x) => /[\u4e00-\u9fff]/.test(x || "");
      if (/[。！!？?；;\n]/.test(c) || (c === " " && buf.trim() && (s[k + 1] === " " || (cjk(s[k - 1]) && cjk(s[k + 1]))))) {
        if (c !== " " && c !== "\n") buf += c;
        if (buf.trim()) out.push(buf); buf = "";
        while (s[k + 1] === " ") k++;
      } else buf += c;
    }
    if (buf.trim()) out.push(buf);
    return out;
  }

  /* ---------- tidying a to-do line ---------- */
  function cut(orig, spans) {
    // Remove due spans; a clause that was little more than the date goes too.
    const n = norm(orig);
    let out = "", last = 0;
    spans.forEach((s) => { out += orig.slice(last, s.i) + "\u0000"; last = s.end; });
    out += orig.slice(last);
    const clauses = out.split(/([，,])/);
    const meat = (c) => c.replace(/\u0000/g, "").replace(/截[止至](日期|时间)?(为|是)?|[并于在前须需应]|之前|以前|[:：\s]/g, "");
    // Only drop date-only clauses when something else is left to say.
    const others = clauses.filter((c, k) => k % 2 === 0 && !c.includes("\u0000") && tidy(c)).length;
    let res = "";
    for (let k = 0; k < clauses.length; k += 2) {
      let c = clauses[k], sep = clauses[k + 1] || "";
      if (c.includes("\u0000")) {
        if (others && meat(c).length <= 2) continue;
        c = c.replace(/\u0000/g, "");
      }
      res += c + sep;
    }
    void n;
    return res;
  }
  function tidy(s) {
    s = stripHead(s);
    s = s.replace(/^\s*[①-⑳]\s*/, "").replace(/^\s*(\d{1,2}[.、]|[（(]\d{1,2}[）)]|[一二三四五六七八九十]{1,3}、)\s*/, "");
    s = s.replace(/^根据[^，,。]{0,40}?(要求|安排|通知|部署|精神)[，,]\s*/, "");
    s = s.replace(/^请?\s*(各单位|各部门|各基层单位|各二级单位|各中心|各队|各位|大家)(及直属(单位)?)?\s*/, "");
    if (CUR.prefixes.length) s = s.replace(new RegExp("^请?\\s*(" + CUR.prefixes.map(reEsc).join("|") + ")(及直属(单位)?)?\\s*"), "");
    s = s.replace(/^请\s*/, "");
    s = s.replace(/([，,])\s*请(?!示)/g, "$1");
    s = s.replace(/[，,]?\s*(谢谢|多谢|感谢)(大家|配合|支持)?[！!。.~～]*\s*$/, "");
    s = s.replace(/[，,；;。.！!\s]+$/, "").replace(/^[，,；;\s]+/, "");
    s = s.replace(/[，,]{2,}/g, "，").replace(/\s{2,}/g, " ");
    return s.trim();
  }

  /* ---------- public ---------- */
  function looks(text, opt) {
    useOpts(opt);
    const raw = String(text || "");
    if (raw.length < 6 || raw.length > 3000) return false;
    const n = norm(stripNoise(raw));
    if (/^\s*(https?:\/\/|www\.)\S+\s*$/i.test(n)) return false;
    if (/[{};]\s*\n.*[{};]/s.test(n) && /function|const |=>|def |class /.test(n)) return false;
    if (!hasVerb(n)) return false;
    if (BOOST.test(n)) return true;
    return dues(n, Date.now(), opt || {}).length > 0;
  }

  function fmtDue(due, now) {
    const d = new Date(due.ms);
    const s = `${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}` + (due.hasTime ? ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "");
    return (due.event ? s : "截止 " + s) + (due.ms < now ? "，已过" : "");
  }

  function parse(text, ref, opt) {
    const o = Object.assign({ noonOff: "12:00", workOff: "17:30", leadMin: 60, dateDays: 0, dateTime: "09:00" }, opt || {});
    useOpts(o);
    ref = ref || Date.now();
    const now = o.now || Date.now();
    const src = stripNoise(text).replace(/[ \t]+\n/g, "\n").trim();
    const { pre, segs } = segments(src);
    const tasks = [];
    const ctx = [];

    segs.forEach((seg, si) => {
      const ss = sentences(seg);
      let main = -1;
      const info = ss.map((s) => {
        const n = norm(s);
        return { s, n, d: dues(n, ref, o), verb: hasVerb(n), cond: COND.test(stripHead(n).trim()) };
      });
      // The main sentence: first with a verb and a due, else first with a verb.
      main = info.findIndex((x) => x.verb && x.d.length && !x.cond);
      if (main < 0) main = info.findIndex((x) => x.verb && !x.cond);
      if (main < 0 && segs.length > 1) main = 0;
      info.forEach((x, k) => {
        const own = k === main || (main >= 0 && k > main && x.verb && !x.cond && x.d.length &&
          !tasks.some((tk) => tk.due && x.d[0] && tk.due.ms === dueMs(x.d[0], o)));
        if (own) {
          const d0 = x.d[0] || null;
          let txt = tidy(cut(x.s, x.d));
          if (!txt) return;
          const ev = !!(d0 && d0.hasTime && !d0.before && EVENT.test(x.n));
          // "征订工作已经启动，请…核对": leading clauses with no verb are background.
          if (!ev && !tasks.length && segs.length === 1 && !ctx.length) {
            const cl = txt.split(/[，,]/);
            let k2 = 0; while (k2 < cl.length - 1 && !hasVerb(norm(cl[k2]))) k2++;
            if (k2 > 0) { ctx.push(cl.slice(0, k2).join("，")); txt = tidy(cl.slice(k2).join("，")); }
          }
          tasks.push({ text: txt, due: d0 ? { ms: dueMs(d0, o), hasTime: d0.hasTime, event: ev, before: !!d0.before } : null });
        } else if (segs.length === 1 && (main < 0 || k < main)) {
          const c = tidy(x.s); if (c) ctx.push(c);
        }
      });
      void si;
    });
    if (segs.length > 1) { const p = tidy(pre.replace(/[:：]\s*$/, "")); if (p) ctx.unshift(p); }

    // Title: "关于…的通知" if present, else the context before the first to-do.
    let title = "";
    const ab = norm(src).match(/关于[^，。\n]{2,40}?的(通知|安排|要求|提醒)/);
    if (ab) title = src.substr(ab.index, ab[0].length);
    else if (ctx.length) title = ctx[0].split(/[，,]/)[0];
    else if (tasks.length > 1) title = "通知（" + tasks.length + " 项）";
    if (title.length > 40) title = title.slice(0, 38) + "…";

    // Reminder: the earliest due still ahead.
    const ahead = tasks.filter((t) => t.due && t.due.ms > now).sort((a, b) => a.due.ms - b.due.ms);
    const first = ahead[0] ? ahead[0].due : null;
    let remindAt = null;
    if (first) remindAt = remindFor(first, o, now);

    const lines = [];
    if (title) lines.push("# " + title);
    tasks.forEach((t) => lines.push("- [ ] " + t.text + (t.due ? "（" + fmtDue(t.due, now) + "）" : "")));
    lines.push("");
    lines.push("> 原文：");
    src.split("\n").forEach((l) => lines.push("> " + l));
    return { title, tasks, body: lines.join("\n"), remindAt, firstDue: first ? first.ms : null };
  }

  function remindFor(due, o, now) {
    const lead = Math.max(0, +o.leadMin || 0) * 60000;
    let r;
    if (due.hasTime) r = due.ms - lead;
    else {
      const [h, mi] = hm(o.dateTime, "09:00");
      r = +at(addDays(dayStart(due.ms), -(+o.dateDays || 0)), h, mi);
      if (r < now) r = due.ms - lead; // that morning is gone: fall back to the lead before end of day
    }
    if (r >= now) return r;
    const left = due.ms - now;
    return left > 10 * 60000 ? now + Math.round(left / 2 / 60000) * 60000 : null;
  }

  const api = { looks, parse, parseTimes, _dues: (t, ref, o) => { useOpts(o); return dues(norm(t), ref, o || {}); } };
  g.NOTICE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

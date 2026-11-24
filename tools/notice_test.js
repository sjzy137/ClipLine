// node tools/notice_test.js  — checks src/notice.js against real group notices.
process.env.TZ = process.env.TZ || "Asia/Shanghai";
const N = require("../src/notice.js");
const ref = new Date(2026, 10, 24, 9, 0).getTime(); // Tue 2026-11-24 09:00
const S = [
`@全体成员   请各单位速来214领取今年度的各类先进以及记功证书`,
`@全体成员  2027年互助保障投保已从石化党建工会子系统中下发订单    缴费截止日期2026年12月13日，请告知本单位参加投保员工收到短信后及时缴费，获在石化e融中进行缴费`,
`@全体成员 请各单位及直属尽快填报《赴京就医绿色通道数据统计》，今天上午下班前上报，谢谢。`,
`通知：11月24日周二下午14:30，在机关二楼会议室进行2027年宣传工作务虚，请黄河、渤海、井下、海洋、钻井院、海外中心6家单位宣传工作负责人参加交流讨论，请围绕前期发的调研提纲提前思考有关务虚内容。`,
`@全体成员 2027年度党报党刊征订工作已经启动，请对本单位党报党刊及胜利日报派送地址、联系人信息分别进行核对，并于11月27日前反馈。如有修改，请标红发送至王海琳石化通，如无变化，请单独回复无变化。参见上年度分送明细表。`,
`@全体成员 ①根据公司主要领导要求，请各单位对明年业务宣传费预算情况进行梳理上报，填写完成《表1 成本费用预算-汇总表》《表2 预算依据（2027年计划使用情况）》并于23日（下周一）上午下班前发送至王海琳石化通。
注意预算时需分解落实到不同机构类型（如直接生产单位、科研设计单位等），只统计本单位计划发生的费用预算，公司层面统筹使用的费用（如宣传文化中心年度均摊等）各单位不需要测算。测算时和本单位财务部门做好对接，列支在图书资料费、印刷费、党组织工作经费等其他渠道的不在统计范围。
②请还没有报送《胜利石油工程公司基层思想政治工作队伍情况表》的今天务必发送至周文馨石化通。谢谢。
③请还没有到机关7号楼1楼大厅领取《感动石化2026》的本周尽快领取完成，数量见东侧窗台发放表。`,
];
const fmt = (ms) => ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "—";
S.forEach((s, i) => {
  const r = N.parse(s, ref, { now: ref });
  console.log(`\n=== #${i + 1} looks=${N.looks(s)} remind=${fmt(r.remindAt)}`);
  console.log(r.body.split("\n> 原文")[0]);
});

// Edge cases: [text, expected due "M/D HH:MM" or "-" for none]
const E = [
  ["请于明天下午3点前提交材料", "11/25 15:00"],
  ["下周三上午10:00在三楼会议室开会，请准时参加", "12/2 10:00"],
  ["请各单位12.1前报送总结", "12/1 17:30"],
  ["本月底前完成整改", "11/30 17:30"],
  ["周五下班前反馈", "11/27 17:30"],
  ["下午4点前上报", "11/24 16:00"],
  ["请周一鸣同志尽快提交报告", "-"],
  ["请到3号楼领取工装", "-"],
  ["2026-12-05前完成录入", "12/5 17:30"],
  ["请于1月5日前上交", "1/5 17:30"],
  ["今天中午前报送", "11/24 12:00"],
  ["12月1日（周二）上午9点半集合", "12/1 09:30"],
];
let bad = 0;
E.forEach(([t, want]) => {
  const r = N.parse(t, ref, { now: ref });
  const d = r.tasks[0] && r.tasks[0].due;
  const got = d ? (() => { const x = new Date(d.ms); return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; })() : "-";
  const ok = got === want; if (!ok) bad++;
  console.log((ok ? "ok  " : "BAD ") + t + " → " + got + (ok ? "" : "  (want " + want + ")") + "  | " + (r.tasks[0] ? r.tasks[0].text : "(no task)") + " looks=" + N.looks(t));
});
if (bad) { console.log(bad + " failing"); process.exitCode = 1; }

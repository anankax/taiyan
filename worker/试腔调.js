/* =========================================================
   拿**代理里那张真的 SKILL**，直接问模型，人眼看一下像不像
   ---------------------------------------------------------
   用法：node 试腔调.js 你的智谱KEY [模型名]

   为什么要有这个：换模型不能只看通不通、快不快。
   glm-4.5-air 比 glm-4.7-flash 快 65 倍，但它"助手味"更重，
   爱吐 ### 和 ** **。换成它到底会不会毁了 SKILL 定的腔调，
   只有把 SKILL 原文喂进去、把输出打出来看，才算数。
   ========================================================= */

const fs = require("fs");
const path = require("path");

const API = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const KEY = process.argv[2];
const MODEL = process.argv[3] || "glm-4.5-air";

/* 从 worker.js 里把 SKILL 和 buildPrompt 抠出来——用真的，别抄一份 */
function loadSkill(){
  const src = fs.readFileSync(path.join(__dirname, "worker.js"), "utf8")
    .replace(/^export default/m, "const __worker =");
  return new Function("return (async () => { " + src +
    "\nreturn { SKILL, buildPrompt, tidy }; })();")();
}

/* 三种身份 × 几种对方的话，看覆盖面 */
const CASES = [
  { voice: "rookie",  len: "mid", name: "周校长",
    said: "周校长：[强][强][玫瑰][玫瑰]用心、精细、实效" },
  { voice: "rookie",  len: "short", name: "张老师",
    said: "小孔，明天教研活动记得带听课记录本" },
  { voice: "lead",    len: "mid", name: "李老师",
    said: "组长，这个单元的学案我实在来不及了，能帮我看看吗" },
  { voice: "veteran", len: "long", name: "周校长",
    said: "老邰，这次公开课你带带小孔" }
];

async function ask(SKILL, buildPrompt, tidy, c){
  const t0 = Date.now();
  let r;
  try{
    r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SKILL },
          { role: "user", content: buildPrompt(c) }
        ],
        temperature: 1.0,
        max_tokens: 2048,
        thinking: { type: "disabled" }
      })
    });
  }catch(e){ return { err: "连不上：" + e.message }; }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const raw = await r.text();
  if(!r.ok) return { err: r.status + " " + raw.slice(0, 150), secs };
  let d; try{ d = JSON.parse(raw); }catch(e){ return { err: "回的不是 JSON", secs }; }
  const msg = (d.choices && d.choices[0] && d.choices[0].message) || {};
  return { raw: String(msg.content || "").trim(), tidyed: tidy(msg.content), secs,
           tokens: d.usage && d.usage.total_tokens };
}

/* 一眼看出坏毛病的检查项 */
function smells(s){
  const out = [];
  if(/^#{1,6}\s|\n#{1,6}\s/.test(s))        out.push("有 ### 小标题");
  if(/\*\*/.test(s))                        out.push("有 ** 加粗");
  if(/^\s*[-*·]\s|\n\s*[-*·]\s/.test(s))    out.push("有列表符号");
  if(/^\s*\d+[.、)]\s|\n\s*\d+[.、)]\s/.test(s)) out.push("有编号列表");
  if(/^["'"「]|["'"」]$/.test(s))            out.push("整段裹引号");
  if(/以下是|这是我的回复|希望这个回答/.test(s)) out.push("助手腔台词");
  if(/不仅.*而且|不是.*而是/.test(s))        out.push("排比句");
  if(/——|综上所述|总而言之|赋能|抓手|闭环/.test(s)) out.push("AI 味词");
  // 这两条是 glm-4-flash 真写出来过的，SKILL 里专门禁了，回来一个都算退步
  if(/小树苗|沃土|耕耘|浇灌|阳光雨露|静待花开|园丁|摇篮/.test(s)) out.push("教育味意象");
  if(/受宠若惊|发挥余热|茁壮成长|不负期望/.test(s))              out.push("刺眼腔调");
  if(/\n/.test(s))                          out.push("分了行（微信里该是一整段）");
  if(s.length > 260)                        out.push("太长（" + s.length + " 字）");
  return out;
}

(async () => {
  if(!KEY){ console.log("用法：node 试腔调.js 你的智谱KEY [模型名]"); process.exitCode = 1; return; }
  const { SKILL, buildPrompt, tidy } = await loadSkill();
  console.log("模型：" + MODEL);
  console.log("SKILL 长度：" + SKILL.length + " 字\n");

  let bad = 0;
  for(const c of CASES){
    const r = await ask(SKILL, buildPrompt, tidy, c);
    console.log("══════════════════════════════════════");
    console.log(`【${c.voice} · ${c.len}】对方（${c.name}）：${c.said.slice(0, 40)}`);
    if(r.err){ console.log("  ✘ " + r.err); bad++; continue; }
    console.log("  耗时 " + r.secs + "s" + (r.tokens ? "，用了 " + r.tokens + " tokens" : ""));
    console.log("──────────────────────────────────────");
    console.log(r.raw.split("\n").map(l => "  " + l).join("\n"));
    console.log("──────────────────────────────────────");
    console.log("  清理后（真正会显示在网页上的）：");
    console.log("  " + r.tidyed.replace(/\n/g, "\n  "));
    const s = smells(r.raw);
    if(s.length){ bad++; console.log("  ⚠ " + s.join("；")); }
    else console.log("  ✔ 没看出坏毛病");
    console.log("");
  }
  console.log(bad ? `⚠ ${bad} 处要处理` : "✔ 四例都干净");
  process.exitCode = bad ? 1 : 0;
})();

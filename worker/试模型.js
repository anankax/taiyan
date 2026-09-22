/* =========================================================
   挨个试模型名，看这把 Key 到底卡在哪一层
   ---------------------------------------------------------
   用法：node 试模型.js 你的智谱KEY

   为什么要有这个：报 429 有两种，长得很像但病根不同——
     · 该模型当前访问量过大  → 模型挤，换个时间就好
     · 您的账户已达到速率限制 → 账户被限，换模型也白搭
   一把 Key 换个模型就通了，说明账户没事，是那个模型的事。
   ========================================================= */

const URL_API = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const KEY = process.argv[2];

/* 先试资源包覆盖得到的：
     glm-4.5-air 有 12,000,000 tokens 的专属包，且是付费模型——
     不走免费池，大概率不用像 glm-4.7-flash 那样排八十秒队。
     包 2026-09-28 到期，不用白不用。
   后面几个是备选，看哪个牌子能用。 */
const MODELS = [
  "glm-4.5-air",
  "glm-4.7-flash",
  "glm-4.5-flash",
  "glm-4.6",
  "glm-4-flash"
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 智谱的中文错话，翻成能下判断的一句话 */
function verdict(status, msg){
  if(status === 200) return ["✔ 通了", "这个能用"];
  if(status === 401 || /令牌|api.?key|鉴权|认证失败/i.test(msg)) return ["✘ Key 不对", "复制漏了尾巴，或者这把 Key 删了"];
  if(/速率限制.*请求频率|rate.?limit/i.test(msg)) return ["△ 账户限速", "账户级，换模型也白搭"];
  if(/访问量过大|稍后再试/i.test(msg)) return ["△ 模型挤", "模型级，等会儿再试"];
  if(/不存在|not found|无权限|未开通|没有权限/i.test(msg)) return ["✘ 没开通", "账户没这个模型的使用权"];
  if(/余额|欠费|quota|额度/i.test(msg)) return ["✘ 没钱了", "账户余额/额度问题"];
  return ["✘ " + status, "看原文"];
}

async function probe(model){
  const t0 = Date.now();
  let r, raw;
  try{
    r = await fetch(URL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "说一句：今天天气不错。" }],
        max_tokens: 32,
        thinking: { type: "disabled" }
      })
    });
    raw = await r.text();
  }catch(e){
    return { model, status: 0, secs: "0.0", msg: "连不上：" + e.message, tag: ["✘ 网络", "检查网络"] };
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  let msg = "";
  try{
    const d = JSON.parse(raw);
    msg = (d.error && (d.error.message || d.error.code)) || "";
    if(!msg && d.choices) msg = d.choices[0].message.content || "";
  }catch(e){ msg = raw.slice(0, 120); }
  return { model, status: r.status, secs, msg: String(msg).slice(0, 80),
           tag: verdict(r.status, String(msg)) };
}

async function main(){
  if(!KEY){
    console.log("用法：node 试模型.js 你的智谱KEY");
    process.exitCode = 1;
    return;
  }
  console.log("拿同一把 Key 挨个试模型，看是账户的事还是模型的事\n");
  const rows = [];
  for(const m of MODELS){
    const r = await probe(m);
    rows.push(r);
    console.log(r.tag[0].padEnd(12) + m.padEnd(22) + r.status + "  " + r.secs + "s");
    if(r.msg) console.log("             " + r.msg);
    console.log("             → " + r.tag[1] + "\n");
    await sleep(3000);            // 别自己把自己试限速了
  }

  console.log("────────── 结论 ──────────");
  const ok = rows.filter(r => r.status === 200);
  if(ok.length){
    console.log("能用：" + ok.map(r => r.model).join("、"));
    const bad = rows.filter(r => r.status !== 200);
    if(bad.length) console.log("不能用：" + bad.map(r => r.model + "（" + r.tag[0].slice(2) + "）").join("、"));
    console.log("\n把 worker.js 里的 MODEL 改成能用的那个就行。");
  } else {
    const acct = rows.filter(r => r.tag[1].startsWith("账户")).length;
    if(acct === rows.length) console.log("全军覆没，而且是\"账户限速\"——不是模型的事，是账户的事。");
    else console.log("一个都没通。看上面每行的原文，多半是账户没开通或没实名。");
  }
  process.exitCode = ok.length ? 0 : 1;
}

main();

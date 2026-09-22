/* =========================================================
   先试试这把 Key 好不好使
   ---------------------------------------------------------
   用法（在这个文件夹里，右键"在终端中打开"）：

     node 试试key.js 你的智谱KEY

   这个脚本发的请求，跟 Cloudflare 代理上要发的**一模一样**。
   它通了，代理就通；它不通，代理也不用查了，先看 Key。

   Key 只是命令行参数，不会存进任何文件。
   ========================================================= */

const URL_API = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

const KEY = process.argv[2];
if(!KEY){
  console.log("用法：node 试试key.js 你的智谱KEY");
  console.log("（Key 在 https://open.bigmodel.cn 左边菜单的「API Key」里）");
  process.exitCode = 1;          // 不直接 process.exit()，Windows 上会吐 libuv 断言
} else {
  main();
}

// 就照着代理那份规矩来：关掉思考，让它直接说人话
function buildBody(){
  return {
    model: "glm-4.7-flash",
    messages: [
      { role: "system", content:
        "你在模仿一位中学教师的微信说话方式。要求：嘴上先谦虚；句尾爱带个「的」字；" +
        "爱用四字格连着走；情绪不绕弯子，最后落到一句大白话。不要分点、不要小标题、" +
        "不要解释你写了什么。全文控制在两三句。" },
      { role: "user", content:
        "遥想当年自己在农村学校，如今能帮到新教师。对方（周校长）夸我「用心、精细、实效」。\n" +
        "请写出我要回的这段话。" }
    ],
    temperature: 1.0,
    max_tokens: 2048,
    thinking: { type: "disabled" }   // GLM-4.7 的 enabled = 强制思考，这里必须关
  };
}

async function main(){
  console.log("正在问智谱…（免费模型偶尔要等十几秒）\n");
  const t0 = Date.now();

  let r, raw;
  try{
    r = await fetch(URL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
      body: JSON.stringify(buildBody())
    });
    raw = await r.text();
  }catch(e){
    console.log("✘ 连不上智谱：", e.message);
    console.log("  检查一下网络。");
    process.exitCode = 1;
    return;
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if(!r.ok){
    console.log("✘ 智谱返回 " + r.status + "（用了 " + secs + " 秒）");
    console.log("  原文：", raw.slice(0, 500));
    console.log("");
    if(r.status === 401)      console.log("  → Key 不对。是不是复制时漏了尾巴，或者已经删掉了。");
    else if(r.status === 429) console.log("  → 问得太频了，等一分钟再来。");
    else if(/thinking/i.test(raw)) console.log("  → thinking 参数不被认。把 buildBody 里那行 thinking 删掉再试。");
    else if(/model/i.test(raw))    console.log("  → 模型名不对。看看是不是 glm-4.7-flash。");
    process.exitCode = 1;
    return;
  }

  let d;
  try{ d = JSON.parse(raw); }
  catch(e){ console.log("✘ 回来的不是 JSON：", raw.slice(0, 300)); process.exitCode = 1; return; }

  const msg = d.choices && d.choices[0] && d.choices[0].message;
  console.log("✔ 通了！（用了 " + secs + " 秒）\n");
  console.log("────────── 它写出来的 ──────────");
  console.log(String((msg && msg.content) || "(空的)").trim());
  console.log("──────────────────────────────\n");

  if(msg && msg.reasoning_content){
    console.log("（注意：它还吐了一段思考过程 reasoning_content，说明 thinking 没关住。");
    console.log("  代理那边会把这段丢掉，只发 content，所以不影响使用。）\n");
  }
  console.log("这把 Key 好使，可以去部署代理了：见同目录 DEPLOY.md");
}

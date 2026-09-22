/* 端到端试跑：起一个假的 Worker（**不用真的 API Key**），
   用真浏览器把页面跑一遍，看三条路对不对：
     ① 代理正常 → 页面把请求发对、把模型的回话原样显示出来
     ② 代理报错 → 自动退回本地语料，页面不空着
     ③ 没配代理 → 纯本地，断网也能用
   跑法：node test/e2e.js      （需要 Chrome，路径在下面 CHROME） */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const DIR = path.join(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TMP = path.join(os.tmpdir(), "taiyan_e2e");
fs.mkdirSync(TMP, { recursive: true });

/* 拿一份 index.html 的副本，尾巴上接一小段"自动点一下"，
   生产文件不动 */
const src = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
const auto = `
<script>
window.addEventListener("load", () => setTimeout(() => {
  document.getElementById("who").value = "周校长";
  const s = document.getElementById("said");
  s.value = "周校长：[强][强][玫瑰][玫瑰]用心、精细、实效";
  s.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("go").click();
  // 等 run() 干完（按钮重新可用），把结果写进 title，方便 --dump-dom 取
  const t = setInterval(() => {
    const g = document.getElementById("go");
    if(g.disabled) return;
    clearInterval(t);
    const bs = document.querySelectorAll(".row.me .bubble");
    document.title = "RESULT::" + (bs.length ? bs[bs.length - 1].textContent : "(无)");
  }, 50);
}, 60));
<\/script>`;
const copy = path.join(TMP, "index.html");
fs.writeFileSync(copy, src.replace("</body>", auto + "\n</body>"));

const FAKE = [
  "周校，您夸我我心里高兴，可也知道自己几斤几两。",
  "刚接班那阵子，我天天担心自己讲错，半夜还在翻教材。",
  "现在有师傅带着，一点一点教，我心里踏实多了。",
  "感谢师傅手把手地教，我这点进步都是师傅给的。",
  "以后还要多向各位老教师请教，请多指点。我很珍惜。"
].join("");

let mode = "ok";
const seen = [];
const srv = http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*",
                 "Access-Control-Allow-Headers": "Content-Type",
                 "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if(req.method === "OPTIONS"){ res.writeHead(204, cors); return res.end(); }
  let b = "";
  req.on("data", c => b += c);
  req.on("end", () => {
    try { seen.push(JSON.parse(b || "{}")); } catch(e){ seen.push({ 解析失败: b }); }
    res.writeHead(mode === "ok" ? 200 : 502, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(mode === "ok" ? { text: FAKE } : { error: "模型没接上" }));
  });
});

function chrome(args){
  return new Promise(r => {
    const p = spawn(CHROME, args, { stdio: ["ignore","pipe","ignore"] });
    let out = "";
    p.stdout.on("data", d => out += d);
    p.on("exit", () => r(out));
  });
}

(async () => {
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const url = `file:///${copy.replace(/\\/g, "/")}?api=http://127.0.0.1:${srv.address().port}`;
  const base = ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${TMP}`,
                "--window-size=430,1500", "--virtual-time-budget=12000"];

  const grab = async u => {
    const dom = await chrome([...base, "--dump-dom", u || url]);
    const m = (dom.match(/<title>RESULT::([\s\S]*?)<\/title>/) || [,"(没抓到)"])[1].trim();
    const tag = (dom.match(/<div class="tagline"[^>]*>([\s\S]*?)<\/div>/) || [,""])[1].trim();
    return { text: m, tag };
  };

  const shot = n => chrome([...base, `--screenshot=${path.join(TMP, n + ".png")}`, url]);

  // ① 代理正常
  mode = "ok";
  let r = await grab();
  console.log("① 代理正常");
  console.log("   页面发来的请求：", JSON.stringify(seen[seen.length - 1] || null));
  console.log("   发言人那条：", r.text);
  console.log("   标注：", r.tag || "(空)");
  console.log("   与假模型返回的原文一致：", r.text === FAKE ? "✔" : "✘");
  await shot("ok");

  // ② 代理挂掉，应退回本地语料
  mode = "fail";
  r = await grab();
  console.log("\n② 代理返回 502");
  console.log("   发言人那条：", r.text);
  console.log("   退回本地语料（有内容且不等于模型原文）：",
    r.text && r.text !== "(没抓到)" && r.text !== FAKE ? "✔" : "✘");
  await shot("fallback");

  // ③ 不配代理，纯本地
  const localUrl = `file:///${copy.replace(/\\/g, "/")}`;
  console.log("\n③ 不填代理（离线）");
  console.log("   发言人那条：", (await grab(localUrl)).text);

  srv.close();
})();

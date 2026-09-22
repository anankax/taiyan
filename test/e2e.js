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

/* 假代理有四种脾气：
     ok        —— 按纯文本流一小段一小段吐（真代理就是这么吐的）
     slow      —— 先停 1.5 秒再吐，看"正在说…"那段等待
     fail      —— 直接 502，看会不会退回本地语料
     cut       —— 吐一半就断，看半截话保不保得住 */
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

    if(mode === "fail"){
      res.writeHead(502, { "Content-Type": "application/json", ...cors });
      return res.end(JSON.stringify({ error: "模型没接上" }));
    }

    // 老版代理：不认 stream，照样回一整坨 JSON。
    //   网页得照样能用——改天换了 worker 忘重新部署就是这个情形
    if(mode === "json"){
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...cors });
      return res.end(JSON.stringify({ text: FAKE }));
    }

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", ...cors });
    // 切成 6 个字一块，模拟流式；按字节切，故意把汉字的边界切坏
    //   用 setImmediate 不用 setTimeout：Chrome 的 --virtual-time-budget
    //   会把页面的定时器瞬间快进掉，服务端要是慢慢吐，页面预算烧完了字节还没到
    const buf = Buffer.from(FAKE, "utf8");
    const step = 6 * 3;               // 一个汉字 3 字节
    let i = 0;
    const push = () => {
      if(i >= buf.length) return res.end();
      res.write(buf.slice(i, i + step));
      i += step;
      // 吐到一半就掐线，看半截话保不保得住。
      //   得等 40ms 让已写的字节真发到浏览器再 destroy——
      //   紧跟着 write 就 destroy 会把 socket 缓冲一起丢掉，
      //   浏览器一个字节都收不到，那就成了"没收到"，退本地是对的，测不出东西
      if(mode === "cut" && i >= Math.floor(buf.length / 2)){
        return setTimeout(() => res.destroy(), 40);
      }
      setImmediate(push);
    };
    push();
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
                "--window-size=430,1500", "--virtual-time-budget=90000"];

  const grab = async u => {
    const dom = await chrome([...base, "--dump-dom", u || url]);
    const m = (dom.match(/<title>RESULT::([\s\S]*?)<\/title>/) || [,"(没抓到)"])[1].trim();
    const tag = (dom.match(/<div class="tagline"[^>]*>([\s\S]*?)<\/div>/) || [,""])[1].trim();
    return { text: m, tag };
  };

  const shot = n => chrome([...base, `--screenshot=${path.join(TMP, n + ".png")}`, url]);

  // ① 代理正常，流式
  mode = "ok";
  let r = await grab();
  console.log("① 代理流式吐字");
  console.log("   页面发来的请求：", JSON.stringify(seen[seen.length - 1] || null));
  console.log("   发言人那条：", r.text);
  console.log("   标注：", r.tag || "(空)");
  console.log("   与假模型返回的原文一致：", r.text === FAKE ? "✔" : "✘");
  console.log("   请求里带了 stream:true：", seen[seen.length-1] && seen[seen.length-1].stream === true ? "✔" : "✘");
  await shot("ok");

  // ② 代理挂掉，应退回本地语料
  mode = "fail";
  r = await grab();
  console.log("\n② 代理返回 502");
  console.log("   发言人那条：", r.text);
  console.log("   退回本地语料（有内容且不等于模型原文）：",
    r.text && r.text !== "(没抓到)" && r.text !== FAKE ? "✔" : "✘");
  await shot("fallback");

  // ③ 吐一半断线，半截话得保住，不能退回本地
  mode = "cut";
  r = await grab();
  const half = r.text && r.text !== "(没抓到)" && FAKE.startsWith(r.text) && r.text.length > 10;
  console.log("\n③ 吐一半断线");
  console.log("   发言人那条：", r.text);
  console.log("   保住了半截（是原文的前缀，且没退回本地语料）：", half ? "✔" : "✘");
  await shot("cut");

  // ④ 老版代理（不回流，回 JSON），也得能用
  mode = "json";
  r = await grab();
  console.log("\n④ 代理是旧版（回 JSON 而非流）");
  console.log("   发言人那条：", r.text);
  console.log("   照样显示出来了：", r.text === FAKE ? "✔" : "✘");

  // ⑤ 不配代理，纯本地
  mode = "ok";
  const localUrl = `file:///${copy.replace(/\\/g, "/")}`;
  const local = await grab(localUrl);
  console.log("\n⑤ 不填代理（离线）");
  console.log("   发言人那条：", local.text);
  console.log("   纯本地出的（有内容且不是模型原文）：",
    local.text && local.text !== "(没抓到)" && local.text !== FAKE ? "✔" : "✘");

  srv.close();
})();

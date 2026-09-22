/* 端到端试跑：起一个**假冒的智谱**（不用真 API Key），
   用真浏览器把页面跑一遍，看几条路对不对：
     ① 正常流式       → 请求发对、SSE 拆对、模型的话原样显示
     ② 401 Key 不对   → 说人话提示，退回本地语料
     ③ 429 排队       → 说人话提示，退回本地语料
     ④ 吐一半断线     → 半截话保住，**不**退回本地
     ⑤ 空的 Key       → 根本不发请求，纯本地

   页面靠 ?api=<地址> 把请求指到这个假服务器（那个参数就是为这个测试留的）。
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

/* 假服务器也要跨域，否则测的是 CORS 而不是页面逻辑 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const FAKE = [
  "周校，您夸我我心里高兴，可也知道自己几斤几两。",
  "刚接班那阵子，我天天担心自己讲错，半夜还在翻教材。",
  "现在有师傅带着，一点一点教，我心里踏实多了。",
  "感谢师傅手把手地教，我这点进步都是师傅给的。",
  "以后还要多向各位老教师请教，请多指点。我很珍惜。"
].join("");

/* 把一段话切成 4 个字一块，发成智谱那种 SSE。
   按字节切，故意切坏汉字的边界，看页面留没留半行缓冲 */
function sseChunks(text, onHalf){
  const buf = Buffer.from(text, "utf8");
  const step = 4 * 3;
  const parts = [];
  for(let i = 0; i < buf.length; i += step){
    const piece = buf.slice(i, i + step).toString("utf8");
    parts.push("data: " + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + "\n\n");
  }
  return { parts, half: Math.ceil(parts.length / 2), onHalf };
}

let mode = "ok";
const seen = [];

const srv = http.createServer((req, res) => {
  if(req.method === "OPTIONS"){ res.writeHead(204, CORS); return res.end(); }
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    let j = {};
    try { j = JSON.parse(body || "{}"); } catch(e){}
    seen.push({ body: j, auth: req.headers.authorization });

    if(mode === "401"){
      res.writeHead(401, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: { message: "令牌无效" } }));
    }
    if(mode === "429"){
      res.writeHead(429, { "Content-Type": "application/json", ...CORS });
      return res.end(JSON.stringify({ error: { code: "1302", message: "并发超限" } }));
    }

    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", ...CORS });

    /* 先来一段 reasoning_content —— 页面的头兜缓冲区会把开头 24 字捂住，
       所以这段思考过程会跟"帽话"一起被削掉。它要是漏出来，测试就红了 */
    const pre = "data: " + JSON.stringify({ choices: [{ delta: { reasoning_content: "用户想要一段回复，我该…" } }] }) + "\n\n";
    res.write(pre);

    const { parts, half } = sseChunks(FAKE);
    let i = 0;
    const push = () => {
      if(i >= parts.length){
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      res.write(parts[i++]);
      // 吐到一半掐线。先给 40ms 让已写的字节真发出去再 destroy，
      //   紧跟着 write 就 destroy 会把 socket 缓冲一起丢掉，
      //   浏览器一个字节都收不到，那就变成"没收到"，测不出东西
      if(mode === "cut" && i >= half) return setTimeout(() => res.destroy(), 40);
      // 用 setImmediate 不用 setTimeout：--virtual-time-budget 会把页面定时器快进掉
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

/* 复制一份页面，尾巴上接一段"自动点一下"。生产文件不动。
   emptyKey=true 时把 Key 掏空，测纯本地那条路 */
function build(emptyKey){
  const src = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const patched = emptyKey
    ? src.replace(/const GLM_KEY\s*=\s*"[^"]*"/, 'const GLM_KEY = ""')
    : src;
  const auto = `
<script>
window.addEventListener("load", () => setTimeout(() => {
  document.getElementById("who").value = "周校长";
  const s = document.getElementById("said");
  s.value = "周校长：[强][强][玫瑰][玫瑰]用心、精细、实效";
  s.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("go").click();
  const t = setInterval(() => {
    const g = document.getElementById("go");
    if(g.disabled) return;
    clearInterval(t);
    const bs = document.querySelectorAll(".row.me .bubble");
    document.title = "RESULT::" + (bs.length ? bs[bs.length - 1].textContent : "(无)");
    // 顺便把"有没有发请求"也带出来
    document.title += "||" + (window.__sent === undefined ? "?" : window.__sent);
  }, 50);
}, 60));
<\/script>`;
  return patched.replace("</body>", auto + "\n</body>");
}

(async () => {
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  const base = ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${TMP}`,
                "--window-size=430,1500", "--virtual-time-budget=90000"];

  let pass = 0, fail = 0;
  const check = (name, ok, extra) => {
    console.log("   " + (ok ? "✔" : "✘") + " " + name + (extra ? "  —— " + extra : ""));
    ok ? pass++ : fail++;
  };

  const grab = async (file) => {
    const u = `file:///${file.replace(/\\/g, "/")}?api=http://127.0.0.1:${port}`;
    const dom = await chrome([...base, "--dump-dom", u]);
    const raw = (dom.match(/<title>RESULT::([\s\S]*?)<\/title>/) || [,"(没抓到)"])[1].trim();
    const [text, sent] = raw.split("||");
    const tag = (dom.match(/<div class="tagline"[^>]*>([\s\S]*?)<\/div>/) || [,""])[1].trim();
    return { text, sent, tag };
  };

  const B2 = {
    正常: path.join(TMP, "with_key.html"),
    空Key: path.join(TMP, "no_key.html")
  };
  fs.writeFileSync(B2.正常, build(false));
  fs.writeFileSync(B2.空Key, build(true));

  /* ---------- ① 正常流式 ---------- */
  mode = "ok";
  seen.length = 0;
  let r = await grab(B2.正常);
  const req = seen[seen.length - 1] || {};
  console.log("\n① 正常流式");
  console.log("   请求体：model=" + (req.body.model || "?") +
              "｜stream=" + req.body.stream +
              "｜messages=" + (req.body.messages || []).length + " 条" +
              "｜thinking=" + JSON.stringify(req.body.thinking));
  console.log("   发言人那条：" + r.text);
  check("Authorization 头带上了 Bearer", /^Bearer .+/.test(req.auth || ""), (req.auth || "").slice(0, 16) + "…");
  check("system 消息是 SKILL", /模仿一位中学教师/.test((req.body.messages || [{}])[0].content || ""));
  check("user 消息带上了对方的话", /用心、精细、实效/.test((req.body.messages || [{},{}])[1].content || ""));
  check("thinking 显式关掉", req.body.thinking && req.body.thinking.type === "disabled");
  check("正文一个字不差", r.text === FAKE, r.text.length + " 字");
  check("思考过程没漏出来", r.text.indexOf("我该") === -1);
  check("标注是「照你这句话现写的」", r.tag.indexOf("现写") >= 0, r.tag);

  /* ---------- ② 401 ---------- */
  mode = "401";
  r = await grab(B2.正常);
  console.log("\n② Key 失效（401）");
  console.log("   发言人那条：" + r.text);
  check("没把错误原文糊到页面上", r.text !== "(没抓到)" && r.text.indexOf("令牌无效") === -1);
  check("退回本地语料", !!r.text && r.text !== "(没抓到)" && r.text !== FAKE);
  check("和模型原文不同（确实是本地拼的）", r.text !== FAKE);

  /* ---------- ③ 429 ---------- */
  mode = "429";
  r = await grab(B2.正常);
  console.log("\n③ 排队（429）");
  console.log("   发言人那条：" + r.text);
  check("退回本地语料，页面没空", !!r.text && r.text !== "(没抓到)");

  /* ---------- ④ 吐一半断线 ---------- */
  mode = "cut";
  r = await grab(B2.正常);
  const half = r.text && r.text !== "(没抓到)" && FAKE.startsWith(r.text) && r.text.length > 10;
  console.log("\n④ 吐一半断线");
  console.log("   发言人那条：" + r.text);
  check("保住了半截（是原文前缀，且没退回本地）", half, r.text.length + " / " + FAKE.length + " 字");

  /* ---------- ⑤ 空 Key ---------- */
  mode = "ok";
  seen.length = 0;
  r = await grab(B2.空Key);
  console.log("\n⑤ Key 是空的");
  console.log("   发言人那条：" + r.text);
  check("根本没发请求", seen.length === 0, "收到 " + seen.length + " 个请求");
  check("纯本地照常出话", !!r.text && r.text !== "(没抓到)");
  check("和模型原文不同", r.text !== FAKE);

  console.log("\n" + (fail ? "✘ " + fail + " 项没过（" + pass + " 项通过）" : "✔ 全部 " + pass + " 项通过"));
  srv.close();
  process.exitCode = fail ? 1 : 0;
})();

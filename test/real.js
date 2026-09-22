/* 真浏览器 → 真智谱。这一条是整件事的前提：
   我们砍掉代理，赌的就是"浏览器能直连智谱"（智谱 CORS 放开）。
   假服务器测得再全也证明不了 CORS，所以得有一天真的打过去。
   跑法：node test/real.js      会花掉一次真实调用（约 1 万 token 里的一小口）

   为什么不 --dump-dom：虚拟时钟会把页面的 setInterval 瞬间烧完，
   dump 早在模型回话之前就发生了。改成页面把结果 POST 回本地服务器，
   我们等这个 POST —— 真实时间怎么走就怎么等。 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const DIR = path.join(__dirname, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TMP = path.join(os.tmpdir(), "taiyan_real");
fs.mkdirSync(TMP, { recursive: true });

const srv = http.createServer((req, res) => {
  res.writeHead(200, { "Access-Control-Allow-Origin": "*",
                       "Access-Control-Allow-Headers": "Content-Type" });
  if(req.method === "OPTIONS") return res.end();
  let b = "";
  req.on("data", c => b += c);
  req.on("end", () => { res.end("ok"); done(JSON.parse(b || "{}")); });
});

let done = () => {};
const result = new Promise(r => done = r);

const src = fs.readFileSync(path.join(DIR, "index.html"), "utf8");

(async () => {
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;

  const auto = `
<script>
window.addEventListener("load", () => setTimeout(() => {
  const back = o => fetch("http://127.0.0.1:${port}/done", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(o)
  });
  // 页面自己抛的错也捞回来，不然只能看到"一片空白"
  window.onerror = (m, u, l, c, e) => back({ crash: m + " @" + l + ":" + c });
  document.getElementById("who").value = "周校长";
  const s = document.getElementById("said");
  s.value = "周校长：[强][强][玫瑰][玫瑰]用心、精细、实效";
  s.dispatchEvent(new Event("input", { bubbles: true }));
  const t0 = Date.now();
  document.getElementById("go").click();
  const t = setInterval(() => {
    const g = document.getElementById("go");
    if(g.disabled) return;
    clearInterval(t);
    const bs = document.querySelectorAll(".row.me .bubble");
    const tag = document.querySelector(".row.me .tagline");
    back({ secs: Math.round((Date.now() - t0) / 100) / 10,
           text: bs.length ? bs[bs.length - 1].textContent : "(无)",
           tag: tag ? tag.textContent : "" });
  }, 100);
}, 60));
<\/script>`;

  const f = path.join(TMP, "real.html");
  fs.writeFileSync(f, src.replace("</body>", auto + "\n</body>"));

  const url = "file:///" + f.replace(/\\/g, "/");
  const args = ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${TMP}`,
                "--window-size=430,1200", url];
  const p = spawn(CHROME, args, { stdio: ["ignore", "pipe", "ignore"] });
  let logs = "";
  p.stdout.on("data", d => logs += d);

  const bail = setTimeout(() => done({ crash: "等了 4 分钟页面没回话" }), 240000);
  const r = await result;
  clearTimeout(bail);
  p.kill();

  console.log("=== 真浏览器 → 真智谱（CORS 实弹）===");
  if(r.crash){
    console.log("✘ 页面那边出事：" + r.crash);
    console.log("浏览器输出：\n" + logs.slice(-1500));
    process.exitCode = 1;
  } else {
    console.log("耗时 " + r.secs + "s｜标注：" + (r.tag || "(空)"));
    console.log(r.text);
    console.log("长度 " + (r.text || "").length + " 字");
    const ok = r.text && r.text !== "(无)" && r.text.length >= 20 && /现写/.test(r.tag || "");
    console.log(ok ? "\n✔ 浏览器直连智谱，通了 —— CORS 这条前提成立"
                   : "\n✘ 没拿到模型的话（退回本地语料了？）");
    process.exitCode = ok ? 0 : 1;
  }
  srv.close();
})();

/* 拿真浏览器打**线上地址**（https://anankax.github.io/taiyan/），
   点两下看是不是真调了模型。跑法：node test/live.js

   为什么单独要有这个：test/real.js 测的是本地 file://，
   而 file:// 发出去的 Origin 是 null。线上是 https 域，Origin 是
   https://anankax.github.io —— 智谱的 CORS 是按请求方反射的，
   理应一样放行，但"理应"不算数，得真打一次。

   file:// 那套"往页面里注入自动点击"的招数在 https 上不好使，
   所以这里走 CDP（Node 22+ 自带 WebSocket，不用装包）。 */
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const TMP = path.join(os.tmpdir(), "taiyan_live_cdp");
const PORT = 9333;
const URL_ = "https://anankax.github.io/taiyan/?cb=" + Date.now();

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    `--user-data-dir=${TMP}`, `--remote-debugging-port=${PORT}`,
    "--window-size=430,1600", URL_
  ], { stdio: ["ignore", "pipe", "ignore"] });

  try {
    // 等调试端口起来
    let tabs = null;
    for(let i = 0; i < 30 && !tabs; i++){
      await sleep(500);
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json`);
        tabs = (await r.json()).filter(t => t.type === "page" && t.url.includes("anankax"));
        if(!tabs.length) tabs = null;
      } catch(e){}
    }
    if(!tabs){ console.log("✘ 没连上浏览器调试端口"); return; }

    const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    ws.onmessage = e => {
      const d = JSON.parse(e.data);
      if(d.id && pending.has(d.id)){ pending.get(d.id)(d.result); pending.delete(d.id); }
    };
    const send = (method, params) => new Promise(r => {
      const i = ++id; pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    const evalJS = async expr => {
      const r = await send("Runtime.evaluate",
        { expression: expr, awaitPromise: true, returnByValue: true });
      if(r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " +
        (r.exceptionDetails.exception || {}).description);
      return r.result.value;
    };

    // 等页面真的加载完
    for(let i = 0; i < 20; i++){
      if(await evalJS("!!document.getElementById('go')")) break;
      await sleep(500);
    }

    const run = said => evalJS(`(async () => {
      const set = (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
      set(document.getElementById("who"), "周校长");
      set(document.getElementById("said"), ${JSON.stringify(said)});
      // 每次先清掉上一轮的，免得读到最后一条旧的
      const old = document.querySelectorAll(".row.me .bubble").length;
      const t0 = Date.now();
      document.getElementById("go").click();
      while((document.getElementById("go").disabled ||
             document.querySelectorAll(".row.me .bubble").length === old)
            && Date.now() - t0 < 200000) await new Promise(r => setTimeout(r, 200));
      const bs = document.querySelectorAll(".row.me .bubble");
      const tg = document.querySelector(".row.me .tagline");
      return JSON.stringify({ secs: ((Date.now() - t0) / 1000).toFixed(1),
                              tag: tg ? tg.textContent : "",
                              text: bs.length ? bs[bs.length - 1].textContent : "(空)" });
    })()`);

    console.log("=== 线上 " + URL_.split("?")[0] + " 实弹 ===\n");
    let good = 0;
    for(const said of ["国旗队带得不错啊，辛苦你了", "这次公开课你带带小孔"]){
      const r = JSON.parse(await run(said));
      console.log("对方说：「" + said + "」");
      console.log("  " + r.secs + "s ｜ " + (r.tag || "(空)"));
      console.log("  " + r.text + "\n");
      if(/现写/.test(r.tag) && r.text && r.text.length > 20) good++;
    }
    console.log(good === 2
      ? "✔ 两条都走了模型 —— 线上真实源 + 真实 CORS 成立"
      : "✘ 有 " + (2 - good) + " 条退回了本地语料（看上面的标注）");
    process.exitCode = good === 2 ? 0 : 1;
  } finally {
    chrome.kill();
  }
})();

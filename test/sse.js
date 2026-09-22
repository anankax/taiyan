/* 专测代理里的 SSE 拆包（worker.js 的 sseToText）。
   不需要真的 API Key：自己造一段智谱会吐的字节流，
   故意在别扭的地方切断，看拆出来的正文对不对。
   跑法：node test/sse.js */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "worker", "worker.js"), "utf8")
  // worker.js 是 ES module，这里只是要把几个函数抠出来单测，
  // 把 export 那行换掉就能塞进 new Function
  .replace(/^export default/m, "const __worker =");

const mod = new Function("return (async () => { " + src +
  "\nreturn { sseToText, cleanHead, cleanTail, __worker }; })();")();

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if(got === want){ pass++; console.log("  ✔ " + name); }
  else { fail++; console.log("  ✘ " + name); console.log("      要的是：" + JSON.stringify(want)); console.log("      拿到的是：" + JSON.stringify(got)); }
};

/* 造一段智谱格式的 SSE。pieces 是逐块吐的正文，
   reasoning 是思考过程（应当被丢掉），最后补 [DONE] */
function makeSSE(pieces, reasoning){
  const ev = o => "data: " + JSON.stringify(o) + "\n\n";
  let s = "";
  for(const r of (reasoning || []))
    s += ev({ choices: [{ delta: { reasoning_content: r } }] });
  for(const p of pieces)
    s += ev({ choices: [{ delta: { content: p } }] });
  s += "data: [DONE]\n\n";
  return s;
}

/* 把整段字节按 chunk 大小切碎，模拟"半行"到达 */
function chunksOf(str, size){
  const b = Buffer.from(str, "utf8");
  const out = [];
  for(let i = 0; i < b.length; i += size) out.push(b.slice(i, i + size));
  return out;
}

async function run(str, size){
  const { sseToText } = await mod;
  const stream = new ReadableStream({
    start(c){ for(const b of chunksOf(str, size)) c.enqueue(new Uint8Array(b)); c.close(); }
  });
  const res = new Response(stream);
  const reader = sseToText(res).getReader();
  const dec = new TextDecoder();
  let out = "";
  for(;;){ const { done, value } = await reader.read(); if(done) break; out += dec.decode(value, { stream: true }); }
  return out;
}

(async () => {
  console.log("== cleanHead / cleanTail ==");
  const { cleanHead, cleanTail } = await mod;
  eq("削掉（以下是回复）", cleanHead("（以下是回复）周校，您过奖了。"), "周校，您过奖了。");
  eq("削掉「回复：」", cleanHead("回复：周校，您过奖了。"), "周校，您过奖了。");
  eq("削掉代码围栏", cleanHead("```\n周校，您过奖了。"), "周校，您过奖了。");
  eq("削掉开头的引号", cleanHead("「周校，您过奖了。」"), "周校，您过奖了。」");
  eq("正常内容不动", cleanHead("周校，您过奖了。"), "周校，您过奖了。");
  eq("末尾围栏", cleanTail("您过奖了。```"), "您过奖了。");
  eq("末尾引号", cleanTail("您过奖了。\""), "您过奖了。");
  eq("末尾空白", cleanTail("您过奖了。\n\n"), "您过奖了。");
  eq("表情不算引号，不能削", cleanTail("我心里踏实。[抱拳]"), "我心里踏实。[抱拳]");

  console.log("\n== 整段拆包 ==");
  const GOOD = "周校，您夸我我心里高兴，可也知道自己几斤几两。刚接班那阵子，我天天担心自己讲错。";
  const PIECES = [GOOD.slice(0,7), GOOD.slice(7,19), GOOD.slice(19,20), GOOD.slice(20,41), GOOD.slice(41)];
  const RAW = makeSSE(PIECES, ["让我想想这位老师会怎么说…", "嗯，先谦虚一下。"]);

  for(const size of [1, 3, 7, 64, 4096]){
    eq(`按 ${size} 字节切碎，正文完整还原`, await run(RAW, size), GOOD);
  }

  console.log("\n== 脏数据 ==");
  eq("思考过程被丢掉",
    await run(makeSSE(["我很开心。"], ["先想一下……", "再想一下……"]), 5), "我很开心。");
  eq("开头白送一句「以下是回复」也削得掉",
    await run(makeSSE(["（以下是回复）", "周校，您过奖了。"]), 4), "周校，您过奖了。");
  eq("结尾带 ``` 也削得掉",
    await run(makeSSE(["周校，您过奖了。", "```"]), 2), "周校，您过奖了。");
  eq("极短回复（短于缓冲）不丢字",
    await run(makeSSE(["好。"]), 1), "好。");
  eq("夹着坏行不崩",
    await run("data: {坏JSON\n\n" + makeSSE(["我很开心。"]), 6), "我很开心。");
  eq("空流给空串", await run("data: [DONE]\n\n", 4), "");

  console.log("\n" + (fail ? `✘ ${fail} 项没过，${pass} 项通过` : `✔ 全过（${pass} 项）`));
  process.exitCode = fail ? 1 : 0;
})();

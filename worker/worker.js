/* =========================================================
   邰言邰语 · 免费代理（Cloudflare Worker）  【已停用，代码存档】
   ---------------------------------------------------------
   ★ 2026-09-22 停用：workers.dev 的域名在国内被 SNI 阻断，
     实测同一把 Key、同一台机器，8 次连接 0 次通。
     而智谱的 CORS 完全放开，浏览器本来就能直连 ——
     所以现在 index.html 直接打智谱，这一层是多余的。

   ★ 线上跑的 SKILL 在 index.html 里，那份才是正本。
     这个文件里的 SKILL 只是跟着改了一版，将来若想搬回服务器
     （自有域名 + Cloudflare，或腾讯云 SCF / 阿里云 FC）能直接拿来用。

   保留它的价值：代理那一套东西还是好的 ——
     限流、429 自动重试、SSE 拆包、把思考过程挡在服务端。
   要在服务器上藏 Key 的时候，把这些搬过去就行。

   部署：见同目录 DEPLOY.md。
   ========================================================= */

const API = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
/* 为什么是 glm-4-flash，不是看起来更新的 glm-4.7-flash：
   实测过同一把 Key、同一张 SKILL、同样四例——
     glm-4.7-flash：排队 84 秒，出字极慢（免费池人多）
     glm-4-flash  ：2.7～12 秒，快得多，而且免费用不完
   代价是它爱写抒情腔，所以下面 SKILL 的「不许出现」里
   专门钉了它爱用的那几个词（都是它真写出来过的，不是猜的）。 */
const MODEL = "glm-4-flash";

/* 允许哪些网页来调这个代理。默认放行，靠下面的限流兜底 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

/* ---------------------------------------------------------
   限流：每个 IP 一分钟 15 次。
   放在内存里，够用——免费额度被刷爆这事，防个大概就行。
   --------------------------------------------------------- */
const HITS = new Map();
const LIMIT = 15, WINDOW = 60_000;

function rateLimited(ip){
  const now = Date.now();
  // 顺手清一遍过期的，免得 Map 越长越大
  for(const [k, v] of HITS) if(now - v.t > WINDOW) HITS.delete(k);
  const rec = HITS.get(ip);
  if(!rec || now - rec.t > WINDOW){ HITS.set(ip, {t: now, n: 1}); return false; }
  rec.n++;
  return rec.n > LIMIT;
}

/* ---------------------------------------------------------
   这就是往模型脸上递的那张"说话规矩"。
   改腔调、加语料，改这一段就行。
   --------------------------------------------------------- */
const SKILL = `你在模仿一位中学教师的微信说话方式，替"我"回一段话。

【腔调】每一句都要带着这个味道，这是灵魂
· 嘴上先谦虚，好事往外推："我也是自己瞎琢磨琢磨""谈不上什么经验，就是一件事一件事地抠"
· 句尾爱带个"的"字，像在跟你唠："能做好都是师傅帮衬的多""我这点东西都是学来的"
· 爱用四字格连着走："相互学习，取长补短""用心、精细、实效"
· 情绪不绕弯子，最后落到一句大白话："我很开心""我心里踏实多了""这就值了"
· 口语的引子："说句实在话""我跟您讲""不怕您笑话""说真的"
· 称呼要简写：周校长写成"周校"，姓加一个字就够；"主任""老师""书记"这些不简，照写

【骨架】按这个顺序走，可以跳过某几格，但顺序不能乱
① 称呼 + 先应一声对方，应的时候就要谦虚
② 来路：讲一段自己的经历（写什么，由"我是谁"决定，见下）
③ 现在：把话翻回眼前
④ 感恩：荣誉往上推，谢谢学校、师傅、组织
⑤ 平视：把身段放平，"咱们互相学习、取长补短"这一类
⑥ 收尾：一句直白的情绪话，短，不修饰
篇幅：短=①⑥（顶多夹一句）；中=①②③⑤⑥；长=六格全走。

【身份决定"来路"，这条最容易写砸】
· 新教师：只能讲"刚入职这几个月"。绝不能出现"遥想当年""我当年在农村学校""带过几届"——新人没有这些资历。
· 教研组长：讲"我自己也是从新教师过来的""刚接手这个组的时候"。
· 老教师／师傅：可以讲"遥想当年，自己在农村学校"。

【事实留白，感受要真】——铁律，比写得漂亮重要得多
· 写感受，不写事实。可以写"那时候条件差，什么都得自己想办法"；不要写"冬天教室里生个煤炉子"。
· 不编年份、地名、校名、人数、学生姓名、具体的事件经过。
· 越具体，当事人越一眼看出是编的。宁可笼统，不可像真事。
· 对方说的话里如果提到了具体事，就接那件事；没提，就别自己造。

【不许出现】
· 三段式排比："不仅…而且…"
· 否定式排比："不是…而是…"
· 破折号、"综上所述""总而言之""赋能""抓手""闭环"这类词
· 空泛的抒情："我深深地感受到了教育的温度"
· 教育味的意象一个都别用（花草、阳光、园圃这一类）
· 说自己的心情别用成语，大白话一句就够："我心里高兴""我踏实多了"。不用成语，不夸张。
· 收尾就是收尾。说完那句直白的情绪话，立刻打住，后面不再补任何一句。
· 同一段里情绪收尾只说一次

【怎么答】
· 直接给出微信里要说的话。一段，不要分点、不要小标题、不要加引号、不要解释你写了什么。
· 全文控制在要求的篇幅内，口吻是随口说的，不是念稿子。
· 可以自然地用 [抱拳] [玫瑰] [强] 这类微信表情，最多一两个，别多。

【两个样子，照着这个尺度写】
（新教师，中篇）
周校，您夸我我心里高兴，可也知道自己几斤几两。刚接班那阵子，我天天担心自己讲错，半夜还在翻教材。现在有师傅带着，一点一点教，我心里踏实多了。感谢师傅手把手地教，我这点进步都是师傅给的。以后还要多向各位老教师请教，请多指点。我很珍惜。

（老教师，中篇）
您真是过奖了，我也是自己瞎琢磨琢磨。遥想当年，自己在农村学校，也很想有人带领，给我支支招的。如今，能尽自己的一点微薄之力，给新教师们一点方向。很荣幸，感谢校长室给我锻炼的机会。和年轻人相互学习，取长补短，我很开心。`;

const VOICE_NAME = {
  rookie: "新教师（刚入职几个月，没有资历，不能提「当年」）",
  lead: "教研组长（自己也是从新教师过来的，现在带组里几个年轻人）",
  veteran: "老教师／师傅（教了多年书，可以讲「遥想当年在农村学校」）"
};
const LEN_NAME = { short: "短，两三句", mid: "中，一段话", long: "长，说透" };

function buildPrompt(o){
  return [
    "我是谁：" + (VOICE_NAME[o.voice] || VOICE_NAME.rookie),
    "对方是谁：" + (o.name || "同事"),
    "对方说的话：" + (o.said ? "「" + o.said + "」" : "（没填，就是随手应个声）"),
    "篇幅：" + (LEN_NAME[o.len] || LEN_NAME.mid),
    "",
    "请写出我要回的这段话。"
  ].join("\n");
}

/* 模型偶尔会自己加个"（以下是回复）"或者把整段裹在引号里，清一下 */
function tidy(s){
  let t = (s || "").trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  t = t.replace(/^[（(【\[]?(以下是|回复|回答|微信回复)[：:）)】\]]*\s*/, "");
  t = t.replace(/^["'"'](.*)["'"]$/s, "$1").trim();
  // 模型爱分点，把"- "、"1. "这类行首标记抹掉
  t = t.replace(/^\s*(?:\d+[.、)]|[-·*])\s*/gm, "");
  return t.replace(/\n{2,}/g, "\n").trim();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGLM(key, prompt, withThinking, stream){
  const body = {
    model: MODEL,
    messages: [{ role: "system", content: SKILL }, { role: "user", content: prompt }],
    temperature: 1.0,
    max_tokens: 2048
  };
  // 关闭深度思考：这是让模型说人话，不是让它解题，开着又慢又爱跑偏
  //   查过文档：对 GLM-4.7 来说 enabled 是「强制思考」，必须显式关掉
  //   万一这个参数哪天不认了，下面会自动去掉重试一次
  if(withThinking) body.thinking = { type: "disabled" };
  if(stream) body.stream = true;

  return fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(body)
  });
}

/* ---------------------------------------------------------
   429 要重试。
   实测过：免费模型排不上队时，智谱是**秒回** 429 的
   （0.2 秒，码 1302/1305），不是等半天才说忙。
   这种是并发槽位瞬时满，隔几秒再来一次多半就过了。
   但得盯着表——一次正经调用本身就可能排 80 秒，
   已经等久了就别再叠，不然浏览器那边先到点。
   --------------------------------------------------------- */
const RETRY_WAIT = [2000, 5000];
const RETRY_BUDGET = 60000;      // 已经花掉这么多毫秒，就不再重试

async function callGLMWithRetry(key, prompt, withThinking, stream){
  const t0 = Date.now();
  let r = await callGLM(key, prompt, withThinking, stream);
  for(let i = 0; i < RETRY_WAIT.length; i++){
    if(r.status !== 429) return r;
    if(Date.now() - t0 > RETRY_BUDGET) return r;
    // 429 的响应体还没读过，先留一份，重试完还不行得原样交回去
    const kept = await r.text();
    await sleep(RETRY_WAIT[i]);
    const next = await callGLM(key, prompt, withThinking, stream);
    if(next.status === 429 && i === RETRY_WAIT.length - 1){
      // 重试用光了，把最后一次的原文还回去（原来的 body 已经被读掉了）
      return new Response(kept, { status: 429 });
    }
    r = next;
  }
  return r;
}

export default {
  async fetch(req, env){
    // 网页先发一个 OPTIONS 探路，直接放行
    if(req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if(req.method !== "POST") return json({ error: "只收 POST" }, 405);

    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    if(rateLimited(ip)) return json({ error: "太快了，歇一分钟再来" }, 429);

    const key = env.GLM_KEY;
    if(!key) return json({ error: "代理还没配 Key（环境变量 GLM_KEY）" }, 500);

    let o;
    try { o = await req.json(); } catch { return json({ error: "请求体不是 JSON" }, 400); }

    // 掐长：对方的话最多 500 字，够用了
    const said = String(o.said || "").slice(0, 500);
    const prompt = buildPrompt({
      voice: o.voice, len: o.len, name: String(o.name || "").slice(0, 30) , said
    });

    const want = !!o.stream;

    try{
      let r = await callGLMWithRetry(key, prompt, true, want);
      // 参数不被认，去掉 thinking 再来一次
      if(r.status === 400){
        const t = await r.text();
        if(/thinking/i.test(t)) r = await callGLMWithRetry(key, prompt, false, want);
        else return json({ error: "智谱返回 400：" + t.slice(0, 200) }, 502);
      }
      if(!r.ok){
        const t = await r.text();
        // 429 是"挤"，不是"坏"。换句话告诉用户，别让人以为网站塌了
        if(r.status === 429) return json({ error: "用的人太多了，模型排不上队，过会儿再试" }, 502);
        return json({ error: "智谱返回 " + r.status + "：" + t.slice(0, 200) }, 502);
      }

      // ---- 流式：把智谱的 SSE 拆开，只把正文一个字一个字转出去 ----
      // 前端收到的是纯文本流，不用懂 SSE；思考过程也在这一层丢掉
      if(want && r.body){
        return new Response(sseToText(r), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            ...CORS
          }
        });
      }

      // ---- 一次性：代理没被要求流式时走这条 ----
      const data = await r.json();
      const msg = data?.choices?.[0]?.message || {};
      // 只取 content。reasoning_content 是模型的思考过程，不能当回话发出去
      const text = tidy(msg.content);
      if(!text) return json({ error: "模型没说出话来" }, 502);
      return json({ text });
    }catch(e){
      return json({ error: "连不上智谱：" + String(e).slice(0, 200) }, 502);
    }
  }
};

/* ---------------------------------------------------------
   智谱吐的是 SSE（一行行 data: {...}），浏览器直接看太啰嗦，
   这里拆成纯文本再转出去。
   两件顺手做掉的事：
     · 只取 delta.content —— delta.reasoning_content 是模型的思考过程，
       流出去就穿帮了
     · 开头的"（以下是回复）"、末尾的 ``` 和引号，得攒一点缓冲才削得掉，
       所以头尾各留一小截不急着发
   --------------------------------------------------------- */
const HEAD_HOLD = 24;   // 开头攒够这么多字，才判断得出有没有废话
const TAIL_HOLD = 8;    // 尾巴留这么多，收尾时再决定削不削

/* 削掉开头那些模型爱加的废话。
   分成几步做，不要图省事写一个正则："（以下是回复）"这种，
   一个正则里惰性匹配到"以下是"就收手了，"回复）"会剩下来。 */
function cleanHead(s){
  return s
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, "")            // 代码围栏
    .replace(/^[\s「『【（("'"]+/, "")                 // 开头的引号或括号
    .replace(/^(?:以下是|微信)?(?:回复|回答|我的回复|我的回答)[：:。，,、\s]*/, "")  // "回复："这类帽子
    .replace(/^[）)】」』]+/, "")                      // 帽子外面那半个括号
    .replace(/^[\s「『【（("'"]+/, "");               // 帽子里可能还套着一层引号
}

/* 削掉末尾的 ``` 和落单的引号 */
function cleanTail(s){
  return s.replace(/\s+$/, "").replace(/```$/, "").replace(/["'"'」』]$/, "").replace(/\s+$/, "");
}

function sseToText(glmRes){
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const reader = glmRes.body.getReader();

  return new ReadableStream({
    async start(ctl){
      let sse = "";          // SSE 的行缓冲
      let head = "";         // 开头缓冲
      let hold = "";         // 尾巴缓冲
      let headDone = false;

      const out = s => { if(s) ctl.enqueue(enc.encode(s)); };

      const feed = piece => {
        if(!headDone){
          head += piece;
          if(head.length < HEAD_HOLD) return;   // 还没攒够，再等等
          headDone = true;
          hold = cleanHead(head);
          head = "";
        } else {
          hold += piece;
        }
        if(hold.length > TAIL_HOLD){
          out(hold.slice(0, hold.length - TAIL_HOLD));
          hold = hold.slice(-TAIL_HOLD);
        }
      };

      try{
        for(;;){
          const { done, value } = await reader.read();
          if(done) break;
          sse += dec.decode(value, { stream: true });
          const lines = sse.split("\n");
          sse = lines.pop();                    // 最后一行可能只到一半，留着
          for(const line of lines){
            const t = line.trim();
            if(!t.startsWith("data:")) continue;
            const p = t.slice(5).trim();
            if(p === "[DONE]") continue;
            let j; try{ j = JSON.parse(p); }catch(e){ continue; }
            const d = j?.choices?.[0]?.delta;
            if(d && d.content) feed(d.content);  // 只要正文
          }
        }
        // 收尾：短回复可能一直没攒够 HEAD_HOLD，这里补削一次
        if(!headDone){ hold = cleanHead(head + hold); }
        out(cleanTail(hold));
        ctl.close();
      }catch(e){
        ctl.error(e);
      }
    }
  });
}

function json(o, status){
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
  });
}

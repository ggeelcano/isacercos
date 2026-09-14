// Mide la demo en móvil de verdad por CDP (desbordes, elementos fuera, errores JS) y simula una conversación completa
// con foto adjunta. Uso: node tools/medir.mjs  → capturas en tools/_cap-*.png y tools/_og.png
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RAIZ = path.resolve(DIR, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 8150, CDP = 9351;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = path.join(RAIZ, p);
  if (!f.startsWith(RAIZ) || !fs.existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(PORT);

async function conectar() {
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--mute-audio", "--no-first-run", "--disable-extensions", "--hide-scrollbars",
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(DIR, "_chromeprofile")}`, "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
  let info = null;
  for (let i = 0; i < 80; i++) { await sleep(250); try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); info = l.find(t => t.type === "page"); if (info) break; } catch {} }
  if (!info) throw new Error("Chrome no arrancó");
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errores = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === "Runtime.exceptionThrown") errores.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errores.push(m.params.entry.text + " " + (m.params.entry.url || "")); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, m => m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, errores, cerrar: () => { try { ws.close(); } catch {} chrome.kill(); } };
}
const ev = async (cdp, expr) => { const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("JS: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
const SONDA = `(() => {
  const de = document.documentElement, cw = de.clientWidth, fuera = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || el.classList.contains('skip') || el.classList.contains('visually-hidden')) continue;
    const r = el.getBoundingClientRect(); if (r.width === 0) continue;
    if (r.right > cw + 1 || r.left < -1) fuera.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().slice(0, 30) + ' ' + Math.round(r.left) + '→' + Math.round(r.right));
    if (fuera.length > 8) break;
  }
  const chat = document.getElementById('chat');
  return { cw, sw: de.scrollWidth, bodySw: document.body.scrollWidth, chatSw: chat.scrollWidth, chatCw: chat.clientWidth, fuera, msgs: document.querySelectorAll('.msg').length, fichas: document.querySelectorAll('.ficha').length, avatarOk: !!document.querySelector('#avatar img') && document.querySelector('#avatar img').naturalWidth > 0 };
})()`;
const foto = async (cdp, w) => { const s = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(DIR, `_cap-${w}.png`), Buffer.from(s.data, "base64")); };
const escribir = async (cdp, t) => { await ev(cdp, `(()=>{const ta=document.getElementById('texto'); ta.value=${JSON.stringify(t)}; document.getElementById('barra').requestSubmit(); return 1})()`); await esperarLibre(cdp); };
const esperarLibre = async cdp => { for (let i = 0; i < 120; i++) { await sleep(300); if (!(await ev(cdp, "!!document.getElementById('typing') || document.getElementById('enviar').disabled"))) return; } };

const cdp = await conectar();
await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Log.enable"); await cdp.send("DOM.enable");
let fallos = 0;
for (const w of [320, 360, 390, 430, 768, 1280]) {
  const h = w < 700 ? 780 : 900;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: w < 700 ? 2 : 1, mobile: w < 700 });
  cdp.errores.length = 0;
  const local = w === 320; // a 320 se prueba el guion local (?local=1); a 390 y 1280 la IA real
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/${local ? "?local=1" : ""}` }); await sleep(1500);
  const a = await ev(cdp, SONDA);
  let b = null;
  if (w === 320 || w === 390 || w === 1280) {
    await escribir(cdp, "hola");
    await escribir(cdp, "me operaron de cáncer de mama y me gustaría hacerme la areola, ¿duele?");
    await escribir(cdp, "La mastectomía fue hace un año y terminé la radioterapia en marzo. Solo el pecho izquierdo");
    // foto adjunta real por CDP
    const doc = await cdp.send("DOM.getDocument", { depth: 1 });
    const inp = await cdp.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#foto" });
    await cdp.send("DOM.setFileInputFiles", { nodeId: inp.nodeId, files: [path.join(DIR, "_foto-prueba.jpg")] });
    await sleep(400); await esperarLibre(cdp);
    await escribir(cdp, "Marta Ferrer");
    await escribir(cdp, "Barcelona");
    await escribir(cdp, "Prefiero presencial");
    await escribir(cdp, "Por las tardes, martes o jueves");
    await sleep(1200);
    b = await ev(cdp, SONDA);
    b.textos = await ev(cdp, "[...document.querySelectorAll('.msg.otro')].map(m=>m.textContent.replace(/\\d\\d:\\d\\d$/,'').trim().slice(0,160))");
    b.ficha = await ev(cdp, "(document.querySelector('.ficha dl')||{}).textContent||''");
  }
  await foto(cdp, w);
  const ok = a.sw <= a.cw && a.bodySw <= a.cw && !a.fuera.length && (!b || (b.sw <= b.cw && !b.fuera.length && b.fichas === 1 && b.chatSw <= b.chatCw)) && !cdp.errores.length && a.avatarOk;
  if (!ok) fallos++;
  console.log(`${String(w).padStart(4)} ${ok ? "OK " : "MAL"} cw=${a.cw} sw=${a.sw} fuera=${a.fuera.length} avatar=${a.avatarOk}${b ? ` | tras conversación${local ? " (guion local)" : " (IA)"}: sw=${b.sw} chatSw=${b.chatSw}/${b.chatCw} msgs=${b.msgs} fichas=${b.fichas} fuera=${b.fuera.length}` : ""} errores=${cdp.errores.length}`);
  if (a.fuera.length || (b && b.fuera.length)) console.log("   fuera:", (a.fuera.length ? a.fuera : b.fuera).slice(0, 5));
  if (cdp.errores.length) console.log("   errores:", cdp.errores.slice(0, 3));
  if (b && (w === 390 || w === 320)) { console.log("   bot dijo:"); b.textos.forEach(t => console.log("     ·", t)); console.log("   ficha:", b.ficha.slice(0, 300)); }
}
// imagen OG
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/tools/og.html` }); await sleep(1200);
const og = await cdp.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(RAIZ, "img", "og.png"), Buffer.from(og.data, "base64"));
console.log("og.png", Math.round(fs.statSync(path.join(RAIZ, "img", "og.png")).size / 1024), "KB");
cdp.cerrar(); server.close();
console.log(fallos ? `${fallos} anchos con fallos` : "todo OK");
process.exit(fallos ? 1 : 0);

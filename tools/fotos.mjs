// Lista las imágenes de la web de Isa (portada + quién soy) y descarga las candidatas a img/_cand/.
import fs from "node:fs";
import path from "node:path";
const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36" };
const paginas = ["https://www.tatuajeparamedico.es/", "https://www.tatuajeparamedico.es/quien-soy/"];
const urls = new Set();
for (const p of paginas) {
  const html = await (await fetch(p, { headers: UA })).text();
  console.log(p, html.length, "bytes");
  for (const m of html.matchAll(/property="og:image" content="([^"]+)"/g)) { console.log("  og:image", m[1]); urls.add(m[1]); }
  for (const m of html.matchAll(/(?:src|data-src|data-lazy-src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/srcset="([^"]+)"/gi)) for (const u of m[1].split(",")) { const s = u.trim().split(/\s+/)[0]; if (/\.(jpe?g|png|webp)/i.test(s)) urls.add(s); }
}
const lista = [...urls].filter(u => !/emoji|\.svg|gravatar|data:image/i.test(u));
console.log("\n" + lista.length + " imágenes:");
lista.forEach(u => console.log(" ", u));
const out = path.join(DIR, "img", "_cand"); fs.mkdirSync(out, { recursive: true });
let n = 0;
for (const u of lista) {
  try {
    const abs = new URL(u, "https://www.tatuajeparamedico.es/").href.replace(/-\d+x\d+(\.\w+)$/, "$1"); // versión sin recorte de WP
    const r = await fetch(abs, { headers: UA }); if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 8000) continue;
    const nombre = String(++n).padStart(2, "0") + "-" + path.basename(new URL(abs).pathname).slice(0, 60);
    fs.writeFileSync(path.join(out, nombre), buf);
    console.log("  ↓", nombre, Math.round(buf.length / 1024) + " KB", abs);
  } catch (e) { console.log("  x", u, e.message); }
}

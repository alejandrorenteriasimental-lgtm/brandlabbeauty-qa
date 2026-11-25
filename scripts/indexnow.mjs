// IndexNow sin webhooks: corre a diario, compara el lastmod de cada URL del sitemap con el último envío (estado.json en caché de Actions)
// y avisa solo de las URL nuevas o con lastmod distinto. Así no se reenvían URL sin cambios ni URL fuera del sitemap.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const BASE = (process.env.SITIO || 'https://brandlabbeauty.org').replace(/\/$/, '');
const KEY = process.env.INDEXNOW_KEY || 'b7e4c2a91f6d4e0b8a3c5d7f9e1b2c4a'; // pública por diseño: está en el sitio
const ESTADO = process.env.ESTADO || 'indexnow-estado.json';

const xml = await (await fetch(BASE + '/sitemap.xml', { signal: AbortSignal.timeout(20000) })).text();
const actual = Object.fromEntries([...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => [(m[1].match(/<loc>([^<]+)/) || [])[1]?.trim(), (m[1].match(/<lastmod>([^<]+)/) || [])[1]?.trim() || '']).filter(([u]) => u?.startsWith(BASE)));
const primera = !existsSync(ESTADO);
const previo = primera ? {} : JSON.parse(readFileSync(ESTADO, 'utf8'));
// Primera ejecución (sin estado): solo lo modificado en los últimos 2 días, para no reenviar todo el sitio.
const urls = Object.entries(actual).filter(([u, m]) => primera ? (m && Date.parse(m) >= Date.now() - 2 * 864e5) : previo[u] !== m).map(([u]) => u);
console.log(`URL en el sitemap: ${Object.keys(actual).length} · con cambios desde el último envío: ${urls.length}${primera ? ' (primera ejecución: ventana de 2 días)' : ''}`);
const k = process.env.KEY_CHECK !== '0' ? (await fetch(`${BASE}/${KEY}.txt`)).status : 200;
if (k !== 200) { console.error(`El archivo de clave ${BASE}/${KEY}.txt responde ${k}`); process.exit(1); }
if (!urls.length) { writeFileSync(ESTADO, JSON.stringify(actual)); console.log('Nada que enviar.'); process.exit(0); }
if (process.env.DRY) { console.log('Prueba (DRY): se enviarían\n' + urls.join('\n')); process.exit(0); }
const r = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(BASE).host, key: KEY, keyLocation: `${BASE}/${KEY}.txt`, urlList: urls })
});
console.log(`IndexNow: HTTP ${r.status} para ${urls.length} URL\n` + urls.map(u => ' - ' + u).join('\n'));
if (r.status === 200 || r.status === 202) { writeFileSync(ESTADO, JSON.stringify(actual)); process.exit(0); }
process.exit(1); // sin guardar estado: se reintenta en la siguiente ejecución

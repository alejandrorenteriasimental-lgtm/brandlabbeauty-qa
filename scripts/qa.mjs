// Control de calidad de brandlabbeauty.org (GitHub Actions, Node 20+). Sin dependencias.
// Errores (rompen el job y generan alerta): HTTP ≠ 200, canonical distinto, noindex, sin título, enlace interno roto, redirección rota.
// Avisos (van al informe): meta descripción, WhatsApp sin origen, medición, lastmod ≠ dateModified, texto corto (posible soft 404), títulos repetidos, vigencias CONOCER.
import { writeFileSync, appendFileSync } from 'node:fs';

const BASE = (process.env.SITIO || 'https://brandlabbeauty.org').replace(/\/$/, '');
const EXTRA = (process.env.QA_URL_EXTRA || '').split(',').map(s => s.trim()).filter(Boolean); // prueba controlada de errores
const UA = 'BrandLabQA/1.1 (+https://brandlabbeauty.org)';
const VIGENCIAS = [{ que: 'Estándares de la ECE657-25 (registro CONOCER)', vence: '2027-07-01' }];

const get = async (url, intentos = 2) => {
  for (let i = 0; i <= intentos; i++) {
    try {
      const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
      return { status: r.status, location: r.headers.get('location'), headers: r.headers, text: r.status === 200 ? await r.text() : '' };
    } catch (e) { if (i === intentos) throw e; await new Promise(s => setTimeout(s, 2000 * (i + 1))); }
  }
};
const attr = (h, re) => (h.match(re) || [])[1] || '';
const texto = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>|<nav[\s\S]*?<\/nav>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const errores = [], avisos = [], filas = [];
const sm = await get(BASE + '/sitemap.xml');
if (sm.status !== 200) { writeFileSync('informe-qa.md', `# QA\n\nSitemap no disponible: HTTP ${sm.status}\n`); process.exit(1); }
const entradas = [...sm.text.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => ({ loc: attr(m[1], /<loc>([^<]+)/).trim(), lastmod: attr(m[1], /<lastmod>([^<]+)/).trim() }));
for (const p of EXTRA) entradas.push({ loc: BASE + (p.startsWith('/') ? p : '/' + p), lastmod: '', prueba: true });

const enlaces = new Map(), titulos = new Map();
for (const { loc: u, lastmod, prueba } of entradas) {
  const path = u.replace(BASE, '') || '/';
  let r;
  try { r = await get(u); } catch (e) { errores.push(`${path}: no responde (${e.message})`); continue; }
  if (r.status !== 200) { errores.push(`${path}: HTTP ${r.status}${r.location ? ' → ' + r.location : ''}${prueba ? ' (prueba controlada)' : ''}`); filas.push([path, r.status, '—', '—', '—']); continue; }
  const h = r.text;
  const canon = attr(h, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i);
  const robots = attr(h, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i) + ' ' + (r.headers.get('x-robots-tag') || '');
  const titulo = attr(h, /<title>([^<]*)<\/title>/i).trim();
  const desc = attr(h, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i);
  const mod = attr(h, /"dateModified"\s*:\s*"([^"]+)"/);
  const palabras = texto(h).split(' ').length;
  if (canon !== u) errores.push(`${path}: canonical «${canon || 'ausente'}» distinto de la URL`);
  if (/noindex/i.test(robots)) errores.push(`${path}: tiene noindex`);
  if (!titulo) errores.push(`${path}: sin <title>`);
  if (!desc) avisos.push(`${path}: sin meta descripción`);
  if (palabras < 150) avisos.push(`${path}: solo ${palabras} palabras de contenido principal (posible soft 404)`);
  if (mod && lastmod && mod.slice(0, 10) !== lastmod.slice(0, 10)) avisos.push(`${path}: lastmod del sitemap (${lastmod}) ≠ dateModified de la página (${mod.slice(0, 10)})`);
  if (lastmod && Date.parse(lastmod) > Date.now() + 864e5) avisos.push(`${path}: lastmod en el futuro (${lastmod})`);
  const wa = [...h.matchAll(/href=["'](https:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^"']+)/g)].map(m => m[1].replace(/&amp;/g, '&'));
  if (wa.some(l => !/text=/.test(l))) avisos.push(`${path}: WhatsApp sin mensaje que identifique el origen`);
  const nums = new Set(wa.map(l => (l.match(/(?:wa\.me\/|phone=)(\d+)/) || [])[1]).filter(Boolean));
  for (const n of nums) if (n !== '525535739808') errores.push(`${path}: WhatsApp a un número distinto del oficial (${n})`);
  if (!/medicion\.js/.test(h)) avisos.push(`${path}: no carga la medición`);
  titulos.set(titulo, [...(titulos.get(titulo) || []), path]);
  for (const m of h.matchAll(/href=["'](\/[^"'#?]*)/g)) if (!/\.(css|js|png|jpg|svg|ico|webp|woff2?|txt|xml|pdf)$/.test(m[1])) enlaces.set(m[1], path);
  filas.push([path, 200, palabras, canon === u ? 'ok' : 'revisar', lastmod || '—']);
}
for (const [t, ps] of titulos) if (t && ps.length > 1) avisos.push(`Título repetido en ${ps.join(', ')}`);

// Enlaces internos (cada destino una sola vez)
const vistas = new Set(entradas.map(e => e.loc.replace(BASE, '') || '/'));
for (const [destino, origen] of enlaces) {
  if (vistas.has(destino)) continue;
  try {
    const r = await get(BASE + destino, 1);
    if (r.status >= 400) errores.push(`Enlace roto ${destino} (HTTP ${r.status}), enlazado desde ${origen}`);
    else if ([301, 302, 307, 308].includes(r.status)) avisos.push(`Enlace interno ${destino} redirige a ${r.location} (desde ${origen}): conviene enlazar directo`);
  } catch (e) { avisos.push(`No se pudo probar ${destino}: ${e.message}`); }
}

// Redirecciones que deben seguir activas
if (BASE === 'https://brandlabbeauty.org') for (const desde of ['http://brandlabbeauty.org/', 'https://www.brandlabbeauty.org/', 'https://brandlabbeauty.netlify.app/']) {
  try { const r = await get(desde); if (![301, 308].includes(r.status) || !String(r.location).startsWith(BASE)) errores.push(`Redirección ${desde}: HTTP ${r.status} → ${r.location}`); }
  catch (e) { avisos.push(`No se pudo probar ${desde}: ${e.message}`); }
}

// Vigencias
for (const v of VIGENCIAS) { const d = Math.round((Date.parse(v.vence) - Date.now()) / 864e5); if (d < 120) (d < 30 ? errores : avisos).push(`${v.que}: vence en ${d} días (${v.vence})`); }

const fecha = new Date().toISOString().slice(0, 10);
const md = [`# Control de calidad · ${fecha}`, '', `Sitio: ${BASE} · URL revisadas: ${filas.length} · enlaces internos: ${enlaces.size} · errores: ${errores.length} · avisos: ${avisos.length}`, '',
  '## Errores', ...(errores.length ? errores.map(e => '- ' + e) : ['- Ninguno']), '', '## Avisos', ...(avisos.length ? avisos.map(e => '- ' + e) : ['- Ninguno']), '',
  '| URL | HTTP | Palabras | Canonical | lastmod |', '|---|---|---|---|---|', ...filas.map(f => `| ${f.join(' | ')} |`), ''].join('\n');
writeFileSync('informe-qa.md', md);
writeFileSync('qa.json', JSON.stringify({ fecha, errores, avisos, filas }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);
process.exit(errores.length ? 1 : 0);

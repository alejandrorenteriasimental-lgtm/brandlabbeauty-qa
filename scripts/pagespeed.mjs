// PageSpeed Insights (API pública v5). Los fallos de la API (cuota, 5xx, tiempo) son AVISOS, no errores del sitio.
// Un rendimiento móvil < 70 en una página sí cuenta como error. Clave opcional: secreto PSI_KEY (nunca se imprime).
import { appendFileSync, writeFileSync } from 'node:fs';
const BASE = (process.env.SITIO || 'https://brandlabbeauty.org').replace(/\/$/, '');
// Sin clave, la cuota anónima de Google casi siempre responde 429: se prueban solo 3 páginas, un intento cada una, para no gastar minutos.
const PAGINAS = process.env.PSI_KEY ? ['/', '/consultoria', '/marketing', '/herramientas', '/calculadora-precio-servicio', '/guias'] : ['/', '/consultoria', '/herramientas'];
const INTENTOS = process.env.PSI_KEY ? 3 : 1;
const key = process.env.PSI_KEY ? '&key=' + encodeURIComponent(process.env.PSI_KEY) : '';
const filas = ['', '## PageSpeed (móvil, laboratorio)', '', '| Página | Rendimiento | Accesibilidad | SEO | LCP | CLS |', '|---|---|---|---|---|---|'];
const errores = [], avisos = [];
const pedir = async url => {
  for (let i = 0; i < INTENTOS; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (r.status === 200) return await r.json();
      if ((r.status === 429 || r.status >= 500) && i < INTENTOS - 1) { await new Promise(s => setTimeout(s, 15000 * (i + 1))); continue; }
      throw new Error('HTTP ' + r.status);
    } catch (e) { if (i === INTENTOS - 1) throw e; }
  }
  throw new Error('cuota o servicio no disponible');
};
for (const p of PAGINAS) {
  try {
    const j = await pedir(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(BASE + p)}&strategy=mobile&category=performance&category=accessibility&category=seo${key}`);
    const c = j.lighthouseResult?.categories || {}, a = j.lighthouseResult?.audits || {};
    const s = k => (c[k]?.score == null ? '—' : Math.round(c[k].score * 100));
    if (typeof s('performance') === 'number' && s('performance') < 70) errores.push(`${p}: rendimiento móvil ${s('performance')}`);
    else if (typeof s('performance') === 'number' && s('performance') < 90) avisos.push(`${p}: rendimiento móvil ${s('performance')}`);
    filas.push(`| ${p} | ${s('performance')} | ${s('accessibility')} | ${s('seo')} | ${a['largest-contentful-paint']?.displayValue || '—'} | ${a['cumulative-layout-shift']?.displayValue || '—'} |`);
  } catch (e) { avisos.push(`PageSpeed no respondió para ${p}: ${e.message}`); filas.push(`| ${p} | sin dato | | | | |`); }
  await new Promise(s => setTimeout(s, 3000));
}
filas.push('', '**Errores:** ' + (errores.join('; ') || 'ninguno'), '', '**Avisos:** ' + (avisos.join('; ') || 'ninguno'), '');
appendFileSync('informe-qa.md', filas.join('\n'));
writeFileSync('psi.json', JSON.stringify({ errores, avisos }));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, filas.join('\n'));
console.log(filas.join('\n'));
process.exit(errores.length ? 1 : 0);

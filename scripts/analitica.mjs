// Recolección semanal con APIs oficiales y gratuitas. Sin dependencias.
// Secretos (los das de alta tú en GitHub; nunca se imprimen):
//   GOOGLE_SA_JSON  → cuenta de servicio con acceso «Restringido» en Search Console y «Lector» en GA4
//   GA4_PROPERTY_ID → id numérico de la propiedad GA4
//   BING_API_KEY    → clave de API de Bing Webmaster Tools
// Si falta un secreto, esa sección queda como «bloqueada» y el job NO falla.
// No usa la Indexing API de Google (solo es para JobPosting/BroadcastEvent; este sitio no es elegible).
import { createSign } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';

const SITIO = 'https://brandlabbeauty.org/';
const PROP_GSC = process.env.GSC_PROPERTY || 'sc-domain:brandlabbeauty.org';
const out = ['', '# Analítica semanal · ' + new Date().toISOString().slice(0, 10), ''];
const datos = {}; const errores = [];
const dia = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const tabla = (cab, filas) => ['| ' + cab.join(' | ') + ' |', '|' + cab.map(() => '---').join('|') + '|', ...filas.map(f => '| ' + f.join(' | ') + ' |')].join('\n');

async function tokenGoogle(scopes) {
  const sa = JSON.parse(process.env.GOOGLE_SA_JSON);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const sin = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: scopes.join(' '), aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const firma = createSign('RSA-SHA256').update(sin).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: sin + '.' + firma }) });
  const j = await r.json(); if (!j.access_token) throw new Error('No se obtuvo token de Google: ' + (j.error_description || j.error)); return j.access_token;
}
const gpost = async (tok, url, body) => { const r = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(`${r.status} ${j.error?.message || ''}`); return j; };

// ---------- Search Console: rendimiento + inspección ----------
if (process.env.GOOGLE_SA_JSON) {
  try {
    const tok = await tokenGoogle(['https://www.googleapis.com/auth/webmasters.readonly']);
    const api = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROP_GSC)}/searchAnalytics/query`;
    const tot = await gpost(tok, api, { startDate: dia(30), endDate: dia(3), dataState: 'final' });
    const t = tot.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const q = await gpost(tok, api, { startDate: dia(30), endDate: dia(3), dimensions: ['query'], rowLimit: 25 });
    const p = await gpost(tok, api, { startDate: dia(30), endDate: dia(3), dimensions: ['page'], rowLimit: 50 });
    datos.gsc = { clics: t.clicks, impresiones: t.impressions, posicion: t.position, consultas: q.rows || [], paginas: p.rows || [] };
    out.push('## Search Console (últimos 28 días con datos finales)', '', `Clics: **${t.clicks}** · impresiones: **${t.impressions}** · CTR: ${(t.ctr * 100).toFixed(1)} % · posición media: ${t.position?.toFixed?.(1) ?? '—'}`, '',
      '### Consultas', tabla(['Consulta', 'Clics', 'Impresiones', 'Posición'], (q.rows || []).map(r => [r.keys[0], r.clicks, r.impressions, r.position.toFixed(1)])), '');
    // Inspección: todas las URL del sitemap (cuota 2,000/día; el sitio tiene < 60)
    const xml = await (await fetch(SITIO + 'sitemap.xml')).text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
    const filas = []; let indexadas = 0;
    for (const u of urls) {
      try {
        const j = await gpost(tok, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { inspectionUrl: u, siteUrl: PROP_GSC, languageCode: 'es-MX' });
        const s = j.inspectionResult?.indexStatusResult || {};
        if (s.verdict === 'PASS') indexadas++;
        filas.push([u.replace(SITIO, '/'), s.coverageState || '—', (s.lastCrawlTime || '—').slice(0, 10), s.googleCanonical && s.googleCanonical !== u ? 'Google elige: ' + s.googleCanonical : 'ok', s.pageFetchState || '—']);
      } catch (e) { filas.push([u.replace(SITIO, '/'), 'error: ' + e.message, '', '', '']); }
    }
    datos.indexacion = { indexadas, total: urls.length, filas };
    out.push(`## Indexación en Google (URL Inspection API): ${indexadas} de ${urls.length}`, '', tabla(['URL', 'Estado', 'Último rastreo', 'Canonical', 'Obtención'], filas), '');
  } catch (e) { errores.push('Search Console: ' + e.message); out.push('## Search Console', '', 'Error: ' + e.message, ''); }
} else out.push('## Search Console', '', 'Bloqueado: falta el secreto GOOGLE_SA_JSON.', '');

// ---------- GA4 Data API ----------
if (process.env.GOOGLE_SA_JSON && process.env.GA4_PROPERTY_ID) {
  try {
    const tok = await tokenGoogle(['https://www.googleapis.com/auth/analytics.readonly']);
    const run = body => gpost(tok, `https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`, { dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], ...body });
    const canal = await run({ dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }] });
    const ia = await run({ dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }], dimensionFilter: { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: 'chatgpt|openai|perplexity|gemini|bard|copilot|claude|anthropic|you\\.com|phind' } } } });
    const ev = await run({ dimensions: [{ name: 'eventName' }, { name: 'pagePath' }], metrics: [{ name: 'eventCount' }], dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: ['clic_whatsapp', 'formulario_whatsapp_preparado', 'herramienta_uso', 'descarga_herramienta', 'clic_estandar'] } } }, limit: 200 });
    const v = r => (r.rows || []).map(x => [...x.dimensionValues.map(d => d.value), ...x.metricValues.map(m => m.value)]);
    datos.ga4 = { canales: v(canal), ia: v(ia), eventos: v(ev) };
    out.push('## GA4 (últimos 28 días)', '', '### Sesiones por canal', tabla(['Canal', 'Sesiones', 'Con interacción'], v(canal)), '',
      '### Tráfico desde asistentes de IA (por fuente de la sesión)', v(ia).length ? tabla(['Fuente', 'Sesiones'], v(ia)) : 'Sin sesiones registradas desde asistentes de IA.', '',
      '### Eventos por página', 'Interacción: herramienta_uso, descarga_herramienta, clic_estandar. Señal de prospecto: clic_whatsapp, formulario_whatsapp_preparado. Ninguno es una venta.', '', tabla(['Evento', 'Página', 'Veces'], v(ev)), '');
  } catch (e) { errores.push('GA4: ' + e.message); out.push('## GA4', '', 'Error: ' + e.message, ''); }
} else out.push('## GA4', '', 'Bloqueado: faltan los secretos GOOGLE_SA_JSON y/o GA4_PROPERTY_ID.', '');

// ---------- Bing Webmaster Tools ----------
if (process.env.BING_API_KEY) {
  try {
    const b = async m => { const r = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/${m}?siteUrl=${encodeURIComponent(SITIO)}&apikey=${process.env.BING_API_KEY}`); if (!r.ok) throw new Error(m + ' HTTP ' + r.status); return (await r.json()).d; };
    const q = await b('GetQueryStats'); const c = await b('GetCrawlIssues'); const l = await b('GetLinkCounts').catch(() => null);
    datos.bing = { consultas: q, rastreo: c, enlaces: l };
    out.push('## Bing Webmaster Tools', '', `Consultas con datos: ${q?.length || 0} · problemas de rastreo: ${c?.length || 0} · páginas con enlaces externos: ${l?.Links?.length ?? '—'}`, '',
      tabla(['Consulta', 'Clics', 'Impresiones', 'Posición'], (q || []).slice(0, 20).map(r => [r.Query, r.Clicks, r.Impressions, r.AvgImpressionPosition])), '');
  } catch (e) { errores.push('Bing: ' + e.message); out.push('## Bing', '', 'Error: ' + e.message, ''); }
} else out.push('## Bing Webmaster Tools', '', 'Bloqueado: falta el secreto BING_API_KEY.', '');

writeFileSync('analitica.md', out.join('\n')); writeFileSync('analitica.json', JSON.stringify({ fecha: dia(0), ...datos, errores }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n'));
console.log(out.join('\n'));
process.exit(errores.length ? 1 : 0);

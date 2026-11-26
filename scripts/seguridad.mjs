// Control semanal de seguridad del repositorio público (solo información pública).
// Busca credenciales, datos personales, permisos innecesarios, acciones sin fijar e información sensible en artefactos.
// Sin dependencias. Falla (exit 1) si encuentra algo; el job de alerta abre o actualiza un issue.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
const REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GH_TOKEN;
const WA_OFICIAL = '5535739808';
const CORREOS_OK = /(noreply|no-reply|users\.noreply\.github\.com|info@brandlabbeauty\.org|example\.(com|org))$/i;
const PATRONES = [
  ['Clave de Google', /AIza[0-9A-Za-z_-]{35}/g], ['Token de GitHub', /\b(ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b|github_pat_[0-9A-Za-z_]{40,}/g],
  ['Clave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:\s*"-----/g], ['Clave de AWS', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Token de Slack', /\bxox[abprs]-[0-9A-Za-z-]{10,}/g], ['Clave tipo sk-', /\bsk-[A-Za-z0-9]{32,}/g],
];
const hallazgos = [];
const revisar = (origen, texto) => {
  for (const [n, re] of PATRONES) if (re.test(texto)) hallazgos.push(`${origen}: ${n}`);
  for (const c of texto.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
    if (!CORREOS_OK.test(c) && !/@v\d|@[0-9a-f]{40}/.test(c)) hallazgos.push(`${origen}: correo ${c.replace(/^(.).*@/, '$1…@')}`);
  for (const t of texto.match(/(?<![\d])(?:\+?52\s?1?\s?)?(?:\d[\s-]?){10}(?![\d])/g) || []) {
    const d = t.replace(/\D/g, '').slice(-10);
    if (/^(55|56|33|81)\d{8}$/.test(d) && d !== WA_OFICIAL) hallazgos.push(`${origen}: teléfono que no es el oficial (…${d.slice(-4)})`);
  }
};
// 1) Archivos del repositorio
for (const f of execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)) {
  if (f === 'scripts/seguridad.mjs') continue; // contiene los propios patrones
  revisar(f, readFileSync(f, 'utf8'));
}
// 2) Workflows: permisos mínimos, acciones fijadas por SHA, sin disparadores riesgosos
for (const f of execSync('git ls-files .github/workflows', { encoding: 'utf8' }).split('\n').filter(Boolean)) {
  const y = readFileSync(f, 'utf8');
  if (!/^permissions:\s*\{\s*\}/m.test(y)) hallazgos.push(`${f}: falta permissions: {} global`);
  if (/pull_request_target/.test(y)) hallazgos.push(`${f}: usa pull_request_target`);
  if (/permissions:[^\n]*(contents|actions|packages|deployments):\s*write/.test(y)) hallazgos.push(`${f}: permiso de escritura innecesario`);
  for (const u of y.match(/uses:\s*[^\s]+/g) || []) if (!/@[0-9a-f]{40}\b/.test(u)) hallazgos.push(`${f}: acción sin fijar por SHA (${u.replace('uses:', '').trim()})`);
}
// 3) Artefactos recientes (se descargan y se revisan)
let nArt = 0;
if (TOKEN && REPO) {
  const h = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' };
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/artifacts?per_page=10`, { headers: h });
  if (r.ok) {
    for (const a of (await r.json()).artifacts || []) {
      if (a.expired) continue;
      const z = await fetch(a.archive_download_url, { headers: h });
      if (!z.ok) continue;
      const dir = `art-${a.id}`; mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}.zip`, Buffer.from(await z.arrayBuffer()));
      execSync(`unzip -o -q ${dir}.zip -d ${dir}`);
      for (const f of execSync(`find ${dir} -type f`, { encoding: 'utf8' }).split('\n').filter(Boolean)) revisar(`artefacto ${a.name}/${f.split('/').pop()}`, readFileSync(f, 'utf8'));
      if (/analitica/i.test(a.name)) hallazgos.push(`artefacto ${a.name}: hay analítica privada en un artefacto público`);
      nArt++;
    }
  } else hallazgos.push(`No se pudieron listar artefactos (HTTP ${r.status})`);
}
const unicos = [...new Set(hallazgos)];
const informe = ['## Control de seguridad del repositorio', '', `Archivos revisados: ${execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean).length} · artefactos revisados: ${nArt}`, '',
  unicos.length ? '### Hallazgos\n' + unicos.map(x => '- ' + x).join('\n') : 'Sin hallazgos: no hay credenciales, datos personales, permisos de más ni acciones sin fijar.', ''].join('\n');
writeFileSync('informe-seguridad.md', informe);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, informe);
console.log(informe);
process.exit(unicos.length ? 1 : 0);

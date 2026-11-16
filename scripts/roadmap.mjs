#!/usr/bin/env node
/**
 * Actualiza el estado de las tareas en ROADMAP.html.
 *
 * El estado vive dentro del propio fichero (quinto argumento de cada `T(...)`),
 * no en el navegador, para que el progreso se vea al abrirlo en cualquier sitio
 * y quede registrado en el repositorio.
 *
 * Uso:
 *   node scripts/roadmap.mjs done   "Título exacto de la tarea" ["Otro título"…]
 *   node scripts/roadmap.mjs doing  "Título exacto de la tarea"
 *   node scripts/roadmap.mjs todo   "Título exacto de la tarea"
 *   node scripts/roadmap.mjs status              → resumen del progreso
 *   node scripts/roadmap.mjs list [texto]        → busca tareas por texto
 */
import fs from 'node:fs';
import path from 'node:path';

const RUTA = path.resolve(import.meta.dirname, '..', 'ROADMAP.html');
const ESTADOS = { todo: 0, doing: 1, done: 2 };
const ETIQUETA = ['pendiente', 'en curso', 'hecha'];

const [, , comando, ...args] = process.argv;

function leer() {
  return fs.readFileSync(RUTA, 'utf8');
}

/** Extrae las fases evaluando el literal de datos del HTML. */
function fases(html) {
  const bloque = html.match(/const PHASES = \[([\s\S]*?)\n\];/);
  if (!bloque) throw new Error('No se ha encontrado el bloque PHASES en ROADMAP.html');
  const T = (t, d, e, tags, s) => ({ t, d, e, tags, s: s || 0 });
  // eslint-disable-next-line no-eval
  return eval('[' + bloque[1] + ']');
}

function resumen() {
  const html = leer();
  const PHASES = fases(html);
  let hechas = 0;
  let curso = 0;
  let total = 0;
  let diasRestantes = 0;

  for (const [i, p] of PHASES.entries()) {
    const d = p.tasks.filter((t) => t.s === 2).length;
    const c = p.tasks.filter((t) => t.s === 1).length;
    hechas += d;
    curso += c;
    total += p.tasks.length;
    diasRestantes += p.tasks.filter((t) => t.s !== 2).reduce((a, t) => a + t.e, 0);

    const pct = Math.round((d / p.tasks.length) * 100);
    const barra = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░');
    const marca = pct === 100 ? '✓' : c > 0 ? '·' : ' ';
    console.log(
      `${marca} ${String(i).padStart(2)} ${barra} ${String(pct).padStart(3)}%  ${d}/${p.tasks.length}  ${p.title}`,
    );
  }

  const pct = Math.round((hechas / total) * 100);
  console.log(
    `\nGLOBAL: ${hechas}/${total} hechas (${pct}%) · ${curso} en curso · ~${diasRestantes} días/dev restantes`,
  );
}

function buscar(texto = '') {
  const PHASES = fases(leer());
  const q = texto.toLowerCase();
  for (const [i, p] of PHASES.entries()) {
    for (const t of p.tasks) {
      if (!q || t.t.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)) {
        console.log(`[${ETIQUETA[t.s].padEnd(9)}] F${String(i).padStart(2)} · ${t.t}`);
      }
    }
  }
}

function marcar(estado, titulos) {
  if (titulos.length === 0) {
    console.error('Indica al menos un título de tarea.');
    process.exit(1);
  }

  const lineas = leer().split('\n');
  const pendientes = new Set(titulos);
  let cambiadas = 0;

  const salida = lineas.map((linea) => {
    const m = linea.match(/^\s*T\("([^"]+)"/);
    if (!m || !pendientes.has(m[1])) return linea;

    pendientes.delete(m[1]);
    cambiadas++;
    // Sustituye el estado anterior (si lo hubiera) por el nuevo.
    return linea.replace(/\](\s*,\s*\d)?\s*\),\s*$/, `],${estado}),`);
  });

  fs.writeFileSync(RUTA, salida.join('\n'));

  console.log(`${cambiadas} tarea(s) marcadas como "${ETIQUETA[estado]}".`);
  for (const t of pendientes) {
    console.error(`  ⚠ No encontrada: "${t}"`);
  }
  if (pendientes.size > 0) process.exit(1);
}

switch (comando) {
  case 'done':
  case 'doing':
  case 'todo':
    marcar(ESTADOS[comando], args);
    resumen();
    break;
  case 'status':
    resumen();
    break;
  case 'list':
    buscar(args[0]);
    break;
  default:
    console.log(
      'Uso:\n' +
        '  node scripts/roadmap.mjs done "Título de la tarea"\n' +
        '  node scripts/roadmap.mjs doing "Título de la tarea"\n' +
        '  node scripts/roadmap.mjs todo "Título de la tarea"\n' +
        '  node scripts/roadmap.mjs status\n' +
        '  node scripts/roadmap.mjs list [texto]',
    );
    process.exit(comando ? 1 : 0);
}

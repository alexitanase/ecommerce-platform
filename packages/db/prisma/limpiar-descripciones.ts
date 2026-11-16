#!/usr/bin/env node
/**
 * Limpia las descripciones ya guardadas.
 *
 * Se necesita porque el arreglo actúa al ENTRAR: lo que se importó antes sigue
 * como estaba. Y como estaba es visible: la descripción corta se sacaba
 * recortando la larga a 500 caracteres, así que en los listados, en Google y al
 * compartir un enlace se lee «<p>Auriculares con cancelación…» con las etiquetas
 * a la vista y cortadas a mitad.
 *
 * Qué hace con cada traducción:
 *
 *  · La descripción larga se sanea con la MISMA lista de etiquetas permitidas que
 *    usa la API. Es lo que la tienda pinta como HTML, así que dejar ahí un
 *    `<script>` de un vendedor de AliExpress sería ejecutar su código en nuestro
 *    dominio.
 *  · La corta se rehace a texto plano desde la larga, cerrando en frase entera,
 *    pero SOLO si tiene etiquetas. Una descripción corta escrita a mano no se
 *    toca: no hay forma de mejorarla automáticamente y sí de estropearla.
 *
 * Uso:
 *   pnpm --filter @ecom/db limpiar-descripciones                enseña qué cambiaría
 *   pnpm --filter @ecom/db limpiar-descripciones -- --aplicar   lo aplica
 *
 * En producción, con la imagen del migrador —que es la que lleva este fichero—:
 *   docker compose -f docker-compose.prod.yml run --rm --no-deps \
 *     --entrypoint sh migrador -c 'node_modules/.bin/tsx prisma/limpiar-descripciones.ts --aplicar'
 */

import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import sanitizeHtml from 'sanitize-html';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

// Igual que la semilla: importación dinámica del cliente generado, que solo
// existe después de `prisma generate`.
const { createPrismaClient } = await import('../src/index.js');

const APLICAR = process.argv.includes('--aplicar');

// Mismas reglas que `apps/api/src/common/contenido/html-descripcion.ts`. Están
// duplicadas a propósito: este script se ejecuta suelto, sin arrancar Nest.
const PERMITIDO = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'h2',
    'h3',
    'h4',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'small',
    'sup',
    'sub',
    'ul',
    'ol',
    'li',
    'blockquote',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
    'img',
    'span',
    'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer' }),
  },
};

const sanear = (html) => {
  if (!html) return null;
  const limpio = sanitizeHtml(html, PERMITIDO).trim();
  return limpio === '' ? null : limpio;
};

const aTextoPlano = (html) => {
  if (!html) return null;
  const separado = html.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|td|th)\s*>|<br\s*\/?>/gi, ' ');
  const texto = sanitizeHtml(separado, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  })
    .replace(/\s+/g, ' ')
    .trim();
  return texto === '' ? null : texto;
};

const resumen = (html, limite = 300) => {
  const texto = aTextoPlano(html);
  if (!texto) return null;
  if (texto.length <= limite) return texto;
  const recortado = texto.slice(0, limite);
  const punto = recortado.lastIndexOf('. ');
  if (punto > limite * 0.5) return recortado.slice(0, punto + 1);
  const espacio = recortado.lastIndexOf(' ');
  return `${espacio > 0 ? recortado.slice(0, espacio) : recortado}…`;
};

const prisma = createPrismaClient();

try {
  const traducciones = await prisma.productTranslation.findMany({
    select: { id: true, locale: true, slug: true, shortDescription: true, description: true },
  });

  let cambiadas = 0;
  let cortasRehechas = 0;
  let peligrosas = 0;

  for (const t of traducciones) {
    const largaLimpia = sanear(t.description);
    // Solo se rehace la corta si tiene etiquetas: una escrita a mano se respeta.
    const cortaTieneHtml = Boolean(t.shortDescription && /<[a-z/]/i.test(t.shortDescription));
    const cortaNueva = cortaTieneHtml
      ? (resumen(t.description) ?? aTextoPlano(t.shortDescription))
      : null;

    const cambiaLarga = largaLimpia !== t.description;
    const cambiaCorta = cortaTieneHtml && cortaNueva !== t.shortDescription;
    if (!cambiaLarga && !cambiaCorta) continue;

    // Lo que se estaba pintando como HTML y no debía: se cuenta aparte porque es
    // lo único de esta limpieza que no es cosmética.
    if (t.description && /<\s*(script|style|iframe|on\w+\s*=)/i.test(t.description)) peligrosas++;

    cambiadas++;
    if (cambiaCorta) cortasRehechas++;

    console.log(`${APLICAR ? '·' : '~'} ${t.slug} [${t.locale}]`);
    if (cambiaCorta) {
      console.log(`    corta: ${JSON.stringify((t.shortDescription ?? '').slice(0, 70))}`);
      console.log(`        →  ${JSON.stringify((cortaNueva ?? '').slice(0, 70))}`);
    }
    if (cambiaLarga) {
      console.log(
        `    larga: ${(t.description ?? '').length} → ${(largaLimpia ?? '').length} caracteres`,
      );
    }

    if (APLICAR) {
      await prisma.productTranslation.update({
        where: { id: t.id },
        data: {
          ...(cambiaLarga ? { description: largaLimpia } : {}),
          ...(cambiaCorta ? { shortDescription: cortaNueva } : {}),
        },
      });
    }
  }

  console.log(
    `\n${traducciones.length} traducciones revisadas · ${cambiadas} a cambiar · ` +
      `${cortasRehechas} descripciones cortas rehechas · ${peligrosas} con etiquetas ejecutables`,
  );
  if (!APLICAR && cambiadas > 0) console.log('Nada escrito. Repite con --aplicar.');
} finally {
  await prisma.$disconnect();
}

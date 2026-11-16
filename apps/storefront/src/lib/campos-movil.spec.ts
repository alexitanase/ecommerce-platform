import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Los campos de formulario, a 16 px en el móvil.
 *
 * Safari en iOS amplía la página automáticamente al enfocar un `input`, un
 * `select` o un `textarea` cuya letra mida MENOS de 16 px. El usuario toca el
 * buscador, la tienda pega un salto y se queda ampliada; para volver hay que
 * pellizcar. En el checkout, con cinco campos seguidos, es un salto por campo.
 *
 * No se ve en el escritorio ni en las herramientas del navegador: solo pasa en
 * un iPhone de verdad, así que reaparece en cuanto alguien escribe `text-sm` en
 * un campo nuevo sin saber esto. De ahí esta comprobación, que lee el código
 * fuente igual que lo hace la del service worker.
 *
 * La solución fácil —`maximum-scale=1, user-scalable=no` en el viewport— está
 * descartada a propósito: desactiva el pellizco en toda la tienda, que es lo
 * que prohíbe el criterio 1.4.4 de la WCAG y deja sin ampliar a quien ve poco.
 */

const RAIZ = join(import.meta.dirname, '..');

/** Tamaños de Tailwind por debajo de los 16 px que exige iOS. */
const PEQUEÑOS = ['text-xs', 'text-sm'];

/** Los que no abren teclado y por tanto no disparan el zoom. */
const SIN_TECLADO = ['checkbox', 'radio', 'hidden', 'range', 'color', 'file', 'submit', 'button'];

function ficheros(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = join(directorio, nombre);
    if (statSync(ruta).isDirectory()) return ficheros(ruta);
    return ruta.endsWith('.tsx') ? [ruta] : [];
  });
}

/**
 * Cada etiqueta de campo del código, entera.
 *
 * Buscar el primer `>` no sirve: `onChange={(e) => ...}` lleva uno dentro y la
 * etiqueta se cortaba antes del `className`, que es justo lo que hay que mirar.
 * Con eso, esta comprobación pasaba sin mirar nada —se probó devolviendo el
 * fallo a propósito y no lo detectó—. Así que se recorre carácter a carácter
 * saltándose las cadenas y lo que va entre llaves, y se para en el `>` de
 * verdad.
 */
function camposDe(codigo: string): string[] {
  const encontrados: string[] = [];
  const apertura = /<(input|select|textarea)[\s>]/g;

  let coincidencia: RegExpExecArray | null;
  while ((coincidencia = apertura.exec(codigo)) !== null) {
    let profundidad = 0;
    let comilla: string | null = null;
    let i = coincidencia.index;

    for (; i < codigo.length; i++) {
      const c = codigo[i] as string;

      if (comilla) {
        if (c === comilla && codigo[i - 1] !== '\\') comilla = null;
        continue;
      }

      if (c === '"' || c === "'" || c === '`') comilla = c;
      else if (c === '{') profundidad++;
      else if (c === '}') profundidad--;
      else if (c === '>' && profundidad === 0) break;
    }

    encontrados.push(codigo.slice(coincidencia.index, i));
  }

  return encontrados;
}

/**
 * Las clases de la etiqueta, y solo eso.
 *
 * Mirar la etiqueta entera daba falsos positivos con los comentarios: uno que
 * explicaba precisamente por qué NO hay que poner `text-sm` contaba como si lo
 * pusiera. Se busca dentro del `className` —entre comillas o entre llaves— y
 * nada más.
 */
function clasesDe(etiqueta: string): string {
  const inicio = etiqueta.indexOf('className');
  if (inicio === -1) return '';

  const resto = etiqueta.slice(inicio);
  const literal = /^className\s*=\s*(["'])([\s\S]*?)\1/.exec(resto);
  if (literal) return literal[2] ?? '';

  // `className={...}`: se toma hasta cerrar la llave, contando las de dentro
  // para no partir una expresión con plantillas o ternarios.
  if (!/^className\s*=\s*\{/.test(resto)) return '';

  let profundidad = 0;
  for (let i = resto.indexOf('{'); i < resto.length; i++) {
    const c = resto[i];
    if (c === '{') profundidad++;
    else if (c === '}') {
      profundidad--;
      if (profundidad === 0) return resto.slice(resto.indexOf('{') + 1, i);
    }
  }

  return resto;
}

/**
 * ¿Lleva una clase de letra pequeña SIN limitarla al escritorio?
 *
 * `text-sm` a secas se aplica también en el móvil y dispara el zoom;
 * `sm:text-sm` solo entra a partir de 640 px, donde iOS ya no amplía nada.
 */
function tieneLetraPequeñaEnMovil(etiqueta: string): boolean {
  const clases = clasesDe(etiqueta);

  return PEQUEÑOS.some((clase) =>
    new RegExp(`(^|[\\s"'\`{])${clase}(?=[\\s"'\`}]|$)`).test(clases),
  );
}

describe('campos de formulario en el móvil', () => {
  it('la clase base no baja de 16 px en el móvil', () => {
    const css = readFileSync(join(RAIZ, 'styles/globals.css'), 'utf8');
    const campo = /\.campo\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(campo).toContain('text-base');
    // El tamaño pequeño solo a partir de `sm`, nunca a secas.
    expect(campo).not.toMatch(/(^|\s)text-sm(?=\s|;|$)/);
  });

  it('ningún campo fija letra pequeña sin acotarla al escritorio', () => {
    const culpables: string[] = [];

    for (const ruta of ficheros(RAIZ)) {
      if (ruta.endsWith('.spec.tsx')) continue;
      const codigo = readFileSync(ruta, 'utf8');

      for (const etiqueta of camposDe(codigo)) {
        const tipo = /type=["']([a-z]+)["']/.exec(etiqueta)?.[1] ?? 'text';
        if (SIN_TECLADO.includes(tipo)) continue;

        if (tieneLetraPequeñaEnMovil(etiqueta)) {
          culpables.push(
            `${ruta.replace(RAIZ, '')}: ${etiqueta.replace(/\s+/g, ' ').slice(0, 90)}`,
          );
        }
      }
    }

    expect(
      culpables,
      `Estos campos harán que iOS amplíe la página al tocarlos. Usa «text-base sm:text-sm»:\n${culpables.join('\n')}`,
    ).toEqual([]);
  });
});

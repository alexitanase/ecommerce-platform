#!/usr/bin/env node
/**
 * Crea las categorías iniciales de la tienda.
 *
 * La semilla de desarrollo no crea ninguna: hasta ahora el árbol de categorías
 * salía vacío tanto en local como en producción, y sin él la tienda no tiene
 * navegación de catálogo —solo el buscador— ni hay dónde colgar lo que se
 * importe del proveedor.
 *
 * Va contra la **API y no contra la base de datos** a propósito. Crear las filas
 * a mano con SQL parece más corto y se salta tres cosas que importan: la ruta
 * materializada (`path`) que usa todo el catálogo para consultar una rama, la
 * herencia de `isAdult`, y el registro de auditoría. Una categoría insertada a
 * pelo funciona hasta que alguien mueve otra y el árbol se descuadra.
 *
 * **Es idempotente**: mira qué handles existen ya y solo crea los que faltan.
 * Se puede ejecutar dos veces seguidas sin duplicar nada, que es justo lo que
 * hace falta cuando la primera pasada se corta a medias.
 *
 * **No escribe salvo que se le pida.** Sin `--aplicar` solo enseña lo que haría.
 *
 * Uso:
 *   node scripts/categorias-iniciales.mjs                 → ensayo, no toca nada
 *   node scripts/categorias-iniciales.mjs --aplicar       → crea las que falten
 *
 * Con qué API habla y con qué credenciales, por variables de entorno:
 *   API             dirección de la API   (por defecto http://localhost:3001)
 *   ADMIN_TOKEN     token de acceso ya obtenido, si se prefiere
 *   ADMIN_EMAIL     correo y contraseña del panel; se usan para pedir el token
 *   ADMIN_PASSWORD  y no se guardan ni se imprimen en ninguna parte
 *
 * Contra producción:
 *   API=https://api.chispaynoche.com ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *     node scripts/categorias-iniciales.mjs --aplicar
 */

/**
 * Las ocho familias de la tienda.
 *
 * Un solo nivel a propósito: con el catálogo todavía vacío, treinta y nueve
 * subcategorías sin un producto dentro dan peor impresión que ocho llenas, y
 * añadir las subcategorías después es una llamada más — repartir productos que
 * ya están colocados, en cambio, es trabajo manual.
 *
 * El `handle` es la clave técnica y no se traduce: es lo que hace idempotente
 * este script y lo que aparece en la ruta materializada. El slug sí, porque es
 * lo que ve el visitante en la barra de direcciones, y va por idioma.
 *
 * Todas nacen marcadas +18. La puerta de edad de la tienda es global, así que
 * hoy no cambia lo que se ve; se marca igualmente porque es cierto, porque las
 * hijas heredan la marca al crearse, y porque el día que la verificación pase a
 * ser por categoría no habrá que revisar el árbol entero.
 */
const CATEGORIAS = [
  {
    handle: 'vibradores',
    traducciones: {
      es: {
        name: 'Vibradores',
        slug: 'vibradores',
        description:
          'Vibradores para estimulación interna y externa: punto G, balas, conejito y modelos con control desde el móvil.',
      },
      ca: {
        name: 'Vibradors',
        slug: 'vibradors',
        description:
          'Vibradors per a estimulació interna i externa: punt G, bales, conillet i models amb control des del mòbil.',
      },
      en: {
        name: 'Vibrators',
        slug: 'vibrators',
        description:
          'Vibrators for internal and external stimulation: G-spot, bullets, rabbit and app-controlled models.',
      },
    },
  },
  {
    handle: 'succionadores',
    traducciones: {
      es: {
        name: 'Succionadores de clítoris',
        slug: 'succionadores',
        description:
          'Estimuladores por ondas de presión y succión, con y sin vibración. La categoría que más ha crecido del sector.',
      },
      ca: {
        name: 'Succionadors de clítoris',
        slug: 'succionadors',
        description:
          'Estimuladors per ones de pressió i succió, amb i sense vibració. La categoria que més ha crescut del sector.',
      },
      en: {
        name: 'Clitoral suction toys',
        slug: 'clitoral-suction',
        description:
          'Pressure-wave and suction stimulators, with and without vibration. The fastest-growing category in the sector.',
      },
    },
  },
  {
    handle: 'consoladores',
    traducciones: {
      es: {
        name: 'Consoladores',
        slug: 'consoladores',
        description:
          'Consoladores realistas, con ventosa, dobles y arneses. Silicona médica y materiales sin ftalatos.',
      },
      ca: {
        name: 'Consoladors',
        slug: 'consoladors',
        description:
          'Consoladors realistes, amb ventosa, dobles i arnesos. Silicona mèdica i materials sense ftalats.',
      },
      en: {
        name: 'Dildos',
        slug: 'dildos',
        description:
          'Realistic, suction-cup, double-ended dildos and harnesses. Medical-grade silicone, phthalate-free.',
      },
    },
  },
  {
    handle: 'para-ellos',
    traducciones: {
      es: {
        name: 'Para ellos',
        slug: 'para-ellos',
        description:
          'Masturbadores, anillos, fundas y bombas de succión. Todo lo pensado para el placer masculino.',
      },
      ca: {
        name: 'Per a ells',
        slug: 'per-a-ells',
        description:
          'Masturbadors, anells, fundes i bombes de succió. Tot el que està pensat per al plaer masculí.',
      },
      en: {
        name: 'For him',
        slug: 'for-him',
        description:
          'Masturbators, cock rings, sleeves and suction pumps. Everything made for male pleasure.',
      },
    },
  },
  {
    handle: 'anal',
    traducciones: {
      es: {
        name: 'Juguetes anales',
        slug: 'juguetes-anales',
        description:
          'Plugs, bolas y kits de dilatación con base de seguridad. Iniciación y uso avanzado.',
      },
      ca: {
        name: 'Joguines anals',
        slug: 'joguines-anals',
        description:
          'Plugs, boles i kits de dilatació amb base de seguretat. Iniciació i ús avançat.',
      },
      en: {
        name: 'Anal toys',
        slug: 'anal-toys',
        description:
          'Plugs, beads and training kits with a safety base. For beginners and advanced use.',
      },
    },
  },
  {
    handle: 'parejas',
    traducciones: {
      es: {
        name: 'Parejas',
        slug: 'parejas',
        description:
          'Juguetes para usar entre dos: vibradores de pareja, control remoto a distancia y juegos eróticos.',
      },
      ca: {
        name: 'Parelles',
        slug: 'parelles',
        description:
          'Joguines per fer servir entre dos: vibradors de parella, control remot a distància i jocs eròtics.',
      },
      en: {
        name: 'Couples',
        slug: 'couples',
        description:
          'Toys made for two: couples vibrators, long-distance remote control and erotic games.',
      },
    },
  },
  {
    handle: 'bdsm',
    traducciones: {
      es: {
        name: 'BDSM',
        slug: 'bdsm',
        description:
          'Ataduras, antifaces, fustas, mordazas y collares. Material de iniciación y de uso habitual.',
      },
      ca: {
        name: 'BDSM',
        slug: 'bdsm',
        description:
          "Lligams, antifaços, fuets, mordasses i collarets. Material d'iniciació i d'ús habitual.",
      },
      en: {
        name: 'BDSM',
        slug: 'bdsm',
        description:
          'Restraints, blindfolds, crops, gags and collars. Beginner kits and everyday gear.',
      },
    },
  },
  {
    handle: 'lubricantes',
    traducciones: {
      es: {
        name: 'Lubricantes y cosmética',
        slug: 'lubricantes',
        description:
          'Lubricantes de base agua y silicona, geles de efecto, aceites de masaje y limpiadores de juguetes.',
      },
      ca: {
        name: 'Lubricants i cosmètica',
        slug: 'lubricants',
        description:
          "Lubricants de base aigua i silicona, gels d'efecte, olis de massatge i netejadors de joguines.",
      },
      en: {
        name: 'Lubricants & cosmetics',
        slug: 'lubricants',
        description:
          'Water- and silicone-based lubricants, sensation gels, massage oils and toy cleaners.',
      },
    },
  },
];

const API = (process.env['API'] ?? 'http://localhost:3001').replace(/\/+$/, '');
const APLICAR = process.argv.includes('--aplicar');

const color = {
  gris: (s) => `[90m${s}[0m`,
  verde: (s) => `[32m${s}[0m`,
  rojo: (s) => `[31m${s}[0m`,
  amarillo: (s) => `[33m${s}[0m`,
  negrita: (s) => `[1m${s}[0m`,
};

async function pedir(ruta, opciones = {}) {
  const respuesta = await fetch(`${API}/api/v1${ruta}`, {
    ...opciones,
    headers: { 'content-type': 'application/json', ...(opciones.headers ?? {}) },
  });

  const texto = await respuesta.text();
  const cuerpo = texto ? JSON.parse(texto) : null;

  if (!respuesta.ok) {
    const detalle = cuerpo?.message ?? respuesta.statusText;
    throw new Error(`${respuesta.status} en ${ruta}: ${JSON.stringify(detalle)}`);
  }

  return cuerpo;
}

/**
 * El token de acceso.
 *
 * Se acepta un token ya hecho para no obligar a poner la contraseña en la línea
 * de órdenes: queda en el historial del intérprete, que en un portátil
 * compartido es un problema real.
 */
async function token() {
  if (process.env['ADMIN_TOKEN']) return process.env['ADMIN_TOKEN'];

  const email = process.env['ADMIN_EMAIL'];
  const password = process.env['ADMIN_PASSWORD'];

  if (!email || !password) {
    throw new Error(
      'Faltan credenciales. Define ADMIN_TOKEN, o bien ADMIN_EMAIL y ADMIN_PASSWORD.',
    );
  }

  const sesion = await pedir('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!sesion?.accessToken) throw new Error('El login no ha devuelto un token de acceso.');
  return sesion.accessToken;
}

/** Los handles que ya existen, incluidas las categorías desactivadas. */
async function existentes() {
  const arbol = await pedir('/catalog/categories/tree?incluirInactivas=true');
  const handles = new Set();

  const recorrer = (nodos) => {
    for (const n of nodos) {
      handles.add(n.handle);
      recorrer(n.children ?? []);
    }
  };
  recorrer(arbol ?? []);

  return handles;
}

async function principal() {
  console.log(`\n  API      ${color.negrita(API)}`);
  console.log(`  Modo     ${APLICAR ? color.verde('aplicar') : color.amarillo('ensayo')}\n`);

  const yaEstan = await existentes();
  const faltan = CATEGORIAS.filter((c) => !yaEstan.has(c.handle));

  if (yaEstan.size > 0) {
    console.log(color.gris(`  Ya existen ${yaEstan.size} categorías; no se tocan.`));
  }

  if (faltan.length === 0) {
    // «Nada que hacer» lo busca `importar-categorias.sh` para saltarse la
    // confirmación cuando no hay nada que confirmar. Si se reescribe esta
    // frase, hay que cambiarla también allí.
    console.log(color.verde('\n  Nada que hacer: las ocho categorías ya están.\n'));
    return;
  }

  if (!APLICAR) {
    console.log(`  Se crearían ${color.negrita(faltan.length)} categorías:\n`);
    for (const c of faltan) {
      console.log(`    ${c.traducciones.es.name}`);
      console.log(
        color.gris(
          `      handle ${c.handle} · /${c.traducciones.es.slug} · /${c.traducciones.ca.slug} · /${c.traducciones.en.slug}`,
        ),
      );
    }
    console.log(color.amarillo('\n  Ensayo: no se ha escrito nada. Repite con --aplicar.\n'));
    return;
  }

  const acceso = await token();
  let creadas = 0;

  for (const [i, c] of faltan.entries()) {
    const cuerpo = {
      handle: c.handle,
      // La posición fija el orden del menú de la tienda. Se cuenta desde las que
      // ya hubiera, para no encajar las nuevas por delante de ellas.
      position: yaEstan.size + i,
      isAdult: true,
      translations: Object.entries(c.traducciones).map(([locale, t]) => ({ locale, ...t })),
    };

    try {
      await pedir('/catalog/categories', {
        method: 'POST',
        headers: { authorization: `Bearer ${acceso}` },
        body: JSON.stringify(cuerpo),
      });
      creadas++;
      console.log(`  ${color.verde('✓')} ${c.traducciones.es.name}`);
    } catch (error) {
      // Se sigue con las demás: que una falle por un slug ocupado no es motivo
      // para dejar el árbol a medio crear y tener que averiguar por dónde iba.
      console.log(`  ${color.rojo('✗')} ${c.traducciones.es.name} — ${error.message}`);
    }
  }

  console.log(color.verde(`\n  ${creadas} de ${faltan.length} categorías creadas.`));
  console.log(
    color.gris(
      '  El árbol se sirve con diez minutos de caché compartida: en la tienda\n' +
        '  pueden tardar ese rato en salir. En el panel se ven al momento.\n',
    ),
  );
}

principal().catch((error) => {
  console.error(color.rojo(`\n  ${error.message}\n`));
  process.exit(1);
});

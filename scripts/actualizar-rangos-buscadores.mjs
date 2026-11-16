#!/usr/bin/env node
/**
 * Baja al repositorio los rangos de IP desde los que rastrean Google y Bing.
 *
 * La puerta de edad de la tienda deja pasar a los buscadores, y para eso hay que
 * saber que quien dice ser Googlebot lo es. La cadena del user-agent no sirve de
 * prueba: la copia cualquiera en dos segundos y se cuela por la puerta.
 *
 * Los dos publican sus rangos en un JSON firmado por ellos, y **se versionan
 * aquí en lugar de pedirlos en cada visita**. Una petición de red —o un DNS
 * inverso— dentro del middleware se pagaría en CADA página de CADA visitante,
 * incluidos los millones que no son robots, y si el fichero remoto deja de
 * responder la tienda entera se queda esperando.
 *
 * A cambio hay que refrescarlo de vez en cuando: los rangos cambian pocas veces
 * al año y solo se añaden, así que un fichero viejo no rompe nada —a lo sumo
 * deja fuera una máquina nueva del rastreador—. Con pasarlo cada pocos meses
 * basta.
 *
 * Uso:
 *   node scripts/actualizar-rangos-buscadores.mjs
 */

import { writeFileSync } from 'node:fs';

const FUENTES = [
  {
    robot: 'googlebot',
    url: 'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
  },
  /*
   * Los rastreadores especiales de Google, que van por otros rangos.
   *
   * Aquí está `Google-InspectionTool`, que es el que usa «Inspeccionar URL» de
   * Search Console. Sin este fichero, comprobar una página desde el panel de
   * Google seguiría enseñando la puerta de edad: se arregla el rastreo de
   * verdad y la herramienta con la que se verifica sigue diciendo que no.
   */
  {
    robot: 'google-especiales',
    url: 'https://developers.google.com/static/search/apis/ipranges/special-crawlers.json',
  },
  {
    robot: 'bingbot',
    url: 'https://www.bing.com/toolbox/bingbot.json',
  },
];

const DESTINO = 'apps/storefront/src/lib/rangos-buscadores.json';

/**
 * Mínimo de prefijos por debajo del cual no se escribe nada.
 *
 * Si la descarga sale a medias —o Google devuelve una página de error con un
 * 200, que lo hace— el resultado sería un fichero con dos rangos, y entonces la
 * puerta dejaría fuera a casi todo el rastreador sin que nada avisara. Es el
 * mismo criterio que `scripts/cortafuegos-cloudflare.sh`.
 */
const MINIMO_PREFIJOS = 20;

const resultado = {};

for (const { robot, url } of FUENTES) {
  const respuesta = await fetch(url, { redirect: 'follow' });
  if (!respuesta.ok) {
    console.error(`✗ ${robot}: ${String(respuesta.status)} al pedir ${url}`);
    process.exit(1);
  }

  let datos;
  try {
    datos = await respuesta.json();
  } catch {
    console.error(`✗ ${robot}: la respuesta no es JSON. ¿Ha cambiado la dirección?`);
    process.exit(1);
  }

  const prefijos = (datos.prefixes ?? [])
    .map((p) => p.ipv4Prefix ?? p.ipv6Prefix)
    .filter((p) => typeof p === 'string');

  if (prefijos.length < MINIMO_PREFIJOS) {
    console.error(
      `✗ ${robot}: solo ${String(prefijos.length)} prefijos, parecen pocos. No se escribe nada.`,
    );
    process.exit(1);
  }

  resultado[robot] = prefijos.sort();
  console.log(`✓ ${robot}: ${String(prefijos.length)} prefijos`);
}

writeFileSync(DESTINO, JSON.stringify(resultado, null, 2) + '\n');
console.log(`\nEscrito ${DESTINO}`);
console.log('Recuerda: hay que reconstruir la imagen de la tienda para que surta efecto.');

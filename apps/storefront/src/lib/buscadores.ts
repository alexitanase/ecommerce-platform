import rangos from './rangos-buscadores.json';

/**
 * ¿Esta petición viene de verdad de un buscador?
 *
 * La puerta de edad de la tienda deja pasar a Google y a Bing: sin eso, el robot
 * recibe la pantalla de verificación —que va con `noindex, nofollow`— en las diez
 * mil URLs del catálogo, y la tienda entera queda fuera del buscador. Con Google
 * Ads y Meta Ads cerrados a un catálogo +18, la búsqueda orgánica es el canal de
 * descubrimiento que queda.
 *
 * **La comprobación es por IP, no por user-agent.** Esa es la diferencia que
 * importa: la cadena `Googlebot/2.1` la copia cualquiera en dos segundos, y si
 * bastara con enviarla, la puerta habría dejado de existir para todo el que lea
 * este fichero. Los rangos desde los que rastrean los publican ellos mismos, y
 * están versionados en `rangos-buscadores.json`.
 *
 * El user-agent sí se usa, pero solo como filtro barato de primera pasada: casi
 * ninguna visita dice ser un robot, así que casi ninguna llega a pagar la
 * comparación de rangos.
 *
 * Sobre el *cloaking*: se le sirve al robot la misma página que a una persona ya
 * verificada, no una distinta hecha para él. Es la decisión que se tomó a
 * sabiendas —está explicada en `vista-previa.ts`— y no es gratis: las guías de
 * Google prohíben servirle contenido distinto del que ve el visitante, y aquí el
 * visitante sin verificar ve la puerta. Se acepta el riesgo porque la
 * alternativa es no existir en el buscador.
 */

/** Fragmentos de user-agent que declaran ser un buscador, en minúsculas. */
const AGENTES = [
  'googlebot',
  'bingbot',
  // «Inspeccionar URL» de Search Console y el resto de rastreadores especiales.
  'google-inspectiontool',
  'storebot-google',
  'google-safety',
  // Bing también rastrea con este para su índice de compras.
  'adidxbot',
] as const;

interface Direccion {
  familia: 4 | 6;
  valor: bigint;
}

interface Prefijo extends Direccion {
  longitud: number;
}

function parsearIpv4(texto: string): bigint | null {
  const partes = texto.split('.');
  if (partes.length !== 4) return null;

  let valor = 0n;
  for (const parte of partes) {
    if (!/^\d{1,3}$/.test(parte)) return null;
    const octeto = Number(parte);
    if (octeto > 255) return null;
    valor = (valor << 8n) | BigInt(octeto);
  }

  return valor;
}

function parsearIpv6(texto: string): bigint | null {
  // Se descarta la zona (`fe80::1%eth0`): no forma parte de la dirección.
  let cadena = texto.split('%')[0] ?? '';
  let embebida: bigint | null = null;

  /*
   * Forma mixta: `::ffff:192.0.2.1`.
   *
   * No es rara: es exactamente cómo llega una IPv4 cuando el que la reenvía
   * habla IPv6. Sin tratarla, un Googlebot legítimo con IPv4 mapeada quedaría
   * fuera, que es el fallo que no se ve hasta que se mira por qué no indexa.
   */
  if (cadena.includes('.')) {
    const corte = cadena.lastIndexOf(':');
    if (corte === -1) return null;
    embebida = parsearIpv4(cadena.slice(corte + 1));
    if (embebida === null) return null;
    // Los dos últimos grupos los aporta la parte IPv4; se rellenan y se sustituyen.
    cadena = `${cadena.slice(0, corte + 1)}0:0`;
  }

  const mitades = cadena.split('::');
  if (mitades.length > 2) return null;

  const izquierda = mitades[0] ? mitades[0].split(':') : [];
  const derecha = mitades.length === 2 && mitades[1] ? mitades[1].split(':') : [];

  // Sin `::` tienen que estar los ocho grupos; con `::` se rellenan los que falten.
  if (mitades.length === 1 && izquierda.length !== 8) return null;
  if (izquierda.length + derecha.length > 8) return null;

  const grupos = [
    ...izquierda,
    ...(Array(8 - izquierda.length - derecha.length).fill('0') as string[]),
    ...derecha,
  ];

  let valor = 0n;
  for (const grupo of grupos) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(grupo)) return null;
    valor = (valor << 16n) | BigInt(parseInt(grupo, 16));
  }

  if (embebida !== null) {
    // Se limpian los 32 bits bajos y se pone la IPv4 en su sitio.
    valor = (valor & ~0xffffffffn) | embebida;
  }

  return valor;
}

export function parsearDireccion(texto: string): Direccion | null {
  const limpio = texto.trim();
  if (limpio === '') return null;

  if (limpio.includes(':')) {
    const valor = parsearIpv6(limpio);
    return valor === null ? null : { familia: 6, valor };
  }

  const valor = parsearIpv4(limpio);
  return valor === null ? null : { familia: 4, valor };
}

function parsearPrefijo(texto: string): Prefijo | null {
  const [direccion, longitud] = texto.split('/');
  if (direccion === undefined || longitud === undefined) return null;

  const base = parsearDireccion(direccion);
  if (base === null) return null;

  const bits = Number(longitud);
  const anchura = base.familia === 4 ? 32 : 128;
  if (!Number.isInteger(bits) || bits < 0 || bits > anchura) return null;

  return { ...base, longitud: bits };
}

/**
 * Los prefijos ya parseados, una sola vez al cargar el módulo.
 *
 * Son unos seiscientos: parsearlos en cada petición sería tirar el trabajo y
 * volverlo a hacer, y el middleware corre en todas.
 */
const PREFIJOS: Prefijo[] = Object.values(rangos as Record<string, string[]>)
  .flat()
  .map(parsearPrefijo)
  .filter((p): p is Prefijo => p !== null);

function contiene(prefijo: Prefijo, direccion: Direccion): boolean {
  if (prefijo.familia !== direccion.familia) return false;

  const anchura = prefijo.familia === 4 ? 32 : 128;
  const desplazamiento = BigInt(anchura - prefijo.longitud);

  return direccion.valor >> desplazamiento === prefijo.valor >> desplazamiento;
}

/** ¿Rastrea esta IP alguno de los buscadores? */
export function ipDeBuscador(ip: string): boolean {
  const direccion = parsearDireccion(ip);
  if (direccion === null) return false;

  return PREFIJOS.some((prefijo) => contiene(prefijo, direccion));
}

/** ¿Dice este user-agent ser un buscador? Solo es el filtro previo. */
export function agenteDeBuscador(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;

  const ua = userAgent.toLowerCase();
  return AGENTES.some((agente) => ua.includes(agente));
}

/**
 * La IP real de quien pide, detrás de Cloudflare y de Traefik.
 *
 * Se lee de las cabeceras y no del socket porque ahí está la IP de Cloudflare, no
 * la del visitante. Fiarse de una cabecera solo es seguro porque el borde ya la
 * ha validado: Traefik únicamente respeta `X-Forwarded-For` cuando viene de los
 * rangos de Cloudflare —está en `docker-compose.prod.yml`— y el puerto 80 del
 * servidor solo lo puede alcanzar Cloudflare. Sin esas dos cosas, cualquiera
 * podría declararse Googlebot desde la IP que quisiera y la verificación por
 * rangos no valdría nada.
 */
export function ipDelCliente(cabeceras: Headers): string | null {
  const cloudflare = cabeceras.get('cf-connecting-ip');
  if (cloudflare) return cloudflare.trim();

  // El primero de la lista es el cliente; los siguientes son los proxies.
  const reenviada = cabeceras.get('x-forwarded-for');
  if (reenviada) return reenviada.split(',')[0]?.trim() ?? null;

  return null;
}

/**
 * ¿Puede esta petición atravesar la puerta de edad por ser un buscador?
 *
 * Las dos condiciones tienen que cumplirse: decir que eres Googlebot no basta, y
 * venir de un rango de Google sin decirlo tampoco —ahí no hay nada que indexar y
 * no hay motivo para abrir—.
 */
export function esBuscadorVerificado(cabeceras: Headers): boolean {
  if (!agenteDeBuscador(cabeceras.get('user-agent'))) return false;

  const ip = ipDelCliente(cabeceras);
  if (ip === null) return false;

  return ipDeBuscador(ip);
}

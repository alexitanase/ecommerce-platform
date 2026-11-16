/**
 * Canales de captación para un catálogo +18.
 *
 * Google Ads y Meta Ads no admiten producto adulto: no es que sea caro, es que
 * la cuenta se cierra. Y con ellos se va el 80 % de lo que cualquier guía de
 * marketing da por supuesto. Lo que queda son canales que hay que trabajar uno
 * a uno, cada uno con sus reglas, y este módulo existe para que esas reglas
 * estén escritas en lugar de en la cabeza de quien las averiguó.
 *
 * Lo segundo que hace es atribuir: saber qué canal trae las ventas. Sin eso se
 * reparte el esfuerzo por intuición, que en una tienda pequeña significa
 * dedicarle meses al canal que más ruido hace en vez de al que paga.
 */

export type TipoCanal = 'organico' | 'email' | 'social' | 'afiliacion' | 'publicidad' | 'directo';

export interface Canal {
  /** Valor que viaja en `utm_source`. */
  clave: string;
  nombre: string;
  tipo: TipoCanal;
  /**
   * Si acepta catálogo adulto, y con qué condiciones.
   *
   * `limitado` es el caso peligroso: acepta la cuenta pero puede cerrarla sin
   * aviso, así que no se puede depender de él. Se distingue de `no` porque
   * usarlo con cabeza —sin invertir, sin que sea el único— sí tiene sentido.
   */
  admiteAdulto: 'si' | 'limitado' | 'no';
  /** Qué hay que saber antes de invertir tiempo o dinero en él. */
  advertencia?: string;
}

/**
 * Los canales que quedan cuando la publicidad convencional está cerrada.
 *
 * No es una lista de buenas ideas: es lo que de verdad admite este catálogo,
 * con la letra pequeña de cada uno. Las que ponen `no` están aquí a propósito,
 * para que no haya que volver a investigarlo dentro de seis meses.
 */
export const CANALES: Canal[] = [
  {
    clave: 'organico',
    nombre: 'Buscadores (SEO)',
    tipo: 'organico',
    admiteAdulto: 'si',
    advertencia:
      'El canal más rentable a largo plazo y el más lento: los primeros resultados tardan meses. Google indexa producto adulto sin problema; lo que no acepta es pagar por anunciarlo.',
  },
  {
    clave: 'newsletter',
    nombre: 'Newsletter propia',
    tipo: 'email',
    admiteAdulto: 'si',
    advertencia:
      'La lista es tuya y nadie te la puede cerrar, que es justo lo que la hace valiosa aquí. Cuidado con el proveedor de envío: varios prohíben contenido adulto en sus condiciones.',
  },
  {
    clave: 'referidos',
    nombre: 'Referidos de clientes',
    tipo: 'afiliacion',
    admiteAdulto: 'si',
  },
  {
    clave: 'afiliados',
    nombre: 'Afiliados y creadores',
    tipo: 'afiliacion',
    admiteAdulto: 'si',
    advertencia:
      'El canal que mejor funciona en este sector: quien recomienda ya tiene la audiencia y asume él la restricción de plataforma.',
  },
  {
    clave: 'reddit',
    nombre: 'Reddit',
    tipo: 'social',
    admiteAdulto: 'si',
    advertencia:
      'Admite el contenido, pero cada comunidad tiene sus normas sobre promoción y la mayoría expulsa a quien solo publica enlaces propios.',
  },
  {
    clave: 'telegram',
    nombre: 'Telegram',
    tipo: 'social',
    admiteAdulto: 'si',
  },
  {
    clave: 'x',
    nombre: 'X (Twitter)',
    tipo: 'social',
    admiteAdulto: 'limitado',
    advertencia:
      'Permite el contenido marcado como sensible en las publicaciones, pero no en los anuncios. La cuenta puede quedar oculta de las búsquedas sin aviso.',
  },
  {
    clave: 'pinterest',
    nombre: 'Pinterest',
    tipo: 'social',
    admiteAdulto: 'no',
    advertencia: 'Prohíbe el contenido adulto y cierra la cuenta. No merece la pena intentarlo.',
  },
  {
    clave: 'tiktok',
    nombre: 'TikTok',
    tipo: 'social',
    admiteAdulto: 'no',
    advertencia:
      'Ni orgánico ni de pago. El alcance es tentador y la cuenta dura poco: no se puede construir nada encima.',
  },
  {
    clave: 'google-ads',
    nombre: 'Google Ads',
    tipo: 'publicidad',
    admiteAdulto: 'no',
    advertencia:
      'Prohibido por política. Insistir arriesga la cuenta de Google entera, incluida la de Merchant y la de Search Console.',
  },
  {
    clave: 'meta-ads',
    nombre: 'Meta Ads',
    tipo: 'publicidad',
    admiteAdulto: 'no',
    advertencia: 'Prohibido por política, con cierre del gestor comercial y de la página.',
  },
  {
    clave: 'redes-adultas',
    nombre: 'Redes publicitarias del sector (otras)',
    tipo: 'publicidad',
    admiteAdulto: 'si',
    advertencia:
      'Aceptan el catálogo y suelen exigir pago por adelantado. La calidad del tráfico varía muchísimo: conviene empezar con presupuestos pequeños y mirar el ingreso por visita, no el número de visitas.',
  },
  /*
   * Las redes grandes van una a una y no todas bajo «redes-adultas».
   *
   * El motivo es el informe: el `utm_source` es lo que separa una fila de otra,
   * y metiéndolas todas en la misma clave el día que se compre en dos a la vez
   * no habría forma de saber cuál trae las ventas —que es exactamente la
   * pregunta por la que existe el marcaje—. El Studio ya trata sus formatos por
   * separado; sus canales también.
   */
  {
    clave: 'exoclick',
    nombre: 'ExoClick',
    tipo: 'publicidad',
    admiteAdulto: 'si',
    advertencia:
      'La más grande del sector y la de más inventario. Su cola de revisión tarda, así que conviene mandar las creatividades con margen y con los pesos ya validados.',
  },
  {
    clave: 'trafficstars',
    nombre: 'TrafficStars',
    tipo: 'publicidad',
    admiteAdulto: 'si',
  },
  {
    clave: 'trafficjunky',
    nombre: 'TrafficJunky',
    tipo: 'publicidad',
    admiteAdulto: 'si',
    advertencia:
      'Su revisión rechaza las imágenes deformadas: nada de estirar una foto para que quepa en el formato.',
  },
  {
    clave: 'juicyads',
    nombre: 'JuicyAds',
    tipo: 'publicidad',
    admiteAdulto: 'si',
  },
];

export const CANAL_DIRECTO = 'directo';

/** Un canal por su clave, o `undefined` si no está en el catálogo. */
export function canalPorClave(clave: string): Canal | undefined {
  return CANALES.find((c) => c.clave === clave);
}

export interface Marcaje {
  fuente: string;
  medio?: string;
  campana?: string;
  /**
   * Qué pieza concreta trajo el clic: el `utm_content`.
   *
   * Es lo que separa «ExoClick trajo doce ventas» de «las trajo el banner
   * vertical con el titular en rojo». Sin esto, probar creatividades es tirar
   * los dados: se cambia algo, sube o baja el total, y no hay forma de saber
   * cuál de los nueve banners lo movió. Lo pone el Studio en cada exportación.
   */
  contenido?: string;
}

/**
 * Deja una clave de canal en su forma canónica.
 *
 * Los parámetros UTM los escribe a mano quien monta la campaña, y acaban
 * llegando con mayúsculas, espacios y acentos según de dónde se copien. Sin
 * normalizar, `Newsletter`, `newsletter ` y `NEWSLETTER` serían tres canales
 * distintos en el informe y ninguno tendría datos suficientes para decidir
 * nada.
 */
export function limpiarClave(valor: string | null | undefined): string | undefined {
  if (!valor) return undefined;

  const v = valor
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    // Sin recortar los separadores de los extremos, quitar un carácter raro
    // del principio dejaría claves como `-newsletter`, que en el informe
    // aparecerían separadas de `newsletter` sin que se vea la diferencia.
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 60);

  return v || undefined;
}

/** Marcaje a partir de los parámetros UTM de una URL. */
export function normalizarMarcaje(busqueda: URLSearchParams): Marcaje | null {
  return marcajeDe({
    fuente: busqueda.get('utm_source'),
    medio: busqueda.get('utm_medium'),
    campana: busqueda.get('utm_campaign'),
    contenido: busqueda.get('utm_content'),
  });
}

/**
 * Marcaje a partir de valores sueltos, ya vengan de la URL o del cuerpo de la
 * petición del pedido. Se limpia igual en los dos casos: lo que llega del
 * navegador lo escribe cualquiera y acaba pintado en un informe del panel.
 */
export function marcajeDe(valores: {
  fuente?: string | null;
  medio?: string | null;
  campana?: string | null;
  contenido?: string | null;
}): Marcaje | null {
  const fuente = limpiarClave(valores.fuente);
  if (!fuente) return null;

  const medio = limpiarClave(valores.medio);
  const campana = limpiarClave(valores.campana);
  const contenido = limpiarClave(valores.contenido);

  return {
    fuente,
    ...(medio ? { medio } : {}),
    ...(campana ? { campana } : {}),
    ...(contenido ? { contenido } : {}),
  };
}

/**
 * Construye un enlace marcado para una campaña.
 *
 * Existe para que nadie tenga que acordarse de la sintaxis: un `utm_source`
 * mal escrito no da ningún error, simplemente hace que esa campaña no aparezca
 * en el informe y parezca que no funcionó.
 */
export function construirEnlace(base: string, marcaje: Marcaje): string {
  const url = new URL(base);

  url.searchParams.set('utm_source', marcaje.fuente);
  if (marcaje.medio) url.searchParams.set('utm_medium', marcaje.medio);
  if (marcaje.campana) url.searchParams.set('utm_campaign', marcaje.campana);
  if (marcaje.contenido) url.searchParams.set('utm_content', marcaje.contenido);

  return url.toString();
}

/**
 * Con qué marcaje se queda una visita que trae uno nuevo.
 *
 * Último clic no directo, que es el criterio estándar: si alguien llega por la
 * newsletter, se va, y vuelve tecleando la dirección, la venta es de la
 * newsletter. Lo contrario —quedarse con el primero de todos— haría que un
 * canal de descubrimiento se llevara el mérito de todas las compras
 * posteriores de esa persona durante meses.
 *
 * Una visita directa nunca pisa un marcaje anterior: por eso el criterio se
 * llama "no directo".
 */
export function marcajeQueGana(anterior: Marcaje | null, nuevo: Marcaje | null): Marcaje | null {
  if (!nuevo || nuevo.fuente === CANAL_DIRECTO) return anterior;
  return nuevo;
}

export interface VentasPorCanal {
  fuente: string;
  nombre: string;
  tipo: TipoCanal;
  pedidos: number;
  ingresoCents: number;
  /** Lo que deja de media cada pedido de este canal. */
  ticketMedioCents: number;
  /** Qué parte del total factura este canal, de 0 a 1. */
  cuota: number;
}

/**
 * Resume las ventas por canal.
 *
 * Ordena por ingreso, no por número de pedidos: veinte pedidos de doce euros
 * valen menos que cinco de noventa, y ordenar por cantidad haría dedicar el
 * esfuerzo al canal equivocado.
 */
export function resumirPorCanal(
  pedidos: { fuente: string | null; totalCents: number }[],
): VentasPorCanal[] {
  const total = pedidos.reduce((suma, p) => suma + p.totalCents, 0);
  const agrupado = new Map<string, { pedidos: number; ingresoCents: number }>();

  for (const p of pedidos) {
    // Sin marcaje es tráfico directo: teclearon la dirección o llegaron por un
    // enlace sin marcar. Es un canal más y hay que verlo, porque una tienda
    // sana tiene una parte importante ahí.
    const fuente = p.fuente ?? CANAL_DIRECTO;
    const actual = agrupado.get(fuente) ?? { pedidos: 0, ingresoCents: 0 };

    agrupado.set(fuente, {
      pedidos: actual.pedidos + 1,
      ingresoCents: actual.ingresoCents + p.totalCents,
    });
  }

  return [...agrupado.entries()]
    .map(([fuente, datos]) => {
      const canal = canalPorClave(fuente);

      return {
        fuente,
        nombre: canal?.nombre ?? fuente,
        tipo: canal?.tipo ?? 'directo',
        pedidos: datos.pedidos,
        ingresoCents: datos.ingresoCents,
        ticketMedioCents: Math.round(datos.ingresoCents / datos.pedidos),
        cuota: total > 0 ? datos.ingresoCents / total : 0,
      };
    })
    .sort((a, b) => b.ingresoCents - a.ingresoCents);
}

/**
 * Base sobre la que se comisiona: las líneas sin IVA y sin envío.
 *
 * En España los precios se muestran con el IVA incluido, así que hay que
 * extraerlo línea a línea —cada una puede llevar un tipo distinto— en vez de
 * aplicar uno solo al total. Comisionar sobre el precio con IVA sería pagar
 * por dinero que se le entrega íntegro a Hacienda, y hacerlo sobre el envío
 * sería pagar por un coste que ya sale del margen.
 *
 * El descuento se reparte en proporción, porque un cupón rebaja el precio con
 * IVA incluido y por tanto rebaja también la base.
 */
export function baseComisionable(
  lineas: { totalCents: number; taxRate: number }[],
  descuentoCents: number,
): number {
  const conIva = lineas.reduce((suma, l) => suma + l.totalCents, 0);
  if (conIva <= 0) return 0;

  const sinIva = lineas.reduce(
    (suma, l) => suma + Math.round(l.totalCents / (1 + l.taxRate / 100)),
    0,
  );

  const proporcionQueQueda = Math.max(0, 1 - descuentoCents / conIva);
  return Math.round(sinIva * proporcionQueQueda);
}

/**
 * Comisión de un afiliado sobre una base.
 *
 * Separado del cálculo de la base a propósito: son dos decisiones distintas
 * —sobre qué se comisiona y cuánto— y mezclarlas hace imposible probar la
 * primera, que es la que se equivoca en silencio.
 */
export function comisionDe(baseCents: number, porcentaje: number): number {
  return Math.round((Math.max(0, baseCents) * porcentaje) / 100);
}

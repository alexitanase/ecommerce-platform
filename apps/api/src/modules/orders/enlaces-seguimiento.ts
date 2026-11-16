/**
 * El enlace donde el cliente ve dónde está su paquete.
 *
 * Los proveedores con API lo mandan hecho. Los que no la tienen —Dreamlove
 * manda un XML y punto— dan como mucho un transportista y un número escritos
 * en su web, y con eso hay que construir la dirección a mano.
 *
 * Importa más de lo que parece: el correo de «tu pedido va en camino» lleva ese
 * enlace, y sin él el cliente recibe un número suelto que tiene que ir a pegar
 * a algún sitio. Ese es exactamente el momento en que escribe preguntando dónde
 * está su pedido, que es el mayor coste de soporte del negocio.
 */

interface Transportista {
  /** Nombre tal y como se le enseña al cliente. */
  nombre: string;
  /**
   * Cómo se reconoce lo que escriba el operador.
   *
   * Se compara ya normalizado —sin tildes, sin puntos y en minúsculas— porque
   * nadie escribe «Correos Express» dos veces igual: aparece como «correos
   * express», «CEX» o «correosexpress».
   */
  alias: string[];
  /**
   * La página del transportista donde se ve ESTE envío.
   *
   * `null` cuando la empresa no tiene ninguna: no toda la tienen. Nacex, sin ir
   * más lejos, resuelve el seguimiento con un formulario que va por POST, así
   * que no hay ninguna dirección que se pueda poner en un correo. Devolver
   * `null` manda al cliente al buscador universal, que sí funciona por URL;
   * inventarse un enlace lo mandaría a una página que no enseña su envío, que
   * es peor que no darle ninguno porque parece que el paquete no existe.
   */
  url: ((numero: string) => string) | null;
  /**
   * Identificador de este transportista en 17TRACK.
   *
   * Se le manda al consultar en vez de dejar que lo adivine por el número. Su
   * detección automática funciona bien con los formatos internacionales y mal
   * con los nacionales: un albarán de Nacex son ocho dígitos sin prefijo, que
   * es exactamente igual que el de media docena de empresas más. Diciéndoselo,
   * la consulta va a la empresa correcta a la primera.
   */
  codigo17track?: number;
}

/**
 * Los transportistas que se usan de verdad desde España.
 *
 * No pretende ser exhaustivo: es la lista de los que aparecen en los envíos de
 * proveedores nacionales y de los internacionales más habituales. Lo que no
 * esté aquí cae en el buscador universal, que funciona con casi cualquier
 * número, así que añadir uno nuevo es una mejora y nunca un arreglo urgente.
 */
const TRANSPORTISTAS: Transportista[] = [
  {
    nombre: 'Correos',
    alias: ['correos'],
    url: (n) =>
      `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=${n}`,
    codigo17track: 19181,
  },
  {
    nombre: 'Correos Express',
    // «expres» sin doble ese incluido a propósito: al quitar la tilde de
    // «exprés» queda así, y sin este alias acababa reconocido como Correos,
    // que es otra empresa y otra web de seguimiento.
    alias: ['correos express', 'correos expres', 'correosexpress', 'cex'],
    /*
     * El que había —`correosexpress.com/web/correosexpress/mis-envios?n=`—
     * responde 503: esa web ya no existe. Llevaba puesto quién sabe cuánto, y
     * el síntoma no se ve desde aquí: quien se lo come es el cliente que abre
     * el enlace del correo de «tu pedido va en camino» y se encuentra un error
     * del servidor, que es justo el momento en el que escribe preguntando.
     *
     * Este es el localizador que usan hoy, y el parámetro se ha comprobado
     * contra su página: `shippingNumber` deja el número escrito en el campo.
     * Los demás que se probaron —`n`, `codigo`, `envio`— los ignora y enseña
     * el formulario vacío.
     */
    url: (n) => `https://s.correosexpress.com/?shippingNumber=${n}`,
    codigo17track: 100048,
  },
  {
    nombre: 'SEUR',
    alias: ['seur'],
    /*
     * `livetracking` sigue funcionando, pero por un 301 a esta misma
     * dirección. Se apunta ya a la definitiva: un redirección de más en un
     * enlace de correo es un salto que algunos clientes de correo bloquean, y
     * el día que SEUR retire el redirección el enlace muere sin avisar.
     */
    url: (n) => `https://www.seur.com/miseur/mis-envios?code=${n}`,
    codigo17track: 100438,
  },
  {
    nombre: 'MRW',
    alias: ['mrw'],
    url: (n) =>
      `https://www.mrw.es/seguimiento_envios/MRW_seguimiento_envios.asp?modo=nacional&envio=${n}`,
    codigo17track: 100175,
  },
  {
    nombre: 'GLS',
    alias: ['gls', 'asm', 'gls spain'],
    url: (n) => `https://mygls.gls-spain.es/e/${n}`,
    codigo17track: 100189,
  },
  {
    nombre: 'DHL',
    alias: ['dhl', 'dhl express', 'dhl parcel'],
    url: (n) => `https://www.dhl.com/es-es/home/rastreo.html?tracking-id=${n}`,
    codigo17track: 100001,
  },
  {
    nombre: 'UPS',
    alias: ['ups'],
    url: (n) => `https://www.ups.com/track?loc=es_ES&tracknum=${n}`,
    codigo17track: 100002,
  },
  {
    nombre: 'FedEx',
    alias: ['fedex'],
    url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
    codigo17track: 100003,
  },
  {
    nombre: 'DPD',
    alias: ['dpd'],
    url: (n) => `https://tracking.dpd.de/status/es_ES/parcel/${n}`,
  },
  {
    nombre: 'Nacex',
    alias: ['nacex'],
    /*
     * Nacex no tiene enlace de seguimiento, y no es que no lo hayamos
     * encontrado: su buscador es un formulario que se envía por POST con dos
     * campos —`agencia_origen` y `numero_albaran`—, porque sus albaranes se
     * numeran por agencia y el número solo no identifica nada. Ninguna
     * dirección con el número dentro lleva al envío.
     *
     * El que había aquí —`seguimientoDetalle.do?agencia=&albaran=`— devolvía
     * 200 y la portada de seguimiento en blanco: el cliente abría el enlace,
     * no veía su envío y daba por hecho que el número era falso.
     *
     * Con `null` se cae al buscador universal, que sí acepta el número en la
     * URL y reconoce Nacex. Un clic más y el envío se ve.
     */
    url: null,
    codigo17track: 100436,
  },
  {
    nombre: 'Envialia',
    alias: ['envialia'],
    url: (n) => `https://www.envialia.com/seguimiento-envio/?n=${n}`,
    codigo17track: 100432,
  },
  {
    nombre: 'CTT Express',
    alias: ['ctt', 'ctt express', 'cttexpress'],
    url: (n) => `https://www.cttexpress.com/localizador-de-envios/?sc=${n}`,
    codigo17track: 100114,
  },
  {
    nombre: 'Tipsa',
    alias: ['tipsa'],
    url: (n) => `https://www.tip-sa.com/localizador?ref=${n}`,
    codigo17track: 100185,
  },
  {
    nombre: 'Zeleris',
    alias: ['zeleris'],
    url: (n) => `https://www.zeleris.com/seguimiento?envio=${n}`,
    codigo17track: 100144,
  },
  {
    nombre: 'Paack',
    alias: ['paack'],
    url: (n) => `https://tracking.paack.app/${n}`,
    codigo17track: 100364,
  },
  {
    nombre: 'Cainiao',
    alias: ['cainiao', 'aliexpress standard shipping', 'ae', 'global cainiao'],
    url: (n) => `https://global.cainiao.com/detail.htm?mailNoList=${n}`,
    codigo17track: 190271,
  },
];

/**
 * Cuando no se reconoce el transportista.
 *
 * 17TRACK identifica el transportista a partir del propio número y cubre más de
 * mil, incluidos los chinos. Es peor que el enlace oficial —una página más por
 * medio— y muchísimo mejor que no dar ninguno.
 */
const UNIVERSAL = (numero: string): string =>
  `https://t.17track.net/es#nums=${encodeURIComponent(numero)}`;

/** Sin tildes, sin puntos y en minúsculas, que es como se puede comparar. */
const normalizar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** El transportista reconocido, o null si no es ninguno de los conocidos. */
export function reconocerTransportista(nombre: string): Transportista | null {
  const buscado = normalizar(nombre);
  if (!buscado) return null;

  /*
   * Se compara también sin separadores.
   *
   * «C.E.X.» y «correos-express» son la misma empresa escrita a mano de dos
   * formas; al quitar puntos y guiones quedan «c e x» y «correos express», y
   * solo la segunda coincide con un alias. Comparando además la versión pegada
   * —«cex»— las dos encuentran lo suyo.
   */
  const compacto = buscado.replace(/ /g, '');

  const exacto = TRANSPORTISTAS.find((t) =>
    t.alias.some((a) => a === buscado || a.replace(/ /g, '') === compacto),
  );
  if (exacto) return exacto;

  /*
   * Contiene, no es igual: llegan cosas como «GLS Spain — Terrestre» o «Envío
   * por SEUR 24h», y exigir coincidencia exacta las mandaría todas al buscador
   * universal teniendo su enlace bueno.
   *
   * Gana el alias MÁS LARGO que encaje, no el primero de la lista. Con el
   * primero, «correos express» reconocía Correos —porque contiene «correos»— y
   * el cliente acababa en la web de otra empresa, que le dice que su envío no
   * existe. El nombre más específico es siempre el correcto.
   */
  let mejor: { transportista: Transportista; largo: number } | null = null;

  for (const transportista of TRANSPORTISTAS) {
    for (const alias of transportista.alias) {
      if (buscado.includes(alias) && alias.length > (mejor?.largo ?? 0)) {
        mejor = { transportista, largo: alias.length };
      }
    }
  }

  return mejor?.transportista ?? null;
}

/**
 * El enlace de seguimiento para un transportista y un número.
 *
 * Devuelve siempre algo mientras haya número: si el transportista no se
 * reconoce, el buscador universal. Un enlace que quizá tarde un clic más vale
 * más que un número suelto que el cliente no sabe dónde pegar.
 */
export function enlaceDeSeguimiento(transportista: string, numero: string): string | null {
  const limpio = numero.trim();
  if (!limpio) return null;

  const conocido = reconocerTransportista(transportista);
  // Reconocido pero sin página propia —el caso de Nacex— cae al universal
  // igual que uno desconocido: lo que importa es que el enlace enseñe el
  // envío, no de quién es el dominio.
  return conocido?.url ? conocido.url(encodeURIComponent(limpio)) : UNIVERSAL(limpio);
}

/**
 * El código de este transportista en 17TRACK, si lo conocemos.
 *
 * `undefined` no es un problema: 17TRACK detecta el transportista a partir del
 * número cuando no se le dice. Decírselo solo lo hace más fiable con los
 * nacionales, que es donde su detección falla.
 */
export function codigoDeSeguimiento(transportista: string): number | undefined {
  return reconocerTransportista(transportista)?.codigo17track;
}

/**
 * El nombre bien escrito del transportista.
 *
 * Lo que teclea una persona a las nueve de la mañana —«correos exprés», «seur
 * 24h»— acaba en el correo del cliente y en su ficha de pedido. Normalizarlo
 * cuando se reconoce cuesta nada y evita que la tienda parezca descuidada.
 */
export function nombreDeTransportista(escrito: string): string {
  return reconocerTransportista(escrito)?.nombre ?? escrito.trim();
}

/** Los que se ofrecen en el desplegable del panel. */
export const TRANSPORTISTAS_CONOCIDOS: string[] = TRANSPORTISTAS.map((t) => t.nombre);

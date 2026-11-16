/**
 * Motor de riesgo del checkout.
 *
 * En dropshipping el fraude no se paga con una devolución: se paga dos veces.
 * Se cobra un pedido con una tarjeta robada, se compra la mercancía al
 * proveedor con dinero real, se envía, y semanas después llega el contracargo.
 * Se pierde el producto, el porte y la comisión, y encima suma un punto negro
 * con la pasarela.
 *
 * Por eso este motor NO decide si alguien es un delincuente —eso no se puede
 * saber— sino cuánto conviene esperar antes de gastar dinero en su pedido. Su
 * salida es una de tres decisiones:
 *
 *  · `ACEPTAR`  — el pedido sigue su curso normal.
 *  · `REVISAR`  — se cobra, pero NO se compra al proveedor hasta que alguien
 *                 lo mire. Es el caso interesante: no molesta al cliente, y si
 *                 el pedido es bueno solo se retrasa unas horas.
 *  · `RECHAZAR` — no se deja ni crear. Reservado a lo que es casi con certeza
 *                 automatizado.
 *
 * **Todo es lógica pura y sin dependencias a propósito.** Las señales las reúne
 * el servicio; aquí solo se puntúan. Así se puede probar cada regla con casos
 * concretos, que es la única forma de tocar un umbral sin miedo: un motor de
 * riesgo mal calibrado no da errores, da ventas perdidas que nadie cuenta.
 */

export type DecisionRiesgo = 'ACEPTAR' | 'REVISAR' | 'RECHAZAR';

export interface SenalesPedido {
  /** Importe total del pedido, en céntimos. */
  totalCents: number;
  /** Pedidos hechos por este email en la última hora. */
  pedidosDelEmailUltimaHora: number;
  /** Pedidos hechos desde esta IP en la última hora. */
  pedidosDeLaIpUltimaHora: number;
  /** Pedidos ya pagados por este email en toda su historia. */
  pedidosPagadosDelEmail: number;
  /** País de la dirección de envío (ISO-3166 alfa-2). */
  paisEnvio: string;
  /** País de facturación, si es distinto del de envío. */
  paisFacturacion?: string;
  /** El dominio del email es de los de usar y tirar. */
  emailDesechable: boolean;
  /** Cuenta creada hace menos de una hora. */
  cuentaRecienCreada: boolean;
  /** Ha comprado sin registrarse. */
  invitado: boolean;
  /** Segundos entre entrar en el checkout y enviarlo. */
  segundosEnElCheckout?: number;
  /** Intentos de pago fallidos previos con este email. */
  pagosFallidosDelEmail: number;
}

export interface Motivo {
  codigo: string;
  puntos: number;
  detalle: string;
}

export interface ResultadoRiesgo {
  puntuacion: number;
  decision: DecisionRiesgo;
  motivos: Motivo[];
}

/**
 * Umbrales.
 *
 * Deliberadamente altos para RECHAZAR. Un falso positivo es una venta perdida y
 * un cliente que no vuelve; un falso negativo se detecta en la revisión manual
 * antes de gastar un céntimo, porque REVISAR retiene el envío al proveedor y no
 * el cobro. Ante la duda, se revisa: es lo barato.
 */
export const UMBRAL_REVISAR = 40;
export const UMBRAL_RECHAZAR = 90;

/** Países a los que se vende; fuera de aquí el envío ya es sospechoso de por sí. */
const PAISES_HABITUALES = new Set(['ES', 'PT', 'FR', 'IT', 'DE', 'AD']);

/**
 * Importe a partir del cual un pedido merece una mirada.
 *
 * No porque un pedido caro sea sospechoso, sino porque lo que se arriesga al
 * equivocarse es proporcional: revisar uno de 400 € cuesta dos minutos y evita
 * perder 400 € de mercancía.
 */
const IMPORTE_ALTO_CENTS = 30_000;
const IMPORTE_MUY_ALTO_CENTS = 60_000;

/**
 * Un formulario relleno en menos de esto no lo ha hecho una persona.
 *
 * Rellenar nombre, apellidos, dirección, ciudad, provincia y código postal a
 * mano no baja de unos segundos ni escribiendo deprisa. Por debajo hay
 * autocompletado del navegador —legítimo— o un script, así que suma poco por
 * sí solo: es una señal de apoyo, no una condena.
 */
const SEGUNDOS_IMPOSIBLES = 3;

export function evaluarRiesgo(senales: SenalesPedido): ResultadoRiesgo {
  const motivos: Motivo[] = [];

  const sumar = (codigo: string, puntos: number, detalle: string): void => {
    motivos.push({ codigo, puntos, detalle });
  };

  // ── Velocidad ────────────────────────────────────────────
  //
  // La señal más fiable de todas. Una persona hace un pedido, quizá dos si se
  // ha equivocado. Cinco en una hora desde el mismo correo es una máquina
  // probando tarjetas: cada intento con una distinta hasta que una pase.
  if (senales.pedidosDelEmailUltimaHora >= 5) {
    sumar(
      'VELOCIDAD_EMAIL_ALTA',
      50,
      `${String(senales.pedidosDelEmailUltimaHora)} pedidos con este email en la última hora`,
    );
  } else if (senales.pedidosDelEmailUltimaHora >= 3) {
    sumar(
      'VELOCIDAD_EMAIL',
      25,
      `${String(senales.pedidosDelEmailUltimaHora)} pedidos con este email en la última hora`,
    );
  }

  // La IP se comparte —una oficina, el CGNAT de una operadora móvil, que en
  // España es lo normal— así que puntúa menos que el email para el mismo
  // número de pedidos.
  if (senales.pedidosDeLaIpUltimaHora >= 8) {
    sumar(
      'VELOCIDAD_IP_ALTA',
      35,
      `${String(senales.pedidosDeLaIpUltimaHora)} pedidos desde esta IP en la última hora`,
    );
  } else if (senales.pedidosDeLaIpUltimaHora >= 5) {
    sumar(
      'VELOCIDAD_IP',
      15,
      `${String(senales.pedidosDeLaIpUltimaHora)} pedidos desde esta IP en la última hora`,
    );
  }

  // ── Pagos fallidos ───────────────────────────────────────
  //
  // Probar tarjetas es exactamente esto: muchos intentos, casi todos rechazados.
  if (senales.pagosFallidosDelEmail >= 3) {
    sumar(
      'PAGOS_FALLIDOS',
      40,
      `${String(senales.pagosFallidosDelEmail)} pagos fallidos previos con este email`,
    );
  }

  // ── Identidad ────────────────────────────────────────────
  if (senales.emailDesechable) {
    // No es ilegal usar un correo temporal, pero quien piensa reclamar una
    // garantía o recibir un aviso de envío no lo hace.
    sumar('EMAIL_DESECHABLE', 30, 'El dominio del email es de correo temporal');
  }

  if (senales.cuentaRecienCreada && senales.totalCents >= IMPORTE_ALTO_CENTS) {
    sumar('CUENTA_NUEVA_IMPORTE_ALTO', 20, 'Cuenta creada hace menos de una hora y pedido alto');
  }

  // ── Destino ──────────────────────────────────────────────
  if (!PAISES_HABITUALES.has(senales.paisEnvio)) {
    sumar('PAIS_INFRECUENTE', 15, `Envío a ${senales.paisEnvio}, fuera de los países habituales`);
  }

  if (senales.paisFacturacion && senales.paisFacturacion !== senales.paisEnvio) {
    // Pasa de verdad y muchas veces es legítimo —un regalo, alguien que vive
    // fuera— pero también es el patrón de una tarjeta robada: se factura en el
    // país del titular y se envía a otro.
    sumar(
      'PAISES_DISTINTOS',
      20,
      `Factura en ${senales.paisFacturacion} y envío a ${senales.paisEnvio}`,
    );
  }

  // ── Importe ──────────────────────────────────────────────
  if (senales.totalCents >= IMPORTE_MUY_ALTO_CENTS) {
    sumar('IMPORTE_MUY_ALTO', 25, `Pedido de ${(senales.totalCents / 100).toFixed(2)} €`);
  } else if (senales.totalCents >= IMPORTE_ALTO_CENTS) {
    sumar('IMPORTE_ALTO', 10, `Pedido de ${(senales.totalCents / 100).toFixed(2)} €`);
  }

  // ── Comportamiento ───────────────────────────────────────
  if (
    senales.segundosEnElCheckout !== undefined &&
    senales.segundosEnElCheckout < SEGUNDOS_IMPOSIBLES
  ) {
    sumar(
      'CHECKOUT_INSTANTANEO',
      20,
      `Formulario enviado en ${String(senales.segundosEnElCheckout)} s`,
    );
  }

  // ── Lo que resta ─────────────────────────────────────────
  //
  // Un cliente con compras pagadas a sus espaldas es lo más parecido a una
  // garantía que hay. Resta, y bastante: sin esto, el mejor cliente de la
  // tienda acabaría en revisión el día que hiciera un pedido grande.
  if (senales.pedidosPagadosDelEmail >= 3) {
    sumar('CLIENTE_HABITUAL', -30, `${String(senales.pedidosPagadosDelEmail)} pedidos ya pagados`);
  } else if (senales.pedidosPagadosDelEmail >= 1) {
    sumar(
      'CLIENTE_CONOCIDO',
      -15,
      `${String(senales.pedidosPagadosDelEmail)} pedido(s) ya pagados`,
    );
  }

  // La puntuación no baja de cero: un cliente excelente no compra margen para
  // que luego se le colara algo grave sin llegar al umbral.
  const puntuacion = Math.max(
    0,
    motivos.reduce((total, m) => total + m.puntos, 0),
  );

  return { puntuacion, decision: decidir(puntuacion), motivos };
}

function decidir(puntuacion: number): DecisionRiesgo {
  if (puntuacion >= UMBRAL_RECHAZAR) return 'RECHAZAR';
  if (puntuacion >= UMBRAL_REVISAR) return 'REVISAR';
  return 'ACEPTAR';
}

/**
 * Dominios de correo temporal más habituales.
 *
 * La lista es corta y no pretende ser exhaustiva: hay miles y cambian cada
 * semana. Cubre los que aparecen de verdad y suma poco por sí sola, así que
 * un dominio nuevo que se cuele no abre ninguna puerta.
 */
const DOMINIOS_DESECHABLES = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'yopmail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'sharklasers.com',
  'trashmail.com',
  'getnada.com',
  'maildrop.cc',
  'dispostable.com',
  'fakeinbox.com',
  'mohmal.com',
  'correotemporal.org',
]);

export function esEmailDesechable(email: string): boolean {
  const dominio = email.toLowerCase().trim().split('@')[1];
  return dominio !== undefined && DOMINIOS_DESECHABLES.has(dominio);
}

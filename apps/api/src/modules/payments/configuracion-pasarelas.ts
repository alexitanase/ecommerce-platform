import { PASARELAS_DISPONIBLES, type ClavePasarela } from '@ecom/payments';

/**
 * Qué pasarelas se ofrecen en el checkout y en qué condiciones.
 *
 * Separado del servicio porque decide qué formas de pago ve el cliente, y
 * equivocarse aquí no da error: da un checkout con menos opciones de las que
 * debería —o con una que la tienda creía desactivada— y el fallo se descubre
 * por las ventas que no llegan.
 *
 * Las credenciales no están aquí: viven en `Integration`, cifradas, y se
 * configuran en Ajustes → Integraciones. Lo que decide este módulo es la parte
 * comercial —si se ofrece, en qué orden y para qué importes—, que es una
 * decisión distinta de "tengo las claves".
 *
 * El interruptor de la integración manda sobre este: una pasarela apagada ahí
 * no se ofrece por mucho que aquí figure como activa.
 */

export interface ConfigPasarela {
  key: ClavePasarela;
  /** Si la tienda quiere ofrecerla. */
  activa: boolean;
  /** Posición en el checkout; el cliente elige casi siempre la primera. */
  orden: number;
  /**
   * Importe mínimo del pedido para ofrecerla.
   *
   * En cripto tiene un uso concreto: la comisión de red no depende del importe,
   * así que en un pedido de 8 € se puede llevar una parte grande del margen.
   */
  minCents: number;
  /** Importe máximo, o null si no hay tope. */
  maxCents: number | null;
}

/** Lo que el panel necesita mostrar de cada pasarela. */
export interface EstadoPasarela extends ConfigPasarela {
  nombre: string;
  implementada: boolean;
  tieneCredenciales: boolean;
  /** Campos que faltan por configurar en Integraciones. */
  faltan: string[];
  /** Se puede ofrecer de verdad ahora mismo. */
  operativa: boolean;
}

export type MotivoNoDisponible =
  'DESACTIVADA' | 'NO_IMPLEMENTADA' | 'SIN_CREDENCIALES' | 'IMPORTE_BAJO' | 'IMPORTE_ALTO';

const POR_DEFECTO = (key: ClavePasarela, orden: number): ConfigPasarela => ({
  key,
  // Solo NOWPayments viene activada: es la decisión de negocio de la tienda y
  // la única implementada. Activar algo por defecto que no se ha revisado es
  // como acaban apareciendo formas de pago que nadie quería ofrecer.
  activa: key === 'nowpayments',
  orden,
  minCents: 0,
  maxCents: null,
});

/**
 * Interpreta lo guardado en ajustes.
 *
 * Acepta el formato antiguo —un array de claves en orden— porque es lo que hay
 * escrito en las tiendas que ya funcionan, y una migración de un ajuste no
 * merece dejar un checkout sin formas de pago si algo sale mal.
 */
export function normalizar(guardado: unknown): ConfigPasarela[] {
  const claves = PASARELAS_DISPONIBLES.map((p) => p.key);

  /**
   * Una pasarela sin implementar no puede estar activa, diga lo que diga lo
   * guardado. El formato antiguo listaba las cuatro, así que sin esto el panel
   * las enseña marcadas —como si la tienda hubiera decidido ofrecerlas— junto a
   * una casilla bloqueada que no se puede desmarcar.
   */
  const implementada = (key: string) =>
    Boolean(PASARELAS_DISPONIBLES.find((p) => p.key === key)?.implementada);

  // Formato antiguo: ['nowpayments', 'stripe'] — el orden era la lista misma y
  // estar en ella significaba estar activa.
  if (Array.isArray(guardado) && guardado.every((v) => typeof v === 'string')) {
    const orden = guardado;
    return claves.map((key, i) => {
      const posicion = orden.indexOf(key);
      return {
        ...POR_DEFECTO(key, i),
        activa: posicion >= 0 && implementada(key),
        orden: posicion >= 0 ? posicion : claves.length + i,
      };
    });
  }

  const porClave = new Map<string, Record<string, unknown>>();
  if (Array.isArray(guardado)) {
    for (const entrada of guardado) {
      if (
        entrada &&
        typeof entrada === 'object' &&
        typeof (entrada as { key?: unknown }).key === 'string'
      ) {
        const registro = entrada as Record<string, unknown>;
        porClave.set(registro['key'] as string, registro);
      }
    }
  }

  return claves.map((key, i) => {
    const g = porClave.get(key);
    if (!g) return POR_DEFECTO(key, i);

    const numero = (v: unknown, sino: number): number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : sino;

    return {
      key,
      activa:
        (typeof g['activa'] === 'boolean' ? g['activa'] : POR_DEFECTO(key, i).activa) &&
        implementada(key),
      orden: numero(g['orden'], i),
      minCents: numero(g['minCents'], 0),
      // null explícito significa "sin tope"; undefined significa "no lo han
      // tocado", y ambos acaban igual, pero un 0 guardado sí es un tope de 0.
      maxCents:
        g['maxCents'] === null || g['maxCents'] === undefined ? null : numero(g['maxCents'], 0),
    };
  });
}

/** Ordena como se mostrará en el checkout. */
export function ordenar(configs: ConfigPasarela[]): ConfigPasarela[] {
  return [...configs].sort((a, b) => a.orden - b.orden || a.key.localeCompare(b.key));
}

/**
 * Por qué no se puede ofrecer esta pasarela, o null si sí se puede.
 *
 * Devuelve el motivo en vez de un booleano para poder explicarlo en el panel:
 * "desactivada" y "le faltan las credenciales" se arreglan de formas muy
 * distintas, y sin distinguirlas se pierde el tiempo en el sitio equivocado.
 */
export function motivoNoDisponible(
  config: ConfigPasarela,
  contexto: { implementada: boolean; tieneCredenciales: boolean; totalCents?: number },
): MotivoNoDisponible | null {
  if (!config.activa) return 'DESACTIVADA';
  if (!contexto.implementada) return 'NO_IMPLEMENTADA';
  if (!contexto.tieneCredenciales) return 'SIN_CREDENCIALES';

  if (contexto.totalCents !== undefined) {
    if (contexto.totalCents < config.minCents) return 'IMPORTE_BAJO';
    if (config.maxCents !== null && contexto.totalCents > config.maxCents) return 'IMPORTE_ALTO';
  }

  return null;
}

/**
 * Pasarelas ofrecibles para un importe concreto, en orden.
 *
 * @param totalCents importe del pedido; si se omite, no se filtran por importe
 */
export function aplicables(
  configs: ConfigPasarela[],
  contexto: {
    implementada: (key: ClavePasarela) => boolean;
    tieneCredenciales: (key: ClavePasarela) => boolean;
    totalCents?: number;
  },
): ConfigPasarela[] {
  return ordenar(configs).filter(
    (c) =>
      motivoNoDisponible(c, {
        implementada: contexto.implementada(c.key),
        tieneCredenciales: contexto.tieneCredenciales(c.key),
        totalCents: contexto.totalCents,
      }) === null,
  );
}

/**
 * Valida un cambio de configuración antes de guardarlo.
 *
 * Lo importante es lo último: dejar el checkout sin ninguna forma de pago
 * operativa no da ningún error al guardar, y la tienda sigue funcionando y
 * enseñando productos. Solo se descubre cuando un cliente llega a pagar y no
 * puede — es decir, con la venta ya perdida.
 *
 * @returns lista de problemas; vacía si la configuración es válida
 */
export function validar(
  configs: ConfigPasarela[],
  contexto: {
    implementada: (key: ClavePasarela) => boolean;
    tieneCredenciales: (key: ClavePasarela) => boolean;
  },
): string[] {
  const problemas: string[] = [];

  for (const c of configs) {
    const nombre = PASARELAS_DISPONIBLES.find((p) => p.key === c.key)?.nombre ?? c.key;

    if (c.maxCents !== null && c.maxCents < c.minCents) {
      problemas.push(`En ${nombre} el importe máximo es menor que el mínimo: nunca se ofrecería.`);
    }

    if (c.activa && !contexto.implementada(c.key)) {
      problemas.push(`${nombre} todavía no está implementada y no se puede activar.`);
    }

    if (c.activa && contexto.implementada(c.key) && !contexto.tieneCredenciales(c.key)) {
      problemas.push(
        `${nombre} está activada pero le faltan credenciales en el entorno: no aparecerá en el checkout.`,
      );
    }
  }

  const operativas = aplicables(configs, contexto);
  if (operativas.length === 0) {
    problemas.push(
      'Ninguna forma de pago quedaría operativa: los clientes no podrían completar la compra.',
    );
  }

  return problemas;
}

/**
 * ¿Este cambio deja la tienda sin poder cobrar, pudiendo cobrar?
 *
 * La distinción es la que decide si se bloquea el guardado o solo se avisa. Que
 * no haya ninguna forma de pago operativa **porque faltan credenciales en el
 * servidor** no es algo que se arregle desde el panel: bloquear ahí dejaría la
 * pantalla inservible justo durante la puesta en marcha, que es cuando todavía
 * no hay credenciales. Apagar a mano la única pasarela que sí funcionaba, en
 * cambio, sí es una decisión del panel y sí conviene frenarla.
 */
export function dejaLaTiendaSinCobrar(
  configs: ConfigPasarela[],
  contexto: {
    implementada: (key: ClavePasarela) => boolean;
    tieneCredenciales: (key: ClavePasarela) => boolean;
  },
): boolean {
  const podriaFuncionar = configs.some(
    (c) => contexto.implementada(c.key) && contexto.tieneCredenciales(c.key),
  );

  return podriaFuncionar && aplicables(configs, contexto).length === 0;
}

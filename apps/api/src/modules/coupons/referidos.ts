/**
 * Programa de referidos.
 *
 * Quien ya compra recomienda la tienda, y cuando la persona recomendada hace
 * su primer pedido los dos ganan un descuento. Con catálogo +18 —sin Google
 * Ads ni Meta Ads— el boca a boca no es un canal más: es de los pocos que
 * quedan, y por eso conviene que las reglas estén escritas y probadas en lugar
 * de repartidas por el servicio.
 *
 * Lo que este módulo evita, que es lo que de verdad importa: que el programa
 * se convierta en una máquina de regalar dinero. Un referido mal validado no
 * da ningún error —emite un cupón y ya está— y solo se descubre al cuadrar
 * cuentas, cuando ya se han emitido cientos.
 */

export interface ReglasReferidos {
  activo: boolean;
  /** Lo que gana quien recomienda, en céntimos. */
  premioReferidorCents: number;
  /** Lo que gana quien llega recomendado, en céntimos. */
  premioReferidoCents: number;
  /**
   * Pedido mínimo para que el referido cuente.
   *
   * Sin mínimo, alguien puede referirse a sí mismo con veinte correos, hacer
   * veinte pedidos de un euro y quedarse con veinte descuentos. El mínimo hace
   * que el fraude cueste más de lo que da.
   */
  pedidoMinimoCents: number;
  /** Cuántas personas puede traer cada cliente. Cero = sin límite. */
  maximoPorReferidor: number;
  /** Días que dura el cupón que se emite. */
  diasDeValidez: number;
}

export const REGLAS_POR_DEFECTO: ReglasReferidos = {
  // Apagado por defecto: un programa que regala dinero no puede activarse solo
  // porque se despliegue una versión nueva.
  activo: false,
  premioReferidorCents: 500,
  premioReferidoCents: 500,
  pedidoMinimoCents: 2500,
  maximoPorReferidor: 10,
  diasDeValidez: 90,
};

export interface SolicitudReferido {
  /** Quién recomienda. */
  referidorId: string;
  emailReferidor: string;
  /** Quién llega recomendado. */
  emailReferido: string;
  /** Si quien llega ya tenía cuenta antes de esto. */
  referidoYaEraCliente: boolean;
  /** Cuántas personas ha traído ya este referidor y se han completado. */
  referidosCompletados: number;
  /** Importe del pedido que dispara el premio. */
  totalPedidoCents: number;
  /** Si este email ya fue referido antes por cualquiera. */
  yaFueReferido: boolean;
}

export type MotivoRechazo =
  | 'PROGRAMA_APAGADO'
  | 'AUTOREFERIDO'
  | 'YA_ERA_CLIENTE'
  | 'YA_FUE_REFERIDO'
  | 'PEDIDO_INSUFICIENTE'
  | 'LIMITE_ALCANZADO';

export interface Decision {
  valido: boolean;
  motivo?: MotivoRechazo;
  /** Explicación para el registro y para el panel. */
  detalle?: string;
  premios?: { referidorCents: number; referidoCents: number };
}

/**
 * ¿Corresponde premiar este referido?
 *
 * El orden de las comprobaciones importa para el registro: se devuelve el
 * primer motivo que lo invalida, y conviene que sea el más informativo. Saber
 * que alguien intentó referirse a sí mismo dice más que "no llega al mínimo".
 */
export function evaluarReferido(solicitud: SolicitudReferido, reglas: ReglasReferidos): Decision {
  if (!reglas.activo) {
    return { valido: false, motivo: 'PROGRAMA_APAGADO', detalle: 'El programa está desactivado' };
  }

  // Comparación normalizada: "Ana@Ejemplo.es " y "ana@ejemplo.es" son la misma
  // persona, y sin normalizar el autoreferido más obvio se cuela.
  const referidor = solicitud.emailReferidor.toLowerCase().trim();
  const referido = solicitud.emailReferido.toLowerCase().trim();

  if (referidor === referido) {
    return {
      valido: false,
      motivo: 'AUTOREFERIDO',
      detalle: 'Quien recomienda y quien llega son la misma dirección',
    };
  }

  if (solicitud.referidoYaEraCliente) {
    // El programa trae gente nueva. Premiar a un cliente de siempre por
    // "llegar recomendado" es regalar descuentos por ventas que ya se tenían.
    return {
      valido: false,
      motivo: 'YA_ERA_CLIENTE',
      detalle: 'Quien llega ya había comprado antes',
    };
  }

  if (solicitud.yaFueReferido) {
    return {
      valido: false,
      motivo: 'YA_FUE_REFERIDO',
      detalle: 'Esta dirección ya fue referida antes',
    };
  }

  if (solicitud.totalPedidoCents < reglas.pedidoMinimoCents) {
    return {
      valido: false,
      motivo: 'PEDIDO_INSUFICIENTE',
      detalle:
        `El pedido es de ${(solicitud.totalPedidoCents / 100).toFixed(2)} € y el mínimo son ` +
        `${(reglas.pedidoMinimoCents / 100).toFixed(2)} €`,
    };
  }

  if (
    reglas.maximoPorReferidor > 0 &&
    solicitud.referidosCompletados >= reglas.maximoPorReferidor
  ) {
    return {
      valido: false,
      motivo: 'LIMITE_ALCANZADO',
      detalle: `Ya ha traído a ${String(solicitud.referidosCompletados)} personas`,
    };
  }

  return {
    valido: true,
    premios: {
      referidorCents: reglas.premioReferidorCents,
      referidoCents: reglas.premioReferidoCents,
    },
  };
}

/**
 * Código de invitación a partir del identificador de quien recomienda.
 *
 * Se dicta por teléfono y se escribe a mano, así que fuera las letras que se
 * confunden: la I con el 1 y la L, la O con el 0. Cuesta menos generar un
 * código legible que atender la reclamación de quien jura haberlo escrito bien.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generarCodigo(aleatorio: () => number = Math.random): string {
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += ALFABETO[Math.floor(aleatorio() * ALFABETO.length)];
  }
  return codigo;
}

/**
 * Normaliza lo que escriba quien lo introduce.
 *
 * Mayúsculas y sin espacios ni guiones, porque la gente los añade al copiar de
 * un mensaje. **No se traducen las letras confundibles**: el alfabeto ya no
 * contiene ninguna de ellas —ni O ni 0, ni I ni L ni 1— así que "corregir" una
 * O por un cero produciría un carácter que no puede existir en ningún código.
 * Si alguien escribe una, el código simplemente no aparece, que es la
 * respuesta correcta y la que se entiende.
 */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[\s-]/g, '');
}

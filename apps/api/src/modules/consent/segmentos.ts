/**
 * Segmentos de la lista de correo.
 *
 * Mandar lo mismo a todo el mundo es la forma más rápida de quemar una lista:
 * quien compró ayer no quiere el mismo correo que quien no compra desde hace
 * seis meses, y a base de recibir cosas que no le interesan la gente deja de
 * abrir, marca como spam y arrastra la reputación del dominio. Con la
 * reputación tocada dejan de llegar hasta los correos de pedido.
 *
 * En esta tienda importa el doble: con catálogo +18 no hay publicidad pagada
 * —Google Ads y Meta la bloquean—, así que la lista de correo es de los pocos
 * canales propios que quedan y estropearla se paga caro.
 *
 * Es lógica pura para poder probarla: un segmento mal calculado no da ningún
 * error, solo hace que un envío se dirija a quien no tocaba.
 */

export type Segmento =
  /** Se apuntó y todavía no ha comprado nada. */
  | 'suscriptor'
  /** Ha comprado una vez. */
  | 'cliente'
  /** Dos o más compras. */
  | 'recurrente'
  /** Gasta bastante más que la media. */
  | 'alto_valor'
  /** Compró alguna vez y lleva mucho sin volver. */
  | 'dormido'
  /** Dejó algo en el carrito y no volvió. */
  | 'carrito_abandonado';

export interface SenalesSuscriptor {
  pedidosPagados: number;
  totalGastadoCents: number;
  /** Días desde la última compra; `null` si nunca ha comprado. */
  diasDesdeUltimaCompra: number | null;
  /** Tiene un carrito con cosas y sin pedido detrás. */
  carritoAbandonado: boolean;
}

/**
 * A partir de cuántos días sin comprar se considera dormido.
 *
 * Noventa días es lo habitual en tiendas de compra ocasional. Con productos de
 * consumo frecuente habría que bajarlo; con muebles, subirlo. Se deja aquí,
 * visible y en un solo sitio, porque es el número que más se querrá tocar.
 */
export const DIAS_PARA_DORMIDO = 90;

/** Gasto a partir del cual alguien entra en «alto valor». */
export const ALTO_VALOR_CENTS = 30_000;

/**
 * Todos los segmentos a los que pertenece alguien.
 *
 * Devuelve varios a propósito: quien ha comprado tres veces y lleva cuatro
 * meses sin aparecer es a la vez `recurrente` y `dormido`, y la campaña que le
 * corresponde —«te echamos de menos»— necesita las dos cosas para existir.
 * Forzar un único segmento obligaría a elegir y perdería información.
 */
export function segmentosDe(senales: SenalesSuscriptor): Segmento[] {
  const segmentos: Segmento[] = [];

  if (senales.pedidosPagados === 0) {
    segmentos.push('suscriptor');
  } else if (senales.pedidosPagados === 1) {
    segmentos.push('cliente');
  } else {
    segmentos.push('recurrente');
  }

  if (senales.totalGastadoCents >= ALTO_VALOR_CENTS) {
    segmentos.push('alto_valor');
  }

  // Solo tiene sentido en quien ya compró: alguien que nunca ha comprado no
  // está "dormido", está sin estrenar, y el correo que le toca es otro.
  if (
    senales.pedidosPagados > 0 &&
    senales.diasDesdeUltimaCompra !== null &&
    senales.diasDesdeUltimaCompra >= DIAS_PARA_DORMIDO
  ) {
    segmentos.push('dormido');
  }

  if (senales.carritoAbandonado) {
    segmentos.push('carrito_abandonado');
  }

  return segmentos;
}

/** ¿Encaja este suscriptor en el segmento que se quiere enviar? */
export function perteneceA(senales: SenalesSuscriptor, segmento: Segmento): boolean {
  return segmentosDe(senales).includes(segmento);
}

/** Etiquetas para el panel. Se explican, no se abrevian. */
export const ETIQUETAS: Record<Segmento, string> = {
  suscriptor: 'Suscritos que aún no han comprado',
  cliente: 'Han comprado una vez',
  recurrente: 'Compran de forma habitual',
  alto_valor: 'Gastan por encima de la media',
  dormido: `Compraron y llevan más de ${String(DIAS_PARA_DORMIDO)} días sin volver`,
  carrito_abandonado: 'Dejaron algo en el carrito',
};

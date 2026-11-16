import type { EstadoProducto } from '@ecom/suppliers';

/**
 * El estado que le toca a UNA variante concreta.
 *
 * El proveedor responde por producto, pero cada variante tiene su precio y su
 * stock. Aplicar el estado del producto a una variante es aplicarle el de la
 * primera de la lista —que es lo que devuelven los campos de cabecera de
 * AliExpress— y en un catálogo con precios de 13,99 € a 39,99 € eso no se
 * parece a nada.
 *
 * Ha costado dos fallos distintos y por eso vive aquí, en un solo sitio:
 *
 *  · **En la sincronización**: ocho variantes de 29,79 €, 17,79 € y 79,99 € se
 *    guardaron todas a 66,39 €, con un stock que no era el de ninguna.
 *
 *  · **Antes de comprar al proveedor**: la comprobación de coste comparaba lo
 *    que costaba la variante PEDIDA contra lo que cuesta la PRIMERA, y paraba
 *    pedidos legítimos avisando de una subida del 102 % que no había ocurrido.
 *    Un pedido cobrado que no se compra y se queda esperando a que alguien lo
 *    mire.
 *
 * Un caso que importa: si el proveedor SÍ manda detalle por variante y la
 * nuestra no está, esa variante ha desaparecido de su catálogo. Ahí no se puede
 * caer al valor del producto —seguiríamos vendiendo algo que ya no existe—: se
 * trata como descatalogada.
 */
export interface EstadoDeVariante {
  costCents: number;
  /** PVP recomendado de ESTA variante, cuando el proveedor lo publica. */
  rrpCents?: number;
  stock?: number;
  disponible: boolean;
  descatalogado: boolean;
}

export function estadoDeVariante(
  enlace: { externalVariantId: string | null },
  estado: EstadoProducto,
): EstadoDeVariante {
  const conDetalle = (estado.variantes ?? []).length > 0;

  // Sin identificador de variante o sin detalle del proveedor, lo del producto
  // es lo único que hay. Es el caso de los proveedores que no las distinguen.
  if (!enlace.externalVariantId || !conDetalle) {
    return {
      costCents: estado.costCents,
      ...(estado.rrpCents === undefined ? {} : { rrpCents: estado.rrpCents }),
      ...(estado.stock === undefined ? {} : { stock: estado.stock }),
      disponible: estado.disponible,
      descatalogado: estado.descatalogado,
    };
  }

  const suya = estado.variantes?.find((v) => v.externalVariantId === enlace.externalVariantId);

  if (!suya) {
    return { costCents: 0, stock: 0, disponible: false, descatalogado: true };
  }

  return {
    costCents: suya.costCents,
    // El PVP de SU variante, por lo mismo que el coste: en una familia de
    // colores los precios se separan hasta el triple.
    ...(suya.rrpCents === undefined ? {} : { rrpCents: suya.rrpCents }),
    ...(suya.stock === undefined ? {} : { stock: suya.stock }),
    disponible: suya.disponible,
    descatalogado: estado.descatalogado,
  };
}

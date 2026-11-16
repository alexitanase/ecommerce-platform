import { margenDeVenta, pvpParaMargen } from '../catalog/services/margen.js';

/**
 * De dónde sale el precio de venta de un producto importado.
 *
 * `pvpr` es la regla de la casa cuando el proveedor lo publica: **su precio,
 * tal cual**. Es al que vende el resto del sector, así que ponerle otro es
 * competir contra el catálogo del propio proveedor. `margen` es la alternativa
 * —partir del coste y aplicar el margen objetivo— y es lo único que se puede
 * hacer con quien no publica PVP, como AliExpress.
 *
 * La diferencia no es cosmética. Con el catálogo de Dreamlove delante, calcular
 * por margen fijo pone artículos un 40 % por encima de lo que cuestan en
 * cualquier otra tienda y otros por debajo de lo que se podrían haber vendido.
 */
export type EstrategiaPrecio = 'margen' | 'pvpr';

export interface ReglasDePrecio {
  /** Margen que se busca cuando el precio lo ponemos nosotros. */
  margenObjetivo: number;
  /**
   * Por debajo de esto, el artículo se marca para revisarlo.
   *
   * Ya no es un suelo que corrija el precio: cuando el proveedor publica PVP,
   * manda el suyo. Sirve para contar y avisar de lo que deja poco margen, que
   * es una decisión de catálogo —revisarlo o dejar de venderlo— y no algo que
   * se arregle subiendo el precio hasta que la cuenta cuadre.
   */
  margenMinimo: number;
  taxRate: number;
  /** Porte del proveedor, si se repercute en el coste del artículo. */
  envioCents?: number;
  /** Lo que el proveedor añade al pagar y no aparece en su catálogo. */
  recargoPct?: number;
  /** Cargo fijo por categoría de las importaciones de bajo valor. */
  cargoFijoCents?: number;
  /** Terminación psicológica del redondeo (99 → 24,99 €). */
  terminacion?: number;
}

export interface PrecioDeImportacion {
  /** Precio de escaparate, con IVA incluido. */
  pvpCents: number;
  /** Lo que cuesta comprarlo de verdad: artículo, porte, recargo y cargo fijo. */
  costeCompraCents: number;
  /** Margen que queda con ese precio, medido sobre la base imponible. */
  margenReal: number;
  /**
   * De dónde ha salido el precio. Se devuelve para poder contarlo: después de
   * subir 950 productos, saber cuántos van al precio del proveedor y cuántos
   * ha habido que calcular es la diferencia entre confiar en la cifra de
   * margen del panel y no saber de dónde sale.
   */
  origen: 'pvpr' | 'margen';
  /**
   * El precio del proveedor no llega al margen mínimo configurado.
   *
   * **Se publica igual.** No es una corrección, es una señal: son los
   * artículos que hay que mirar uno a uno —o dejar de vender— porque a ese
   * precio dan poco o nada. Contarlos es lo que permite decidir sobre ellos;
   * cambiarles el precio por su cuenta es lo que los sacaba del mercado.
   */
  bajoMinimo: boolean;
  aviso?: string;
}

/**
 * El precio al que se pone a la venta un artículo del proveedor.
 *
 * **Si el proveedor publica PVP recomendado, ese es el precio.** Sin corregir,
 * sin redondear y sin añadirle nuestro margen por encima: es el precio al que
 * lo vende el resto del sector, así que ponerle otro es competir contra el
 * catálogo del propio proveedor. Un artículo cuyo PVPR deja poco margen es un
 * artículo que hay que revisar —o dejar de vender—, no uno al que subirle el
 * precio hasta que la cuenta cuadre: subiéndolo se queda fuera de mercado y no
 * se vende ninguno, que es margen cero sobre cero unidades.
 *
 * El margen mínimo no desaparece, cambia de papel: en vez de mandar sobre el
 * precio, marca el artículo para que salga en el recuento y en el aviso.
 *
 * Sin PVPR publicado sí se calcula, porque no hay nada más de donde tirar. Un
 * cero no es un precio: es un campo que el proveedor no ha rellenado.
 */
export function precioDeImportacion(
  estrategia: EstrategiaPrecio,
  costeCents: number,
  rrpCents: number | undefined,
  reglas: ReglasDePrecio,
): PrecioDeImportacion {
  const comunes = {
    costeCents,
    envioCents: reglas.envioCents ?? 0,
    recargoPct: reglas.recargoPct ?? 0,
    cargoFijoCents: reglas.cargoFijoCents ?? 0,
    taxRate: reglas.taxRate,
    ...(reglas.terminacion !== undefined ? { terminacion: reglas.terminacion } : {}),
  };

  const porMargen = pvpParaMargen({
    ...comunes,
    margenObjetivo: reglas.margenObjetivo,
    margenMinimo: reglas.margenMinimo,
  });

  if (estrategia === 'margen' || !rrpCents || rrpCents <= 0) {
    return {
      pvpCents: porMargen.pvpCents,
      costeCompraCents: porMargen.costeCompraCents,
      margenReal: porMargen.margenReal,
      origen: 'margen',
      bajoMinimo: porMargen.margenReal < reglas.margenMinimo,
      ...(porMargen.aviso ? { aviso: porMargen.aviso } : {}),
    };
  }

  const conPvpr = margenDeVenta(rrpCents, porMargen.costeCompraCents, reglas.taxRate);
  const bajoMinimo = conPvpr.porcentaje < reglas.margenMinimo;

  return {
    pvpCents: rrpCents,
    costeCompraCents: porMargen.costeCompraCents,
    margenReal: conPvpr.porcentaje,
    origen: 'pvpr',
    bajoMinimo,
    /*
     * El aviso no cambia el precio: lo señala.
     *
     * Con el margen y el importe delante se puede decidir lo único que hay que
     * decidir en estos casos —revisarlo o dejar de venderlo—, que es una
     * decisión de catálogo y no de calculadora.
     */
    ...(bajoMinimo
      ? {
          aviso:
            `Se publica al PVP del proveedor (${(rrpCents / 100).toFixed(2)} €), que deja un ` +
            `${conPvpr.porcentaje}% de margen sobre un coste de ` +
            `${(porMargen.costeCompraCents / 100).toFixed(2)} €: por debajo del mínimo del ` +
            `${reglas.margenMinimo}%`,
        }
      : {}),
  };
}

import {
  ErrorProveedor,
  type CapacidadesProveedor,
  type EstadoProducto,
  type InfoSeguimiento,
  type ParametrosBusqueda,
  type ProductoProveedor,
  type RespuestaPedido,
  type ResultadoBusqueda,
  type SolicitudPedido,
  type SupplierAdapter,
  type VarianteProveedor,
} from '../../core/types.js';
import type { ArticuloDreamlove, GrupoDreamlove, RepositorioCatalogoDreamlove } from './tipos.js';

/**
 * Adaptador de Dreamlove.
 *
 * Es el primer proveedor de la plataforma SIN API. No hay nada que llamar: nos
 * mandan un XML con su catálogo, se procesa, y a partir de ahí todo lo que
 * sabemos de ellos sale de la copia que tenemos guardada. Comprar es entrar en
 * su web y hacer el pedido a mano.
 *
 * Que eso quepa detrás de la misma interfaz que AliExpress es justo lo que
 * buscaba el contrato: el importador, el motor de precios y la sincronización
 * funcionan igual sin enterarse de que al otro lado no hay nadie escuchando.
 * Lo único que cambia es lo que declara en `capacidades`, y el motor de pedidos
 * lo consulta antes de intentar comprar.
 *
 * La diferencia importante con los demás está en el agrupado: Dreamlove manda
 * cada color y cada talla como un producto independiente unido por
 * `item_group_id`, así que aquí se recomponen las familias antes de
 * entregárselas al importador. Sin eso, la tienda enseñaría ocho fichas casi
 * idénticas del mismo artículo.
 */
export class DreamloveAdapter implements SupplierAdapter {
  readonly key = 'dreamlove';
  readonly nombre = 'Dreamlove';

  readonly capacidades: CapacidadesProveedor = {
    buscarCatalogo: true,
    importarProducto: true,
    // Se consulta contra el último catálogo procesado, no contra ellos: es tan
    // fresco como lo sea el fichero que se haya subido.
    consultarStock: true,
    /*
     * Aquí está toda la diferencia con AliExpress.
     *
     * No hay forma de mandarles un pedido por programa, así que el motor de
     * fulfillment no debe intentarlo: al ver esto en falso deja el sub-pedido
     * en la cola de compras manuales con las líneas listas para copiar, en vez
     * de fallar cinco veces y marcarlo como incidencia.
     */
    crearPedido: false,
    cancelarPedido: false,
    seguimiento: false,
    devoluciones: false,
    // Su almacén sirve en paquete neutro; el pedido se hace a nuestro nombre.
    envioSinMarca: true,
    // No hay API que limitar: lo que hay es una consulta a nuestra propia base
    // de datos. El número no es infinito para que nadie lo lea como «da igual
    // cuántas veces la llames desde un bucle».
    limitePeticionesPorSegundo: 50,
  };

  constructor(
    private readonly catalogo: RepositorioCatalogoDreamlove,
    private readonly opciones: { onLog?: (n: 'info' | 'warn' | 'error', m: string) => void } = {},
  ) {}

  /**
   * Lo que se comprueba aquí no son credenciales: es que haya catálogo.
   *
   * Dreamlove no da ninguna clave, así que el equivalente a «las credenciales
   * funcionan» es «tenemos su fichero procesado y con artículos dentro». Un
   * proveedor dado de alta al que nadie ha subido el catálogo no puede
   * importar nada, y conviene que lo diga antes de que alguien lo intente.
   */
  async verificarCredenciales(): Promise<{ ok: boolean; mensaje?: string }> {
    const { total } = await this.catalogo.buscar({ pagina: 1, porPagina: 1 });

    if (total === 0) {
      return {
        ok: false,
        mensaje:
          'No hay ningún catálogo de Dreamlove procesado. Sube su fichero XML desde la ficha ' +
          'del proveedor: sin él no se puede buscar ni importar nada.',
      };
    }

    return { ok: true, mensaje: `Catálogo con ${total} productos.` };
  }

  async buscar(parametros: ParametrosBusqueda): Promise<ResultadoBusqueda> {
    const pagina = Math.max(1, parametros.pagina ?? 1);
    const porPagina = Math.min(100, Math.max(1, parametros.porPagina ?? 20));

    const { grupos, total } = await this.catalogo.buscar({
      ...(parametros.q ? { texto: parametros.q } : {}),
      pagina,
      porPagina,
      ...(parametros.orden ? { orden: parametros.orden } : {}),
    });

    return {
      items: grupos.map((g) => this.productoDesdeGrupo(g)),
      total,
      pagina,
      hayMas: pagina * porPagina < total,
    };
  }

  /**
   * Ficha por id, código «D-…», EAN o identificador de grupo.
   *
   * Devuelve `null` y no un error cuando no está: el importador distingue «no
   * existe» de «ha fallado la consulta», y con un error una referencia mal
   * tecleada parecería una avería.
   */
  async obtenerProducto(externalId: string): Promise<ProductoProveedor | null> {
    const grupo = await this.catalogo.grupoPorReferencia(externalId.trim());
    return grupo && grupo.length > 0 ? this.productoDesdeGrupo(grupo) : null;
  }

  async consultarEstado(externalIds: string[]): Promise<EstadoProducto[]> {
    const grupos = await this.catalogo.gruposPorClaves(externalIds);

    const porClave = new Map<string, GrupoDreamlove>();
    for (const grupo of grupos) {
      const clave = grupo[0]?.claveGrupo;
      if (clave) porClave.set(clave, grupo);
    }

    return externalIds.map((id) => {
      const grupo = porClave.get(id);

      // Uno por cada identificador pedido, también por los que ya no están:
      // omitirlos dejaría a la sincronización sin saber que hay que retirarlos,
      // y seguiríamos vendiendo lo que el proveedor ya no sirve.
      if (!grupo || grupo.length === 0) {
        return { externalId: id, disponible: false, costCents: 0, descatalogado: true };
      }

      const producto = this.productoDesdeGrupo(grupo);

      return {
        externalId: id,
        disponible: grupo.some((a) => a.disponible),
        costCents: producto.costCents,
        // El PVP que recomienda hoy: es el precio al que se vende, así que la
        // sincronización tiene que verlo cambiar como ve cambiar el coste.
        ...(producto.rrpCents !== undefined ? { rrpCents: producto.rrpCents } : {}),
        stock: producto.stock ?? 0,
        // Los portes de Dreamlove son del pedido, no del artículo: contarlos
        // aquí los metería en el coste de cada línea.
        shippingCents: 0,
        descatalogado: false,
        variantes: grupo.map((a) => ({
          externalVariantId: a.externalId,
          costCents: a.costeCents,
          ...(a.pvpRecomendadoCents > 0 ? { rrpCents: a.pvpRecomendadoCents } : {}),
          stock: a.stock,
          disponible: a.disponible,
          ...(a.imagenes[0] ? { imageUrl: a.imagenes[0] } : {}),
        })),
      };
    });
  }

  // ── Pedidos: no hay ─────────────────────────────────────────

  /**
   * Dreamlove no admite pedidos por programa.
   *
   * El motor de fulfillment mira `capacidades.crearPedido` y no llega hasta
   * aquí. Esto es la red por si alguien llama al adaptador directamente: mejor
   * un error explícito y no reintentable que un pedido que se da por enviado
   * sin que nadie haya comprado nada.
   */
  crearPedido(solicitud: SolicitudPedido): Promise<RespuestaPedido> {
    this.opciones.onLog?.(
      'warn',
      `Se ha intentado enviar el pedido ${solicitud.referenciaInterna} a Dreamlove por programa`,
    );

    return Promise.reject(
      new ErrorProveedor(
        'SIN_PERMISO',
        'Dreamlove no tiene forma de recibir pedidos automáticamente: hay que comprarlo a ' +
          'mano en su web y anotar la referencia en la ficha del pedido.',
        { proveedor: this.key, reintentable: false },
      ),
    );
  }

  /** No hay pedido que consultar: los que existen se hicieron a mano. */
  consultarPedido(): Promise<RespuestaPedido | null> {
    return Promise.resolve(null);
  }

  cancelarPedido(): Promise<{ ok: boolean; mensaje?: string }> {
    return Promise.resolve({
      ok: false,
      mensaje:
        'Dreamlove no admite cancelaciones por programa. Hay que llamarles o escribirles antes ' +
        'de que salga el envío.',
    });
  }

  obtenerSeguimiento(): Promise<InfoSeguimiento | null> {
    return Promise.resolve(null);
  }

  // ── Del catálogo del proveedor a un producto nuestro ────────

  /**
   * Convierte una familia de artículos en el producto que ve la tienda.
   *
   * El artículo que manda —el «cabeza»— es el que está disponible y con más
   * stock: de él salen el título, la descripción y las fotos de portada. Coger
   * el primero del XML sin más dejaba fichas encabezadas por el color agotado.
   */
  private productoDesdeGrupo(grupo: GrupoDreamlove): ProductoProveedor {
    const cabeza = this.cabezaDe(grupo);
    const opciones = this.opcionesPorArticulo(grupo);
    const marca = cabeza.marcaRaiz ?? cabeza.marca;

    const variantes: VarianteProveedor[] = grupo.map((articulo) => ({
      externalId: articulo.externalId,
      // El SKU visible es su código «D-…»: es lo que hay que teclear en su web
      // para comprarlo, así que es lo que tiene que ver quien prepara el pedido.
      sku: articulo.codigo,
      costCents: articulo.costeCents,
      // El PVP recomendado de esta variante concreta. El del cabeza de familia
      // no vale: los colores de un mismo artículo tienen precios distintos.
      ...(articulo.pvpRecomendadoCents > 0 ? { rrpCents: articulo.pvpRecomendadoCents } : {}),
      stock: articulo.stock,
      options: opciones.get(articulo.externalId) ?? {},
      ...(articulo.imagenes[0] ? { imageUrl: articulo.imagenes[0] } : {}),
      ...(articulo.pesoGramos !== null ? { weightGrams: articulo.pesoGramos } : {}),
    }));

    return {
      externalId: cabeza.claveGrupo,
      // Con varios colores manda el título común, que es el de la familia. Sin
      // él, la ficha de ocho colores se titularía «… GRANATE».
      title: (grupo.length > 1 ? cabeza.tituloGrupo : null) ?? cabeza.titulo,
      /*
       * La descripción que se pasa es la larga en HTML, no la corta.
       *
       * La corta de Dreamlove viene en inglés incluso en el campo español
       * —«BATHMATE - HYDRO 7 HERCULES CLEAR»—, mientras que la larga sí está
       * traducida. El importador saca el resumen aplanando esta misma, así que
       * dándole la larga salen bien las dos.
       */
      description: cabeza.descripcionHtml || cabeza.descripcion,
      // El más barato de la familia: es el que decide desde qué precio se
      // anuncia, y con el resto de variantes cada una lleva el suyo.
      costCents: Math.min(...grupo.map((a) => a.costeCents)),
      /*
       * El PVP recomendado del artículo más barato, para que case con el coste
       * de arriba: los dos describen la variante desde la que se anuncia.
       *
       * Se ignoran los ceros. Un artículo sin PVPR publicado no vale cero
       * euros, y colarlo en el mínimo pondría a cero el precio de la familia
       * entera.
       */
      ...this.pvpRecomendadoDelGrupo(grupo),
      currency: cabeza.moneda,
      /*
       * Cero, y no los 18,66 € que trae la ficha.
       *
       * Ese importe es el porte del PEDIDO —viene idéntico en los 12.913
       * artículos del catálogo—, no el de la unidad. Sumarlo como coste de
       * línea subiría todos los PVP en 18,66 € y sacaría el catálogo del
       * mercado. Viaja en `metadata` para que el panel lo enseñe y el pedido
       * manual lo cuente una sola vez.
       */
      shippingCents: 0,
      imageUrls: this.imagenesDelGrupo(grupo, cabeza),
      categoryPath: cabeza.categoria,
      /*
       * La marca RAÍZ, no la hoja.
       *
       * Dreamlove declara «SATISFYER |SATISFYER VIBRATOR»: lo primero es el
       * fabricante y lo segundo una gama suya. La tienda vende marcas, no
       * gamas, y quedarse con la hoja convertiría 203 fabricantes en 452
       * «marcas» —entre ellas cosas como «BODIES & MASTURBATORS»—.
       */
      ...(marca ? { brand: marca } : {}),
      // Solo cuenta el stock de lo que el proveedor sirve: sumar el de un
      // artículo marcado como no disponible promete unidades que no hay.
      stock: grupo.reduce((suma, a) => suma + (a.disponible ? a.stock : 0), 0),
      variants: variantes,
      ...(cabeza.plazoDias ? { leadTimeDays: cabeza.plazoDias } : {}),
      taxRatePct: cabeza.ivaPct,
      attributes: {
        ...(cabeza.pesoGramos !== null ? { pesoGramos: cabeza.pesoGramos } : {}),
        ...(cabeza.medidasMm
          ? {
              anchoMm: cabeza.medidasMm.ancho,
              altoMm: cabeza.medidasMm.alto,
              fondoMm: cabeza.medidasMm.fondo,
            }
          : {}),
      },
      metadata: {
        codigo: cabeza.codigo,
        // Qué código corresponde a cada variante: es lo que se copia en su web
        // al hacer el pedido a mano, y sin esto habría que buscarlo uno a uno.
        codigosPorVariante: Object.fromEntries(grupo.map((a) => [a.externalId, a.codigo])),
        grupoId: cabeza.grupoId,
        portesPedidoCents: cabeza.portesPedidoCents,
        pvpRecomendadoCents: cabeza.pvpRecomendadoCents,
        ivaPct: cabeza.ivaPct,
        eans: cabeza.eans,
        // La gama, por si algún día se quiere afinar más: no se pierde, pero
        // no es la marca.
        marcaLinea: cabeza.marca,
        categoriaEs: cabeza.categoriaEs,
        urlProveedor: cabeza.urlProveedor,
        minUnidades: cabeza.minUnidades,
        liquidacion: cabeza.liquidacion,
        enOferta: cabeza.enOferta,
        esNovedad: cabeza.esNovedad,
      },
    };
  }

  /** El PVP recomendado más bajo de la familia, si alguno lo trae. */
  private pvpRecomendadoDelGrupo(grupo: GrupoDreamlove): { rrpCents?: number } {
    const precios = grupo.map((a) => a.pvpRecomendadoCents).filter((p) => p > 0);
    return precios.length > 0 ? { rrpCents: Math.min(...precios) } : {};
  }

  private cabezaDe(grupo: GrupoDreamlove): ArticuloDreamlove {
    const ordenados = [...grupo].sort((a, b) => {
      if (a.disponible !== b.disponible) return a.disponible ? -1 : 1;
      if (a.stock !== b.stock) return b.stock - a.stock;
      // Desempate estable: sin él, dos artículos iguales podían turnarse de
      // cabeza entre importaciones y cambiar el título de la ficha solos.
      return a.externalId.localeCompare(b.externalId);
    });

    // El grupo nunca viene vacío; el `?? grupo[0]` es para que el tipo lo sepa.
    return ordenados[0] ?? (grupo[0] as ArticuloDreamlove);
  }

  /**
   * Qué opción distingue a cada artículo de sus hermanos.
   *
   * Normalmente es el color o la talla que declara el proveedor, pero sus
   * datos no siempre bastan: hay familias en las que varios artículos traen
   * las mismas opciones, o ninguna. Dejarlo así crearía dos variantes
   * indistinguibles —el cliente elige «Color: negro» y hay dos— o una sola
   * para toda la familia, que es peor: se vendería un color y se pediría otro.
   *
   * Cuando eso pasa se cambia a una opción «Modelo» con lo que de verdad los
   * diferencia: la parte del título que no comparten, y si tampoco vale, su
   * código, que es único por definición.
   */
  private opcionesPorArticulo(grupo: GrupoDreamlove): Map<string, Record<string, string>> {
    const opciones = new Map<string, Record<string, string>>();

    // Un artículo suelto no necesita opciones: crearle una «Modelo» obligaría
    // a elegir entre una sola cosa.
    if (grupo.length === 1) {
      const unico = grupo[0];
      if (unico) opciones.set(unico.externalId, {});
      return opciones;
    }

    const firma = (a: ArticuloDreamlove): string =>
      Object.entries(a.opciones)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => `${k}=${v}`)
        .join('|');

    const firmas = grupo.map(firma);
    const sirven = firmas.every((f) => f.length > 0) && new Set(firmas).size === grupo.length;

    for (const articulo of grupo) {
      opciones.set(
        articulo.externalId,
        sirven ? articulo.opciones : { Modelo: this.etiquetaDistintiva(articulo) },
      );
    }

    return opciones;
  }

  /** Lo que queda del título al quitarle la parte común de la familia. */
  private etiquetaDistintiva(articulo: ArticuloDreamlove): string {
    const comun = articulo.tituloGrupo;

    if (comun && articulo.titulo.toUpperCase().startsWith(comun.toUpperCase())) {
      const resto = articulo.titulo
        .slice(comun.length)
        .replace(/^[\s-–—]+/, '')
        .trim();
      if (resto.length > 0) return resto;
    }

    return articulo.codigo;
  }

  /**
   * Fotos de la familia: primero las del cabeza, después las de los hermanos.
   *
   * Se juntan porque en la ficha agrupada el cliente quiere ver los colores que
   * puede elegir, y cada color solo tiene fotos en su propia fila. Se quitan
   * las repetidas —las familias comparten a menudo la foto de detalle— para no
   * descargar y almacenar la misma imagen ocho veces.
   */
  private imagenesDelGrupo(grupo: GrupoDreamlove, cabeza: ArticuloDreamlove): string[] {
    const vistas = new Set<string>(cabeza.imagenes);
    const resultado = [...cabeza.imagenes];

    for (const articulo of grupo) {
      if (articulo.externalId === cabeza.externalId) continue;
      // Solo la principal de cada hermano: la galería del importador se queda
      // en ocho, y llenarla con las cuatro fotos de detalle del primer color
      // dejaría fuera al resto de colores.
      const principal = articulo.imagenes[0];
      if (principal && !vistas.has(principal)) {
        vistas.add(principal);
        resultado.push(principal);
      }
    }

    return resultado;
  }
}

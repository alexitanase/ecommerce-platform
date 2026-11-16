/**
 * Tipos del catálogo de Dreamlove.
 *
 * Dreamlove no tiene API: manda un XML de unos 340 MB con todo su catálogo y
 * ahí se acaba la integración. No hay endpoint de stock, ni de precios, ni de
 * pedidos. Todo lo que sabemos de ellos sale de ese fichero, y todo lo que
 * ellos saben de nosotros se lo decimos comprando a mano en su web.
 *
 * Estos tipos describen UNA FILA del XML tal y como nos interesa guardarla:
 * ya normalizada —importes en céntimos, textos en español, imágenes
 * ordenadas— pero sin mezclarse todavía con el modelo de la tienda.
 */

/** Un artículo del catálogo, uno por cada fila `<product>` del XML. */
/** Una categoría tal como la manda el proveedor. */
export interface CategoriaDreamlove {
  /** Ruta en inglés, de la raíz a la hoja: ['LOVETOYS', 'Vibrators']. */
  ruta: string[];
  /** Su nombre en español: «Vibradores». */
  nombreEs: string;
}

export interface ArticuloDreamlove {
  /**
   * El `<id>` de Dreamlove. Es el que aparece al final de la URL de su ficha y
   * el que no cambia entre catálogos.
   */
  externalId: string;

  /**
   * Su `<public_id>`: el código «D-196690» que se ve en su web.
   *
   * Se guarda además del id porque es lo que una persona teclea. Cuando haya
   * que hacer el pedido a mano, el operador busca por este código, no por el
   * número interno.
   */
  codigo: string;

  /**
   * Identificador del grupo de variantes (`item_group_id`), si pertenece a uno.
   *
   * Dreamlove manda cada color y cada talla como un producto INDEPENDIENTE y
   * solo los relaciona con este campo. Sin agruparlos, la tienda enseñaría
   * ocho fichas casi idénticas del mismo artículo en ocho colores.
   */
  grupoId: string | null;

  /**
   * Con qué se agrupa este artículo: su grupo si lo tiene, o él mismo.
   *
   * Es la clave con la que la tienda ve UN producto. Se guarda calculada en
   * vez de resolverla en cada consulta porque es por lo que se busca, se
   * pagina y se importa, y un `COALESCE` en el `WHERE` no usa índice.
   */
  claveGrupo: string;

  /** Título en español; si no lo trae, el que venga por defecto (inglés). */
  titulo: string;

  /**
   * Título común de la familia, sin el color ni la talla.
   *
   * «SATISFYER - DOUBLE BALL-R» frente a los ocho títulos de sus colores. Es
   * el que se pone al producto agrupado: usar el de un color cualquiera deja
   * una ficha titulada «… GRANATE» que también vende el azul.
   */
  tituloGrupo: string | null;
  /** Descripción corta en texto plano. */
  descripcion: string;
  /** Descripción larga en HTML, tal y como la manda el proveedor. */
  descripcionHtml: string;

  /** La marca que declara el artículo, que es la HOJA: «SATISFYER PLUGS». */
  marca: string | null;
  /** Jerarquía completa: «SATISFYER |SATISFYER PLUGS». */
  marcaJerarquia: string | null;
  /**
   * La marca de verdad: la raíz de esa jerarquía.
   *
   * Es la que se enseña en la tienda, y no la hoja, porque la hoja es una línea
   * de producto y no una marca. En el catálogo de julio de 2026 hay 452 hojas
   * frente a 203 raíces, y entre las hojas aparecen cosas como «BODIES &
   * MASTURBATORS», que es una gama de PRETTY LOVE. Importar por hoja llenaría
   * la tienda de marcas inventadas y partiría en seis trozos a un fabricante
   * que es uno solo.
   */
  marcaRaiz: string | null;

  /** Lo que nos cuesta a nosotros, sin IVA y sin portes. */
  costeCents: number;
  /** El PVP que ellos recomiendan, con IVA. Solo informativo. */
  pvpRecomendadoCents: number;
  /** Tipo de IVA del artículo: 21, 10 o 4 en este catálogo. */
  ivaPct: number;
  moneda: string;

  /**
   * Portes que declara la ficha.
   *
   * Cuidado con este número: en el catálogo de julio de 2026 valía 18,66 € en
   * los 12.913 productos, lo que significa que es el porte del PEDIDO y no el
   * de la unidad. Repercutirlo en cada artículo subiría todos los PVP en
   * 18,66 € sin motivo. Se guarda como dato del proveedor, no como coste de
   * la línea.
   */
  portesPedidoCents: number;

  stock: number;
  /** Su campo `available`; puede ser 0 aun con stock, y entonces no se sirve. */
  disponible: boolean;

  /** URLs de las fotos, con la marcada como preferida en primer lugar. */
  imagenes: string[];

  /** Ruta de categorías de la principal: ['LOVETOYS', 'Vibrators']. */
  categoria: string[];
  /** Nombre en español de la categoría principal: «Vibradores». */
  categoriaEs: string | null;
  /**
   * Todas las que declara, que son su cadena de ancestros.
   *
   * Sirven para construir el árbol del proveedor con nombres en español en
   * todos los niveles, no solo en la hoja. Ver `categoriasDelProducto`.
   */
  categorias: CategoriaDreamlove[];

  /** Códigos de barras, normalmente un EAN-13. */
  eans: string[];

  pesoGramos: number | null;
  /** Medidas del embalaje en milímetros. */
  medidasMm: { ancho: number; alto: number; fondo: number } | null;

  /**
   * Opciones de la variante ya legibles: { Color: 'GRANATE' }.
   *
   * Salen de los pares `var_name_N` / `var_value_N`. Los valores vacíos se
   * descartan: Dreamlove manda «Talla» sin valor en artículos que no tienen
   * tallas, y crear una opción vacía obligaría al cliente a elegir entre nada.
   */
  opciones: Record<string, string>;

  minUnidades: number;
  maxUnidades: number;

  /** Plazo que promete la ficha, en días: «2-3 días». */
  plazoDias: { min: number; max: number } | null;

  urlProveedor: string | null;
  /** Código arancelario, necesario si algún día se exporta fuera de la UE. */
  codigoArancelario: string | null;

  enOferta: boolean;
  esNovedad: boolean;
  /** Liquidación: no se repondrá cuando se agote. */
  liquidacion: boolean;
  /** Necesita frío. Ninguno en el catálogo actual, pero lo declaran. */
  refrigerado: boolean;

  /** Cuándo lo tocó Dreamlove por última vez, según su propio campo. */
  actualizadoEn: Date | null;
}

/** Resumen de una pasada completa por el XML. */
export interface ResumenLectura {
  articulos: number;
  /** Filas que no se pudieron interpretar; se anotan y se sigue. */
  descartados: number;
  /** Errores de sintaxis XML encontrados por el camino. */
  erroresXml: number;
}

/**
 * De dónde saca el adaptador los artículos.
 *
 * El adaptador de Dreamlove no habla con nadie por HTTP: consulta lo que se
 * guardó al procesar el XML. Se declara como interfaz para que el paquete de
 * proveedores no dependa de la base de datos —quien la implementa es la API,
 * con Prisma— y para poder probar el adaptador con un catálogo en memoria.
 */
export interface RepositorioCatalogoDreamlove {
  /**
   * Busca devolviendo GRUPOS, no filas sueltas.
   *
   * Cada grupo trae ya todos sus artículos porque un producto de la tienda son
   * todos los colores juntos. Si esto devolviera representantes y el adaptador
   * pidiera después los hermanos de cada uno, una página de veinte resultados
   * serían veintiuna consultas.
   */
  buscar(parametros: {
    texto?: string;
    /** Solo artículos que el proveedor sirve ahora mismo. */
    soloDisponibles?: boolean;
    pagina: number;
    porPagina: number;
    orden?: 'relevancia' | 'precio_asc' | 'precio_desc' | 'ventas';
  }): Promise<{ grupos: GrupoDreamlove[]; total: number }>;

  /**
   * El grupo al que pertenece una referencia: id, código «D-…», EAN o grupo.
   *
   * Los cuatro valen porque los cuatro son cosas que una persona tiene a mano:
   * el código está en su web y el EAN en la caja del producto.
   */
  grupoPorReferencia(referencia: string): Promise<GrupoDreamlove | null>;

  /** Varios grupos de golpe, para sincronizar sin una consulta por producto. */
  gruposPorClaves(claves: string[]): Promise<GrupoDreamlove[]>;
}

/**
 * Los artículos que la tienda vende como UN producto.
 *
 * Nunca está vacío: un grupo sin artículos no es un producto sin variantes,
 * es un producto que no existe.
 */
export type GrupoDreamlove = ArticuloDreamlove[];

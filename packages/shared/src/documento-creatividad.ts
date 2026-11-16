import { z } from 'zod';
import { traducible } from './bloques-portada.js';
import { clavePersonalizada, formatoPorClave, type FormatoAnuncio } from './formatos-anuncio.js';

/**
 * El documento de una creatividad.
 *
 * Es la fuente de todo lo que sale del Studio. Un documento no es un banner:
 * es un lienzo infinito con **mesas de trabajo**, una por formato de salida,
 * todas visibles a la vez. Ver el 300×250 al lado del 1080×1920 mientras se
 * edita es lo que evita que una campaña salga con doce piezas que no se
 * parecen entre sí.
 *
 * Vive en `shared` por el mismo motivo que los bloques de la portada: lo valida
 * la API al guardar, lo pinta el editor y lo pinta el renderizador del
 * servidor. Con tres copias, la primera que se desincroniza rompe una
 * exportación y no se nota hasta que la red rechaza el archivo.
 *
 * Dos decisiones que explican casi toda la forma del esquema:
 *
 *  1. **La lista de capas es plana**, con `mesaId` y `padreId`, en vez de un
 *     árbol anidado. Un árbol obliga a recorrer para cambiar una propiedad y a
 *     recursión en Zod; con la lista plana, mover una capa de grupo es cambiar
 *     un campo, y el editor puede indexar por id sin recorrer nada.
 *  2. **La geometría es en píxeles de su mesa**, no en fracciones. Editar es
 *     arrastrar, y arrastrar en fracciones acumula error de redondeo hasta que
 *     un borde deja de cuadrar. Lo que sí es relativo es el **anclaje**, que es
 *     lo que usa `recolocarRecuadro` al llevar la pieza a otro tamaño: sin él,
 *     pasar de 728×90 a 300×500 deja el logo fuera del lienzo.
 *
 * Y una que se nota en lo que NO hay aquí: el documento **no sabe con qué se
 * pinta**. No hay nada de SVG ni de HTML en este esquema. El motor de dibujo
 * empezó siendo SVG y pasó a HTML/CSS sin tocar ni una línea de aquí ni migrar
 * un solo documento guardado, que es exactamente para lo que sirve separarlos.
 */

// ═════════════════════════════════════════════════════════════
//  Piezas básicas
// ═════════════════════════════════════════════════════════════

/**
 * Un color, o una referencia a un estilo compartido.
 *
 * `#e11d48` es un color suelto; `@primario` apunta a `estilos.colores`. La
 * referencia es lo que permite cambiar el color de marca y que cambie en las
 * doce mesas a la vez, que es justo lo que nadie hace a mano cuando son doce.
 */
export const color = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|@[a-z0-9_-]{1,40})$/,
    'Un color es #rrggbb, #rrggbbaa o una referencia @estilo',
  );

export const idCapa = z.string().min(1).max(40);

/** Recuadro en píxeles de la mesa, con el origen arriba a la izquierda. */
export const recuadroSchema = z.object({
  x: z.number(),
  y: z.number(),
  ancho: z.number().min(1).max(20000),
  alto: z.number().min(1).max(20000),
  /** Grados en sentido horario, sobre el centro del recuadro. */
  rotacion: z.number().min(-360).max(360).default(0),
});

export type Recuadro = z.infer<typeof recuadroSchema>;

export const anclajeXSchema = z.enum(['izquierda', 'centro', 'derecha', 'estirar']);
export const anclajeYSchema = z.enum(['arriba', 'centro', 'abajo', 'estirar']);

/**
 * A qué se agarra la capa cuando el lienzo cambia de tamaño.
 *
 * `estirar` mantiene los dos márgenes y estira: es lo que quiere un fondo o una
 * franja de color, y lo que nunca quiere una foto —se deforma—.
 */
export const anclajeSchema = z.object({
  x: anclajeXSchema.default('izquierda'),
  y: anclajeYSchema.default('arriba'),
});

export type Anclaje = z.infer<typeof anclajeSchema>;

export const paradaDegradadoSchema = z.object({
  posicion: z.number().min(0).max(1),
  color,
});

export const rellenoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('ninguno') }),
  z.object({ tipo: z.literal('solido'), color }),
  z.object({
    tipo: z.literal('degradado'),
    /** Lineal en grados; radial ignora el ángulo. */
    forma: z.enum(['lineal', 'radial']).default('lineal'),
    angulo: z.number().min(0).max(360).default(90),
    paradas: z.array(paradaDegradadoSchema).min(2).max(8),
  }),
  z.object({
    tipo: z.literal('imagen'),
    activoId: z.string().min(1).max(40),
    ajuste: z.enum(['cubrir', 'contener', 'estirar', 'repetir']).default('cubrir'),
    /** Encuadre dentro del marco, 0..1 en cada eje. */
    foco: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).default({
      x: 0.5,
      y: 0.5,
    }),
  }),
]);

export type Relleno = z.infer<typeof rellenoSchema>;

export const trazoSchema = z.object({
  color,
  grosor: z.number().min(0).max(200).default(1),
  alineacion: z.enum(['dentro', 'centro', 'fuera']).default('dentro'),
  discontinuo: z.boolean().default(false),
});

export const sombraSchema = z.object({
  x: z.number().min(-500).max(500).default(0),
  y: z.number().min(-500).max(500).default(4),
  desenfoque: z.number().min(0).max(500).default(8),
  extension: z.number().min(-500).max(500).default(0),
  color: color.default('#00000040'),
  /** Hacia dentro del recuadro, para dar hueco o relieve. */
  interior: z.boolean().default(false),
});

export const fusionSchema = z.enum([
  'normal',
  'multiplicar',
  'trama',
  'superponer',
  'oscurecer',
  'aclarar',
  'diferencia',
]);

// ═════════════════════════════════════════════════════════════
//  Animación
// ═════════════════════════════════════════════════════════════

export const propiedadAnimableSchema = z.enum([
  'x',
  'y',
  'escala',
  'opacidad',
  'rotacion',
  'recorte',
]);

export const fotogramaSchema = z.object({
  ms: z.number().min(0).max(60000),
  valor: z.number(),
  suavizado: z.enum(['lineal', 'entrada', 'salida', 'entrada-salida']).default('entrada-salida'),
});

export const pistaSchema = z.object({
  propiedad: propiedadAnimableSchema,
  fotogramas: z.array(fotogramaSchema).min(2).max(20),
});

export type Pista = z.infer<typeof pistaSchema>;

/**
 * Animaciones preparadas.
 *
 * El 90 % de los banners animados son una de estas seis, y nadie quiere abrir
 * una línea de tiempo para hacerlas. Se guardan por nombre —no expandidas a
 * fotogramas— para poder mejorarlas después sin tocar los documentos guardados.
 */
export const presetAnimacionSchema = z.enum([
  'aparecer',
  'deslizar-izquierda',
  'deslizar-arriba',
  'zoom-lento',
  'latido',
  'rebote',
]);

export const animacionCapaSchema = z.object({
  preset: presetAnimacionSchema.optional(),
  /** Retardo desde el inicio de la escena. */
  retardoMs: z.number().min(0).max(60000).default(0),
  duracionMs: z.number().min(0).max(60000).default(600),
  pistas: z.array(pistaSchema).max(6).default([]),
});

// ═════════════════════════════════════════════════════════════
//  Capas
// ═════════════════════════════════════════════════════════════

const comun = {
  id: idCapa,
  /** Mesa a la que pertenece. Una capa vive en una sola mesa. */
  mesaId: z.string().min(1).max(40),
  /** Grupo que la contiene, si está agrupada. */
  padreId: idCapa.optional(),
  orden: z.number().int().min(0).max(10000).default(0),
  nombre: z.string().max(80).default(''),
  visible: z.boolean().default(true),
  bloqueada: z.boolean().default(false),
  opacidad: z.number().min(0).max(1).default(1),
  fusion: fusionSchema.default('normal'),
  recuadro: recuadroSchema,
  anclaje: anclajeSchema.default({ x: 'izquierda', y: 'arriba' }),
  sombra: sombraSchema.optional(),
  /**
   * Clave de sincronización entre mesas.
   *
   * Las capas que comparten `enlace` comparten **contenido** —el titular, el
   * relleno, la imagen— pero no geometría: cada mesa coloca lo suyo. Es lo que
   * hace que cambiar el precio en una mesa lo cambie en las doce sin obligar a
   * que las doce se parezcan.
   */
  enlace: z.string().min(1).max(40).optional(),
  animacion: animacionCapaSchema.optional(),
};

export const capaTextoSchema = z.object({
  ...comun,
  tipo: z.literal('texto'),
  contenido: traducible,
  fuente: z.string().max(80).default('marca'),
  peso: z.number().int().min(100).max(900).default(700),
  tamano: z.number().min(4).max(800).default(24),
  interlineado: z.number().min(0.6).max(3).default(1.15),
  espaciado: z.number().min(-10).max(40).default(0),
  alineacion: z.enum(['izquierda', 'centro', 'derecha']).default('izquierda'),
  alineacionVertical: z.enum(['arriba', 'centro', 'abajo']).default('arriba'),
  transformar: z.enum(['ninguna', 'mayusculas', 'minusculas']).default('ninguna'),
  color: color.default('#111111'),
  contorno: trazoSchema.optional(),
  /**
   * Qué hacer cuando el texto no cabe.
   *
   * `encoger` por defecto y no `fijo` a propósito: el mismo titular en catalán o
   * en inglés es más largo, y en un lote de treinta banners nadie los revisa uno
   * a uno. Un titular tres puntos más pequeño se vende igual; uno cortado, no.
   */
  ajuste: z.enum(['fijo', 'encoger', 'crecer']).default('encoger'),
  /** Estilo de texto compartido del que hereda, si lo hay. */
  estilo: z.string().max(40).optional(),
});

export const capaImagenSchema = z.object({
  ...comun,
  tipo: z.literal('imagen'),
  /**
   * Puede estar vacío mientras se elige el archivo.
   *
   * Exigirlo desde el primer momento parecía más estricto y era peor: al añadir
   * una capa de imagen el documento quedaba inválido hasta elegir la foto, así
   * que el guardado automático fallaba con un error que no decía nada. El
   * renderizador ya dibuja un hueco identificado cuando no hay archivo.
   */
  activoId: z.string().max(40).default(''),
  ajuste: z.enum(['cubrir', 'contener', 'estirar']).default('cubrir'),
  foco: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .default({ x: 0.5, y: 0.5 }),
  radio: z.number().min(0).max(2000).default(0),
  filtros: z
    .object({
      brillo: z.number().min(0).max(3).default(1),
      contraste: z.number().min(0).max(3).default(1),
      saturacion: z.number().min(0).max(3).default(1),
      desenfoque: z.number().min(0).max(100).default(0),
    })
    .optional(),
  trazo: trazoSchema.optional(),
});

export const capaFormaSchema = z.object({
  ...comun,
  tipo: z.literal('forma'),
  forma: z.enum(['rectangulo', 'elipse', 'linea', 'triangulo', 'estrella']).default('rectangulo'),
  relleno: rellenoSchema.default({ tipo: 'solido', color: '#e11d48' }),
  trazo: trazoSchema.optional(),
  radio: z.number().min(0).max(2000).default(0),
  /** Puntas de la estrella. Se ignora en las demás formas. */
  puntas: z.number().int().min(3).max(20).default(5),
});

export const capaVectorSchema = z.object({
  ...comun,
  tipo: z.literal('vector'),
  /** SVG ya saneado al importarlo. Nunca se guarda el original tal cual. */
  svg: z.string().max(200000),
  /** Recolorea los trazos y rellenos del SVG: logos monocromos. */
  color: color.optional(),
});

export const capaBotonSchema = z.object({
  ...comun,
  tipo: z.literal('boton'),
  texto: traducible,
  relleno: rellenoSchema.default({ tipo: 'solido', color: '@primario' }),
  color: color.default('#ffffff'),
  radio: z.number().min(0).max(2000).default(8),
  tamano: z.number().min(4).max(200).default(16),
  fuente: z.string().max(80).default('marca'),
  peso: z.number().int().min(100).max(900).default(700),
});

/**
 * Bloque atado a un producto real del catálogo.
 *
 * Es lo que ninguna herramienta de diseño puede hacer: la foto, el nombre y el
 * precio salen de la base de datos al renderizar. De una plantilla salen
 * treinta banners, y —lo que importa más— ningún banner puede anunciar un
 * precio que ya no existe, que es publicidad engañosa y no un despiste.
 */
export const capaProductoSchema = z.object({
  ...comun,
  tipo: z.literal('producto'),
  productId: z.string().min(1).max(40),
  disposicion: z.enum(['foto', 'foto-precio', 'ficha']).default('foto-precio'),
  mostrarAntes: z.boolean().default(true),
  mostrarDescuento: z.boolean().default(true),
  color: color.default('#111111'),
  fuente: z.string().max(80).default('marca'),
});

export const capaVideoSchema = z.object({
  ...comun,
  tipo: z.literal('video'),
  /** Vacío mientras se elige, igual que en la capa de imagen. */
  activoId: z.string().max(40).default(''),
  ajuste: z.enum(['cubrir', 'contener']).default('cubrir'),
  desdeMs: z.number().min(0).max(600000).default(0),
  hastaMs: z.number().min(0).max(600000).optional(),
  silenciado: z.boolean().default(true),
  radio: z.number().min(0).max(2000).default(0),
});

/**
 * Un bloque de HTML tal cual.
 *
 * Es la vía de escape del editor: hay piezas que llegan ya maquetadas —una
 * plantilla de la red, un trozo que alguien escribió a mano— y convertirlas en
 * capas una a una no siempre compensa. Esta capa las pinta como están y deja
 * tocar el código.
 *
 * El contenido se sanea **en el servidor** al guardar, no aquí: este esquema lo
 * usan el editor y el renderizador, y una validación que solo corre en el
 * navegador no protege de nada. Lo que llega es marcado sin scripts, sin
 * manejadores de eventos y sin marcos.
 */
export const capaHtmlSchema = z.object({
  ...comun,
  tipo: z.literal('html'),
  html: z.string().max(200000).default(''),
  /** CSS propio del bloque, acotado a él al pintarlo. */
  css: z.string().max(50000).default(''),
});

export const capaGrupoSchema = z.object({
  ...comun,
  tipo: z.literal('grupo'),
  /** Recorta lo que sobresalga de sus límites. */
  recorta: z.boolean().default(false),
});

export const capaInstanciaSchema = z.object({
  ...comun,
  tipo: z.literal('instancia'),
  componenteId: z.string().min(1).max(40),
  /** Lo que esta instancia cambia respecto al componente. */
  sustituciones: z.record(z.string().max(40), z.unknown()).default({}),
});

export const capaSchema = z.discriminatedUnion('tipo', [
  capaTextoSchema,
  capaImagenSchema,
  capaFormaSchema,
  capaVectorSchema,
  capaBotonSchema,
  capaProductoSchema,
  capaVideoSchema,
  capaHtmlSchema,
  capaGrupoSchema,
  capaInstanciaSchema,
]);

export type Capa = z.infer<typeof capaSchema>;
export type TipoCapa = Capa['tipo'];
export type CapaTexto = z.infer<typeof capaTextoSchema>;
export type CapaImagen = z.infer<typeof capaImagenSchema>;
export type CapaForma = z.infer<typeof capaFormaSchema>;
export type CapaProducto = z.infer<typeof capaProductoSchema>;
export type CapaHtml = z.infer<typeof capaHtmlSchema>;

// ═════════════════════════════════════════════════════════════
//  Mesas, estilos y documento
// ═════════════════════════════════════════════════════════════

export const mesaSchema = z.object({
  id: z.string().min(1).max(40),
  nombre: z.string().max(80).default(''),
  /** Clave del catálogo de formatos, o vacío si es un tamaño a medida. */
  formato: z.string().max(60).default(''),
  ancho: z.number().int().min(16).max(8000),
  alto: z.number().int().min(16).max(8000),
  fondo: rellenoSchema.default({ tipo: 'solido', color: '#ffffff' }),
  /** Posición en el lienzo infinito. Solo afecta a dónde se ve al editar. */
  posicion: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  /**
   * La mesa de la que copian las demás.
   *
   * Solo puede haber una. No manda sobre las otras —cada mesa se edita a
   * mano—, pero es de la que sale el contenido al enlazar capas y la que se
   * clona al añadir formatos.
   */
  maestra: z.boolean().default(false),
  /** Idioma de esta mesa, cuando una campaña sale en varios. */
  locale: z.string().max(5).optional(),
});

export type Mesa = z.infer<typeof mesaSchema>;

export const estiloColorSchema = z.object({
  id: z.string().min(1).max(40),
  nombre: z.string().max(60),
  valor: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/),
});

export const estiloTextoSchema = z.object({
  id: z.string().min(1).max(40),
  nombre: z.string().max(60),
  fuente: z.string().max(80).default('marca'),
  peso: z.number().int().min(100).max(900).default(700),
  tamano: z.number().min(4).max(800).default(24),
  interlineado: z.number().min(0.6).max(3).default(1.15),
  espaciado: z.number().min(-10).max(40).default(0),
  color: color.default('#111111'),
});

export const variableSchema = z.object({
  clave: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, 'La clave es minúsculas, números y guion bajo'),
  tipo: z.enum(['texto', 'color', 'imagen']),
  etiqueta: z.string().max(60).default(''),
  valor: z.string().max(500).default(''),
});

/** Tope de mesas por documento. Con más, el lienzo deja de ser navegable. */
export const MAX_MESAS = 40;
/** Tope de capas por documento, sumando todas las mesas. */
export const MAX_CAPAS = 600;

export const VERSION_DOCUMENTO = 1;

export const documentoSchema = z.object({
  version: z.number().int().min(1).max(99).default(VERSION_DOCUMENTO),
  mesas: z.array(mesaSchema).min(1).max(MAX_MESAS),
  capas: z.array(capaSchema).max(MAX_CAPAS).default([]),
  estilos: z
    .object({
      colores: z.array(estiloColorSchema).max(60).default([]),
      textos: z.array(estiloTextoSchema).max(60).default([]),
    })
    .default({ colores: [], textos: [] }),
  variables: z.array(variableSchema).max(40).default([]),
  animacion: z
    .object({
      duracionMs: z.number().min(0).max(60000).default(0),
      /** 0 = sin fin. Las redes suelen querer 3 como mucho. */
      bucles: z.number().int().min(0).max(20).default(3),
    })
    .default({ duracionMs: 0, bucles: 3 }),
});

export type Documento = z.infer<typeof documentoSchema>;

// ═════════════════════════════════════════════════════════════
//  Operaciones sobre el documento
// ═════════════════════════════════════════════════════════════

/** Documento nuevo con una sola mesa del formato pedido. */
export function documentoVacio(formato: FormatoAnuncio | string, nuevoId: () => string): Documento {
  const f = resolverFormato(formato);

  return documentoSchema.parse({
    version: VERSION_DOCUMENTO,
    mesas: [
      {
        id: nuevoId(),
        nombre: f.nombre,
        formato: f.clave,
        ancho: f.ancho,
        alto: f.alto,
        maestra: true,
      },
    ],
    capas: [],
  });
}

/**
 * Documento nuevo con una mesa a medida, sin ficha de red detrás.
 *
 * Existe porque no todo lo que se diseña es un formato de anuncio: una cabecera
 * para un sitio concreto o una prueba rápida no tienen ficha, y obligar a elegir
 * una del catálogo llevaría a elegir la que menos desentone y trabajar con el
 * peso máximo equivocado.
 */
export function documentoAMedida(
  ancho: number,
  alto: number,
  nuevoId: () => string,
  nombre?: string,
): Documento {
  return documentoSchema.parse({
    version: VERSION_DOCUMENTO,
    mesas: [
      {
        id: nuevoId(),
        nombre: nombre ?? `${Math.round(ancho)}×${Math.round(alto)}`,
        formato: clavePersonalizada(ancho, alto),
        ancho: Math.round(ancho),
        alto: Math.round(alto),
        maestra: true,
      },
    ],
    capas: [],
  });
}

/** El formato pedido, por objeto o por clave, o un error que dice cuál falta. */
function resolverFormato(formato: FormatoAnuncio | string): FormatoAnuncio {
  if (typeof formato !== 'string') return formato;
  const f = formatoPorClave(formato);
  if (!f) throw new Error(`Formato desconocido: ${formato}`);
  return f;
}

export function mesaMaestra(doc: Documento): Mesa {
  const mesa = doc.mesas.find((m) => m.maestra) ?? doc.mesas[0];
  if (!mesa) throw new Error('El documento no tiene ninguna mesa');
  return mesa;
}

export const capasDeMesa = (doc: Documento, mesaId: string): Capa[] =>
  doc.capas.filter((c) => c.mesaId === mesaId).sort((a, b) => a.orden - b.orden);

/**
 * Lleva un recuadro de una mesa a otra respetando su anclaje.
 *
 * Esto es lo que convierte «añadir once formatos» en cinco minutos. La regla:
 *
 *  · El **tamaño** escala con el factor uniforme más pequeño de los dos ejes.
 *    Escalar cada eje por su cuenta deforma las fotos y los logos, y es el
 *    error que hace que un banner adaptado se note adaptado.
 *  · La **posición** se mide desde el borde al que la capa está anclada, así
 *    que un logo pegado a la esquina inferior derecha sigue pegado a ella.
 *  · `estirar` es la excepción: conserva los dos márgenes y estira, que es lo
 *    que quiere un fondo y lo que nunca quiere una foto.
 *
 * No pretende acertar siempre —de 728×90 a 300×500 no hay regla que acierte—;
 * pretende dejarlo lo bastante cerca como para rematarlo a mano.
 */
export function recolocarRecuadro(
  recuadro: Recuadro,
  anclaje: Anclaje,
  origen: { ancho: number; alto: number },
  destino: { ancho: number; alto: number },
): Recuadro {
  const fx = destino.ancho / origen.ancho;
  const fy = destino.alto / origen.alto;
  const f = Math.min(fx, fy);

  let ancho = recuadro.ancho * f;
  let alto = recuadro.alto * f;
  let x: number;
  let y: number;

  if (anclaje.x === 'estirar') {
    const margenIzq = recuadro.x;
    const margenDer = origen.ancho - (recuadro.x + recuadro.ancho);
    x = margenIzq * fx;
    ancho = Math.max(1, destino.ancho - margenIzq * fx - margenDer * fx);
  } else if (anclaje.x === 'derecha') {
    const margen = origen.ancho - (recuadro.x + recuadro.ancho);
    x = destino.ancho - margen * f - ancho;
  } else if (anclaje.x === 'centro') {
    const centro = recuadro.x + recuadro.ancho / 2;
    x = (centro / origen.ancho) * destino.ancho - ancho / 2;
  } else {
    x = recuadro.x * f;
  }

  if (anclaje.y === 'estirar') {
    const margenSup = recuadro.y;
    const margenInf = origen.alto - (recuadro.y + recuadro.alto);
    y = margenSup * fy;
    alto = Math.max(1, destino.alto - margenSup * fy - margenInf * fy);
  } else if (anclaje.y === 'abajo') {
    const margen = origen.alto - (recuadro.y + recuadro.alto);
    y = destino.alto - margen * f - alto;
  } else if (anclaje.y === 'centro') {
    const centro = recuadro.y + recuadro.alto / 2;
    y = (centro / origen.alto) * destino.alto - alto / 2;
  } else {
    y = recuadro.y * f;
  }

  return {
    x: redondear(x),
    y: redondear(y),
    ancho: redondear(Math.max(1, ancho)),
    alto: redondear(Math.max(1, alto)),
    rotacion: recuadro.rotacion,
  };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Escala el cuerpo de una capa de texto al cambiar de mesa.
 *
 * El recuadro ya lo mueve `recolocarRecuadro`, pero el tamaño de fuente no está
 * en el recuadro: sin esto, un titular de 48 px diseñado para un 1080×1920
 * aparece igual de grande en un 300×100 y tapa el banner entero.
 */
export const escalarTipografia = (tamano: number, factor: number): number =>
  Math.max(4, redondear(tamano * factor));

/**
 * Duplica una mesa a otro formato, recolocando todas sus capas.
 *
 * Las copias quedan **enlazadas** a las originales: el contenido se sincroniza,
 * la geometría no. Es el comportamiento que se quiere el 95 % de las veces —el
 * titular es el mismo, la composición no— y el enlace se rompe capa a capa
 * desde el editor cuando toca.
 */
export function clonarMesa(
  doc: Documento,
  mesaId: string,
  formato: FormatoAnuncio | string,
  nuevoId: () => string,
): Documento {
  const origen = doc.mesas.find((m) => m.id === mesaId);
  if (!origen) throw new Error(`No existe la mesa ${mesaId}`);

  const f = resolverFormato(formato);
  if (doc.mesas.length >= MAX_MESAS) throw new Error('El documento ya tiene el máximo de mesas');

  const destino: Mesa = {
    ...origen,
    id: nuevoId(),
    nombre: f.nombre,
    formato: f.clave,
    ancho: f.ancho,
    alto: f.alto,
    maestra: false,
    // A la derecha de la última mesa, con un hueco para que se vean separadas.
    posicion: { x: derechaDelLienzo(doc) + 80, y: origen.posicion.y },
  };

  const factor = Math.min(f.ancho / origen.ancho, f.alto / origen.alto);
  const equivalencias = new Map<string, string>();
  const originales = capasDeMesa(doc, mesaId);
  for (const c of originales) equivalencias.set(c.id, nuevoId());

  const copias = originales.map((c) => {
    const base = {
      ...c,
      id: equivalencias.get(c.id) ?? nuevoId(),
      mesaId: destino.id,
      padreId: c.padreId ? equivalencias.get(c.padreId) : undefined,
      recuadro: recolocarRecuadro(c.recuadro, c.anclaje, origen, destino),
      // Si la original no tenía enlace, se le pone ahora: es el momento en que
      // pasa a existir una hermana con la que sincronizarse.
      enlace: c.enlace ?? c.id,
    };
    if (base.tipo === 'texto') return { ...base, tamano: escalarTipografia(base.tamano, factor) };
    if (base.tipo === 'boton') return { ...base, tamano: escalarTipografia(base.tamano, factor) };
    return base;
  });

  // A las originales sin enlace se les asigna el suyo, o la sincronización solo
  // iría en un sentido.
  const capas: Capa[] = doc.capas.map((c) =>
    c.mesaId === mesaId && !c.enlace ? { ...c, enlace: c.id } : c,
  );

  return { ...doc, mesas: [...doc.mesas, destino], capas: [...capas, ...copias] };
}

const derechaDelLienzo = (doc: Documento): number =>
  doc.mesas.reduce((max, m) => Math.max(max, m.posicion.x + m.ancho), 0);

/** Campos que viajan entre capas enlazadas: contenido, nunca geometría. */
const CAMPOS_SINCRONIZADOS = [
  'contenido',
  'texto',
  'activoId',
  'svg',
  'relleno',
  'color',
  'productId',
  'componenteId',
  'sustituciones',
  'filtros',
  'trazo',
  'disposicion',
] as const;

/**
 * Propaga el contenido de una capa a sus hermanas de otras mesas.
 *
 * Lo que NO se propaga es tan importante como lo que sí: posición, tamaño,
 * rotación, anclaje y tamaño de fuente se quedan donde están. Si se propagaran,
 * arreglar el titular en la mesa de 728×90 lo rompería en las otras once, que
 * es exactamente el motivo por el que la gente acaba con doce archivos sueltos.
 */
export function sincronizarEnlace(doc: Documento, capaId: string): Documento {
  const fuente = doc.capas.find((c) => c.id === capaId);
  if (!fuente?.enlace) return doc;

  const cambios: Record<string, unknown> = {};
  for (const campo of CAMPOS_SINCRONIZADOS) {
    if (campo in fuente) cambios[campo] = (fuente as Record<string, unknown>)[campo];
  }

  return {
    ...doc,
    capas: doc.capas.map((c) =>
      c.id !== fuente.id && c.enlace === fuente.enlace && c.tipo === fuente.tipo
        ? { ...c, ...cambios }
        : c,
    ),
  };
}

/** Rompe el enlace de una capa: a partir de aquí va por libre. */
export function desenlazar(doc: Documento, capaId: string): Documento {
  return {
    ...doc,
    capas: doc.capas.map((c) => (c.id === capaId ? { ...c, enlace: undefined } : c)),
  };
}

/**
 * Resuelve un color que puede ser una referencia a un estilo compartido.
 *
 * Cae al propio valor si la referencia no existe: un estilo borrado deja el
 * color en `@primario`, y pintar eso como negro sería peor que no pintarlo.
 */
export function resolverColor(doc: Documento, valor: string, respaldo = '#000000'): string {
  if (!valor.startsWith('@')) return valor;
  const id = valor.slice(1);
  return doc.estilos.colores.find((e) => e.id === id)?.valor ?? respaldo;
}

/**
 * Sustituye `{{variable}}` en un texto.
 *
 * Es lo que permite que una plantilla diga «{{descuento}} de descuento» y que
 * el mismo documento sirva para la campaña de julio y la de noviembre.
 */
export function aplicarVariables(texto: string, doc: Documento): string {
  return texto.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (original, clave: string) => {
    const v = doc.variables.find((x) => x.clave === clave);
    return v ? v.valor : original;
  });
}

/** Problemas de estructura del documento, para avisar antes de guardar. */
export function problemasDelDocumento(doc: Documento): string[] {
  const problemas: string[] = [];
  const mesas = new Set(doc.mesas.map((m) => m.id));
  const capas = new Set(doc.capas.map((c) => c.id));

  if (doc.mesas.filter((m) => m.maestra).length > 1) {
    problemas.push('Hay más de una mesa marcada como maestra.');
  }
  if (new Set(doc.mesas.map((m) => m.id)).size !== doc.mesas.length) {
    problemas.push('Hay mesas con el mismo identificador.');
  }
  if (capas.size !== doc.capas.length) {
    problemas.push('Hay capas con el mismo identificador.');
  }
  for (const c of doc.capas) {
    if (!mesas.has(c.mesaId))
      problemas.push(`La capa «${c.nombre || c.id}» apunta a una mesa que no existe.`);
    if (c.padreId && !capas.has(c.padreId)) {
      problemas.push(`La capa «${c.nombre || c.id}» está dentro de un grupo que no existe.`);
    }
    if (c.padreId === c.id) problemas.push(`La capa «${c.nombre || c.id}» se contiene a sí misma.`);
  }
  return problemas;
}

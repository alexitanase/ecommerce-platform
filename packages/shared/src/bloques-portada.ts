import { z } from 'zod';
import { LOCALES, type Locale } from './locales.js';

/**
 * Bloques de la portada.
 *
 * La portada no está escrita en el código: es una lista ordenada de bloques que
 * se edita desde el panel. Cambiar el orden, el texto del hero o los productos
 * destacados en campaña no puede depender de un despliegue, porque entonces no
 * se hace y la portada se queda igual todo el año.
 *
 * El esquema vive en `shared` porque lo usan los tres: la API lo valida al
 * guardar, el admin construye el formulario con él y la tienda lo pinta. Con
 * tres copias, la primera que se desincroniza rompe la portada entera —y es la
 * página que más se visita.
 *
 * Los textos son un objeto por idioma. Traducir es opcional: si falta el
 * catalán se cae al español (`textoDe`), porque una portada en otro idioma es
 * mejor que una portada con huecos.
 */

/**
 * Texto traducible. Ningún idioma es obligatorio salvo el de la tienda.
 *
 * Se exporta porque lo reutiliza el menú de navegación: dos definiciones de «lo
 * mismo traducido» se separan en cuanto una cambia de límite.
 */
export const traducible = z.partialRecord(z.enum(LOCALES), z.string().max(500));

export type Traducible = z.infer<typeof traducible>;

/** Texto en el idioma pedido, con respaldo al español y a lo que haya. */
export function textoDe(valor: Traducible | undefined, locale: Locale): string {
  if (!valor) return '';
  return valor[locale] ?? valor.es ?? Object.values(valor).find((v) => v) ?? '';
}

const comun = {
  id: z.string().min(1).max(40),
  visible: z.boolean().default(true),
};

/** Enlace de un botón: interno ("/buscar") o absoluto. */
const enlace = z.string().trim().max(300);

export const bloqueHeroSchema = z.object({
  ...comun,
  tipo: z.literal('hero'),
  titulo: traducible,
  subtitulo: traducible.optional(),
  textoBoton: traducible.optional(),
  enlaceBoton: enlace.optional(),
  imagen: z.string().trim().max(500).optional(),
  /** Con imagen de fondo hace falta oscurecerla o el texto no se lee. */
  oscurecer: z.boolean().default(true),
});

/**
 * Origen de los productos de un bloque de destacados.
 *
 * `manual` gana en campaña —se eligen a dedo— pero se queda obsoleto solo: si
 * un producto se agota o se retira, el hueco se nota. Por eso el resto de
 * orígenes son consultas, no listas.
 */
export const origenDestacados = z.enum(['novedad', 'valoracion', 'categoria', 'manual']);

export const bloqueDestacadosSchema = z.object({
  ...comun,
  tipo: z.literal('destacados'),
  titulo: traducible,
  origen: origenDestacados.default('novedad'),
  /** Con `origen: 'categoria'`. */
  categoryId: z.string().max(40).optional(),
  /** Con `origen: 'manual'`: identificadores de producto, en orden. */
  productIds: z.array(z.string().min(1).max(40)).max(24).default([]),
  limite: z.number().int().min(2).max(24).default(8),
});

export const bloqueColeccionesSchema = z.object({
  ...comun,
  tipo: z.literal('colecciones'),
  titulo: traducible,
  /** Categorías a destacar, en orden. Vacío: las de primer nivel. */
  categoryIds: z.array(z.string().min(1).max(40)).max(12).default([]),
});

export const bloqueBannerSchema = z.object({
  ...comun,
  tipo: z.literal('banner'),
  titulo: traducible,
  texto: traducible.optional(),
  textoBoton: traducible.optional(),
  enlaceBoton: enlace.optional(),
  imagen: z.string().trim().max(500).optional(),
});

export const bloqueTestimoniosSchema = z.object({
  ...comun,
  tipo: z.literal('testimonios'),
  titulo: traducible,
  testimonios: z
    .array(z.object({ texto: traducible, autor: z.string().trim().max(80) }))
    .max(12)
    .default([]),
});

/**
 * Ventajas de comprar aquí: envío, devoluciones, pago.
 *
 * Parece decoración y no lo es. En una tienda desconocida, decir cuánto tarda
 * el envío y que hay 14 días de devolución es de lo que más mueve la primera
 * compra, y además la ley obliga a informarlo antes de comprar.
 */
export const bloqueVentajasSchema = z.object({
  ...comun,
  tipo: z.literal('ventajas'),
  ventajas: z
    .array(z.object({ titulo: traducible, texto: traducible.optional() }))
    .max(6)
    .default([]),
});

export const bloquePortadaSchema = z.discriminatedUnion('tipo', [
  bloqueHeroSchema,
  bloqueDestacadosSchema,
  bloqueColeccionesSchema,
  bloqueBannerSchema,
  bloqueTestimoniosSchema,
  bloqueVentajasSchema,
]);

export const bloquesPortadaSchema = z.array(bloquePortadaSchema).max(30);

export type BloquePortada = z.infer<typeof bloquePortadaSchema>;
export type TipoBloque = BloquePortada['tipo'];
export type BloqueHero = z.infer<typeof bloqueHeroSchema>;
export type BloqueDestacados = z.infer<typeof bloqueDestacadosSchema>;
export type BloqueColecciones = z.infer<typeof bloqueColeccionesSchema>;
export type BloqueBanner = z.infer<typeof bloqueBannerSchema>;
export type BloqueTestimonios = z.infer<typeof bloqueTestimoniosSchema>;
export type BloqueVentajas = z.infer<typeof bloqueVentajasSchema>;

export const TIPOS_BLOQUE: TipoBloque[] = [
  'hero',
  'destacados',
  'colecciones',
  'banner',
  'ventajas',
  'testimonios',
];

/**
 * Portada por defecto de una tienda recién instalada.
 *
 * No se deja vacía a propósito: una portada en blanco parece una tienda rota, y
 * el primer día es cuando menos ganas hay de montarla desde cero. Con esto ya
 * hay algo que enseñar, y se edita encima.
 */
export function bloquesPorDefecto(): BloquePortada[] {
  return [
    {
      id: 'hero',
      tipo: 'hero',
      visible: true,
      titulo: { es: 'Bienvenido a la tienda', ca: 'Benvingut a la botiga', en: 'Welcome' },
      subtitulo: {
        es: 'Envíos a toda España y devoluciones en 14 días.',
        ca: 'Enviaments a tot Espanya i devolucions en 14 dies.',
        en: 'Shipping across Spain and 14-day returns.',
      },
      textoBoton: { es: 'Ver catálogo', ca: 'Veure catàleg', en: 'Browse the catalogue' },
      enlaceBoton: '/buscar',
      oscurecer: true,
    },
    /*
     * Las categorías, justo debajo del hero.
     *
     * Sin lista de identificadores: coge las de primer nivel, que es lo único
     * que se puede saber de antemano en una tienda que todavía no tiene
     * catálogo. Y su foto la pone la portada en caché de cada categoría, así
     * que sale con imagen sin que nadie suba doce fotos el primer día.
     *
     * Va antes que los productos a propósito. Quien entra sabiendo lo que
     * quiere usa el buscador; quien entra a mirar necesita que le digan qué
     * hay, y ocho productos sueltos de un catálogo de miles no se lo dicen.
     * Se quita desde el panel en un clic si no encaja con la tienda.
     */
    {
      id: 'categorias',
      tipo: 'colecciones',
      visible: true,
      titulo: { es: 'Explora por categoría', ca: 'Explora per categoria', en: 'Shop by category' },
      categoryIds: [],
    },
    {
      id: 'novedades',
      tipo: 'destacados',
      visible: true,
      titulo: { es: 'Novedades', ca: 'Novetats', en: 'New arrivals' },
      origen: 'novedad',
      productIds: [],
      limite: 8,
    },
    {
      id: 'ventajas',
      tipo: 'ventajas',
      visible: true,
      ventajas: [
        {
          titulo: {
            es: 'Envío a toda España',
            ca: 'Enviament a tot Espanya',
            en: 'Spain-wide shipping',
          },
          texto: {
            es: 'Con seguimiento desde que sale hasta que llega.',
            ca: 'Amb seguiment des que surt fins que arriba.',
            en: 'Tracked from dispatch to delivery.',
          },
        },
        {
          titulo: {
            es: '14 días para devolver',
            ca: '14 dies per retornar',
            en: '14 days to return',
          },
          texto: {
            es: 'Sin dar explicaciones, como marca la ley.',
            ca: 'Sense donar explicacions, com marca la llei.',
            en: 'No questions asked, as the law requires.',
          },
        },
        {
          titulo: { es: 'Pago seguro', ca: 'Pagament segur', en: 'Secure payment' },
          texto: {
            es: 'No guardamos los datos de tu medio de pago.',
            ca: 'No desem les dades del teu mitjà de pagament.',
            en: 'We never store your payment details.',
          },
        },
      ],
    },
    {
      id: 'valorados',
      tipo: 'destacados',
      visible: true,
      titulo: { es: 'Lo mejor valorado', ca: 'El millor valorat', en: 'Top rated' },
      origen: 'valoracion',
      productIds: [],
      limite: 4,
    },
  ];
}

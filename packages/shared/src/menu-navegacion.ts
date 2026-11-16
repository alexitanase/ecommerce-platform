import { z } from 'zod';
import { traducible } from './bloques-portada.js';

/**
 * El menú de la sub-barra de la tienda.
 *
 * Es la franja de enlaces que va justo debajo de la cabecera. Existe porque la
 * cabecera no tenía **ni un solo enlace de navegación**: había logo, buscador,
 * deseos, cuenta y carrito, así que la única forma de llegar al catálogo era
 * escribir en el buscador. Quien entra a mirar sin saber qué quiere no tenía por
 * dónde empezar.
 *
 * Se configura desde el panel y no en el código por el mismo motivo que la
 * portada: las categorías que interesa destacar cambian con la temporada, y si
 * cambiarlas exige un despliegue no se cambian.
 *
 * El esquema vive en `shared` porque lo usan los tres: la API lo valida al
 * guardar, el panel construye el formulario con él y la tienda lo pinta.
 */

export const TIPOS_ENLACE = ['pagina', 'categoria', 'url'] as const;
export type TipoEnlace = (typeof TIPOS_ENLACE)[number];

/**
 * Destinos que se admiten en un enlace de tipo `url`.
 *
 * O una ruta de la propia tienda —empezando por una barra y no por dos— o una
 * dirección `http(s)` completa. Nada más.
 *
 * Esto **no** es quisquillosidad: el valor acaba en el `href` de un enlace de
 * todas las páginas de la tienda. Un `javascript:…` guardado aquí sería código
 * ajeno ejecutándose en nuestro dominio en cuanto alguien lo pulsara, y como se
 * guarda una vez y se sirve a todo el mundo, sería un XSS almacenado en la
 * navegación principal. Que solo pueda editarlo el equipo no es defensa: basta
 * una cuenta del panel comprometida.
 */
const RUTA_INTERNA = /^\/(?!\/)[^\s]*$/;
const URL_ABSOLUTA = /^https?:\/\/[^\s]+$/i;

export const destinoUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((v) => RUTA_INTERNA.test(v) || URL_ABSOLUTA.test(v), {
    message: 'El enlace debe ser una ruta de la tienda («/buscar») o una dirección http(s).',
  });

export const enlaceMenuSchema = z
  .object({
    id: z.string().min(1).max(40),
    visible: z.boolean().default(true),
    tipo: z.enum(TIPOS_ENLACE),
    /**
     * Qué se enlaza: el id de la página, el id de la categoría o la dirección.
     *
     * Se guarda el **id** y no el slug a propósito: los slugs son distintos en
     * cada idioma y además se pueden editar. Con el slug guardado, cambiar el
     * título de una página en el panel rompería el menú sin avisar.
     */
    destino: z.string().trim().min(1).max(300),
    /**
     * Texto del enlace. Si falta, se usa el nombre real de la página o de la
     * categoría, que casi siempre es lo que se quiere.
     */
    etiqueta: traducible.optional(),
    /** Se pinta llamando la atención: «Ofertas», «Novedades». */
    destacado: z.boolean().default(false),
  })
  .superRefine((enlace, ctx) => {
    if (enlace.tipo !== 'url') return;

    const comprobado = destinoUrlSchema.safeParse(enlace.destino);
    if (!comprobado.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['destino'],
        message: comprobado.error.issues[0]?.message ?? 'Enlace no válido',
      });
    }

    /*
     * A un enlace suelto hay que ponerle texto.
     *
     * En los de página y categoría la etiqueta puede faltar porque hay de dónde
     * sacarla —el título real—, pero una URL no tiene nombre: sin etiqueta
     * saldría un enlace en blanco en la barra de navegación de toda la tienda.
     */
    if (!Object.values(enlace.etiqueta ?? {}).some((v) => v && v.trim() !== '')) {
      ctx.addIssue({
        code: 'custom',
        path: ['etiqueta'],
        message: 'Un enlace a una dirección necesita texto en algún idioma.',
      });
    }
  });

export type EnlaceMenu = z.infer<typeof enlaceMenuSchema>;

/**
 * Como mucho doce.
 *
 * No es un límite técnico: es que una barra de navegación con veinte enlaces no
 * se lee, y en el móvil se convierte en una tira infinita que hay que arrastrar.
 * Si hacen falta más, lo que hace falta es un menú desplegable.
 */
export const MAXIMO_ENLACES = 12;

export const menuNavegacionSchema = z.array(enlaceMenuSchema).max(MAXIMO_ENLACES);

export type MenuNavegacion = z.infer<typeof menuNavegacionSchema>;

/**
 * El menú de fábrica.
 *
 * El catálogo y el índice de categorías, nada más. Es deliberado: si el menú
 * naciera vacío la sub-barra no se pintaría, y nadie sabría que existe hasta
 * encontrarla en el panel por casualidad —le ha pasado ya tres veces a este
 * proyecto—. Las dos rutas son fijas y sin parámetros, así que son las únicas
 * que no pueden quedarse obsoletas cuando cambie el catálogo.
 *
 * «Categorías» entra de fábrica porque la alternativa es que no entre nunca:
 * el menú admite seis enlaces y el catálogo tiene cientos de categorías, así
 * que a las que no caben solo se llega por esa página. Puesta a mano desde el
 * panel se le pondría el día que alguien echara de menos algo que no sabe que
 * existe.
 */
export function menuPorDefecto(): MenuNavegacion {
  return [
    {
      id: 'catalogo',
      visible: true,
      tipo: 'url',
      destino: '/buscar',
      etiqueta: { es: 'Catálogo', ca: 'Catàleg', en: 'Catalogue' },
      destacado: false,
    },
    {
      id: 'categorias',
      visible: true,
      tipo: 'url',
      destino: '/categorias',
      etiqueta: { es: 'Categorías', ca: 'Categories', en: 'Categories' },
      destacado: false,
    },
  ];
}

/** Un enlace ya resuelto para un idioma, tal y como lo pinta la tienda. */
export interface EnlaceResuelto {
  id: string;
  etiqueta: string;
  /** Ruta interna sin el idioma («/buscar») o URL absoluta. */
  href: string;
  /** Sale de la tienda: se abre en otra pestaña y se marca como externo. */
  externo: boolean;
  destacado: boolean;
}

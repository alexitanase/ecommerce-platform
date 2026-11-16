import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

/**
 * Rutas por idioma.
 *
 * `localePrefix: 'always'` hace que TODAS las URLs lleven el idioma delante
 * (/es/…, /ca/…, /en/…), incluido el idioma por defecto. Es más verboso, pero
 * evita el problema clásico de tener el mismo contenido accesible en dos URLs
 * (/producto y /es/producto), que Google penaliza como contenido duplicado.
 */
export const routing = defineRouting({
  locales: ['es', 'ca', 'en'],
  defaultLocale: 'es',
  localePrefix: 'always',

  // Slugs traducidos: cada mercado tiene su URL propia, mejor para SEO local.
  pathnames: {
    '/': '/',
    '/buscar': { es: '/buscar', ca: '/cercar', en: '/search' },
    // El índice del catálogo. Slug traducido como el del buscador: es una
    // página que se indexa y por la que entra tráfico de búsqueda.
    '/categorias': { es: '/categorias', ca: '/categories', en: '/categories' },
    // El índice de fabricantes. Traducido como el resto: por «marcas» se busca
    // en Google, y es una de las formas en que la gente llega a una tienda.
    '/marcas': { es: '/marcas', ca: '/marques', en: '/brands' },
    // Lo rebajado. Traducido porque es de las pocas páginas por las que se
    // busca escribiendo la palabra: «ofertas» + el nombre de la tienda.
    '/ofertas': { es: '/ofertas', ca: '/ofertes', en: '/deals' },
    '/carrito': { es: '/carrito', ca: '/cistella', en: '/cart' },
    '/checkout': { es: '/checkout', ca: '/checkout', en: '/checkout' },
    '/cuenta': { es: '/cuenta', ca: '/compte', en: '/account' },
    '/deseos': { es: '/deseos', ca: '/desitjos', en: '/wishlist' },
    // Páginas de contenido (aviso legal, privacidad, cookies…). Sin declararla
    // aquí, `<Link href={{ pathname: '/[slug]' }}>` no se resuelve y next/link
    // recibe la ruta con los corchetes dentro, que revienta el renderizado.
    '/[slug]': '/[slug]',
    // El blog es el canal de captación principal: con catálogo +18, Google Ads
    // y Meta Ads están cerrados y solo queda el tráfico orgánico.
    '/blog': { es: '/blog', ca: '/blog', en: '/blog' },
    '/blog/[slug]': { es: '/blog/[slug]', ca: '/blog/[slug]', en: '/blog/[slug]' },
    '/entrar': { es: '/entrar', ca: '/entrar', en: '/login' },
    // Mismo slug en los tres idiomas: la URL viaja dentro de correos ya
    // enviados, y traducirla rompería los enlaces del día que se cambie.
    '/preferencias': '/preferencias',
    '/registro': { es: '/registro', ca: '/registre', en: '/register' },
    /*
     * Estas cuatro las llevan enlaces de correos YA ENVIADOS.
     *
     * Cambiar su slug rompe los correos que están en bandejas de entrada
     * ahora mismo, así que van iguales en los tres idiomas y no se tocan. Y
     * tienen que existir: mientras no existieron, el enlace para verificar el
     * email y el de recuperar la contraseña llevaban a un 404.
     */
    '/recuperar': { es: '/recuperar', ca: '/recuperar', en: '/recover' },
    /*
     * El detalle de un pedido, igual en los tres idiomas.
     *
     * Su dirección la construye la API para los correos de confirmación y de
     * envío (`/{locale}/pedido/{token}`), así que traducir el slug rompería
     * todos los que ya están en bandejas de entrada. Y tiene que estar
     * declarada aquí: sin ella, `<Link href={{ pathname: '/pedido/[token]' }}>`
     * no compila y la cuenta no puede enlazar a sus propios pedidos.
     */
    '/pedido/[token]': '/pedido/[token]',
    '/restablecer': '/restablecer',
    '/verificar-email': '/verificar-email',
    '/preferencias/confirmar': '/preferencias/confirmar',
  },
});

export type Locale = (typeof routing.locales)[number];

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

/**
 * Qué se puede ver sin haber declarado la edad.
 *
 * La tienda entera es +18, así que la puerta va en la entrada y no producto a
 * producto: hoy el 100 % del catálogo está marcado como restringido, con lo
 * que sin puerta de entrada la portada sale vacía y el buscador no devuelve
 * nada — y no había forma de verificarse, porque la única puerta estaba en la
 * ficha de un producto al que no llegaba ningún enlace.
 *
 * Si algún día entra catálogo apto para todos los públicos, esto es lo único
 * que hay que cambiar: quitar la puerta general y dejar que cada ficha pida la
 * verificación cuando le toque, que es un camino que ya funciona.
 */

/**
 * Rutas que siguen abiertas sin verificar. No es una lista de comodidad:
 *
 *  · **Legales.** La LSSI obliga a que el aviso legal, la privacidad y las
 *    condiciones sean accesibles a cualquiera. Esconderlas detrás de una
 *    puerta es justo lo que la ley no permite.
 *  · **Seguimiento de pedido.** El enlace del correo de confirmación tiene que
 *    funcionar; quien ya ha comprado no puede encontrarse un formulario de
 *    edad para ver dónde está su paquete.
 *  · **Preferencias de correo.** Darse de baja no puede tener obstáculos: es
 *    requisito del RGPD, y además ponerle una puerta a quien quiere irse es la
 *    forma más rápida de acabar marcado como spam.
 *  · **La propia puerta**, evidentemente.
 */
const ABIERTAS = [
  'acceso',
  'aviso-legal',
  'privacidad',
  'cookies',
  'condiciones',
  'envios',
  'devoluciones',
  'pedido',
  'preferencias',
];

/**
 * ¿Esta ruta se puede servir sin verificar la edad?
 *
 * `ruta` llega con el idioma delante (`/es/privacidad`). Se compara el primer
 * segmento después del idioma, no la ruta entera: `/es/pedido/abc123/pago`
 * tiene que estar tan abierta como `/es/pedido/abc123`.
 */
export function rutaAbierta(ruta: string): boolean {
  const partes = ruta.split('/').filter(Boolean);
  // `/es` a secas es la portada: esa sí lleva puerta.
  const seccion = partes[1];
  return seccion !== undefined && ABIERTAS.includes(seccion);
}

/**
 * Quién viene solo a leer la cabecera del HTML.
 *
 * Cuando alguien pega un enlace de la tienda en WhatsApp, Telegram o X, esas
 * aplicaciones piden la página con su propio robot para sacar el título, la
 * descripción y la foto. **No traen cookies**, así que hasta ahora la puerta de
 * edad les respondía a todos con el formulario de verificación: la vista previa
 * de cualquier producto de la tienda salía con el nombre genérico de la tienda,
 * sin foto y sin decir qué se estaba compartiendo. Un enlace así no se pulsa.
 *
 * Estos robots leen `<head>` y se van; no navegan, no compran y no ven el
 * cuerpo de la página. Dejarles pasar la puerta les da los metadatos —que es
 * justo lo que se quiere compartir— y a la persona que pulse el enlace le sigue
 * saliendo la verificación de edad, porque su navegador sí entra por la puerta.
 *
 * **Los buscadores no están en esta lista, y siguen sin estarlo**, pero ya no
 * porque no pasen: pasan por otro camino. Aquí se identifica al robot por su
 * user-agent, que es una cadena que copia cualquiera, y para una vista previa da
 * igual —lo que se abre es el `<head>` de una página que se quería compartir—.
 * Para un buscador no da igual: dejarlo entrar por user-agent sería abrir la
 * puerta a todo el que lo escriba. Van por `lib/buscadores.ts`, que comprueba la
 * IP contra los rangos que Google y Bing publican.
 */

/**
 * Fragmentos que identifican a un robot de vista previa, en minúsculas.
 *
 * Se comparan por inclusión y no con una expresión exacta: cada aplicación
 * cambia su versión y su formato cada dos por tres, y una regla estricta se
 * rompe en silencio —la vista previa deja de salir y nadie se entera—.
 */
const ROBOTS = [
  // Meta: cubre las vistas previas de Facebook, Instagram y Messenger.
  'facebookexternalhit',
  'facebookcatalog',
  'meta-externalagent',
  // WhatsApp se identifica así tanto en el móvil como en la versión web.
  'whatsapp',
  'telegrambot',
  'twitterbot',
  'slackbot',
  'discordbot',
  'linkedinbot',
  'pinterest',
  'redditbot',
  'skypeuripreview',
  'vkshare',
  'applebot',
  // El estándar que usan varios lectores y clientes de correo.
  'embedly',
  'iframely',
  'opengraph',
] as const;

/** ¿Esta petición viene de un robot que solo quiere la vista previa? */
export function esRobotDeVistaPrevia(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;

  const ua = userAgent.toLowerCase();
  return ROBOTS.some((robot) => ua.includes(robot));
}

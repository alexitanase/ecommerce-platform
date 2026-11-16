/**
 * Cálculos de un artículo del blog.
 *
 * Para una tienda con catálogo +18 el contenido no es un adorno: Google Ads y
 * Meta Ads bloquean estos productos, así que el tráfico orgánico deja de ser
 * un complemento y pasa a ser el canal principal de captación. Eso cambia lo
 * que hay que cuidar aquí.
 *
 * Lógica pura y aparte del servicio, porque son las decisiones que se ven en
 * la pantalla —el resumen que se comparte en redes, el tiempo de lectura que
 * decide si alguien entra— y equivocarse en ellas no da ningún error.
 */

/**
 * Palabras por minuto de un lector medio en español.
 *
 * La horquilla habitual va de 200 a 250; se usa la baja a propósito. Decir
 * "3 min" y que se tarden 5 deja peor sensación que al revés.
 */
const PALABRAS_POR_MINUTO = 200;

/** Quita el marcado para poder contar y resumir sobre el texto de verdad. */
export function soloTexto(contenido: string): string {
  return (
    contenido
      // Bloques de código enteros: cuentan como texto y no se leen como tal.
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      // Imágenes antes que enlaces: comparten sintaxis y el orden importa.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      // De un enlace se queda el texto, que sí se lee.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      // Los marcadores de énfasis se BORRAN, no se sustituyen por un espacio:
      // `**palabra**` tiene que quedar en `palabra`, no en ` palabra `, o cada
      // palabra en negrita contaría como tres y el tiempo de lectura saldría
      // inflado. Los de bloque (#, >, |) sí separan y se cambian por espacio.
      .replace(/[*_~`]/g, '')
      .replace(/[#>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Minutos de lectura, redondeados hacia arriba.
 *
 * Nunca cero: un artículo de tres líneas es "1 min", no "0 min", que además de
 * raro invita a pensar que está vacío.
 */
export function minutosDeLectura(contenido: string): number {
  const palabras = soloTexto(contenido).split(' ').filter(Boolean).length;
  return Math.max(1, Math.ceil(palabras / PALABRAS_POR_MINUTO));
}

/**
 * Resumen para el listado y para lo que se comparte en redes.
 *
 * Se usa el que haya escrito quien redacta; solo si no lo hay se saca del
 * cuerpo. Un resumen automático siempre es peor —arranca por donde arranque el
 * texto, sin gancho— pero es infinitamente mejor que compartir un artículo con
 * la descripción vacía.
 *
 * Se corta por frase entera y, si no hay ninguna a mano, por palabra: un corte
 * a mitad de palabra en la tarjeta de un tuit se ve fatal.
 */
export function resumen(contenido: string, escrito?: string | null, maximo = 200): string {
  if (escrito?.trim()) return escrito.trim();

  const texto = soloTexto(contenido);
  if (texto.length <= maximo) return texto;

  const cortado = texto.slice(0, maximo);

  // Se prefiere terminar en un punto si queda razonablemente cerca del final.
  const finDeFrase = Math.max(
    cortado.lastIndexOf('. '),
    cortado.lastIndexOf('? '),
    cortado.lastIndexOf('! '),
  );
  if (finDeFrase > maximo * 0.5) return cortado.slice(0, finDeFrase + 1).trim();

  const ultimoEspacio = cortado.lastIndexOf(' ');
  return `${(ultimoEspacio > 0 ? cortado.slice(0, ultimoEspacio) : cortado).trim()}…`;
}

/**
 * Título para la etiqueta `<title>` y para Google.
 *
 * Google corta alrededor de los 60 caracteres. Pasarse no penaliza, pero el
 * resultado sale truncado con puntos suspensivos y la parte que suele quedar
 * fuera es justo la del final, donde se pone lo distintivo.
 */
export function tituloSeo(titulo: string, escrito?: string | null, maximo = 60): string {
  const elegido = escrito?.trim() || titulo.trim();
  if (elegido.length <= maximo) return elegido;

  const cortado = elegido.slice(0, maximo);
  const ultimoEspacio = cortado.lastIndexOf(' ');
  return (ultimoEspacio > maximo * 0.6 ? cortado.slice(0, ultimoEspacio) : cortado).trim();
}

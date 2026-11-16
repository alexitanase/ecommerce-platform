/**
 * Los enlaces para compartir una ficha.
 *
 * Va aparte del componente porque lo único que puede romperse aquí es la
 * construcción de la URL, y eso se prueba sin navegador. El fallo clásico no es
 * de diseño: un producto que se llama «Gel 2 en 1 & masaje» mete un `&` en la
 * cadena y, sin codificar, parte el parámetro por la mitad —el mensaje llega
 * cortado en «Gel 2 en 1» y el enlace se pierde—. Los nombres vienen del
 * proveedor, así que caracteres raros hay siempre.
 */

export interface EnlaceCompartir {
  clave: 'whatsapp' | 'telegram' | 'email';
  href: string;
  /** Sale a la web y se abre en otra pestaña. El correo no. */
  externo: boolean;
}

/**
 * @param url     dirección canónica de la ficha, absoluta
 * @param mensaje el texto que acompaña al enlace
 */
export function enlacesDeCompartir(url: string, mensaje: string): EnlaceCompartir[] {
  const u = encodeURIComponent(url);
  const m = encodeURIComponent(mensaje);

  return [
    // `wa.me` lleva mensaje y enlace en el mismo campo: WhatsApp no tiene uno
    // separado para la URL, la detecta dentro del texto.
    {
      clave: 'whatsapp',
      href: `https://wa.me/?text=${encodeURIComponent(`${mensaje} ${url}`)}`,
      externo: true,
    },
    { clave: 'telegram', href: `https://t.me/share/url?url=${u}&text=${m}`, externo: true },
    {
      clave: 'email',
      href: `mailto:?subject=${m}&body=${encodeURIComponent(`${mensaje}\n\n${url}`)}`,
      externo: false,
    },
  ];
}

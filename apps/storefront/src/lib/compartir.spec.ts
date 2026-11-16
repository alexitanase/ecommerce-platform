import { describe, expect, it } from 'vitest';
import { enlacesDeCompartir } from './compartir';

const URL_FICHA = 'https://tienda.local/es/producto/gel-2-en-1';

const de = (clave: string, url = URL_FICHA, mensaje = 'Mira esto') =>
  enlacesDeCompartir(url, mensaje).find((e) => e.clave === clave);

describe('enlacesDeCompartir', () => {
  it('mete el enlace y el texto en el mensaje de WhatsApp', () => {
    // WhatsApp no tiene campo aparte para la URL: si no va dentro del texto, se
    // comparte un mensaje sin enlace, que es compartir nada.
    const href = de('whatsapp')?.href ?? '';

    expect(href).toContain(encodeURIComponent(URL_FICHA));
    expect(href).toContain(encodeURIComponent('Mira esto'));
  });

  it('un nombre con «&» no parte la URL', () => {
    // Es el caso real: los nombres los escribe el proveedor. Sin codificar, el
    // «&» abre un parámetro nuevo y el mensaje llega cortado por ahí.
    const href = de('telegram', URL_FICHA, 'Gel 2 en 1 & masaje')?.href ?? '';

    expect(href).toContain('%26');
    expect(href.split('&').length).toBe(2);
  });

  it('una almohadilla en la URL no se come el resto del enlace', () => {
    // Un `#` sin codificar convierte todo lo que sigue en un ancla del propio
    // t.me, así que el destinatario recibe un enlace a la nada.
    const href = de('telegram', `${URL_FICHA}#opiniones`)?.href ?? '';

    expect(href).toContain('%23opiniones');
    expect(href).not.toContain('#');
  });

  it('el correo lleva el enlace en el cuerpo, no solo en el asunto', () => {
    const email = de('email');

    expect(email?.href.startsWith('mailto:?subject=')).toBe(true);
    expect(email?.href).toContain(`body=${encodeURIComponent('Mira esto\n\n')}`);
  });

  it('el correo no se abre en otra pestaña y las redes sí', () => {
    // Un `mailto:` con `target="_blank"` deja una pestaña en blanco que hay que
    // cerrar a mano.
    expect(de('email')?.externo).toBe(false);
    expect(de('whatsapp')?.externo).toBe(true);
    expect(de('telegram')?.externo).toBe(true);
  });
});

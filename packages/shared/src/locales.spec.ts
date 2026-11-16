import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_INFO,
  idiomaPorDefectoValido,
  isLocale,
  normalizarIdiomas,
  pickTranslation,
  negociarIdioma,
  resolveLocale,
} from './locales.js';

/**
 * La elección de idioma.
 *
 * Dos decisiones con consecuencias visibles: con qué idioma recibimos a alguien
 * que llega por primera vez, y qué se enseña cuando falta una traducción. La
 * segunda importa más de lo que parece: el catálogo se traduce en diferido
 * desde el panel, así que en cualquier momento hay fichas a medio traducir.
 */

describe('Idiomas declarados', () => {
  it('todos tienen su información de presentación', () => {
    // Añadir un idioma a LOCALES y olvidarse de LOCALE_INFO dejaría el selector
    // de idioma con una opción sin nombre.
    for (const locale of LOCALES) {
      expect(LOCALE_INFO[locale]?.nativeName, locale).toBeTruthy();
      expect(LOCALE_INFO[locale]?.bcp47, locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it('el idioma por defecto es uno de los declarados', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('isLocale rechaza lo que no está en la lista', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale('ES')).toBe(false);
  });
});

describe('Idioma a partir de la cabecera del navegador', () => {
  it('elige el que más se prefiere de los que tenemos', () => {
    expect(resolveLocale('ca-ES,ca;q=0.9,es;q=0.8')).toBe('ca');
  });

  it('respeta el orden de preferencia aunque el primero no lo tengamos', () => {
    // Un navegador en francés con español de segundo: se le atiende en
    // español, no en el idioma por defecto por casualidad.
    expect(resolveLocale('fr-FR,fr;q=0.9,en;q=0.7')).toBe('en');
  });

  it('la q manda sobre el orden de escritura', () => {
    expect(resolveLocale('en;q=0.2,ca;q=0.9')).toBe('ca');
  });

  it('ignora la región y se queda con el idioma', () => {
    expect(resolveLocale('es-MX')).toBe('es');
    expect(resolveLocale('EN-us')).toBe('en');
  });

  it('sin cabecera o sin nada que encaje, el idioma por defecto', () => {
    expect(resolveLocale()).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('fr-FR,de;q=0.9')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('*')).toBe(DEFAULT_LOCALE);
  });

  it('una cabecera malformada no revienta', () => {
    // Llega de fuera: puede venir cualquier cosa, y esto se ejecuta en cada
    // petición de la tienda.
    expect(resolveLocale(';;;')).toBe(DEFAULT_LOCALE);
    expect(resolveLocale('es;q=noesunnumero')).toBe('es');
  });
});

describe('Negociar solo entre los idiomas que se ofrecen', () => {
  it('salta el idioma preferido si está desactivado', () => {
    // Un navegador en catalán en una tienda que ha desactivado el catalán: se
    // le atiende en el siguiente que pida, no en catalán.
    expect(negociarIdioma('ca-ES,ca;q=0.9,es;q=0.8', ['es', 'en'])).toBe('es');
  });

  it('distingue «no hay preferencia» de «la preferencia no se puede servir»', () => {
    /*
     * Los dos casos acaban en el idioma por defecto del panel, pero por caminos
     * distintos, y el middleware necesita saber cuál es cuál: devolver un idioma
     * por defecto disfrazado de preferencia haría que la tienda ignorase el
     * ajuste del panel creyendo que respeta al visitante.
     */
    expect(negociarIdioma('fr-FR,de;q=0.9', ['es', 'en'])).toBeNull();
    expect(negociarIdioma(null, ['es', 'en'])).toBeNull();
    expect(negociarIdioma('', ['es', 'en'])).toBeNull();
  });

  it('sin lista se negocia contra todos los compilados', () => {
    expect(negociarIdioma('ca')).toBe('ca');
  });
});

describe('Elegir traducción', () => {
  it('devuelve la del idioma pedido', () => {
    expect(pickTranslation({ es: 'Botas', en: 'Boots' }, 'en')).toBe('Boots');
  });

  it('si falta, cae al idioma por defecto', () => {
    // El catálogo se traduce en diferido: una ficha recién importada solo
    // existe en español durante un rato.
    expect(pickTranslation({ es: 'Botas' }, 'ca')).toBe('Botas');
  });

  it('si tampoco está el de por defecto, cualquiera antes que nada', () => {
    // Una ficha sin título es peor que una ficha en otro idioma.
    expect(pickTranslation({ en: 'Boots' }, 'ca')).toBe('Boots');
  });

  it('sin ninguna traducción devuelve undefined', () => {
    expect(pickTranslation({}, 'es')).toBeUndefined();
  });

  it('un texto vacío guardado a propósito se respeta', () => {
    // Distinto de "no hay traducción": alguien ha decidido dejarlo en blanco.
    expect(pickTranslation({ ca: '', es: 'Botas' }, 'ca')).toBe('');
  });
});

describe('normalizarIdiomas', () => {
  it('respeta el orden, que es el del selector', () => {
    expect(normalizarIdiomas(['en', 'es'])).toEqual(['en', 'es']);
  });

  it('descarta lo que no es un idioma de la plataforma', () => {
    // Solo se pueden activar los que tienen traducciones compiladas.
    expect(normalizarIdiomas(['es', 'de', 42, null, 'ca'])).toEqual(['es', 'ca']);
  });

  it('una lista vacía cae al idioma por defecto en vez de dejar la tienda muda', () => {
    // Desde el panel se pueden desmarcar las tres casillas; sin esto la raíz no
    // tendría a dónde redirigir y la tienda entera quedaría inaccesible.
    expect(normalizarIdiomas([])).toEqual([DEFAULT_LOCALE]);
    expect(normalizarIdiomas(null)).toEqual([DEFAULT_LOCALE]);
    expect(normalizarIdiomas(['de'])).toEqual([DEFAULT_LOCALE]);
  });

  it('no repite', () => {
    expect(normalizarIdiomas(['es', 'es', 'ca'])).toEqual(['es', 'ca']);
  });
});

describe('idiomaPorDefectoValido', () => {
  it('lo deja si está entre los activos', () => {
    expect(idiomaPorDefectoValido('ca', ['es', 'ca'])).toBe('ca');
  });

  it('si está desactivado, gana el primero de los activos', () => {
    // Con el por defecto desactivado, la raíz llevaría a un idioma que se ha
    // decidido no servir.
    expect(idiomaPorDefectoValido('es', ['en', 'ca'])).toBe('en');
  });

  it('no cae en DEFAULT_LOCALE si también está desactivado', () => {
    expect(idiomaPorDefectoValido('de', ['en'])).toBe('en');
  });

  it('con basura devuelve algo servible', () => {
    expect(idiomaPorDefectoValido(null, ['ca', 'en'])).toBe('ca');
    expect(idiomaPorDefectoValido(7, ['ca'])).toBe('ca');
  });
});

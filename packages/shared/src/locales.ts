/**
 * Idiomas de la plataforma.
 *
 * Arrancamos con español, catalán e inglés. Añadir un idioma nuevo debería
 * ser tocar solo este fichero y los ficheros de traducción: ningún componente
 * ni consulta debe tener idiomas escritos a mano.
 */

export const LOCALES = ['es', 'ca', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

export const LOCALE_INFO: Record<Locale, { name: string; nativeName: string; bcp47: string }> = {
  es: { name: 'Español', nativeName: 'Español', bcp47: 'es-ES' },
  ca: { name: 'Catalán', nativeName: 'Català', bcp47: 'ca-ES' },
  en: { name: 'Inglés', nativeName: 'English', bcp47: 'en-GB' },
};

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/**
 * Deja una lista de idiomas venida del panel en algo con lo que se pueda operar.
 *
 * Los idiomas activos se guardan como ajuste (`shop.supportedLocales`), así que
 * llegan como JSON de la base de datos y pueden ser cualquier cosa: una lista con
 * un idioma que ya no existe, un número por medio, o vacía porque alguien
 * desmarcó las tres casillas.
 *
 * Una tienda sin ningún idioma no se puede servir —no hay a dónde enviar la
 * raíz—, así que una lista vacía cae al idioma por defecto en lugar de dejar la
 * tienda inaccesible. El orden se respeta: es el del selector.
 *
 * Ojo con lo que esto NO hace: no crea idiomas. Solo pueden activarse los que
 * tienen ficheros de traducción compilados, y por eso se filtra contra `LOCALES`.
 */
export function normalizarIdiomas(valor: unknown): Locale[] {
  const lista = Array.isArray(valor) ? valor : [];
  const idiomas = lista.filter((v): v is Locale => typeof v === 'string' && isLocale(v));
  const unicos = [...new Set(idiomas)];

  return unicos.length > 0 ? unicos : [DEFAULT_LOCALE];
}

/**
 * El idioma por defecto que de verdad se puede usar.
 *
 * Tiene que estar entre los activos: si no lo está, la raíz de la tienda
 * redirigiría a un idioma desactivado y quien entrase por `chispaynoche.com`
 * acabaría en una página que se ha decidido no servir. Cuando no encaja, gana el
 * primero de los activos y no `DEFAULT_LOCALE`, que también podría estar
 * desactivado.
 */
export function idiomaPorDefectoValido(valor: unknown, activos: readonly Locale[]): Locale {
  if (typeof valor === 'string' && isLocale(valor) && activos.includes(valor)) return valor;
  return activos[0] ?? DEFAULT_LOCALE;
}

/**
 * El idioma que pide el navegador, si es uno de los que se le pueden dar.
 *
 * Devuelve `null` cuando ninguno encaja, y esa es toda la diferencia con
 * `resolveLocale`: quien pregunta decide entonces qué hacer. Al middleware de la
 * tienda le hace falta esa distinción, porque «el navegador pide francés» no
 * lleva al mismo sitio que «el navegador pide español y el español está
 * desactivado»: lo primero va al idioma por defecto DEL PANEL, y lo segundo
 * también, pero por otro camino y sin poder confundirse con una preferencia real.
 *
 * `disponibles` existe porque el conjunto de idiomas compilados y el de idiomas
 * ofrecidos no son el mismo: el panel puede desactivar el inglés, y entonces un
 * navegador en inglés no debe llevar a la versión inglesa.
 */
export function negociarIdioma(
  acceptLanguage: string | null | undefined,
  disponibles: readonly Locale[] = LOCALES,
): Locale | null {
  if (!acceptLanguage) return null;

  const preferencias = acceptLanguage
    .split(',')
    .map((parte) => {
      const [tag = '', ...params] = parte.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split('=')[1]) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of preferencias) {
    const base = tag.split('-')[0] ?? '';
    if (isLocale(base) && disponibles.includes(base)) return base;
  }

  return null;
}

/**
 * Elige el mejor idioma disponible a partir de la cabecera Accept-Language.
 * Si nada encaja, devuelve el idioma por defecto.
 */
export function resolveLocale(acceptLanguage?: string | null): Locale {
  return negociarIdioma(acceptLanguage) ?? DEFAULT_LOCALE;
}

/**
 * Devuelve el texto en el idioma pedido, cayendo al idioma por defecto y,
 * en último caso, a cualquier traducción existente. Nunca devuelve vacío si
 * hay algún contenido: una ficha sin título es peor que una ficha en otro idioma.
 */
export function pickTranslation<T>(
  translations: Partial<Record<Locale, T>>,
  locale: Locale,
): T | undefined {
  return (
    translations[locale] ??
    translations[DEFAULT_LOCALE] ??
    Object.values(translations).find((v) => v !== undefined && v !== null)
  );
}

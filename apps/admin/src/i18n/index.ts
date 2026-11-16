import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from './es.json';

/**
 * Idiomas del admin.
 *
 * Se guarda la preferencia en localStorage: quien trabaja a diario en el panel
 * no debe volver a elegir idioma cada vez que abre el navegador.
 *
 * Solo el castellano viaja dentro del paquete principal. Los otros dos se
 * traen cuando hacen falta: son ~40 kB de textos cada uno, y quien trabaja en
 * español los descargaba igualmente para no leerlos nunca. El idioma guardado
 * se pide ANTES del primer render (`prepararIdioma`), así que quien trabaja en
 * catalán tampoco ve medio segundo de castellano al cargar.
 */
const GUARDADO = 'idioma-admin';

const CARGADORES: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  ca: () => import('./ca.json'),
  en: () => import('./en.json'),
};

void i18n.use(initReactI18next).init({
  resources: { es: { translation: es } },
  lng: 'es',
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
});

/** Trae un idioma si no está ya cargado. */
async function cargar(idioma: string): Promise<void> {
  if (i18n.hasResourceBundle(idioma, 'translation')) return;

  const cargador = CARGADORES[idioma];
  if (!cargador) return;

  const modulo = await cargador();
  i18n.addResourceBundle(idioma, 'translation', modulo.default, true, true);
}

/** Deja listo el idioma guardado antes del primer render. */
export async function prepararIdioma(): Promise<void> {
  const guardado = localStorage.getItem(GUARDADO) ?? 'es';
  if (guardado === 'es') return;

  try {
    await cargar(guardado);
    await i18n.changeLanguage(guardado);
  } catch {
    // Si el trozo del idioma no llega, se sigue en castellano: arrancar en otro
    // idioma es mejor que no arrancar.
  }
}

export function cambiarIdioma(idioma: string): void {
  localStorage.setItem(GUARDADO, idioma);
  void cargar(idioma).then(() => i18n.changeLanguage(idioma));
}

export const IDIOMAS = [
  { codigo: 'es', nombre: 'Español' },
  { codigo: 'ca', nombre: 'Català' },
  { codigo: 'en', nombre: 'English' },
];

export default i18n;

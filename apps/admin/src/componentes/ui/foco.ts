import { useEffect, type RefObject } from 'react';

const FOCUSABLES =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Atrapa el foco dentro de un contenedor mientras está activo.
 *
 * Solo para las capas que NO son `<dialog>` —el menú lateral en móvil, que en
 * escritorio es parte de la página y no puede ser un diálogo—. Donde se puede
 * usar `<dialog>` se usa: el navegador lo hace mejor que cualquier
 * implementación a mano.
 *
 * Al soltarlo devuelve el foco a donde estaba. Sin eso, cerrar el menú deja el
 * foco en un elemento que acaba de salir de pantalla, y la siguiente pulsación
 * de Tab salta a un sitio impredecible.
 */
export function useFocoAtrapado(
  caja: RefObject<HTMLElement | null>,
  activo: boolean,
  alEscapar?: () => void,
) {
  useEffect(() => {
    if (!activo) return;

    const previo = document.activeElement as HTMLElement | null;
    const elementos = () =>
      Array.from(caja.current?.querySelectorAll<HTMLElement>(FOCUSABLES) ?? []);

    elementos()[0]?.focus();

    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        alEscapar?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = elementos();
      const primero = items[0];
      const ultimo = items[items.length - 1];
      if (!primero || !ultimo) return;

      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener('keydown', alPulsar);
    return () => {
      document.removeEventListener('keydown', alPulsar);
      previo?.focus();
    };
  }, [activo, alEscapar, caja]);
}

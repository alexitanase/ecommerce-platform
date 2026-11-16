import { useSyncExternalStore } from 'react';

/**
 * Hora actual, como estado suscrito.
 *
 * `Date.now()` leído durante el render es impuro: da un valor distinto en cada
 * pasada, así que dos renders del mismo componente pueden decir cosas
 * diferentes sin que nada haya cambiado. Y encima no se actualiza solo: la
 * marca de «actualizado hace 2 minutos» se quedaba congelada en el minuto en
 * que se pintó, que es justo lo contrario de lo que promete.
 *
 * Con `useSyncExternalStore` el reloj es una fuente externa a la que React se
 * suscribe. El valor se redondea al intervalo para que la instantánea sea
 * estable entre tics y React no vea un cambio en cada lectura.
 */
export function useAhora(intervalo = 30_000): number {
  return useSyncExternalStore(
    (avisar) => {
      const id = setInterval(avisar, intervalo);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalo) * intervalo,
    // En servidor no hay reloj que se mueva; se devuelve 0 y quien lo use no
    // pinta la marca de frescura.
    () => 0,
  );
}

'use client';

import { useSyncExternalStore } from 'react';

/** Suscripción vacía: el valor nunca cambia después de la hidratación. */
const sinCambios = () => () => {
  // No hay nada a lo que suscribirse: "estamos en el cliente" no cambia.
};

/**
 * ¿Se está ejecutando ya en el navegador?
 *
 * Sustituye al patrón `const [montado, setMontado] = useState(false)` con un
 * `useEffect` que lo pone a true. Aquel funcionaba, pero provoca un render
 * extra en cascada y React 19 lo desaconseja expresamente.
 *
 * `useSyncExternalStore` recibe dos lecturas distintas —una para el servidor y
 * otra para el cliente— y React se encarga de usar cada una donde corresponde.
 * El resultado es el mismo sin render adicional.
 *
 * Se usa para todo lo que dependa de localStorage (carrito, consentimiento de
 * cookies) o del tema resuelto: en el servidor esos datos no existen, y pintar
 * un valor distinto al del cliente rompe la hidratación.
 */
export function useEsCliente(): boolean {
  return useSyncExternalStore(
    sinCambios,
    () => true, // en el navegador
    () => false, // en el servidor
  );
}

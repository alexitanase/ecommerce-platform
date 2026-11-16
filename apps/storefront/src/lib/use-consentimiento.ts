'use client';

import { useSyncExternalStore } from 'react';
import {
  alCambiarConsentimiento,
  hayDecision,
  leerConsentimiento,
  type Consentimiento,
} from './consentimiento';

/**
 * El consentimiento como estado externo.
 *
 * `useSyncExternalStore` y no `useState` + `useEffect`: el valor vive fuera de
 * React (localStorage, y puede cambiarlo otra pestaña), y sincronizarlo con un
 * efecto provoca un render en cascada que React 19 marca como error. Además
 * así el servidor devuelve siempre "sin permiso" sin descuadrar la hidratación.
 */

function suscribir(alCambiar: () => void): () => void {
  return alCambiarConsentimiento(alCambiar);
}

/** Snapshot estable: devolver un objeto nuevo cada vez causaría un bucle. */
let cache: Consentimiento | null = null;
let cacheSerializado = '';

function instantanea(): Consentimiento {
  const actual = leerConsentimiento();
  const serializado = JSON.stringify(actual);

  if (serializado !== cacheSerializado) {
    cache = actual;
    cacheSerializado = serializado;
  }

  return cache ?? actual;
}

const SIN_PERMISO_SERVIDOR: Consentimiento = {
  necesarias: true,
  analiticas: false,
  marketing: false,
  fecha: '',
  version: 0,
};

export function useConsentimiento(): Consentimiento {
  return useSyncExternalStore(suscribir, instantanea, () => SIN_PERMISO_SERVIDOR);
}

/** ¿Hay que enseñar el banner? En el servidor, nunca: no se sabe todavía. */
export function useHayDecision(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => hayDecision(),
    () => true,
  );
}

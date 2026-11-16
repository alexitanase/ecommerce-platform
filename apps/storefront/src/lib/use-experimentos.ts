'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { valorDe, visitante, type Asignacion } from './experimentos';

/**
 * Variantes asignadas a quien está navegando.
 *
 * Devuelve una lista vacía mientras carga y si algo falla. Es deliberado: quien
 * lo use tiene que pasar siempre un valor por defecto y pintar con él, para que
 * la tienda no parpadee ni se quede a medias por una prueba A/B.
 */
export function useExperimentos(): Asignacion[] {
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);

  useEffect(() => {
    const id = visitante();
    if (!id) return;

    void api<Asignacion[]>(`/experiments/asignacion?visitante=${encodeURIComponent(id)}`)
      .then(setAsignaciones)
      .catch(() => {
        // Sin experimentos se ve la versión por defecto. No se avisa de nada:
        // a quien compra no le importa que no haya podido medirse una prueba.
      });
  }, []);

  return asignaciones;
}

/** Valor de un experimento concreto, con su valor por defecto. */
export function useExperimento<T>(clave: string, porDefecto: T): T {
  return valorDe(useExperimentos(), clave, porDefecto);
}

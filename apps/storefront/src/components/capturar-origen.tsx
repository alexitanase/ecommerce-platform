'use client';

import { useEffect } from 'react';
import { capturarReferido } from '@/lib/referido';
import { capturarCanal } from '@/lib/canal';

/**
 * Guarda lo que venga en la URL: el código de invitación y el marcaje de
 * campaña.
 *
 * Los dos van juntos porque llegan juntos —un enlace de afiliado lleva el
 * código y el `utm_source` a la vez— y porque los dos tienen que sobrevivir
 * hasta el checkout, que casi nunca es la misma visita.
 *
 * Va en el layout y no en una página concreta porque el enlace que se comparte
 * apunta a cualquier sitio: la portada, una ficha de producto o una categoría.
 * No pinta nada.
 */
export function CapturarOrigen() {
  useEffect(() => {
    capturarReferido(window.location.search);
    capturarCanal(window.location.search);
  }, []);

  return null;
}

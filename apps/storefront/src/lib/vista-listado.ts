'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VistaListado } from '@/components/tarjeta-producto';

/**
 * Cuadrícula o lista, recordado entre visitas.
 *
 * En el navegador y no en la URL a propósito. Es una preferencia de quien
 * mira, no parte de lo que está mirando: si viajara en la dirección, compartir
 * un enlace de una categoría impondría al que lo recibe la vista del que lo
 * mandó, y volver atrás podría cambiarla sola. Lo que sí va en la URL son los
 * filtros y la página, que son el contenido.
 *
 * Y se recuerda porque quien prefiere la lista la prefiere siempre: obligarle
 * a pulsar el conmutador en cada categoría es peor que no ofrecerlo.
 */
interface EstadoVista {
  vista: VistaListado;
  fijar: (vista: VistaListado) => void;
}

export const useVistaListado = create<EstadoVista>()(
  persist(
    (set) => ({
      // La cuadrícula manda por defecto: es la que enseña la foto grande, y en
      // una tienda la foto es lo que decide si se entra en la ficha.
      vista: 'cuadricula',
      fijar: (vista) => set({ vista }),
    }),
    { name: 'ecom-vista-listado' },
  ),
);

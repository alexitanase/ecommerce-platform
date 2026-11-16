'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Las últimas búsquedas de este navegador.
 *
 * Viven aquí y no en el servidor por dos motivos. El primero es que sirven sin
 * cuenta, que es como llega la mayoría. El segundo es que lo que alguien busca
 * en una tienda +18 es exactamente el tipo de dato que no queremos tener
 * guardado con un nombre al lado: en el navegador es un historial que su dueño
 * borra cuando quiere, y en nuestra base de datos sería un perfil.
 *
 * Por eso el buscador ofrece un botón de borrarlas todas, y no está escondido.
 */

/** Cuántas se recuerdan. Más allá, la lista deja de ser un atajo. */
const MAXIMO = 6;

interface EstadoBusquedas {
  recientes: string[];
  recordar: (consulta: string) => void;
  olvidar: (consulta: string) => void;
  olvidarTodas: () => void;
}

export const useBusquedas = create<EstadoBusquedas>()(
  persist(
    (set) => ({
      recientes: [],

      recordar: (consulta) => {
        const limpia = consulta.trim();
        if (limpia.length < 2) return;

        set((estado) => ({
          // Sin distinguir mayúsculas: quien busca «Satisfyer» después de
          // «satisfyer» no ha hecho dos búsquedas distintas, y verlas las dos
          // en la lista es ver un hueco desperdiciado.
          recientes: [
            limpia,
            ...estado.recientes.filter((r) => r.toLowerCase() !== limpia.toLowerCase()),
          ].slice(0, MAXIMO),
        }));
      },

      olvidar: (consulta) =>
        set((estado) => ({ recientes: estado.recientes.filter((r) => r !== consulta) })),

      olvidarTodas: () => set({ recientes: [] }),
    }),
    { name: 'ecom-busquedas' },
  ),
);

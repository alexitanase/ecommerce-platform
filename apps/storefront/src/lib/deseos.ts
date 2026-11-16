'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Lista de deseos y productos vistos.
 *
 * Las dos viven en el navegador para que funcionen sin cuenta: guardar algo no
 * puede exigir registrarse, porque la mayoría se va antes que registrarse.
 *
 * La diferencia está en qué pasa al identificarse:
 *
 * - **Deseos**: se funden con los de la cuenta y a partir de ahí manda el
 *   servidor, así que se siguen viendo desde el móvil y desde el portátil.
 * - **Vistos**: se quedan en el navegador y no se envían a ningún sitio. Son
 *   un historial de navegación, y guardarlo en el servidor sería recoger un
 *   dato de comportamiento que no hace falta para vender.
 */

/** Cuántos vistos se recuerdan. Más allá, ni se enseñan ni se recuerdan. */
const MAXIMO_VISTOS = 12;

export interface ProductoVisto {
  id: string;
  slug: string;
  nombre: string;
  imagen: string | null;
  precioCents: number;
}

interface EstadoDeseos {
  /** Identificadores de producto guardados. */
  deseos: string[];
  vistos: ProductoVisto[];
  /** Se ha fundido ya con la cuenta en esta sesión. */
  sincronizado: boolean;

  alternar: (productId: string) => boolean;
  esDeseado: (productId: string) => boolean;
  fijarDeseos: (ids: string[]) => void;
  marcarSincronizado: (valor: boolean) => void;
  registrarVisto: (producto: ProductoVisto) => void;
}

export const useDeseos = create<EstadoDeseos>()(
  persist(
    (set, get) => ({
      deseos: [],
      vistos: [],
      sincronizado: false,

      /** Añade o quita; devuelve si ha quedado guardado. */
      alternar: (productId) => {
        const deseos = get().deseos;
        const estaba = deseos.includes(productId);

        set({
          deseos: estaba ? deseos.filter((id) => id !== productId) : [productId, ...deseos],
        });

        return !estaba;
      },

      esDeseado: (productId) => get().deseos.includes(productId),

      fijarDeseos: (ids) => {
        set({ deseos: ids });
      },

      marcarSincronizado: (valor) => {
        set({ sincronizado: valor });
      },

      registrarVisto: (producto) => {
        const vistos = get().vistos.filter((v) => v.id !== producto.id);
        // El último visto va primero y se recorta la cola: es un carrusel de
        // "por dónde ibas", no un historial completo.
        set({ vistos: [producto, ...vistos].slice(0, MAXIMO_VISTOS) });
      },
    }),
    {
      name: 'deseos',
      // `sincronizado` no se guarda: al recargar hay que volver a fundir con la
      // cuenta, porque puede haber cambiado desde otro dispositivo.
      partialize: (estado) => ({ deseos: estado.deseos, vistos: estado.vistos }),
    },
  ),
);

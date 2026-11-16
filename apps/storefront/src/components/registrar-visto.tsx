'use client';

import { useEffect } from 'react';
import { useDeseos, type ProductoVisto } from '@/lib/deseos';

/**
 * Anota que el visitante ha mirado esta ficha.
 *
 * No pinta nada: existe solo para poder hacerlo desde una página que se
 * renderiza en el servidor. Lo guardado se queda en el navegador y no se envía
 * a ningún sitio, así que no hace falta consentimiento de cookies: es
 * almacenamiento necesario para una función que el propio usuario pide.
 */
export function RegistrarVisto({ producto }: { producto: ProductoVisto }) {
  const registrar = useDeseos((e) => e.registrarVisto);

  useEffect(() => {
    registrar(producto);
    // Solo el id: el resto de campos son del mismo producto, y con el objeto
    // entero en las dependencias el efecto se repetiría en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto.id, registrar]);

  return null;
}

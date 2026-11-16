'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useCarrito, type LineaCarrito } from '@/lib/carrito';

/**
 * Vuelta desde el correo de carrito abandonado.
 *
 * El enlace del correo trae el token del carrito guardado en el servidor, así
 * que funciona aunque el cliente abra el correo en otro dispositivo: se mira en
 * el móvil y se compra en el portátil, y sin esto llegaría a un carrito vacío.
 *
 * El mismo componente atiende la baja (`?baja=`). Va aquí y no en una página
 * aparte para que el enlace de "no quiero estos correos" acabe en el carrito,
 * con lo que se dejó a la vista, en vez de en una pantalla muerta.
 */

interface LineaServidor {
  variantId: string;
  productId: string;
  sku: string;
  nombre: string;
  variante: string | null;
  imagen: string | null;
  slug: string | null;
  cantidad: number;
  precioUnitarioCents: number;
  disponible: number;
}

type Estado = 'recuperado' | 'caducado' | 'baja' | null;

export function RecuperarCarrito() {
  const t = useTranslations('carrito');
  const parametros = useSearchParams();
  const [estado, setEstado] = useState<Estado>(null);

  const tokenRecuperar = parametros.get('recuperar');
  const tokenBaja = parametros.get('baja');

  useEffect(() => {
    if (!tokenRecuperar) return;

    void api<{ lineas: LineaServidor[] }>(`/cart/recover/${tokenRecuperar}`, { method: 'POST' })
      .then((carrito) => {
        const lineas: LineaCarrito[] = carrito.lineas.map((l) => ({
          variantId: l.variantId,
          productId: l.productId,
          sku: l.sku,
          nombre: l.nombre,
          variante: l.variante,
          imagen: l.imagen,
          precioCents: l.precioUnitarioCents,
          cantidad: l.cantidad,
          stockDisponible: l.disponible,
          slug: l.slug ?? '',
        }));

        // Se sustituye el carrito local en vez de sumarlo: el del correo es el
        // que el cliente quiere recuperar, y fusionarlo duplicaría cantidades
        // si ya tenía lo mismo en este navegador.
        useCarrito.setState({ lineas });
        setEstado('recuperado');
      })
      .catch(() => {
        // Comprado, caducado o token inventado: para el cliente es lo mismo,
        // ese carrito ya no está.
        setEstado('caducado');
      });
  }, [tokenRecuperar]);

  useEffect(() => {
    if (!tokenBaja) return;

    void api(`/cart/recover/${tokenBaja}/unsubscribe`, { method: 'POST' })
      .then(() => {
        setEstado('baja');
      })
      .catch(() => {
        // La baja no puede fallar de cara al cliente: si el token ya no vale,
        // es que ese carrito tampoco va a recibir más correos.
        setEstado('baja');
      });
  }, [tokenBaja]);

  if (!estado) return null;

  const tono = estado === 'caducado' ? 'var(--aviso)' : 'var(--exito)';

  return (
    <p
      role="status"
      className="mb-4 rounded-lg px-4 py-3 text-sm"
      style={{ background: `color-mix(in srgb, ${tono} 12%, transparent)`, color: tono }}
    >
      {t(`recuperacion_${estado}`)}
    </p>
  );
}

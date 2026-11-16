import { ImageResponse } from 'next/og';
import { ajustesPublicos } from '@/lib/api';
import { colorSeguro, textoSobre } from '@/lib/contraste';

/**
 * Icono de la aplicación, dibujado a partir de la marca.
 *
 * Una tienda recién instalada no tiene logo en PNG de 512×512, y sin icono el
 * navegador no ofrece instalarla. Aquí se genera uno con la inicial sobre el
 * color de marca: no sustituye a un logo de verdad —en cuanto se sube uno en
 * Ajustes, el manifiesto usa ese— pero evita que la función quede muerta
 * esperando a que alguien abra un editor de imágenes.
 *
 * Se cachea un año: cambia solo si cambia la marca, y entonces cambia también
 * la URL del manifiesto.
 */
export const revalidate = 31_536_000;

export async function GET(peticion: Request): Promise<Response> {
  const tamano = Number(new URL(peticion.url).searchParams.get('tamano') ?? '512');
  // Solo los dos tamaños que pide el manifiesto: sin esto, cualquiera podría
  // pedir 8000×8000 y hacer trabajar al servidor gratis.
  const lado = tamano === 192 ? 192 : 512;

  const ajustes = await ajustesPublicos();
  const nombre = typeof ajustes['brand.name'] === 'string' ? ajustes['brand.name'] : 'Tienda';
  const fondo = colorSeguro(ajustes['brand.primaryColor'], '#4f46e5');

  // Dos letras como mucho: "Mi Tienda" → "MT", "Bazar" → "B".
  const inicial = nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: fondo,
        color: textoSobre(fondo),
        fontSize: lado * 0.42,
        fontWeight: 700,
        // Margen generoso: Android recorta el icono a un círculo o a un
        // cuadrado redondeado, y sin aire se comería las letras.
        letterSpacing: '-0.05em',
      }}
    >
      {inicial || 'T'}
    </div>,
    { width: lado, height: lado },
  );
}

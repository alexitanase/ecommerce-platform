import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';

/**
 * Purga bajo demanda del caché ISR.
 *
 * Sin esto, cambiar un precio en el admin tarda hasta diez minutos en verse en
 * la tienda: justo el tiempo del `revalidate` de la página. La API llama aquí
 * en cuanto un producto cambia y la siguiente visita ya ve el dato nuevo.
 *
 * El secreto es obligatorio: sin él, cualquiera podría forzar el recálculo de
 * todo el catálogo en bucle y convertir el ISR en un ataque de denegación
 * contra nuestra propia API.
 */
export async function POST(peticion: NextRequest): Promise<NextResponse> {
  const esperado = process.env['REVALIDATE_SECRET'];

  // Sin secreto configurado la ruta no existe, en vez de quedar abierta.
  if (!esperado) {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  }

  const recibido = peticion.headers.get('x-revalidate-secret') ?? '';
  if (!comparaSegura(recibido, esperado)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const cuerpo = (await peticion.json().catch(() => null)) as { etiquetas?: unknown } | null;
  const etiquetas = Array.isArray(cuerpo?.etiquetas)
    ? cuerpo.etiquetas.filter((e): e is string => typeof e === 'string')
    : [];

  if (etiquetas.length === 0) {
    return NextResponse.json({ error: 'Faltan etiquetas' }, { status: 400 });
  }

  // Next 16 exige indicar en qué plazo caduca lo etiquetado. `expire: 0` es la
  // purga inmediata, que es lo que se quiere aquí: el admin acaba de cambiar un
  // precio y la siguiente visita tiene que verlo.
  for (const etiqueta of etiquetas) revalidateTag(etiqueta, { expire: 0 });

  return NextResponse.json({ revalidadas: etiquetas });
}

/**
 * Comparación en tiempo constante: con `===`, el tiempo de respuesta revela
 * cuántos caracteres se acertaron y el secreto se reconstruye poco a poco.
 */
function comparaSegura(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

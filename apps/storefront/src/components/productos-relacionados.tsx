import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { api } from '@/lib/api';
import { TarjetaProducto, type ProductoResumen } from '@/components/tarjeta-producto';

/**
 * «También te puede interesar», al final de la descripción.
 *
 * Va DESPUÉS de la descripción y antes de las valoraciones a propósito: quien
 * ha llegado hasta el final del texto o ya ha decidido comprar, o ha decidido
 * que este no es. En el segundo caso, la alternativa es lo único que evita que
 * cierre la pestaña; ponerlo antes competiría con el producto que está mirando.
 *
 * Si no hay relacionados no se pinta nada —ni el título—: una sección vacía en
 * mitad de la ficha se lee como que algo ha fallado al cargar.
 */
export async function ProductosRelacionados({
  productId,
  locale,
}: {
  productId: string;
  locale: string;
}) {
  const t = await getTranslations('producto');

  /*
   * Las cookies se reenvían igual que en la ficha.
   *
   * La API decide con ellas si puede enseñar catálogo +18, y sin reenviarlas
   * vería un visitante sin verificar: en una tienda cuyo catálogo entero es
   * restringido, eso deja la sección vacía siempre.
   */
  const galletas = (await cookies()).toString();

  const productos = await api<ProductoResumen[]>(
    `/catalog/products/${productId}/relacionados?locale=${locale}`,
    galletas
      ? { cache: 'no-store' as const, cookies: galletas }
      : { revalidar: 600, etiquetas: ['catalogo'] },
  ).catch(() => [] as ProductoResumen[]);

  if (productos.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="titulo-ficha">{t('relacionados')}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {productos.map((p) => (
          <TarjetaProducto key={p.id} producto={p} locale={locale} />
        ))}
      </div>
    </section>
  );
}

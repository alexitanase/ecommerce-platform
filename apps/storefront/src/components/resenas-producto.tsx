import { getTranslations } from 'next-intl/server';
import { api } from '@/lib/api';
import { fecha } from '@/lib/formato';

interface Resena {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  isVerifiedPurchase: boolean;
  reply: string | null;
  createdAt: string;
}

interface Resumen {
  media: number;
  total: number;
  reparto: Record<string, number>;
}

export async function ResenasProducto({
  productId,
  locale,
}: {
  productId: string;
  locale: string;
}) {
  const t = await getTranslations('producto');

  const [resumen, listado] = await Promise.all([
    api<Resumen>(`/reviews/product/${productId}/summary`, { revalidar: 600 }).catch(() => null),
    api<{ items: Resena[] }>(`/reviews/product/${productId}`, { revalidar: 600 }).catch(() => ({
      items: [] as Resena[],
    })),
  ]);

  return (
    <section className="mt-14 border-t border-[var(--borde)] pt-10">
      <h2 className="titulo-ficha">{t('valoraciones')}</h2>

      {!resumen || resumen.total === 0 ? (
        <p className="text-[var(--texto-tenue)]">{t('sin_valoraciones')}</p>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-6">
            <div>
              <p className="text-3xl font-bold">{resumen.media.toFixed(1)}</p>
              <p className="text-sm text-[var(--texto-tenue)]">
                {resumen.total} {t('valoraciones').toLowerCase()}
              </p>
            </div>

            <div className="flex-1 space-y-1">
              {[5, 4, 3, 2, 1].map((estrellas) => {
                const cantidad = resumen.reparto[String(estrellas)] ?? 0;
                const porcentaje = resumen.total > 0 ? (cantidad / resumen.total) * 100 : 0;
                return (
                  <div key={estrellas} className="flex items-center gap-2 text-xs">
                    <span className="w-3 text-right">{estrellas}</span>
                    <span aria-hidden="true">★</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--fondo-sutil)]">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${String(porcentaje)}%`, background: 'var(--aviso)' }}
                      />
                    </span>
                    <span className="w-8 text-[var(--texto-tenue)]">{cantidad}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <ul className="space-y-4">
            {listado.items.map((r) => (
              <li key={r.id} className="card p-4">
                <div className="flex items-center gap-2">
                  <span aria-label={`${String(r.rating)} de 5 estrellas`}>
                    {'★'.repeat(r.rating)}
                    <span className="text-[var(--texto-tenue)]">{'★'.repeat(5 - r.rating)}</span>
                  </span>
                  {r.isVerifiedPurchase && (
                    <span
                      className="etiqueta"
                      style={{
                        background: 'color-mix(in srgb, var(--exito) 15%, transparent)',
                        color: 'var(--exito)',
                      }}
                    >
                      {t('compra_verificada')}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-[var(--texto-tenue)]">
                    {fecha(r.createdAt, locale)}
                  </span>
                </div>

                {r.title && <p className="mt-2 font-medium">{r.title}</p>}
                {r.body && <p className="mt-1 text-sm text-[var(--texto-suave)]">{r.body}</p>}

                {r.reply && (
                  <div className="mt-3 rounded-lg bg-[var(--fondo-sutil)] p-3 text-sm">
                    <p className="text-[var(--texto-suave)]">{r.reply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, put } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Formas de pago del checkout.
 *
 * Lo que se configura aquí es la decisión comercial: si se ofrece, en qué orden
 * y para qué importes. **Las credenciales no se tocan desde el navegador**:
 * viven en el entorno del servidor. Guardarlas en la base de datos significaría
 * que una filtración de la base entrega también la cuenta de cobro, y que
 * cualquiera con acceso al panel puede leerlas. Por eso la pantalla dice qué
 * variable falta, pero no permite escribirla.
 *
 * El orden importa más de lo que parece: la primera opción se lleva la mayoría
 * de los pagos, así que ponerla arriba es una decisión de coste —cada pasarela
 * cobra una comisión distinta—, no de estética.
 */

interface Pasarela {
  key: 'nowpayments' | 'revolut' | 'stripe' | 'paypal';
  nombre: string;
  activa: boolean;
  orden: number;
  minCents: number;
  maxCents: number | null;
  implementada: boolean;
  tieneCredenciales: boolean;
  faltan: string[];
  operativa: boolean;
}

const euros = (centimos: number) => (centimos / 100).toFixed(2).replace('.', ',');

/** Céntimos desde lo que se escribe, admitiendo coma decimal. */
function aCentimos(valor: string): number | null {
  const limpio = valor.replace(',', '.').trim();
  if (limpio === '') return null;
  const numero = Number(limpio);
  return Number.isFinite(numero) && numero >= 0 ? Math.round(numero * 100) : null;
}

export function MetodosPago() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  /** Cambios sin guardar, por clave de pasarela. */
  const [borrador, setBorrador] = useState<Record<string, Partial<Pasarela>>>({});
  const [pruebas, setPruebas] = useState<Record<string, { ok: boolean; mensaje?: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const consulta = useQuery({
    queryKey: ['pasarelas'],
    queryFn: () => get<Pasarela[]>('/payments/gateways'),
  });

  const pasarelas = useMemo(
    () => (consulta.data ?? []).map((p) => ({ ...p, ...borrador[p.key] })),
    [consulta.data, borrador],
  );

  const sinGuardar = Object.keys(borrador).length > 0;

  const guardar = useMutation({
    mutationFn: () =>
      put<Pasarela[]>('/payments/gateways', {
        pasarelas: pasarelas.map((p) => ({
          key: p.key,
          activa: p.activa,
          orden: p.orden,
          minCents: p.minCents,
          maxCents: p.maxCents,
        })),
      }),
    onSuccess: (datos) => {
      qc.setQueryData(['pasarelas'], datos);
      setBorrador({});
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const probar = useMutation({
    mutationFn: (key: string) =>
      post<{ ok: boolean; mensaje?: string }>(`/payments/gateways/${key}/test`),
    onSuccess: (resultado, key) => setPruebas((p) => ({ ...p, [key]: resultado })),
  });

  const cambiar = (key: string, campo: keyof Pasarela, valor: unknown) =>
    setBorrador((b) => ({ ...b, [key]: { ...b[key], [campo]: valor } }));

  /** Sube o baja una pasarela intercambiando su posición con la vecina. */
  const mover = (indice: number, direccion: -1 | 1) => {
    const destino = indice + direccion;
    if (destino < 0 || destino >= pasarelas.length) return;

    const a = pasarelas[indice];
    const b = pasarelas[destino];
    if (!a || !b) return;

    setBorrador((borradorActual) => ({
      ...borradorActual,
      [a.key]: { ...borradorActual[a.key], orden: b.orden },
      [b.key]: { ...borradorActual[b.key], orden: a.orden },
    }));
  };

  if (consulta.isLoading) return <Cargando />;
  if (consulta.error)
    return <ErrorPanel error={consulta.error} reintentar={() => void consulta.refetch()} />;

  const ordenadas = [...pasarelas].sort((a, b) => a.orden - b.orden);
  const operativas = ordenadas.filter((p) => p.activa && p.implementada && p.tieneCredenciales);

  return (
    <div>
      <Encabezado titulo={t('metodos_pago.titulo')} descripcion={t('metodos_pago.descripcion')} />

      {/* El aviso que de verdad importa: sin ninguna forma de pago operativa la
          tienda sigue funcionando y enseñando productos, y el fallo solo
          aparece cuando un cliente llega a pagar. */}
      {operativas.length === 0 && (
        <div
          className="panel mb-4 border-l-4 p-4 text-sm"
          style={{ borderLeftColor: 'var(--peligro)' }}
        >
          <strong>{t('metodos_pago.sin_operativas')}</strong>
          <p className="mt-1" style={{ color: 'var(--texto-tenue)' }}>
            {t('metodos_pago.sin_operativas_ayuda')}
          </p>
        </div>
      )}

      <div className="panel mb-4 p-4 text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('metodos_pago.credenciales_aviso')}
      </div>

      {error && (
        <div
          className="panel mb-4 border-l-4 p-4 text-sm"
          style={{ borderLeftColor: 'var(--peligro)' }}
        >
          {error}
        </div>
      )}

      <div className="space-y-3">
        {ordenadas.map((p, i) => {
          const prueba = pruebas[p.key];

          return (
            <article key={p.key} className="panel p-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{p.nombre}</h2>
                    {i === 0 && p.operativa && (
                      <Etiqueta tono="exito" texto={t('metodos_pago.principal')} />
                    )}
                    {!p.implementada && (
                      <Etiqueta tono="neutro" texto={t('metodos_pago.no_implementada')} />
                    )}
                    {p.implementada && !p.tieneCredenciales && (
                      <Etiqueta tono="aviso" texto={t('metodos_pago.sin_credenciales')} />
                    )}
                  </div>

                  {p.faltan.length > 0 && (
                    <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {t('metodos_pago.faltan')}:{' '}
                      <code className="font-mono">{p.faltan.join(', ')}</code>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-fantasma px-2 text-sm"
                    aria-label={t('metodos_pago.subir')}
                    disabled={i === 0}
                    onClick={() => mover(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-fantasma px-2 text-sm"
                    aria-label={t('metodos_pago.bajar')}
                    disabled={i === ordenadas.length - 1}
                    onClick={() => mover(i, 1)}
                  >
                    ↓
                  </button>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={p.activa}
                      // Activar algo sin implementar solo generaría un checkout
                      // que falla al pulsar; se impide en origen.
                      disabled={!p.implementada}
                      onChange={(e) => cambiar(p.key, 'activa', e.target.checked)}
                    />
                    {t('metodos_pago.activa')}
                  </label>
                </div>
              </header>

              <div className="mt-3 flex flex-wrap items-end gap-4">
                <label className="text-xs">
                  <span className="block" style={{ color: 'var(--texto-tenue)' }}>
                    {t('metodos_pago.minimo')}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="campo mt-1 w-28"
                    defaultValue={p.minCents === 0 ? '' : euros(p.minCents)}
                    placeholder="0,00"
                    // En cada pulsación y no al salir del campo: si el valor
                    // solo entrara en el estado al perder el foco, lo que se ve
                    // escrito y lo que se guardaría podrían no coincidir.
                    onChange={(e) => cambiar(p.key, 'minCents', aCentimos(e.target.value) ?? 0)}
                  />
                </label>

                <label className="text-xs">
                  <span className="block" style={{ color: 'var(--texto-tenue)' }}>
                    {t('metodos_pago.maximo')}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="campo mt-1 w-28"
                    defaultValue={p.maxCents === null ? '' : euros(p.maxCents)}
                    placeholder={t('metodos_pago.sin_tope')}
                    onChange={(e) => cambiar(p.key, 'maxCents', aCentimos(e.target.value))}
                  />
                </label>

                <div className="ml-auto flex items-center gap-3">
                  {prueba && (
                    <span
                      className="text-xs"
                      style={{ color: prueba.ok ? 'var(--exito)' : 'var(--peligro)' }}
                    >
                      {prueba.ok ? t('metodos_pago.prueba_ok') : prueba.mensaje}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-fantasma text-sm"
                    disabled={!p.implementada || probar.isPending}
                    onClick={() => probar.mutate(p.key)}
                  >
                    {t('metodos_pago.probar')}
                  </button>
                </div>
              </div>

              {(p.minCents > 0 || p.maxCents !== null) && (
                <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {t('metodos_pago.rango_aviso', {
                    min: euros(p.minCents),
                    max: p.maxCents === null ? '∞' : euros(p.maxCents),
                  })}
                </p>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          className="btn btn-primario"
          disabled={!sinGuardar || guardar.isPending}
          onClick={() => guardar.mutate()}
        >
          {guardar.isPending ? t('app.cargando') : t('app.guardar')}
        </button>
        {sinGuardar && (
          <button
            type="button"
            className="btn btn-fantasma text-sm"
            onClick={() => {
              setBorrador({});
              setError(null);
            }}
          >
            {t('app.cancelar')}
          </button>
        )}
      </div>
    </div>
  );
}

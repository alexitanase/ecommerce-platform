import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Zonas y tarifas de envío.
 *
 * Hasta ahora solo se podían tocar por API, y es lo que decide cuánto se cobra
 * por cada pedido: dejarlo sin interfaz obliga a llamar al desarrollador para
 * subir un porte.
 *
 * La pantalla enseña dos cosas que no son evidentes y que, mal entendidas,
 * cuestan dinero o dan un disgusto fiscal:
 *
 *  · Qué zonas están **fuera del territorio IVA** (Canarias, Ceuta y Melilla).
 *    Cobrarles IVA español es un error de facturación.
 *  · Cuál es el **umbral de envío gratis** por tarifa, que es la palanca de
 *    margen que más se toca.
 */

interface Tarifa {
  id: string;
  name: string;
  carrier: string | null;
  type: 'FLAT' | 'WEIGHT' | 'ORDER_VALUE';
  priceCents: number;
  freeFromCents: number | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  minOrderCents: number | null;
  maxOrderCents: number | null;
  minDays: number;
  maxDays: number;
  position: number;
  isActive: boolean;
}

interface Zona {
  id: string;
  name: string;
  countries: string[];
  postalPrefixes: string[];
  excludedPostalPrefixes: string[];
  outsideVatTerritory: boolean;
  customsWarning: boolean;
  priority: number;
  isActive: boolean;
  rates: Tarifa[];
}

const euros = (centimos: number) => (centimos / 100).toFixed(2).replace('.', ',') + ' €';

/** Céntimos a partir de lo que se escribe en el campo, admitiendo coma. */
function aCentimos(valor: string): number {
  const limpio = valor.replace(',', '.').trim();
  const numero = Number(limpio);
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
}

export function Envios() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<string | null>(null);

  const zonas = useQuery({
    queryKey: ['envios', 'zonas'],
    queryFn: () => get<Zona[]>('/shipping/zones'),
  });

  const refrescar = () => void qc.invalidateQueries({ queryKey: ['envios'] });

  const guardarTarifa = useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: Partial<Tarifa> }) =>
      patch(`/shipping/rates/${id}`, datos),
    onSuccess: () => {
      setEditando(null);
      refrescar();
    },
  });

  const crearTarifa = useMutation({
    mutationFn: ({ zoneId, datos }: { zoneId: string; datos: Partial<Tarifa> }) =>
      post(`/shipping/zones/${zoneId}/rates`, datos),
    onSuccess: refrescar,
  });

  const borrarTarifa = useMutation({
    mutationFn: (id: string) => del(`/shipping/rates/${id}`),
    onSuccess: refrescar,
  });

  if (zonas.isLoading) return <Cargando />;
  if (zonas.error)
    return <ErrorPanel error={zonas.error} reintentar={() => void zonas.refetch()} />;

  const items = zonas.data ?? [];

  return (
    <div>
      <Encabezado titulo={t('envios.titulo')} descripcion={t('envios.descripcion')} />

      {items.length === 0 ? (
        <Vacio titulo={t('envios.sin_zonas')} descripcion={t('envios.sin_zonas_ayuda')} />
      ) : (
        <div className="space-y-4">
          {items.map((zona) => (
            <article key={zona.id} className="panel p-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{zona.name}</h2>
                    {!zona.isActive && <Etiqueta tono="neutro" texto={t('envios.inactiva')} />}
                    {/* Es el aviso más importante de la pantalla: en estas zonas
                        la venta va sin IVA español y cobrarlo es un error de
                        facturación que no se detecta hasta el cierre. */}
                    {zona.outsideVatTerritory && (
                      <Etiqueta tono="aviso" texto={t('envios.sin_iva')} />
                    )}
                    {zona.customsWarning && <Etiqueta tono="neutro" texto={t('envios.aduanas')} />}
                  </div>
                  <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                    {zona.countries.join(', ')}
                    {zona.postalPrefixes.length > 0 &&
                      ` · ${t('envios.cp_incluidos')}: ${zona.postalPrefixes.join(', ')}`}
                    {zona.excludedPostalPrefixes.length > 0 &&
                      ` · ${t('envios.cp_excluidos')}: ${zona.excludedPostalPrefixes.join(', ')}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-fantasma text-sm"
                  onClick={() =>
                    crearTarifa.mutate({
                      zoneId: zona.id,
                      datos: {
                        name: t('envios.nueva_tarifa'),
                        priceCents: 495,
                        minDays: 3,
                        maxDays: 7,
                        position: zona.rates.length,
                      },
                    })
                  }
                >
                  + {t('envios.anadir_tarifa')}
                </button>
              </header>

              {zona.rates.length === 0 ? (
                <p className="mt-4 text-sm" style={{ color: 'var(--texto-tenue)' }}>
                  {t('envios.zona_sin_tarifas')}
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {zona.rates.map((tarifa) =>
                    editando === tarifa.id ? (
                      <FormularioTarifa
                        key={tarifa.id}
                        tarifa={tarifa}
                        guardando={guardarTarifa.isPending}
                        onGuardar={(datos) => guardarTarifa.mutate({ id: tarifa.id, datos })}
                        onCancelar={() => setEditando(null)}
                      />
                    ) : (
                      <FilaTarifa
                        key={tarifa.id}
                        tarifa={tarifa}
                        onEditar={() => setEditando(tarifa.id)}
                        onBorrar={() => borrarTarifa.mutate(tarifa.id)}
                      />
                    ),
                  )}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function FilaTarifa({
  tarifa,
  onEditar,
  onBorrar,
}: {
  tarifa: Tarifa;
  onEditar: () => void;
  onBorrar: () => void;
}) {
  const { t } = useTranslation();
  const [confirmando, setConfirmando] = useState(false);

  if (confirmando) {
    return (
      <li
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
        style={{ borderColor: 'var(--error)' }}
      >
        <span className="text-sm">{t('envios.confirmar_borrado', { nombre: tarifa.name })}</span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-peligro text-sm" onClick={onBorrar}>
            {t('app.eliminar')}
          </button>
          <button
            type="button"
            className="btn btn-fantasma text-sm"
            onClick={() => setConfirmando(false)}
          >
            {t('app.cancelar')}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
      style={{ borderColor: 'var(--borde)' }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{tarifa.name}</span>
          {!tarifa.isActive && <Etiqueta tono="neutro" texto={t('envios.inactiva')} />}
          {tarifa.type !== 'FLAT' && (
            <Etiqueta tono="neutro" texto={t(`envios.tipo_${tarifa.type}`)} />
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {tarifa.minDays}–{tarifa.maxDays} {t('envios.dias')}
          {tarifa.freeFromCents !== null &&
            ` · ${t('envios.gratis_desde', { importe: euros(tarifa.freeFromCents) })}`}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span className="tabular-nums text-sm font-medium">{euros(tarifa.priceCents)}</span>
        <button type="button" className="btn btn-fantasma text-sm" onClick={onEditar}>
          {t('app.editar')}
        </button>
        {/* Discreto y con confirmación: borrar la única tarifa de una zona
            deja los pedidos a ese destino sin forma de completarse, y el fallo
            no se ve hasta que un cliente intenta comprar. */}
        <button
          type="button"
          className="btn btn-fantasma text-sm"
          style={{ color: 'var(--error)' }}
          onClick={() => setConfirmando(true)}
        >
          {t('app.eliminar')}
        </button>
      </div>
    </li>
  );
}

function FormularioTarifa({
  tarifa,
  guardando,
  onGuardar,
  onCancelar,
}: {
  tarifa: Tarifa;
  guardando: boolean;
  onGuardar: (datos: Partial<Tarifa>) => void;
  onCancelar: () => void;
}) {
  const { t } = useTranslation();
  const [nombre, setNombre] = useState(tarifa.name);
  const [precio, setPrecio] = useState((tarifa.priceCents / 100).toFixed(2));
  const [gratisDesde, setGratisDesde] = useState(
    tarifa.freeFromCents === null ? '' : (tarifa.freeFromCents / 100).toFixed(2),
  );
  const [minDias, setMinDias] = useState(String(tarifa.minDays));
  const [maxDias, setMaxDias] = useState(String(tarifa.maxDays));
  const [activa, setActiva] = useState(tarifa.isActive);

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    onGuardar({
      name: nombre.trim(),
      priceCents: aCentimos(precio),
      // Vacío significa "nunca gratis", que no es lo mismo que gratis a partir
      // de 0 €: eso último regalaría el envío en todos los pedidos.
      freeFromCents: gratisDesde.trim() === '' ? null : aCentimos(gratisDesde),
      minDays: Number(minDias) || 0,
      maxDays: Number(maxDias) || 0,
      isActive: activa,
    });
  };

  return (
    <li className="rounded-lg border p-3" style={{ borderColor: 'var(--marca-primario)' }}>
      <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="etiqueta">{t('envios.nombre')}</span>
          <input
            className="campo mt-1 w-full"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="etiqueta">{t('envios.precio')}</span>
          <input
            className="campo mt-1 w-full"
            inputMode="decimal"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="etiqueta">{t('envios.gratis_desde_campo')}</span>
          <input
            className="campo mt-1 w-full"
            inputMode="decimal"
            placeholder={t('envios.nunca_gratis')}
            value={gratisDesde}
            onChange={(e) => setGratisDesde(e.target.value)}
          />
          <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('envios.gratis_desde_ayuda')}
          </span>
        </label>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <label>
            <span className="etiqueta">{t('envios.dias_min')}</span>
            <input
              className="campo mt-1 w-full"
              inputMode="numeric"
              value={minDias}
              onChange={(e) => setMinDias(e.target.value)}
            />
          </label>
          <label>
            <span className="etiqueta">{t('envios.dias_max')}</span>
            <input
              className="campo mt-1 w-full"
              inputMode="numeric"
              value={maxDias}
              onChange={(e) => setMaxDias(e.target.value)}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
          {t('envios.activa')}
        </label>

        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" className="btn btn-primario text-sm" disabled={guardando}>
            {t('app.guardar')}
          </button>
          <button type="button" className="btn btn-fantasma text-sm" onClick={onCancelar}>
            {t('app.cancelar')}
          </button>
        </div>
      </form>
    </li>
  );
}

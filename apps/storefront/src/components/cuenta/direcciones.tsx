'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { api, ErrorApi } from '@/lib/api';
import { Vacio } from '@/components/ui/estados';

/**
 * Direcciones guardadas.
 *
 * Hasta ahora solo se listaban. Poder guardarlas y no poder tocarlas es peor
 * que no tenerlas: quien se muda ve para siempre la dirección vieja en su
 * cuenta y tiene que reescribirla entera en cada compra, con la de al lado
 * mirándole. El primer pedido a la dirección equivocada lo paga la tienda.
 *
 * La validación del código postal la hace la API por país —en España los dos
 * primeros dígitos son la provincia, así que un 99999 es imposible— y aquí se
 * enseña campo a campo lo que responda. No se duplican esas reglas: repetidas
 * en dos sitios, se separan en cuanto una de las dos cambie.
 */

export interface Direccion {
  id: string;
  type: string;
  firstName: string;
  lastName: string;
  company: string | null;
  line1: string;
  line2: string | null;
  city: string;
  province: string;
  postalCode: string;
  countryCode: string;
  phone: string | null;
  isDefault: boolean;
}

type Borrador = Omit<Direccion, 'id' | 'isDefault'> & { id?: string; isDefault: boolean };

const VACIA: Borrador = {
  type: 'SHIPPING',
  firstName: '',
  lastName: '',
  company: null,
  line1: '',
  line2: null,
  city: '',
  province: '',
  postalCode: '',
  countryCode: 'ES',
  phone: null,
  isDefault: false,
};

export function Direcciones({
  direcciones,
  token,
  onCambio,
}: {
  direcciones: Direccion[];
  token: string | null;
  onCambio: () => void;
}) {
  const t = useTranslations('cuenta');
  const tc = useTranslations('comun');

  const [editando, setEditando] = useState<Borrador | null>(null);
  const [errores, setErrores] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const llamar = async (accion: () => Promise<unknown>) => {
    setOcupado(true);
    setError(null);
    setErrores({});
    try {
      await accion();
      setEditando(null);
      onCambio();
    } catch (fallo) {
      if (fallo instanceof ErrorApi && fallo.campos) setErrores(fallo.campos);
      else setError(fallo instanceof Error ? fallo.message : tc('error'));
    } finally {
      setOcupado(false);
    }
  };

  const guardar = (e: FormEvent) => {
    e.preventDefault();
    if (!editando || !token) return;

    const { id, ...datos } = editando;
    void llamar(() =>
      api(id ? `/addresses/${id}` : '/addresses', {
        method: id ? 'PATCH' : 'POST',
        token,
        // Los opcionales vacíos se quitan en vez de mandarse como null: la API
        // los valida solo si vienen, y un `null` en `phone` sería un teléfono
        // no válido en lugar de "no hay teléfono".
        body: JSON.stringify(
          Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== null && v !== '')),
        ),
      }),
    );
  };

  const campo = (
    nombre: keyof Borrador,
    etiqueta: string,
    opciones: { requerido?: boolean; ancho?: string } = {},
  ) => {
    const fallos = errores[nombre];
    const valor = editando?.[nombre];

    return (
      <div className={opciones.ancho}>
        <label htmlFor={`dir-${nombre}`} className="mb-1 block text-sm font-medium">
          {etiqueta}
        </label>
        <input
          id={`dir-${nombre}`}
          className="campo"
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => setEditando((d) => (d ? { ...d, [nombre]: e.target.value } : d))}
          aria-invalid={fallos ? true : undefined}
          aria-describedby={fallos ? `dir-${nombre}-error` : undefined}
          required={opciones.requerido ?? false}
        />
        {fallos && (
          <span
            id={`dir-${nombre}-error`}
            role="alert"
            className="mt-1 block text-xs"
            style={{ color: 'var(--error)' }}
          >
            {fallos.join('. ')}
          </span>
        )}
      </div>
    );
  };

  if (editando) {
    return (
      <form onSubmit={guardar} className="card space-y-4 p-5">
        <h3 className="font-medium">
          {editando.id ? t('editar_direccion') : t('nueva_direccion')}
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          {campo('firstName', t('dir_nombre'), { requerido: true })}
          {campo('lastName', t('dir_apellidos'), { requerido: true })}
        </div>

        {campo('line1', t('dir_calle'), { requerido: true })}
        {campo('line2', t('dir_calle2'))}

        <div className="grid gap-4 sm:grid-cols-3">
          {campo('postalCode', t('dir_cp'), { requerido: true })}
          {campo('city', t('dir_ciudad'), { requerido: true })}
          {campo('province', t('dir_provincia'), { requerido: true })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {campo('countryCode', t('dir_pais'), { requerido: true })}
          {campo('phone', t('dir_telefono'))}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={editando.isDefault}
            onChange={(e) => setEditando((d) => (d ? { ...d, isDefault: e.target.checked } : d))}
          />
          {t('usar_por_defecto')}
        </label>

        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primario" disabled={ocupado}>
            {tc('guardar')}
          </button>
          <button
            type="button"
            className="btn btn-fantasma"
            onClick={() => {
              setEditando(null);
              setErrores({});
            }}
          >
            {tc('cancelar')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn btn-secundario" onClick={() => setEditando(VACIA)}>
          + {t('nueva_direccion')}
        </button>
      </div>

      {direcciones.length === 0 ? (
        <Vacio
          icono="usuario"
          titulo={t('sin_direcciones')}
          descripcion={t('sin_direcciones_ayuda')}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {direcciones.map((d) => (
            <li key={d.id} className="card flex flex-col p-4">
              {d.isDefault && (
                <span
                  className="etiqueta mb-2 self-start"
                  style={{
                    background: 'color-mix(in srgb, var(--marca-primario) 12%, transparent)',
                    color: 'var(--marca-texto)',
                  }}
                >
                  {t('predeterminada')}
                </span>
              )}

              <address className="text-sm not-italic text-[var(--texto-suave)]">
                <span className="block font-medium text-[var(--texto)]">
                  {d.firstName} {d.lastName}
                </span>
                {d.line1}
                {d.line2 ? `, ${d.line2}` : ''}
                <br />
                {d.postalCode} {d.city} ({d.province})
                <br />
                {d.countryCode}
                {d.phone ? ` · ${d.phone}` : ''}
              </address>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-fantasma text-sm"
                  onClick={() => setEditando({ ...d })}
                >
                  {tc('editar')}
                </button>

                {!d.isDefault && (
                  <button
                    type="button"
                    className="btn btn-fantasma text-sm"
                    disabled={ocupado || !token}
                    onClick={() =>
                      void llamar(() =>
                        api(`/addresses/${d.id}/default`, { method: 'POST', token: token! }),
                      )
                    }
                  >
                    {t('hacer_predeterminada')}
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-fantasma text-sm"
                  style={{ color: 'var(--error)' }}
                  disabled={ocupado || !token}
                  onClick={() => {
                    // Una dirección borrada no se recupera y el botón está al
                    // lado de "editar": sin confirmación, un dedo en el móvil
                    // basta para perderla.
                    if (!window.confirm(t('confirmar_borrar_direccion'))) return;
                    void llamar(() =>
                      api(`/addresses/${d.id}`, { method: 'DELETE', token: token! }),
                    );
                  }}
                >
                  {tc('eliminar')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post, subirFichero } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { useToast } from '@/componentes/ui/toast';
import { ConfirmarPeligro } from '@/componentes/ui/overlays';

/**
 * Marcas de producto.
 *
 * El fabricante de lo que se vende. La tabla existía en la base de datos desde
 * el principio sin ninguna pantalla detrás, así que el dato que manda el
 * proveedor en cada artículo —SATISFYER, BATHMATE, PRETTY LOVE— se tiraba.
 *
 * Se llenan solas al importar: cada producto crea su marca si no existía. Esta
 * pantalla es para lo que no puede hacer una importación —subir el logotipo,
 * corregir un nombre mal escrito, esconder una marca sin borrar sus productos—.
 */

interface Marca {
  id: string;
  handle: string;
  name: string;
  logoUrl: string | null;
  isActive: boolean;
  productos: number;
}

export function Marcas() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();

  const [nueva, setNueva] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [nombreEditado, setNombreEditado] = useState('');
  const [porBorrar, setPorBorrar] = useState<Marca | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);

  const marcas = useQuery({
    queryKey: ['marcas'],
    queryFn: () => get<Marca[]>('/brands'),
  });

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['marcas'] });
    // Los desplegables del editor de producto y del importador leen la misma
    // lista: dejarlos con la copia vieja esconde la marca recién creada.
    void qc.invalidateQueries({ queryKey: ['producto'] });
  };

  const crear = useMutation({
    mutationFn: (name: string) => post('/brands', { name }),
    onSuccess: () => {
      setNueva('');
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const actualizar = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: Record<string, unknown> }) =>
      patch(`/brands/${id}`, cambios),
    onSuccess: () => {
      setEditando(null);
      refrescar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminar = useMutation({
    mutationFn: (id: string) => del(`/brands/${id}`),
    onSuccess: () => {
      setPorBorrar(null);
      refrescar();
    },
    onError: (e: Error) => {
      setPorBorrar(null);
      toast.error(e.message);
    },
  });

  const subirLogo = async (id: string, fichero: File): Promise<void> => {
    setSubiendo(id);
    try {
      await subirFichero(`/brands/${id}/logo`, fichero);
      refrescar();
      toast.exito(t('marcas.logo_subido'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('marcas.logo_error'));
    } finally {
      setSubiendo(null);
    }
  };

  if (marcas.isLoading) return <Cargando />;
  if (marcas.error)
    return <ErrorPanel error={marcas.error} reintentar={() => void marcas.refetch()} />;

  const items = marcas.data ?? [];

  return (
    <div>
      <Encabezado
        titulo={t('marcas.titulo')}
        descripcion={t('marcas.descripcion')}
        cargados={items.length}
      />

      <form
        className="panel mb-4 flex flex-wrap items-end gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (nueva.trim()) crear.mutate(nueva.trim());
        }}
      >
        <label className="block flex-1" style={{ minWidth: 220 }}>
          <span className="mb-1 block text-sm font-medium">{t('marcas.nombre')}</span>
          <input
            className="campo"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            placeholder="Satisfyer"
            data-prueba="nueva-marca"
          />
        </label>
        <button
          type="submit"
          className="btn btn-primario"
          disabled={nueva.trim().length === 0 || crear.isPending}
        >
          {t('marcas.crear')}
        </button>
      </form>

      {items.length === 0 ? (
        <Vacio titulo={t('marcas.ninguna')} descripcion={t('marcas.ninguna_ayuda')} />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>{t('marcas.logotipo')}</th>
                <th>{t('marcas.nombre')}</th>
                <th className="text-right">{t('marcas.productos')}</th>
                <th>{t('app.estado')}</th>
                <th className="text-right">{t('app.acciones')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.logoUrl ? (
                      // `contain` y fondo neutro: un logotipo recortado deja de
                      // ser el logotipo de nadie.
                      <img
                        src={m.logoUrl}
                        alt=""
                        className="h-8 w-16 rounded object-contain"
                        style={{ background: 'var(--fondo-sutil)' }}
                      />
                    ) : (
                      <span
                        className="grid h-8 w-16 place-items-center rounded text-[10px]"
                        style={{ background: 'var(--fondo-sutil)', color: 'var(--texto-tenue)' }}
                      >
                        {t('marcas.sin_logo')}
                      </span>
                    )}
                  </td>

                  <td>
                    {editando === m.id ? (
                      <div className="flex flex-wrap gap-2">
                        <input
                          className="campo max-w-[200px]"
                          value={nombreEditado}
                          onChange={(e) => setNombreEditado(e.target.value)}
                          aria-label={t('marcas.nombre')}
                        />
                        <button
                          type="button"
                          className="btn btn-primario text-xs"
                          disabled={nombreEditado.trim().length === 0}
                          onClick={() =>
                            actualizar.mutate({
                              id: m.id,
                              cambios: { name: nombreEditado.trim() },
                            })
                          }
                        >
                          {t('app.guardar')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-fantasma text-xs"
                          onClick={() => setEditando(null)}
                        >
                          {t('app.cancelar')}
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="font-medium">{m.name}</span>
                        <span
                          className="ml-2 font-mono text-xs"
                          style={{ color: 'var(--texto-tenue)' }}
                        >
                          {m.handle}
                        </span>
                      </>
                    )}
                  </td>

                  <td className="text-right tabular-nums">{m.productos}</td>

                  <td>
                    <Etiqueta
                      texto={m.isActive ? t('marcas.activa') : t('marcas.inactiva')}
                      tono={m.isActive ? 'exito' : 'neutro'}
                    />
                  </td>

                  <td>
                    <div className="flex flex-wrap justify-end gap-2">
                      <label className="btn btn-secundario cursor-pointer text-xs">
                        {subiendo === m.id ? '…' : t('marcas.subir_logo')}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/avif"
                          className="hidden"
                          disabled={subiendo !== null}
                          onChange={(e) => {
                            const fichero = e.target.files?.[0];
                            // Se limpia para poder reintentar con el MISMO
                            // fichero tras un fallo: si no, no salta el cambio.
                            e.target.value = '';
                            if (fichero) void subirLogo(m.id, fichero);
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        className="btn btn-fantasma text-xs"
                        onClick={() => {
                          setEditando(m.id);
                          setNombreEditado(m.name);
                        }}
                      >
                        {t('app.editar')}
                      </button>

                      <button
                        type="button"
                        className="btn btn-fantasma text-xs"
                        onClick={() =>
                          actualizar.mutate({ id: m.id, cambios: { isActive: !m.isActive } })
                        }
                      >
                        {m.isActive ? t('marcas.desactivar') : t('marcas.activar')}
                      </button>

                      {/* Borrar solo tiene sentido sin productos: con ellos, la
                          API lo rechaza y lo que toca es desactivarla. */}
                      {m.productos === 0 && (
                        <button
                          type="button"
                          className="btn btn-fantasma text-xs"
                          style={{ color: 'var(--error)' }}
                          onClick={() => setPorBorrar(m)}
                        >
                          {t('app.eliminar')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmarPeligro
        abierto={porBorrar !== null}
        alCerrar={() => setPorBorrar(null)}
        alConfirmar={() => porBorrar && eliminar.mutate(porBorrar.id)}
        trabajando={eliminar.isPending}
        titulo={t('marcas.eliminar')}
        descripcion={t('marcas.eliminar_confirmar', { nombre: porBorrar?.name ?? '' })}
        textoConfirmar={t('app.eliminar')}
      />
    </div>
  );
}

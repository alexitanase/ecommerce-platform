import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

/**
 * Configuración de los servicios externos.
 *
 * Aquí se ponen las claves de la pasarela, del correo, del traductor y del
 * acceso social. Antes vivían en el servidor, en un fichero que había que
 * editar y reiniciar; es decir, en la práctica no se cambiaban.
 *
 * Dos cosas que la pantalla deja claras a propósito:
 *
 *  - **Un secreto guardado no se vuelve a enseñar.** Solo dice "configurado".
 *    Si hay que cambiarlo se escribe el nuevo encima; si se deja vacío, se
 *    conserva el que había.
 *  - **Lo que no está completo no se puede activar.** El botón lo impide y
 *    dice qué falta, porque una pasarela a medias no falla al guardarla: falla
 *    con el primer cliente que intenta pagar.
 */

interface Campo {
  clave: string;
  etiqueta: string;
  secreto: boolean;
  obligatorio: boolean;
  ayuda?: string;
  tipo?: 'texto' | 'numero' | 'booleano';
  configurado?: boolean;
  valor?: string | number | boolean | null;
}

type Familia =
  | 'pago'
  | 'correo'
  | 'almacenamiento'
  | 'buscador'
  | 'traduccion'
  | 'acceso'
  | 'seguimiento'
  | 'imagenes'
  | 'analitica';

interface Integracion {
  key: string;
  familia: Familia;
  nombre: string;
  descripcion: string;
  donde: string | null;
  implementada: boolean;
  activa: boolean;
  operativa: boolean;
  faltan: string[];
  credenciales: Campo[];
  ajustes: Campo[];
  credencialesDesde: string | null;
  /** URLs nuestras que hay que dar de alta en el panel del servicio. */
  retornos: { tipo: 'oauth' | 'ipn' | 'webhook'; url: string }[];
  ultimaComprobacion: string | null;
  ultimaComprobacionOk: boolean | null;
  ultimoError: string | null;
}

/**
 * Orden en el que se enseñan.
 *
 * Primero lo que impide vender si falta —cobrar, avisar al cliente, guardar las
 * fotos— y al final lo prescindible. Quien abre esta pantalla con la tienda
 * recién instalada tiene que encontrarse lo urgente arriba.
 *
 * **Esta lista tiene que llevar TODAS las familias del catálogo de la API.** Lo
 * que no esté aquí no se pinta, y el síntoma es de los que no se buscan: la
 * integración existe, está implementada y funcionando, y en el panel no hay
 * dónde configurarla. Le pasaba a `analitica`: GA4 y el píxel de Meta llevaban
 * implementados desde la fase 11 y esta pantalla no los enseñaba, así que no
 * había forma de poner el identificador de medición.
 */
const FAMILIAS: Familia[] = [
  'pago',
  'correo',
  'almacenamiento',
  'buscador',
  'seguimiento',
  'traduccion',
  'acceso',
  'imagenes',
  'analitica',
];

export function Integraciones() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [borrador, setBorrador] = useState<Record<string, Record<string, string | boolean>>>({});

  const consulta = useQuery({
    queryKey: ['integraciones'],
    queryFn: () => get<Integracion[]>('/integrations'),
  });

  const probar = useMutation({
    mutationFn: (key: string) =>
      post<{ ok: boolean; mensaje?: string }>(`/integrations/${key}/test`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integraciones'] }),
  });

  const guardar = useMutation({
    mutationFn: ({ key, cuerpo }: { key: string; cuerpo: unknown }) =>
      post(`/integrations/${key}`, cuerpo),
    onSuccess: (_, { key }) => {
      // Los secretos escritos se descartan del formulario tras guardarlos: no
      // tiene sentido conservarlos en memoria del navegador.
      setBorrador((b) => ({ ...b, [key]: {} }));
      void qc.invalidateQueries({ queryKey: ['integraciones'] });
    },
  });

  if (consulta.isLoading) return <Cargando />;
  if (consulta.error)
    return <ErrorPanel error={consulta.error} reintentar={() => void consulta.refetch()} />;

  const integraciones = consulta.data ?? [];

  const valorDe = (key: string, campo: string): string | boolean => borrador[key]?.[campo] ?? '';

  const cambiar = (key: string, campo: string, valor: string | boolean) => {
    setBorrador((b) => ({ ...b, [key]: { ...b[key], [campo]: valor } }));
  };

  const enviar = (integracion: Integracion, activa?: boolean) => {
    const cambios = borrador[integracion.key] ?? {};

    const credenciales: Record<string, string> = {};
    const ajustes: Record<string, string | boolean> = {};

    for (const campo of integracion.credenciales) {
      const valor = cambios[campo.clave];
      // Solo lo que se ha escrito: mandar los vacíos borraría lo guardado.
      if (typeof valor === 'string' && valor.length > 0) credenciales[campo.clave] = valor;
    }

    for (const campo of integracion.ajustes) {
      const valor = cambios[campo.clave];
      if (valor !== undefined && valor !== '') ajustes[campo.clave] = valor;
    }

    guardar.mutate({
      key: integracion.key,
      cuerpo: {
        ...(activa !== undefined ? { activa } : {}),
        ...(Object.keys(credenciales).length > 0 ? { credenciales } : {}),
        ...(Object.keys(ajustes).length > 0 ? { ajustes } : {}),
      },
    });
  };

  return (
    <div>
      <Encabezado titulo={t('integraciones.titulo')} descripcion={t('integraciones.descripcion')} />

      {guardar.error && (
        <p
          role="alert"
          className="mb-4 rounded-lg px-4 py-3 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--error) 12%, transparent)',
            color: 'var(--error)',
          }}
        >
          {guardar.error.message}
        </p>
      )}

      {FAMILIAS.map((familia) => {
        const grupo = integraciones.filter((i) => i.familia === familia);
        if (grupo.length === 0) return null;

        return (
          <section key={familia} className="mb-8">
            <h2 className="mb-1 text-sm font-semibold">{t(`integraciones.familia_${familia}`)}</h2>
            <p className="mb-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
              {t(`integraciones.familia_${familia}_ayuda`)}
            </p>

            <div className="fichas fichas-anchas">
              {grupo.map((i) => (
                <article key={i.key} className="panel p-4">
                  <header className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{i.nombre}</h3>

                    {i.operativa ? (
                      <Etiqueta texto={t('integraciones.operativa')} tono="exito" />
                    ) : i.activa ? (
                      <Etiqueta texto={t('integraciones.incompleta')} tono="aviso" />
                    ) : (
                      <Etiqueta texto={t('integraciones.desactivada')} tono="neutro" />
                    )}

                    {!i.implementada && (
                      <Etiqueta texto={t('integraciones.no_implementada')} tono="neutro" />
                    )}
                  </header>

                  <p className="mb-3 text-sm" style={{ color: 'var(--texto-suave)' }}>
                    {i.descripcion}
                  </p>

                  {i.donde && (
                    <p className="mb-3 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {t('integraciones.donde')}: {i.donde}
                    </p>
                  )}

                  {/* Las URLs que hay que pegar en el panel del servicio. Van
                      antes de los campos porque sin darlas de alta las
                      credenciales no sirven de nada: el acceso con Google falla
                      con `redirect_uri_mismatch`, y NOWPayments cobra el pedido
                      y no avisa nunca, así que el pago no se marca. */}
                  {i.retornos.map((r) => (
                    <UrlDeRetorno key={r.tipo} tipo={r.tipo} url={r.url} />
                  ))}

                  <div className="space-y-3">
                    {i.credenciales.map((campo) => (
                      <label key={campo.clave} className="block">
                        <span className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
                          {campo.etiqueta}
                          {campo.configurado && (
                            <Etiqueta texto={t('integraciones.guardado')} tono="exito" />
                          )}
                        </span>
                        <input
                          type={campo.secreto ? 'password' : 'text'}
                          autoComplete="off"
                          value={String(valorDe(i.key, campo.clave))}
                          placeholder={
                            campo.configurado
                              ? t('integraciones.dejar_vacio')
                              : t('integraciones.sin_configurar')
                          }
                          onChange={(e) => cambiar(i.key, campo.clave, e.target.value)}
                          className="campo"
                        />
                        {campo.ayuda && (
                          <span
                            className="mt-1 block text-xs"
                            style={{ color: 'var(--texto-tenue)' }}
                          >
                            {campo.ayuda}
                          </span>
                        )}
                      </label>
                    ))}

                    {i.ajustes.map((campo) =>
                      campo.tipo === 'booleano' ? (
                        <label
                          key={campo.clave}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={
                              borrador[i.key]?.[campo.clave] !== undefined
                                ? borrador[i.key]?.[campo.clave] === true
                                : campo.valor === true
                            }
                            onChange={(e) => cambiar(i.key, campo.clave, e.target.checked)}
                          />
                          {campo.etiqueta}
                        </label>
                      ) : (
                        <label key={campo.clave} className="block">
                          <span className="mb-1 block text-sm font-medium">{campo.etiqueta}</span>
                          <input
                            type={campo.tipo === 'numero' ? 'number' : 'text'}
                            value={
                              borrador[i.key]?.[campo.clave] !== undefined
                                ? String(borrador[i.key]?.[campo.clave])
                                : String(campo.valor ?? '')
                            }
                            onChange={(e) => cambiar(i.key, campo.clave, e.target.value)}
                            className="campo"
                          />
                          {campo.ayuda && (
                            <span
                              className="mt-1 block text-xs"
                              style={{ color: 'var(--texto-tenue)' }}
                            >
                              {campo.ayuda}
                            </span>
                          )}
                        </label>
                      ),
                    )}
                  </div>

                  {i.faltan.length > 0 && (
                    <p className="mt-3 text-xs" style={{ color: 'var(--aviso)' }}>
                      {t('integraciones.faltan')}: {i.faltan.join(', ')}
                    </p>
                  )}

                  {i.ultimaComprobacion && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                      {t('integraciones.ultima_comprobacion')}:{' '}
                      {new Date(i.ultimaComprobacion).toLocaleString('es-ES')} ·{' '}
                      {i.ultimaComprobacionOk ? '✓' : (i.ultimoError ?? '✗')}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-secundario text-sm"
                      disabled={guardar.isPending}
                      onClick={() => enviar(i)}
                    >
                      {t('app.guardar')}
                    </button>

                    <button
                      type="button"
                      className={`btn text-sm ${i.activa ? 'btn-fantasma' : 'btn-primario'}`}
                      disabled={guardar.isPending || (!i.implementada && !i.activa)}
                      onClick={() => enviar(i, !i.activa)}
                    >
                      {i.activa ? t('integraciones.desactivar') : t('integraciones.activar')}
                    </button>

                    {/* Probar de verdad contra el servicio: unas credenciales
                        mal copiadas no fallan al guardarlas, fallan con el
                        primer cliente. */}
                    <button
                      type="button"
                      className="btn btn-fantasma text-sm"
                      disabled={probar.isPending || i.faltan.length > 0}
                      onClick={() => probar.mutate(i.key)}
                    >
                      {probar.isPending && probar.variables === i.key
                        ? t('integraciones.probando')
                        : t('integraciones.probar')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Una URL nuestra que hay que dar de alta en el panel del servicio.
 *
 * Es el paso que no estaba en esta pantalla y hace fallar todo lo demás, y falla
 * lejos: con el Client ID y el Secret correctos, Google rechaza el acceso con
 * `redirect_uri_mismatch`; con la clave de NOWPayments correcta, el cliente paga,
 * la pasarela intenta avisar a una URL que nadie dio de alta y el pedido se queda
 * esperando un pago que ya se hizo. Ninguno de los dos errores se puede detectar
 * desde aquí, así que se enseña la URL lista para copiar y se explica dónde va.
 *
 * En un campo de solo lectura y no como texto: una URL larga escrita a mano se
 * copia mal, y un carácter de diferencia da el mismo error sin decir por qué. Con
 * `onFocus` seleccionando todo, un clic y Ctrl+C también valen.
 */
function UrlDeRetorno({ tipo, url }: { tipo: 'oauth' | 'ipn' | 'webhook'; url: string }) {
  const { t } = useTranslation();
  const [copiada, setCopiada] = useState(false);

  const copiar = () => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    });
  };

  const etiqueta = t(`integraciones.url_${tipo}`);

  return (
    <div
      className="mb-3 rounded-lg border p-3"
      style={{ borderColor: 'var(--borde)', background: 'var(--fondo-sutil)' }}
      data-prueba={`url-${tipo}`}
    >
      <p className="mb-1 text-xs font-medium">{etiqueta}</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="campo font-mono text-base sm:text-xs"
          aria-label={etiqueta}
        />
        <button type="button" onClick={copiar} className="btn btn-secundario shrink-0 text-xs">
          {copiada ? t('app.copiado') : t('app.copiar')}
        </button>
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t(`integraciones.url_${tipo}_ayuda`)}
      </p>
    </div>
  );
}

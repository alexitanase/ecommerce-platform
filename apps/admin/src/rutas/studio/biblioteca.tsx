import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subirFichero } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Boton } from '@/componentes/ui/boton';
import { ConfirmarPeligro } from '@/componentes/ui/overlays';
import { useToast } from '@/componentes/ui/toast';
import { useSesion } from '@/lib/sesion';
import { copiar, listarActivos, pesoLegible, retirarActivo, type Activo } from '@/lib/studio';
import { Ico } from '@/lib/navegacion';

/**
 * Biblioteca de activos.
 *
 * Cada pieza guarda **de dónde salió**: subida, del catálogo, del proveedor o
 * generada con IA —y en ese caso, con qué modelo y con qué instrucción—. No es
 * un adorno: es lo que permite saber qué se puede usar comercialmente y poder
 * responder si alguien reclama una imagen seis meses después.
 *
 * Los originales se guardan tal cual, sin recomprimir. Son materia prima: se
 * recortan, se escalan y se componen, y recomprimir de entrada arrastraría los
 * artefactos a todas las piezas que salgan de ellos.
 */

const ORIGENES = ['SUBIDA', 'IA', 'CATALOGO', 'PROVEEDOR'] as const;

export function Biblioteca() {
  const { t } = useTranslation();
  const { puede } = useSesion();
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const [origen, setOrigen] = useState('');
  const [texto, setTexto] = useState('');
  const [subiendo, setSubiendo] = useState(0);
  const [aRetirar, setARetirar] = useState<Activo | null>(null);

  const activos = useQuery({
    queryKey: ['studio', 'activos', origen, texto],
    queryFn: () => listarActivos({ ...(origen ? { origen } : {}), ...(texto ? { texto } : {}) }),
  });

  const refrescar = () => void qc.invalidateQueries({ queryKey: ['studio', 'activos'] });

  const retirar = useMutation({
    mutationFn: (id: string) => retirarActivo(id),
    onSuccess: () => {
      toast.exito(t('studio.activo_retirado'));
      setARetirar(null);
      refrescar();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  /**
   * Subida de uno o varios ficheros.
   *
   * En serie y no en paralelo a propósito: la API procesa cada imagen con sharp
   * y diez a la vez desde el navegador dejan la API sin CPU justo cuando la
   * tienda la necesita. Además así la barra dice algo cierto.
   */
  const subir = async (ficheros: FileList | null) => {
    if (!ficheros?.length) return;

    for (let i = 0; i < ficheros.length; i++) {
      const fichero = ficheros[i];
      if (!fichero) continue;
      try {
        await subirFichero('/studio/activos', fichero, {
          alProgresar: (p) => setSubiendo(Math.round(((i + p / 100) / ficheros.length) * 100)),
        });
      } catch (e) {
        toast.error((e as Error).message);
      }
    }

    setSubiendo(0);
    if (entrada.current) entrada.current.value = '';
    refrescar();
  };

  if (activos.isLoading) return <Cargando />;
  if (activos.error)
    return <ErrorPanel error={activos.error} reintentar={() => void activos.refetch()} />;

  const items = activos.data ?? [];

  return (
    <div className="studio-pagina">
      <div className="studio-titular">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('studio.biblioteca')}</h1>
          <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
            {t('studio.biblioteca_descripcion')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            className="campo w-auto"
            type="search"
            value={texto}
            placeholder={t('studio.buscar_activo')}
            aria-label={t('studio.buscar_activo')}
            onChange={(e) => setTexto(e.target.value)}
          />

          <select
            className="campo w-auto"
            value={origen}
            onChange={(e) => setOrigen(e.target.value)}
            aria-label={t('studio.filtrar_origen')}
          >
            <option value="">{t('studio.todos_origenes')}</option>
            {ORIGENES.map((o) => (
              <option key={o} value={o}>
                {t(`studio.origen.${o}`)}
              </option>
            ))}
          </select>

          {puede('studio:write') && (
            <>
              <input
                ref={entrada}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void subir(e.target.files)}
              />
              <Boton
                variante="primario"
                onClick={() => entrada.current?.click()}
                cargando={subiendo > 0}
              >
                {subiendo > 0 ? `${subiendo} %` : t('studio.subir')}
              </Boton>
            </>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <Vacio titulo={t('studio.sin_activos')} descripcion={t('studio.sin_activos_ayuda')} />
      ) : (
        <div className="studio-activos">
          {items.map((a) => (
            <FichaActivo
              key={a.id}
              activo={a}
              alCopiar={async () => {
                const hecho = await copiar(a.url);
                if (hecho) toast.exito(t('studio.url_copiada'));
                else toast.error(t('studio.enlace_no_copiado'));
              }}
              alRetirar={puede('studio:write') ? () => setARetirar(a) : undefined}
            />
          ))}
        </div>
      )}

      {aRetirar && (
        <ConfirmarPeligro
          abierto
          titulo={t('studio.retirar_activo')}
          descripcion={t('studio.retirar_activo_ayuda', { nombre: aRetirar.name })}
          textoConfirmar={t('studio.retirar')}
          alConfirmar={() => retirar.mutate(aRetirar.id)}
          trabajando={retirar.isPending}
          alCerrar={() => setARetirar(null)}
        />
      )}
    </div>
  );
}

function FichaActivo({
  activo,
  alCopiar,
  alRetirar,
}: {
  activo: Activo;
  alCopiar: () => void;
  alRetirar?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <figure className="studio-activo">
      <div
        className="studio-activo-vista"
        // El marcador borroso de fondo evita el rectángulo gris mientras carga
        // la imagen real, que en una rejilla de trescientas se nota.
        style={activo.blurhash ? { backgroundImage: `url(${activo.blurhash})` } : undefined}
      >
        <img src={activo.url} alt={activo.name} loading="lazy" />
      </div>

      <figcaption>
        <p className="truncate text-sm font-medium" title={activo.name}>
          {activo.name}
        </p>
        <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {activo.width}×{activo.height} · {pesoLegible(activo.sizeBytes)}
        </p>

        {/*
         * La dirección pública del fichero, para poder usarla fuera del Studio
         * —en la portada, en un correo, en una página—. Es la misma que sirve la
         * tienda, así que copiarla de aquí evita el paso de ir a buscarla al
         * almacenamiento.
         */}
        <div className="studio-copiar mt-1">
          <input
            className="campo font-mono"
            value={activo.url}
            readOnly
            aria-label={t('studio.url_de', { nombre: activo.name })}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Boton
            variante="secundario"
            tamano="sm"
            soloIcono
            etiqueta={t('studio.copiar_url')}
            onClick={alCopiar}
            icono={<Ico d="M9 9h11v11H9zM5 15H4V4h11v1" />}
          />
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <Etiqueta
            texto={t(`studio.origen.${activo.source}`)}
            tono={activo.source === 'IA' ? 'info' : 'neutro'}
          />
          {alRetirar && (
            <button type="button" className="enlace-sutil text-xs" onClick={alRetirar}>
              {t('studio.retirar')}
            </button>
          )}
        </div>
      </figcaption>
    </figure>
  );
}

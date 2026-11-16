import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { Capa, Documento, TipoCapa } from '@ecom/shared';
import { Cargando, ErrorPanel, Etiqueta } from '@/componentes/estados';
import { Boton } from '@/componentes/ui/boton';
import { Modal } from '@/componentes/ui/overlays';
import { useToast } from '@/componentes/ui/toast';
import { Enlace } from '@/componentes/enlace';
import { Ico } from '@/lib/navegacion';
import { useSesion } from '@/lib/sesion';
import { ErrorApi } from '@/lib/api';
import { Lienzo } from '@/componentes/studio/editor/lienzo';
import { PanelCapas, PanelPropiedades } from '@/componentes/studio/editor/paneles';
import { ImportarHtml } from '@/componentes/studio/editor/importar-html';
import { CodigoHtml } from '@/componentes/studio/editor/codigo-html';
import { useFormatos } from '@/componentes/studio/selector-formato';
import {
  actualizarCapa,
  alinear,
  anadirCapa,
  borrarCapa,
  capaNueva,
  capaPorId,
  duplicarCapa,
  moverEnOrden,
  siguienteOrden,
  type Alineacion,
} from '@/lib/studio-edicion';
import {
  descargar,
  exportarHtml,
  exportarMesa,
  nombreDeArchivo,
  type TipoExportacion,
} from '@/lib/studio-exportar';
import {
  cambiarEstadoCreatividad,
  guardarDocumento,
  listarActivos,
  pesoLegible,
  restaurarVersion,
  TONO_ESTADO,
  verCreatividad,
  versionesDe,
} from '@/lib/studio';

/**
 * El editor.
 *
 * Todo lo que hay aquí se puede hacer **a mano**, de principio a fin, sin que
 * intervenga ningún modelo: capas, formas, texto, imágenes, alineación,
 * historial y exportación. La IA es una capa que se enchufa encima en la fase C
 * y que se puede dejar apagada para siempre; el Studio no depende de ella para
 * nada. Ver STUDIO.md.
 *
 * El documento vive en el estado de este componente y se guarda solo. Cada
 * guardado crea una versión nueva en el servidor, con control de concurrencia:
 * si alguien guardó por medio, avisa en lugar de pisarlo.
 */

const GUARDADO_MS = 1500;

export function Editor() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { puede } = useSesion();
  // El árbol de rutas se define por código, así que TanStack no genera los tipos
  // de cada ruta y `useParams` devuelve un objeto vacío en tipos. Se acota aquí,
  // igual que en la ficha de producto.
  const parametros: Record<string, string | undefined> = useParams({ strict: false });
  const creativeId = parametros['creativeId'] ?? '';

  const creatividad = useQuery({
    queryKey: ['studio', 'creatividad', creativeId],
    queryFn: () => verCreatividad(creativeId),
    // El documento se edita en local: recargarlo al volver a la pestaña
    // machacaría lo que se está haciendo.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const activos = useQuery({ queryKey: ['studio', 'activos'], queryFn: () => listarActivos() });
  const formatos = useFormatos();

  const [doc, setDoc] = useState<Documento | null>(null);
  const [version, setVersion] = useState(0);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [sucio, setSucio] = useState(false);
  const [historial, setHistorial] = useState(false);
  const [importando, setImportando] = useState(false);
  const [viendoCodigo, setViendoCodigo] = useState(false);
  const [exportando, setExportando] = useState(false);

  const pasado = useRef<Documento[]>([]);
  const futuro = useRef<Documento[]>([]);

  /*
   * El documento se copia al estado local una sola vez, al abrir: a partir de
   * ahí manda el editor y el servidor no vuelve a pisarlo.
   *
   * Se hace durante el render y no en un efecto a propósito. Con un efecto hay
   * un render intermedio con el documento todavía a null —el lienzo vacío
   * parpadea— y React avisa de que es una cascada innecesaria. Ajustar el
   * estado en el render es el patrón para justamente esto: converge en la misma
   * pasada.
   */
  if (creatividad.data?.documento && doc === null) {
    setDoc(creatividad.data.documento);
    setVersion(creatividad.data.currentVersion);
  }

  const editable = puede('studio:write');
  const mesa = doc?.mesas[0];
  const ficha = formatos.data?.formatos.find((f) => f.clave === creatividad.data?.format);

  /** URL de cada activo, que es lo único que el motor de dibujo necesita. */
  const urls = useMemo(
    () => Object.fromEntries((activos.data ?? []).map((a) => [a.id, a.url])),
    [activos.data],
  );

  // ── Historial ───────────────────────────────────────────

  const aplicar = useCallback((siguiente: Documento, alHistorial = true) => {
    setDoc((actual) => {
      if (actual && alHistorial) {
        pasado.current = [...pasado.current.slice(-49), actual];
        futuro.current = [];
      }
      return siguiente;
    });
    setSucio(true);
  }, []);

  const deshacer = useCallback(() => {
    const previo = pasado.current.pop();
    if (!previo) return;
    setDoc((actual) => {
      if (actual) futuro.current = [...futuro.current, actual];
      return previo;
    });
    setSucio(true);
  }, []);

  const rehacer = useCallback(() => {
    const siguiente = futuro.current.pop();
    if (!siguiente) return;
    setDoc((actual) => {
      if (actual) pasado.current = [...pasado.current, actual];
      return siguiente;
    });
    setSucio(true);
  }, []);

  // ── Guardado automático ─────────────────────────────────

  const guardar = useMutation({
    mutationFn: (documento: Documento) => guardarDocumento(creativeId, documento, version),
    onSuccess: (r) => {
      setVersion(r.version);
      setSucio(false);
      if (r.reabierta) toast.mostrar(t('studio.reabierta'));
      void qc.invalidateQueries({ queryKey: ['studio', 'campana'] });
    },
    onError: (e: unknown) => {
      // El 409 es el caso que importa: alguien guardó desde otra pestaña. Se
      // avisa y NO se reintenta, o el reintento pisaría su trabajo.
      if (e instanceof ErrorApi && e.status === 409) toast.error(e.message);
      else toast.error((e as Error).message);
    },
  });

  useEffect(() => {
    if (!doc || !sucio || !editable) return;
    const temporizador = setTimeout(() => guardar.mutate(doc), GUARDADO_MS);
    return () => clearTimeout(temporizador);
    // `guardar` cambia de identidad en cada render de react-query; incluirlo
    // reiniciaría el temporizador sin parar y no guardaría nunca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, sucio, editable]);

  // ── Acciones sobre capas ────────────────────────────────

  const anadir = (tipo: TipoCapa) => {
    if (!doc || !mesa) return;
    const capa = capaNueva(tipo, mesa, siguienteOrden(doc, mesa.id));
    aplicar(anadirCapa(doc, capa));
    setSeleccion(capa.id);
  };

  const cambiarCapa = (id: string, cambios: Record<string, unknown>, final = true) => {
    if (!doc) return;
    // Durante el arrastre no se apila historial: si no, deshacer retrocedería
    // un píxel y haría falta pulsarlo cien veces.
    if (Object.keys(cambios).length === 0) {
      setSucio(true);
      return;
    }
    aplicar(actualizarCapa(doc, id, cambios), final);
  };

  const borrar = (id: string) => {
    if (!doc) return;
    aplicar(borrarCapa(doc, id));
    if (seleccion === id) setSeleccion(null);
  };

  /** Mete las capas importadas encima de lo que ya hay, sin borrarlo. */
  const importar = (nuevas: Capa[], avisos: string[]) => {
    if (!doc || !mesa) return;
    const desde = siguienteOrden(doc, mesa.id);
    const colocadas = nuevas.map((c, i) => ({ ...c, orden: desde + i }));
    aplicar({ ...doc, capas: [...doc.capas, ...colocadas] });
    setImportando(false);
    setSeleccion(colocadas[0]?.id ?? null);

    toast.exito(t('studio.importadas', { count: colocadas.length }));
    for (const aviso of avisos) toast.mostrar(aviso);
  };

  /**
   * Sustituye las capas de la mesa por las que devuelve el código.
   *
   * Se cambian TODAS las de esta mesa, no se añaden encima: lo que se está
   * aplicando es la pieza entera reescrita, y dejar las viejas debajo llenaría
   * el documento de capas tapadas que solo aparecen al mover algo.
   */
  const aplicarCodigo = (nuevas: Capa[]) => {
    if (!doc || !mesa) return;
    const otrasMesas = doc.capas.filter((c) => c.mesaId !== mesa.id);
    aplicar({ ...doc, capas: [...otrasMesas, ...nuevas.map((c, i) => ({ ...c, orden: i }))] });
    setViendoCodigo(false);
    setSeleccion(null);
    toast.exito(t('studio.codigo_aplicado', { count: nuevas.length }));
  };

  const duplicar = () => {
    if (!doc || !seleccion) return;
    const r = duplicarCapa(doc, seleccion);
    aplicar(r.doc);
    setSeleccion(r.nuevaId);
  };

  // ── Teclado ─────────────────────────────────────────────

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      const destino = e.target as HTMLElement;
      // Escribiendo en un campo, las flechas mueven el cursor y Suprimir borra
      // letras: aquí no pintamos nada.
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(destino.tagName)) return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) rehacer();
        else deshacer();
        return;
      }
      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicar();
        return;
      }
      if (!editable || !seleccion || !doc) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        borrar(seleccion);
        return;
      }

      const paso = e.shiftKey ? 10 : 1;
      const flechas: Record<string, [number, number]> = {
        ArrowLeft: [-paso, 0],
        ArrowRight: [paso, 0],
        ArrowUp: [0, -paso],
        ArrowDown: [0, paso],
      };
      const delta = flechas[e.key];
      if (delta) {
        e.preventDefault();
        const capa = capaPorId(doc, seleccion);
        if (!capa) return;
        cambiarCapa(seleccion, {
          recuadro: {
            ...capa.recuadro,
            x: capa.recuadro.x + delta[0],
            y: capa.recuadro.y + delta[1],
          },
        });
      }
    };

    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, seleccion, editable, deshacer, rehacer]);

  // ── Estados de la creatividad ───────────────────────────

  const cambiarEstado = useMutation({
    mutationFn: (paso: 'revision' | 'devolver' | 'aprobar' | 'publicar') =>
      cambiarEstadoCreatividad(creativeId, paso),
    onSuccess: () => {
      toast.exito(t('studio.estado_cambiado'));
      void creatividad.refetch();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  // ── Exportar ────────────────────────────────────────────

  const exportarComoHtml = async () => {
    if (!doc || !mesa || !creatividad.data) return;
    setExportando(true);
    try {
      const blob = await exportarHtml(doc, mesa, urls, creatividad.data.name);
      descargar(
        blob,
        nombreDeArchivo(creatividad.data.name, mesa, creatividad.data.locale, 'html'),
      );
      toast.exito(t('studio.export_ok', { peso: pesoLegible(blob.size) }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExportando(false);
    }
  };

  const exportar = async (tipo: TipoExportacion) => {
    if (!doc || !mesa || !creatividad.data) return;
    setExportando(true);
    try {
      const r = await exportarMesa(doc, mesa, urls, tipo, ficha?.pesoMaxKb);
      descargar(
        r.blob,
        nombreDeArchivo(creatividad.data.name, mesa, creatividad.data.locale, tipo),
      );

      if (r.excedeMaximo) {
        toast.error(
          t('studio.export_pesa', {
            peso: pesoLegible(r.bytes),
            maximo: `${ficha?.pesoMaxKb ?? 0} KB`,
          }),
        );
      } else {
        toast.exito(t('studio.export_ok', { peso: pesoLegible(r.bytes) }));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExportando(false);
    }
  };

  if (creatividad.isLoading || !doc || !mesa) return <Cargando />;
  if (creatividad.error)
    return <ErrorPanel error={creatividad.error} reintentar={() => void creatividad.refetch()} />;
  if (!creatividad.data) return null;

  const pieza = creatividad.data;
  const capa = seleccion ? capaPorId(doc, seleccion) : undefined;

  return (
    <div className="studio-editor">
      {/* ── Barra de la pieza ── */}
      <div className="studio-editor-barra">
        <Enlace
          a="/studio/campanas/$campaignId"
          params={{ campaignId: pieza.campaign.id }}
          className="enlace-sutil text-sm"
        >
          ← {pieza.campaign.name}
        </Enlace>

        <span className="font-medium">{pieza.name}</span>
        <Etiqueta
          texto={t(`studio.estado_creatividad.${pieza.status}`)}
          tono={TONO_ESTADO[pieza.status]}
        />
        <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {mesa.ancho}×{mesa.alto}
          {ficha ? ` · ${ficha.pesoMaxKb} KB` : ''}
        </span>

        <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {guardar.isPending
            ? t('studio.guardando')
            : sucio
              ? t('studio.sin_guardar')
              : t('studio.guardado', { version })}
        </span>

        <div className="studio-editor-acciones">
          <Boton
            variante="fantasma"
            tamano="sm"
            soloIcono
            etiqueta={t('studio.deshacer')}
            onClick={deshacer}
            icono={<Ico d="M3 7v6h6M3 13a9 9 0 106-8.5" />}
          />
          <Boton
            variante="fantasma"
            tamano="sm"
            soloIcono
            etiqueta={t('studio.rehacer')}
            onClick={rehacer}
            icono={<Ico d="M21 7v6h-6M21 13a9 9 0 11-6-8.5" />}
          />
          <Boton variante="secundario" tamano="sm" onClick={() => setHistorial(true)}>
            {t('studio.versiones')}
          </Boton>

          {pieza.status === 'BORRADOR' && editable && (
            <Boton
              variante="secundario"
              tamano="sm"
              onClick={() => cambiarEstado.mutate('revision')}
            >
              {t('studio.mandar_revision')}
            </Boton>
          )}
          {pieza.status === 'EN_REVISION' && puede('studio:publish') && (
            <>
              <Boton
                variante="secundario"
                tamano="sm"
                onClick={() => cambiarEstado.mutate('devolver')}
              >
                {t('studio.devolver')}
              </Boton>
              <Boton
                variante="primario"
                tamano="sm"
                onClick={() => cambiarEstado.mutate('aprobar')}
              >
                {t('studio.aprobar')}
              </Boton>
            </>
          )}
          {pieza.status === 'APROBADA' && puede('studio:publish') && (
            <Boton variante="primario" tamano="sm" onClick={() => cambiarEstado.mutate('publicar')}>
              {t('studio.publicar')}
            </Boton>
          )}

          <div className="grupo-botones">
            {(['png', 'jpg', 'webp'] as const).map((tipo) => (
              <button
                key={tipo}
                type="button"
                className="btn btn-secundario text-sm"
                disabled={exportando}
                onClick={() => void exportar(tipo)}
              >
                {tipo.toUpperCase()}
              </button>
            ))}
            {/*
             * HTML también es una salida, no solo una entrada: es lo que piden
             * los formatos «en iframe» de las redes, y la forma de sacar la
             * pieza de aquí sin perderla —se vuelve a importar tal cual—.
             */}
            <button
              type="button"
              className="btn btn-secundario text-sm"
              disabled={exportando}
              onClick={() => void exportarComoHtml()}
            >
              HTML
            </button>
          </div>
        </div>
      </div>

      <div className="studio-editor-cuerpo">
        {/* ── Herramientas y capas ── */}
        <aside className="studio-panel studio-panel-izq">
          {editable && (
            <div className="studio-herramientas">
              {(
                [
                  ['texto', 'M4 7V4h16v3M9 20h6M12 4v16'],
                  ['forma', 'M4 4h16v16H4z'],
                  ['imagen', 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6'],
                  ['boton', 'M3 8h18v8H3zM7 12h10'],
                ] as const
              ).map(([tipo, d]) => (
                <button
                  key={tipo}
                  type="button"
                  className="objetivo"
                  title={t(`studio.anadir.${tipo}`)}
                  aria-label={t(`studio.anadir.${tipo}`)}
                  onClick={() => anadir(tipo)}
                >
                  <Ico d={d} />
                </button>
              ))}

              <span className="studio-herramientas-sep" aria-hidden="true" />

              <button
                type="button"
                className="objetivo"
                title={t('studio.importar_html')}
                aria-label={t('studio.importar_html')}
                onClick={() => setImportando(true)}
              >
                <Ico d="M4 4h16v16H4zM8 10l-2 2 2 2M16 10l2 2-2 2M13 8l-2 8" />
              </button>

              <button
                type="button"
                className="objetivo"
                title={t('studio.codigo_html')}
                aria-label={t('studio.codigo_html')}
                onClick={() => setViendoCodigo(true)}
              >
                <Ico d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
              </button>
            </div>
          )}

          <PanelCapas
            documento={doc}
            mesa={mesa}
            seleccion={seleccion}
            alSeleccionar={setSeleccion}
            alCambiar={(id, cambios) => cambiarCapa(id, cambios)}
            alMover={(id, direccion) => aplicar(moverEnOrden(doc, id, direccion))}
            alBorrar={borrar}
            editable={editable}
          />
        </aside>

        {/* ── Lienzo ── */}
        <div className="studio-tablero">
          <div className="studio-zoom">
            <button
              type="button"
              className="objetivo"
              onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}
              aria-label={t('studio.alejar')}
            >
              <Ico d="M5 12h14" />
            </button>
            <span>{Math.round(zoom * 100)} %</span>
            <button
              type="button"
              className="objetivo"
              onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
              aria-label={t('studio.acercar')}
            >
              <Ico d="M12 5v14M5 12h14" />
            </button>
            {/*
             * Volver al 100 % tiene botón propio porque es la única vista que
             * dice la verdad: un 300×250 hay que verlo a tamaño real antes de
             * darlo por bueno, y al 300 % todo se lee. Solo aparece cuando hace
             * falta, o serían dos «100 %» seguidos sin sentido.
             */}
            {zoom !== 1 && (
              <button type="button" className="objetivo text-xs" onClick={() => setZoom(1)}>
                {t('studio.tamano_real')}
              </button>
            )}
          </div>

          <div className="studio-tablero-centro">
            <Lienzo
              documento={doc}
              mesa={mesa}
              formato={ficha}
              activos={urls}
              zoom={zoom}
              seleccion={seleccion}
              alSeleccionar={setSeleccion}
              alCambiar={(id, cambios, final) => cambiarCapa(id, cambios, final)}
            />
          </div>
        </div>

        {/* ── Propiedades ── */}
        <aside className="studio-panel studio-panel-der">
          <PanelPropiedades
            capa={capa}
            activos={activos.data ?? []}
            alCambiar={(cambios) => seleccion && cambiarCapa(seleccion, cambios)}
            alAlinear={(como: Alineacion) =>
              seleccion && aplicar(alinear(doc, seleccion, mesa, como))
            }
            editable={editable}
          />
        </aside>
      </div>

      {importando && mesa && (
        <ImportarHtml mesa={mesa} alCerrar={() => setImportando(false)} alImportar={importar} />
      )}

      {viendoCodigo && mesa && (
        <CodigoHtml
          documento={doc}
          mesa={mesa}
          activos={urls}
          editable={editable}
          alCerrar={() => setViendoCodigo(false)}
          alAplicar={aplicarCodigo}
        />
      )}

      {historial && (
        <ModalVersiones
          creativeId={creativeId}
          alCerrar={() => setHistorial(false)}
          alRestaurar={() => {
            setHistorial(false);
            setDoc(null);
            pasado.current = [];
            futuro.current = [];
            void creatividad.refetch();
          }}
        />
      )}
    </div>
  );
}

function ModalVersiones({
  creativeId,
  alCerrar,
  alRestaurar,
}: {
  creativeId: string;
  alCerrar: () => void;
  alRestaurar: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const versiones = useQuery({
    queryKey: ['studio', 'versiones', creativeId],
    queryFn: () => versionesDe(creativeId),
  });

  const restaurar = useMutation({
    mutationFn: (version: number) => restaurarVersion(creativeId, version),
    onSuccess: () => {
      toast.exito(t('studio.version_restaurada'));
      alRestaurar();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  return (
    <Modal
      abierto
      titulo={t('studio.versiones')}
      descripcion={t('studio.versiones_ayuda')}
      alCerrar={alCerrar}
      ancho="md"
    >
      {versiones.isLoading ? (
        <Cargando />
      ) : (
        <ul className="lista">
          {(versiones.data ?? []).map((v) => (
            <li key={v.id} className="lista-linea">
              <div>
                <p className="text-sm font-medium">
                  v{v.version} {v.label && <span className="font-normal">· {v.label}</span>}
                </p>
                <p className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {new Date(v.createdAt).toLocaleString('es-ES')}
                  {v.authorModel && ` · ${v.authorModel}`}
                </p>
              </div>
              <Boton
                variante="secundario"
                tamano="sm"
                cargando={restaurar.isPending}
                onClick={() => restaurar.mutate(v.version)}
              >
                {t('studio.restaurar')}
              </Boton>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

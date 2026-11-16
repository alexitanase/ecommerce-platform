import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Alerta, Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Boton } from '@/componentes/ui/boton';
import { Modal } from '@/componentes/ui/overlays';
import { Entrada, Seleccion } from '@/componentes/ui/formulario';
import { useToast } from '@/componentes/ui/toast';
import { Enlace } from '@/componentes/enlace';
import { useSesion } from '@/lib/sesion';
import { SelectorFormato, useFormatos } from '@/componentes/studio/selector-formato';
import { ModalCampana, type ValoresCampana } from '@/componentes/studio/modal-campana';
import { MesaHTML } from '@/componentes/studio/render/capas';
import { Ico } from '@/lib/navegacion';
import {
  copiar,
  crearCreatividad,
  editarCampana,
  listarActivos,
  TONO_CAMPANA,
  TONO_ESTADO,
  verCampana,
  type CampanaConPiezas,
} from '@/lib/studio';
import { medidaPersonalizada } from '@ecom/shared';

/**
 * Ficha de campaña.
 *
 * Lo primero que se ve no es la lista de piezas: es el **enlace marcado**. Cada
 * creatividad lleva su propio `utm_content`, y eso es lo que convierte el
 * informe de canales en algo con lo que decidir — sin él se sabe que la red
 * trajo doce ventas, con él se sabe cuál de los nueve banners las trajo.
 */
export function FichaCampana() {
  const { t } = useTranslation();
  const { puede } = useSesion();
  const qc = useQueryClient();
  const toast = useToast();
  // Ver el comentario de la ficha de producto: con el árbol definido por código,
  // `useParams` no viene tipado y se acota en un solo sitio.
  const parametros: Record<string, string | undefined> = useParams({ strict: false });
  const campaignId = parametros['campaignId'] ?? '';
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(false);

  const campana = useQuery({
    queryKey: ['studio', 'campana', campaignId],
    queryFn: () => verCampana(campaignId),
  });

  // Las imágenes de la biblioteca, para que las vistas previas no salgan con
  // huecos donde hay fotos.
  const activos = useQuery({ queryKey: ['studio', 'activos'], queryFn: () => listarActivos() });

  const editar = useMutation({
    mutationFn: (valores: ValoresCampana) =>
      editarCampana(campaignId, {
        name: valores.name,
        channel: valores.channel,
        objective: valores.objective,
        landingUrl: valores.landingUrl,
        brief: valores.brief,
        ...(valores.status ? { status: valores.status } : {}),
      }),
    onSuccess: () => {
      toast.exito(t('studio.campana_guardada'));
      setEditando(false);
      void qc.invalidateQueries({ queryKey: ['studio', 'campana', campaignId] });
      void qc.invalidateQueries({ queryKey: ['studio', 'campanas'] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  if (campana.isLoading) return <Cargando />;
  if (campana.error)
    return <ErrorPanel error={campana.error} reintentar={() => void campana.refetch()} />;
  if (!campana.data) return null;

  const c = campana.data;

  return (
    <div className="studio-pagina">
      <div className="studio-titular">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{c.name}</h1>
            <Etiqueta
              texto={t(`studio.estado_campana.${c.status}`)}
              tono={TONO_CAMPANA[c.status]}
            />
          </div>
          <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
            {c.canal} · {t(`studio.objetivo.${c.objective}`)} · {c.locales.join(' / ')}
          </p>
        </div>

        {puede('studio:write') && (
          <div className="flex items-center gap-2">
            <Boton variante="secundario" onClick={() => setEditando(true)}>
              {t('studio.editar_campana')}
            </Boton>
            <Boton variante="primario" onClick={() => setCreando(true)}>
              + {t('studio.nueva_creatividad')}
            </Boton>
          </div>
        )}
      </div>

      {c.brief && (
        <div className="panel p-4">
          <p className="etiqueta-campo">{t('studio.campo_brief')}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{c.brief}</p>
        </div>
      )}

      {/*
       * El enlace de la campaña ya no se enseña: cada pieza trae el suyo, que es
       * el que se copia de verdad. Lo único que queda es el aviso de cuando no
       * hay destino, porque entonces NINGUNA pieza puede llevar enlace y sus
       * ventas no se van a poder atribuir.
       */}
      {!c.landingUrl && <Alerta tono="aviso">{t('studio.sin_destino')}</Alerta>}

      {c.creatividades.length === 0 ? (
        <Vacio
          titulo={t('studio.sin_creatividades')}
          descripcion={t('studio.sin_creatividades_ayuda')}
          {...(puede('studio:write')
            ? {
                accion: (
                  <Boton variante="primario" onClick={() => setCreando(true)}>
                    {t('studio.nueva_creatividad')}
                  </Boton>
                ),
              }
            : {})}
        />
      ) : (
        <div className="studio-rejilla">
          {c.creatividades.map((pieza) => (
            <TarjetaCreatividad
              key={pieza.id}
              pieza={pieza}
              activos={Object.fromEntries((activos.data ?? []).map((a) => [a.id, a.url]))}
            />
          ))}
        </div>
      )}

      {editando && (
        <ModalCampana
          titulo={t('studio.editar_campana')}
          conEstado
          guardando={editar.isPending}
          inicial={{
            name: c.name,
            channel: c.channel,
            objective: c.objective,
            landingUrl: c.landingUrl ?? '',
            brief: c.brief ?? '',
            status: c.status,
          }}
          alCerrar={() => setEditando(false)}
          alGuardar={(valores) => editar.mutate(valores)}
        />
      )}

      {creando && (
        <ModalNuevaCreatividad
          campaignId={campaignId}
          idiomas={c.locales}
          alCerrar={() => setCreando(false)}
          alCrear={() => {
            setCreando(false);
            void qc.invalidateQueries({ queryKey: ['studio', 'campana', campaignId] });
          }}
        />
      )}
    </div>
  );
}

/**
 * Una pieza en la lista, con su vista previa.
 *
 * La vista previa es el documento de verdad pintado a escala, no una imagen
 * guardada: no hay nada que regenerar cuando la pieza cambia, y lo que se ve en
 * la lista no puede quedarse desfasado respecto a lo que hay dentro. Se pinta a
 * tamaño real y se encoge con `scale` por lo mismo que en el editor — maquetar
 * al tamaño pequeño daría otro resultado.
 *
 * La tarjeta no es un enlace entero: lleva dentro un campo y botones, y meter
 * controles en un `<a>` no solo es marcado inválido, es que cada clic en el
 * campo navegaría a otra pantalla.
 */
function TarjetaCreatividad({
  pieza,
  activos,
}: {
  pieza: CampanaConPiezas['creatividades'][number];
  activos: Record<string, string>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const formatos = useFormatos();

  const ficha = formatos.data?.formatos.find((f) => f.clave === pieza.format);
  const aMedida = medidaPersonalizada(pieza.format);
  const mesa = pieza.documento?.mesas[0];

  const copiarEnlace = async () => {
    if (!pieza.enlace) return;
    const hecho = await copiar(pieza.enlace);
    if (hecho) toast.exito(t('studio.enlace_copiado'));
    else toast.error(t('studio.enlace_no_copiado'));
  };

  // Encaja la mesa dentro de la caja de la vista previa sin deformarla ni
  // ampliarla: una pieza de 300×250 se ve a su tamaño, una de 1080×1920 se
  // encoge, y ninguna se estira para rellenar.
  const escala = mesa ? Math.min(ALTO_VISTA / mesa.alto, ANCHO_VISTA / mesa.ancho, 1) : 1;

  return (
    <div className="studio-tarjeta">
      <div className="studio-vista">
        {pieza.documento && mesa ? (
          <div
            className="studio-vista-lienzo"
            style={{ width: mesa.ancho * escala, height: mesa.alto * escala }}
            aria-hidden="true"
          >
            <div style={{ transform: `scale(${escala})`, transformOrigin: 'top left' }}>
              <MesaHTML mesa={mesa} documento={pieza.documento} activos={activos} />
            </div>
          </div>
        ) : (
          <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('studio.sin_vista')}
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{pieza.name}</span>
        <Etiqueta
          texto={t(`studio.estado_creatividad.${pieza.status}`)}
          tono={TONO_ESTADO[pieza.status]}
        />
      </div>

      <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {ficha
          ? `${ficha.nombre} · ${ficha.ancho}×${ficha.alto}`
          : aMedida
            ? `${t('studio.a_medida')} · ${aMedida.ancho}×${aMedida.alto}`
            : pieza.format}
      </p>

      {/*
       * El enlace marcado, a mano y listo para pegar en el panel de la red. En
       * un campo de solo lectura y no como texto suelto: seleccionar una URL
       * larga a mano se corta a la mitad, y esta lleva dentro el `utm_content`
       * del que depende saber después qué banner vendió.
       */}
      {pieza.enlace && (
        <div className="studio-copiar">
          <input
            className="campo font-mono"
            value={pieza.enlace}
            readOnly
            aria-label={t('studio.enlace_de', { nombre: pieza.name })}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Boton
            variante="secundario"
            tamano="sm"
            soloIcono
            etiqueta={t('studio.copiar_enlace')}
            onClick={() => void copiarEnlace()}
            icono={<Ico d="M9 9h11v11H9zM5 15H4V4h11v1" />}
          />
        </div>
      )}

      <Enlace
        a="/studio/creatividades/$creativeId"
        params={{ creativeId: pieza.id }}
        className="btn btn-secundario w-full text-sm"
      >
        {t('studio.editar')}
      </Enlace>
    </div>
  );
}

/** Caja de la vista previa, en píxeles de pantalla. */
const ANCHO_VISTA = 260;
const ALTO_VISTA = 150;

function ModalNuevaCreatividad({
  campaignId,
  idiomas,
  alCerrar,
  alCrear,
}: {
  campaignId: string;
  idiomas: string[];
  alCerrar: () => void;
  alCrear: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const [nombre, setNombre] = useState('');
  const [formato, setFormato] = useState('');
  const [locale, setLocale] = useState(idiomas[0] ?? 'es');
  const [aMedida, setAMedida] = useState(false);
  const [ancho, setAncho] = useState(600);
  const [alto, setAlto] = useState(600);

  const listo = nombre.length >= 2 && (aMedida ? ancho >= 16 && alto >= 16 : Boolean(formato));

  const crear = useMutation({
    mutationFn: () =>
      crearCreatividad({
        campaignId,
        name: nombre,
        locale,
        kind: 'banner',
        ...(aMedida ? { ancho, alto } : { format: formato }),
      }),
    onSuccess: () => {
      toast.exito(t('studio.creatividad_creada'));
      alCrear();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  return (
    <Modal abierto titulo={t('studio.nueva_creatividad')} alCerrar={alCerrar} ancho="lg">
      <form
        className="campos-formulario"
        onSubmit={(e) => {
          e.preventDefault();
          crear.mutate();
        }}
      >
        <Entrada
          etiqueta={t('studio.campo_nombre')}
          ayuda={t('studio.campo_nombre_creatividad_ayuda')}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          maxLength={120}
          autoFocus
        />

        {idiomas.length > 1 && (
          <Seleccion
            etiqueta={t('studio.campo_idioma')}
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            opciones={idiomas.map((l) => ({ valor: l, texto: l.toUpperCase() }))}
          />
        )}

        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="etiqueta-campo">{t('studio.campo_formato')}</p>
            {/*
             * A medida hace falta más de lo que parece: una cabecera para un
             * sitio concreto no es ningún formato de red, y obligar a elegir uno
             * lleva a coger el que menos desentone y trabajar con el peso máximo
             * equivocado.
             */}
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={aMedida}
                onChange={(e) => setAMedida(e.target.checked)}
              />
              {t('studio.usar_a_medida')}
            </label>
          </div>

          {aMedida ? (
            <div className="studio-props-rejilla mt-2">
              <label className="studio-campo">
                <span>{t('studio.prop_ancho')}</span>
                <input
                  className="campo"
                  type="number"
                  min={16}
                  max={8000}
                  value={ancho}
                  onChange={(e) => setAncho(Number(e.target.value))}
                />
              </label>
              <label className="studio-campo">
                <span>{t('studio.prop_alto')}</span>
                <input
                  className="campo"
                  type="number"
                  min={16}
                  max={8000}
                  value={alto}
                  onChange={(e) => setAlto(Number(e.target.value))}
                />
              </label>
              <p className="col-span-2 text-sm" style={{ color: 'var(--texto-tenue)' }}>
                {t('studio.a_medida_ayuda')}
              </p>
            </div>
          ) : (
            <SelectorFormato valor={formato} alElegir={setFormato} />
          )}
        </div>

        <div className="modal-pie">
          <Boton type="button" variante="secundario" onClick={alCerrar}>
            {t('app.cancelar')}
          </Boton>
          <Boton type="submit" variante="primario" cargando={crear.isPending} disabled={!listo}>
            {t('studio.crear')}
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

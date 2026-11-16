import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOCALES, type Locale } from '@ecom/shared';
import { del, get, post } from '@/lib/api';
import { fechaRelativa } from '@/lib/formato';
import { Cargando, ErrorPanel, Etiqueta } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';
import { Tabla, type ColumnaTabla } from '@/componentes/ui/tabla';
import { Boton } from '@/componentes/ui/boton';
import { ConfirmarPeligro } from '@/componentes/ui/overlays';

/**
 * Páginas de contenido y legales.
 *
 * La API tenía el CRUD entero desde la fase 2 y el panel no ofrecía ninguna
 * pantalla: las seis páginas obligatorias en España las creaba la semilla en
 * borrador, con un texto que empieza por «PENDIENTE DE COMPLETAR», y no había
 * forma de tocarlas sin entrar a la base de datos. Una tienda sin aviso legal ni
 * política de privacidad **publicados** incumple la LSSI y el RGPD, así que esto
 * bloqueaba abrir de verdad.
 *
 * Tres decisiones de la pantalla:
 *
 *  · **El contenido es texto plano, no HTML.** La tienda lo pinta con
 *    `whitespace-pre-line`, así que un `<p>` saldría escrito tal cual delante
 *    del visitante. Por eso aquí hay un área de texto y no el editor de HTML que
 *    usan las fichas de producto.
 *
 *  · **El identificador de las páginas del sistema no se toca.** La semilla las
 *    busca por él para no duplicarlas, y el pie de la tienda enlaza «privacidad»
 *    y «aviso-legal» por su nombre. Cambiarlo las rompería en silencio.
 *
 *  · **Publicar avisa antes de intentarlo.** La API rechaza publicar con menos
 *    de veinte caracteres en algún idioma; se comprueba aquí para no gastar el
 *    viaje y, sobre todo, para que se lea «te falta el catalán» en lugar de un
 *    error de validación.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lo que exige la API para dar una página por publicable. */
const MINIMO_CONTENIDO = 20;

interface Resumen {
  id: string;
  handle: string;
  status: 'DRAFT' | 'PUBLISHED';
  isSystem: boolean;
  idiomas: string[];
  titulos: Record<string, string>;
  faltan: string[];
  updatedAt: string;
}

interface Traduccion {
  locale: string;
  title: string;
  slug: string;
  content: string;
  metaTitle: string | null;
  metaDescription: string | null;
}

interface Detalle {
  id: string;
  handle: string;
  status: 'DRAFT' | 'PUBLISHED';
  isSystem: boolean;
  translations: Traduccion[];
}

function traduccionVacia(locale: string): Traduccion {
  return { locale, title: '', slug: '', content: '', metaTitle: null, metaDescription: null };
}

const NUEVA: Detalle = {
  id: '',
  handle: '',
  status: 'DRAFT',
  isSystem: false,
  translations: [],
};

export function Paginas() {
  const { t, i18n } = useTranslation();

  /** `null` = la lista; `''` = una página nueva; un id = editar esa. */
  const [editando, setEditando] = useState<string | null>(null);

  const consulta = useQuery({
    queryKey: ['paginas'],
    queryFn: () => get<Resumen[]>('/content/admin/pages'),
  });

  if (editando !== null) {
    return (
      <Editor
        key={editando}
        pageId={editando === '' ? null : editando}
        alVolver={() => setEditando(null)}
      />
    );
  }

  const idioma = i18n.language;

  const columnas: ColumnaTabla<Resumen>[] = [
    {
      clave: 'titulo',
      titulo: t('paginas.columna_titulo'),
      valor: (p) => (
        <button
          type="button"
          className="text-left font-medium underline-offset-2 hover:underline"
          onClick={() => setEditando(p.id)}
        >
          {p.titulos[idioma] ?? p.titulos['es'] ?? p.handle}
        </button>
      ),
      ordenar: (a, b) => (a.titulos['es'] ?? a.handle).localeCompare(b.titulos['es'] ?? b.handle),
    },
    {
      clave: 'handle',
      titulo: t('paginas.columna_handle'),
      valor: (p) => (
        <code className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {p.handle}
        </code>
      ),
    },
    {
      clave: 'estado',
      titulo: t('app.estado'),
      valor: (p) => (
        <div className="flex flex-wrap items-center gap-1">
          <Etiqueta
            texto={p.status === 'PUBLISHED' ? t('paginas.publicada') : t('paginas.borrador')}
            tono={p.status === 'PUBLISHED' ? 'exito' : 'aviso'}
          />
          {/* Obligatoria por ley: explica por qué no se puede borrar. */}
          {p.isSystem && <Etiqueta texto={t('paginas.obligatoria')} tono="info" />}
        </div>
      ),
      ordenar: (a, b) => a.status.localeCompare(b.status),
    },
    {
      clave: 'idiomas',
      titulo: t('paginas.columna_idiomas'),
      valor: (p) =>
        p.faltan.length === 0 ? (
          <Etiqueta texto={t('paginas.completa')} tono="exito" />
        ) : (
          <Etiqueta
            texto={t('paginas.faltan', { idiomas: p.faltan.join(', ').toUpperCase() })}
            tono="aviso"
          />
        ),
    },
    {
      clave: 'actualizada',
      titulo: t('paginas.columna_actualizada'),
      valor: (p) => fechaRelativa(p.updatedAt, idioma),
      ordenar: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
    },
  ];

  const sinPublicar = (consulta.data ?? []).filter(
    (p) => p.isSystem && p.status !== 'PUBLISHED',
  ).length;

  return (
    <div>
      <Encabezado
        titulo={t('paginas.titulo')}
        descripcion={t('paginas.descripcion')}
        cargados={consulta.data?.length}
        acciones={
          <Boton variante="primario" onClick={() => setEditando('')}>
            {t('paginas.nueva')}
          </Boton>
        }
      />

      {/* El aviso va aquí y no en el pie: es la razón por la que esta pantalla
          existe, y con la tienda abierta es una multa, no un pendiente. */}
      {sinPublicar > 0 && (
        <div
          className="mb-4 rounded-xl p-3 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--aviso) 12%, transparent)',
            color: 'var(--aviso)',
          }}
        >
          {t('paginas.aviso_sin_publicar', { n: sinPublicar })}
        </div>
      )}

      <Tabla
        descripcion={t('paginas.titulo')}
        columnas={columnas}
        filas={consulta.data ?? []}
        idFila={(p) => p.id}
        cargando={consulta.isLoading}
        error={consulta.error}
        reintentar={() => void consulta.refetch()}
        buscarEn={(p) => `${p.handle} ${Object.values(p.titulos).join(' ')}`}
        vacio={{
          titulo: t('paginas.vacio'),
          descripcion: t('paginas.vacio_ayuda'),
          accion: (
            <Boton variante="primario" onClick={() => setEditando('')}>
              {t('paginas.nueva')}
            </Boton>
          ),
        }}
      />
    </div>
  );
}

function Editor({ pageId, alVolver }: { pageId: string | null; alVolver: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [idioma, setIdioma] = useState<Locale>('es');
  /** Cambios sin guardar. `null` mientras no se ha tocado nada. */
  const [borrador, setBorrador] = useState<Detalle | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const consulta = useQuery({
    queryKey: ['pagina', pageId],
    queryFn: () => get<Detalle>(`/content/admin/pages/${pageId ?? ''}`),
    enabled: pageId !== null,
  });

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['paginas'] });
    void qc.invalidateQueries({ queryKey: ['pagina', pageId] });
    // El editor del menú ofrece solo las páginas publicadas: si aquí se acaba
    // de publicar una, tiene que aparecer en su desplegable sin recargar.
    void qc.invalidateQueries({ queryKey: ['paginas', 'menu'] });
  };

  const guardar = useMutation({
    mutationFn: (p: Detalle) =>
      post<Detalle>('/content/admin/pages', {
        ...(p.id ? { id: p.id } : {}),
        handle: p.handle.trim(),
        status: p.status,
        // Solo las que tienen título y dirección: la API exige los dos en cada
        // traducción que reciba, y un idioma a medio rellenar haría fallar el
        // guardado entero en lugar de quedarse pendiente.
        translations: completas(p).map((tr) => ({
          locale: tr.locale,
          title: tr.title.trim(),
          slug: tr.slug.trim(),
          content: tr.content,
          ...(tr.metaTitle?.trim() ? { metaTitle: tr.metaTitle.trim() } : {}),
          ...(tr.metaDescription?.trim() ? { metaDescription: tr.metaDescription.trim() } : {}),
        })),
      }),
    onSuccess: () => {
      invalidar();
      setBorrador(null);
      // Una página nueva ya no lo es: se vuelve a la lista en lugar de dejar el
      // formulario creando otra igual con cada guardado.
      if (!pageId) {
        alVolver();
        return;
      }
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    },
  });

  const eliminar = useMutation({
    mutationFn: () => del(`/content/admin/pages/${pageId ?? ''}`),
    onSuccess: () => {
      invalidar();
      alVolver();
    },
  });

  if (consulta.isLoading) return <Cargando />;
  if (consulta.error)
    return <ErrorPanel error={consulta.error} reintentar={() => void consulta.refetch()} />;

  const pagina = borrador ?? (pageId ? consulta.data : NUEVA);
  if (!pagina) return <Cargando />;

  const traduccion =
    pagina.translations.find((tr) => tr.locale === idioma) ?? traduccionVacia(idioma);

  const actualizar = (cambios: Partial<Detalle>) => setBorrador({ ...pagina, ...cambios });

  const actualizarTraduccion = (cambios: Partial<Traduccion>) => {
    const existe = pagina.translations.some((tr) => tr.locale === idioma);
    setBorrador({
      ...pagina,
      translations: existe
        ? pagina.translations.map((tr) => (tr.locale === idioma ? { ...tr, ...cambios } : tr))
        : [...pagina.translations, { ...traduccion, ...cambios }],
    });
  };

  const listas = completas(pagina);

  /* Lo que impide guardar, en el idioma de quien mira y antes del viaje a la
     API. El orden importa: se enseña el primero, no los cinco a la vez. */
  const problemas: string[] = [];

  if (!SLUG.test(pagina.handle.trim())) problemas.push(t('paginas.error_handle'));
  if (listas.length === 0) problemas.push(t('paginas.error_sin_idioma'));

  const slugsMalos = pagina.translations
    .filter((tr) => tr.slug.trim() !== '' && !SLUG.test(tr.slug.trim()))
    .map((tr) => tr.locale.toUpperCase());
  if (slugsMalos.length > 0)
    problemas.push(t('paginas.error_slug', { idiomas: slugsMalos.join(', ') }));

  const aMedias = pagina.translations
    .filter((tr) => !esCompleta(tr) && (tr.title.trim() !== '' || tr.content.trim() !== ''))
    .map((tr) => tr.locale.toUpperCase());
  if (aMedias.length > 0)
    problemas.push(t('paginas.error_a_medias', { idiomas: aMedias.join(', ') }));

  const cortas = listas
    .filter((tr) => tr.content.trim().length < MINIMO_CONTENIDO)
    .map((tr) => tr.locale.toUpperCase());
  if (pagina.status === 'PUBLISHED' && cortas.length > 0)
    problemas.push(t('paginas.error_contenido', { idiomas: cortas.join(', ') }));

  /* El título del idioma que se está viendo, con respaldo al español: en «EN»
     recién creado está vacío, y una cabecera en blanco no dice qué se edita. */
  const titulo =
    traduccion.title.trim() ||
    (pagina.translations.find((tr) => tr.locale === 'es')?.title ?? '').trim();

  return (
    <div>
      <Encabezado
        titulo={titulo || (pageId ? pagina.handle : t('paginas.nueva'))}
        descripcion={t('paginas.editor_descripcion')}
        /* El grupo y «Páginas» los pone sola la navegación; aquí solo falta el
           último nivel, que es el único que esta pantalla conoce. */
        migas={[{ etiqueta: titulo || (pageId ? pagina.handle : t('paginas.nueva')) }]}
        acciones={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label={t('nav.idioma')}>
              {LOCALES.map((l) => {
                const tr = pagina.translations.find((x) => x.locale === l);
                return (
                  <button
                    key={l}
                    type="button"
                    className={`btn text-sm ${idioma === l ? 'btn-primario' : 'btn-fantasma'}`}
                    onClick={() => setIdioma(l)}
                    aria-pressed={idioma === l}
                  >
                    {l.toUpperCase()}
                    {/* Un punto en los idiomas sin redactar: sin esto hay que
                        entrar en los tres para saber cuál falta. */}
                    {!tr || !esCompleta(tr) ? (
                      <span aria-hidden="true" style={{ color: 'var(--aviso)' }}>
                        {' •'}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <Boton variante="secundario" onClick={alVolver}>
              {t('app.volver')}
            </Boton>
          </div>
        }
      />

      <div className="panel space-y-4 p-4">
        <div className="campos-formulario">
          <Campo
            id="pagina-handle"
            etiqueta={t('paginas.campo_handle')}
            ayuda={
              pagina.isSystem
                ? t('paginas.campo_handle_bloqueado')
                : t('paginas.campo_handle_ayuda')
            }
          >
            {(props) => (
              <input
                {...props}
                type="text"
                className="campo"
                value={pagina.handle}
                disabled={pagina.isSystem}
                onChange={(e) => actualizar({ handle: e.target.value })}
                placeholder="devoluciones"
              />
            )}
          </Campo>

          <Campo
            id="pagina-estado"
            etiqueta={t('app.estado')}
            ayuda={t('paginas.campo_estado_ayuda')}
          >
            {(props) => (
              <select
                {...props}
                className="campo"
                value={pagina.status}
                onChange={(e) => actualizar({ status: e.target.value as Detalle['status'] })}
              >
                <option value="DRAFT">{t('paginas.borrador')}</option>
                <option value="PUBLISHED">{t('paginas.publicada')}</option>
              </select>
            )}
          </Campo>
        </div>

        <hr style={{ borderColor: 'var(--borde)' }} />

        <div className="campos-formulario">
          <Campo
            id="pagina-title"
            etiqueta={`${t('paginas.campo_title')} · ${idioma.toUpperCase()}`}
          >
            {(props) => (
              <input
                {...props}
                type="text"
                className="campo"
                maxLength={200}
                value={traduccion.title}
                onChange={(e) => actualizarTraduccion({ title: e.target.value })}
              />
            )}
          </Campo>

          <Campo
            id="pagina-slug"
            etiqueta={`${t('paginas.campo_slug')} · ${idioma.toUpperCase()}`}
            ayuda={
              pagina.isSystem ? t('paginas.campo_slug_sistema') : t('paginas.campo_slug_ayuda')
            }
          >
            {(props) => (
              <input
                {...props}
                type="text"
                className="campo"
                maxLength={120}
                value={traduccion.slug}
                onChange={(e) => actualizarTraduccion({ slug: e.target.value })}
                placeholder="privacidad"
              />
            )}
          </Campo>
        </div>

        <Campo
          id="pagina-content"
          etiqueta={`${t('paginas.campo_content')} · ${idioma.toUpperCase()}`}
          ayuda={t('paginas.campo_content_ayuda')}
        >
          {(props) => (
            <textarea
              {...props}
              className="campo font-mono text-base sm:text-sm"
              rows={18}
              maxLength={100_000}
              value={traduccion.content}
              onChange={(e) => actualizarTraduccion({ content: e.target.value })}
            />
          )}
        </Campo>

        <details>
          <summary className="cursor-pointer text-sm font-medium">{t('paginas.seo')}</summary>
          <div className="campos-formulario mt-3">
            <Campo
              id="pagina-metatitle"
              etiqueta={`${t('paginas.campo_metatitle')} · ${idioma.toUpperCase()}`}
              ayuda={t('paginas.campo_metatitle_ayuda')}
            >
              {(props) => (
                <input
                  {...props}
                  type="text"
                  className="campo"
                  maxLength={70}
                  value={traduccion.metaTitle ?? ''}
                  onChange={(e) => actualizarTraduccion({ metaTitle: e.target.value })}
                />
              )}
            </Campo>

            <Campo
              id="pagina-metadesc"
              etiqueta={`${t('paginas.campo_metadesc')} · ${idioma.toUpperCase()}`}
              ayuda={t('paginas.campo_metadesc_ayuda')}
            >
              {(props) => (
                <input
                  {...props}
                  type="text"
                  className="campo"
                  maxLength={160}
                  value={traduccion.metaDescription ?? ''}
                  onChange={(e) => actualizarTraduccion({ metaDescription: e.target.value })}
                />
              )}
            </Campo>
          </div>
        </details>
      </div>

      <div
        className="sticky bottom-4 mt-5 flex flex-wrap items-center gap-3 rounded-xl p-3"
        style={{
          background: 'var(--fondo-panel)',
          border: '1px solid var(--borde-fuerte)',
          boxShadow: 'var(--sombra)',
        }}
      >
        <span
          className="text-sm"
          style={{ color: guardado ? 'var(--exito)' : 'var(--texto-suave)' }}
        >
          {guardado
            ? t('app.guardado')
            : t('paginas.idiomas_listos', { n: listas.length, total: LOCALES.length })}
        </span>

        {problemas[0] && (
          <span className="text-sm" style={{ color: 'var(--aviso)' }}>
            {problemas[0]}
          </span>
        )}

        {guardar.error && (
          <span className="text-sm" style={{ color: 'var(--error)' }}>
            {guardar.error.message}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {pageId && !pagina.isSystem && (
            <Boton variante="peligro" onClick={() => setConfirmarBorrado(true)}>
              {t('app.eliminar')}
            </Boton>
          )}
          <Boton
            variante="primario"
            onClick={() => guardar.mutate(pagina)}
            cargando={guardar.isPending}
            disabled={problemas.length > 0}
          >
            {t('app.guardar')}
          </Boton>
        </div>
      </div>

      <ConfirmarPeligro
        abierto={confirmarBorrado}
        alCerrar={() => setConfirmarBorrado(false)}
        alConfirmar={() => eliminar.mutate()}
        titulo={t('paginas.borrar_titulo')}
        descripcion={t('paginas.borrar_descripcion')}
        textoConfirmar={t('app.eliminar')}
        trabajando={eliminar.isPending}
      />
    </div>
  );
}

/** Una traducción que la API acepta: sin título o sin dirección la rechaza. */
function esCompleta(tr: Traduccion): boolean {
  return tr.title.trim() !== '' && tr.slug.trim() !== '';
}

function completas(p: Detalle): Traduccion[] {
  return p.translations.filter(esCompleta);
}

/**
 * Un campo con su etiqueta y su ayuda.
 *
 * La ayuda va FUERA de la etiqueta y enlazada con `aria-describedby`: metida
 * dentro pasaría a formar parte del nombre accesible del campo, que es lo que
 * anuncia un lector de pantalla y lo que busca el control por voz. Es el mismo
 * motivo por el que está así en el editor del menú.
 */
function Campo({
  id,
  etiqueta,
  ayuda,
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  children: (props: { id: string; 'aria-describedby'?: string }) => React.ReactNode;
}) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {etiqueta}
      </label>
      {children({ id, ...(idAyuda ? { 'aria-describedby': idAyuda } : {}) })}
      {ayuda && (
        <span id={idAyuda} className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {ayuda}
        </span>
      )}
    </div>
  );
}

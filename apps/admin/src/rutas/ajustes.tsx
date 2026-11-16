import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DIVISA_BASE, LOCALES, LOCALE_INFO, nombreDivisa } from '@ecom/shared';
import { get, patch } from '@/lib/api';
import { Cargando, ErrorPanel, Etiqueta } from '@/componentes/estados';
import { Encabezado } from '@/componentes/encabezado';

interface Grupo {
  namespace: string;
  items: { key: string; value: unknown; isPublic: boolean }[];
}

/**
 * Ajustes de la plataforma.
 *
 * El editor de marca previsualiza los colores en vivo aplicándolos al propio
 * panel: es la forma más honesta de enseñar cómo van a quedar, en lugar de un
 * cuadradito de muestra que no dice nada sobre el contraste real del texto.
 */
export function Ajustes() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [cambios, setCambios] = useState<Record<string, unknown>>({});
  const [guardado, setGuardado] = useState(false);

  const ajustes = useQuery({
    queryKey: ['ajustes'],
    queryFn: () => get<Grupo[]>('/settings'),
  });

  const guardar = useMutation({
    mutationFn: (lista: { namespace: string; key: string; value: unknown }[]) =>
      patch('/settings', { cambios: lista }),
    onSuccess: () => {
      setCambios({});
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
      void qc.invalidateQueries({ queryKey: ['ajustes'] });
    },
  });

  const valor = (ns: string, k: string): unknown => {
    const clave = `${ns}.${k}`;
    if (clave in cambios) return cambios[clave];
    return ajustes.data?.find((g) => g.namespace === ns)?.items.find((i) => i.key === k)?.value;
  };

  /**
   * Lectura como texto.
   *
   * Los ajustes se guardan como JSON, así que un valor puede ser objeto o
   * array (por ejemplo `brand.tagline`, que es un texto por idioma). Volcarlo
   * con `String()` pintaría "[object Object]" en el campo, y guardarlo así
   * destruiría el ajuste original.
   */
  const texto = (ns: string, k: string, porDefecto = ''): string => {
    const v = valor(ns, k);
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return porDefecto;
  };

  const cambiar = (ns: string, k: string, v: unknown) => {
    setCambios((c) => ({ ...c, [`${ns}.${k}`]: v }));
  };

  /**
   * Lectura de un ajuste que es una lista de códigos.
   *
   * Los idiomas activos y las divisas se guardan como array JSON. Si el valor
   * llegara siendo otra cosa —o no existiera todavía— hay que devolver una lista
   * vacía y no reventar: es un ajuste que se puede editar a mano en la base de
   * datos, y la pantalla de ajustes es justo la que hace falta para arreglarlo.
   */
  const listaTexto = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  // Previsualización en vivo del color de marca sobre el propio panel.
  const colorPrimario = texto('brand', 'primaryColor');
  useEffect(() => {
    if (/^#[0-9a-f]{6}$/i.test(colorPrimario)) {
      document.documentElement.style.setProperty('--marca-primario', colorPrimario);
    }
  }, [colorPrimario]);

  if (ajustes.isLoading) return <Cargando />;
  if (ajustes.error)
    return <ErrorPanel error={ajustes.error} reintentar={() => void ajustes.refetch()} />;

  const campoTexto = (ns: string, k: string, etiqueta: string, tipo = 'text') => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{etiqueta}</span>
      <input
        type={tipo}
        value={texto(ns, k)}
        onChange={(e) => cambiar(ns, k, e.target.value)}
        className="campo"
      />
    </label>
  );

  const campoNumero = (ns: string, k: string, etiqueta: string, ayuda?: string) => (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{etiqueta}</span>
      <input
        type="number"
        value={Number(valor(ns, k) ?? 0) / 100}
        onChange={(e) => cambiar(ns, k, Math.round(Number(e.target.value) * 100))}
        className="campo"
      />
      {ayuda && (
        <span className="mt-1 block text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {ayuda}
        </span>
      )}
    </label>
  );

  const campoBooleano = (ns: string, k: string, etiqueta: string) => (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={Boolean(valor(ns, k))}
        onChange={(e) => cambiar(ns, k, e.target.checked)}
      />
      <span className="text-sm">{etiqueta}</span>
    </label>
  );

  const pendientes = Object.entries(cambios).map(([clave, value]) => {
    const [namespace = '', key = ''] = clave.split('.');
    return { namespace, key, value };
  });

  return (
    <div>
      <Encabezado
        titulo={t('ajustes.titulo')}
        acciones={
          guardado && (
            // `role="status"` para que el aviso de guardado lo anuncie también
            // un lector de pantalla: si no, quien no ve la pantalla no tiene
            // forma de saber que el cambio se aplicó.
            <span role="status" className="text-sm" style={{ color: 'var(--exito)' }}>
              {t('app.guardado')}
            </span>
          )
        }
      />

      {/* Los cinco bloques son independientes entre sí, así que se reparten por
          el ancho disponible en vez de apilarse en una columna estrecha. */}
      <div className="fichas fichas-anchas">
        <section className="panel p-5">
          <h2 className="mb-4 font-semibold">{t('ajustes.marca')}</h2>
          <div className="space-y-4">
            {campoTexto('brand', 'name', t('ajustes.nombre_tienda'))}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">
                  {t('ajustes.color_primario')}
                </span>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={texto('brand', 'primaryColor', '#4f46e5')}
                    onChange={(e) => cambiar('brand', 'primaryColor', e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-lg border"
                    style={{ borderColor: 'var(--borde-fuerte)' }}
                  />
                  <input
                    type="text"
                    value={texto('brand', 'primaryColor')}
                    onChange={(e) => cambiar('brand', 'primaryColor', e.target.value)}
                    className="campo font-mono"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">{t('ajustes.color_acento')}</span>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={texto('brand', 'accentColor', '#7c3aed')}
                    onChange={(e) => cambiar('brand', 'accentColor', e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded-lg border"
                    style={{ borderColor: 'var(--borde-fuerte)' }}
                  />
                  <input
                    type="text"
                    value={texto('brand', 'accentColor')}
                    onChange={(e) => cambiar('brand', 'accentColor', e.target.value)}
                    className="campo font-mono"
                  />
                </div>
              </label>
            </div>

            {campoTexto('brand', 'logoLight', t('ajustes.logo_claro'), 'url')}
            {campoTexto('brand', 'favicon', t('ajustes.favicon'), 'url')}
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="mb-4 font-semibold">{t('ajustes.tienda')}</h2>
          <div className="space-y-4">
            {campoNumero(
              'shop',
              'freeShippingThreshold',
              t('ajustes.envio_gratis'),
              'En euros. 0 desactiva el aviso.',
            )}
            {campoBooleano('shop', 'maintenanceMode', t('ajustes.mantenimiento'))}
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="mb-1 font-semibold">{t('ajustes.idiomas')}</h2>
          <p className="mb-4 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('ajustes.idiomas_ayuda')}
          </p>
          <ListaIdiomas
            activos={listaTexto(valor('shop', 'supportedLocales'))}
            porDefecto={texto('shop', 'defaultLocale', 'es')}
            alCambiarActivos={(v) => cambiar('shop', 'supportedLocales', v)}
            alCambiarPorDefecto={(v) => cambiar('shop', 'defaultLocale', v)}
          />
        </section>

        <section className="panel p-5">
          <h2 className="mb-1 font-semibold">{t('ajustes.divisas')}</h2>
          <p className="mb-4 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('ajustes.divisas_ayuda')}
          </p>
          <ListaDivisas
            activas={listaTexto(valor('shop', 'currencies'))}
            porDefecto={texto('shop', 'defaultCurrency', 'EUR')}
            alCambiarActivas={(v) => cambiar('shop', 'currencies', v)}
            alCambiarPorDefecto={(v) => cambiar('shop', 'defaultCurrency', v)}
          />
        </section>

        <section className="panel p-5">
          <h2 className="mb-4 font-semibold">{t('ajustes.legal')}</h2>
          <div className="space-y-4">
            {campoTexto('legal', 'companyName', t('ajustes.razon_social'))}
            {campoTexto('legal', 'taxId', t('ajustes.nif'))}
            {campoTexto('legal', 'address', t('ajustes.domicilio'))}
            {campoTexto('legal', 'invoicePrefix', t('ajustes.serie_factura'))}
            {campoBooleano('legal', 'adultContentEnabled', t('ajustes.contenido_adulto'))}
          </div>
        </section>

        {/* El alta en OSS no cambia lo que se cobra: pasado el umbral, la venta
            tributa en destino de todas formas. Sirve para saber si la cuota se
            puede declarar por la ventanilla única o hay un alta pendiente. */}
        <section className="panel p-5">
          <h2 className="mb-1 font-semibold">{t('ajustes.fiscalidad')}</h2>
          <p className="mb-4 text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {t('ajustes.fiscalidad_ayuda')}
          </p>
          <div className="space-y-4">
            {campoTexto('tax', 'homeCountry', t('ajustes.pais_tienda'))}
            {campoBooleano('tax', 'ossRegistered', t('ajustes.oss_alta'))}
            {campoBooleano('tax', 'iossRegistered', t('ajustes.ioss_alta'))}
            {campoTexto('tax', 'iossNumber', t('ajustes.ioss_numero'))}
          </div>
        </section>
      </div>

      {pendientes.length > 0 && (
        <div
          className="sticky bottom-4 mt-5 flex items-center gap-3 rounded-xl p-3"
          style={{
            background: 'var(--fondo-panel)',
            border: '1px solid var(--borde-fuerte)',
            boxShadow: 'var(--sombra)',
          }}
        >
          <span className="text-sm" style={{ color: 'var(--texto-suave)' }}>
            {pendientes.length} cambio(s) sin guardar
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setCambios({})} className="btn btn-fantasma">
              {t('app.cancelar')}
            </button>
            <button
              type="button"
              onClick={() => guardar.mutate(pendientes)}
              disabled={guardar.isPending}
              className="btn btn-primario"
            >
              {t('app.guardar')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Qué idiomas se sirven y cuál recibe quien entra sin idioma.
 *
 * Lo que se puede activar son los idiomas **compilados**: los que tienen sus
 * ficheros de traducción. Añadir uno nuevo de verdad no es una casilla, es
 * traducir la tienda y desplegar, y por eso la lista sale de la plataforma y no
 * es un campo libre. Decirlo aquí evita la pregunta y evita el intento.
 *
 * El idioma por defecto va como radio dentro de la misma lista, y no en un
 * desplegable aparte, porque la regla que los une —el de por defecto tiene que
 * estar activo— solo se entiende viéndolos juntos. La API rechaza la
 * combinación imposible; esto es para no llegar a intentarla.
 */
function ListaIdiomas({
  activos,
  porDefecto,
  alCambiarActivos,
  alCambiarPorDefecto,
}: {
  activos: string[];
  porDefecto: string;
  alCambiarActivos: (v: string[]) => void;
  alCambiarPorDefecto: (v: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <ul className="space-y-2">
      {LOCALES.map((codigo) => {
        const activo = activos.includes(codigo);
        const esPorDefecto = porDefecto === codigo;
        const info = LOCALE_INFO[codigo];

        return (
          <li
            key={codigo}
            className="flex flex-wrap items-center gap-3 rounded-lg p-3"
            style={{ border: '1px solid var(--borde)' }}
          >
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={activo}
                /*
                 * El idioma por defecto no se puede desactivar desde aquí.
                 *
                 * La API lo rechaza igual, pero dejar la casilla pulsable para
                 * después decir que no se puede es hacer trabajar a alguien para
                 * nada. Para desactivarlo, primero se pone otro por defecto.
                 */
                disabled={esPorDefecto}
                onChange={(e) =>
                  alCambiarActivos(
                    e.target.checked ? [...activos, codigo] : activos.filter((c) => c !== codigo),
                  )
                }
              />
              <span className="text-sm font-medium">{info.nativeName}</span>
              <code className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                {codigo}
              </code>
            </label>

            <label
              className="ml-auto flex cursor-pointer items-center gap-2 text-xs"
              style={{ color: activo ? undefined : 'var(--texto-tenue)' }}
            >
              <input
                type="radio"
                name="idioma-por-defecto"
                checked={esPorDefecto}
                // Poner por defecto uno desactivado no tiene sentido: se activa
                // antes. Así el radio nunca ofrece una combinación inválida.
                disabled={!activo}
                onChange={() => alCambiarPorDefecto(codigo)}
              />
              {t('ajustes.por_defecto')}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * En qué divisas se ENSEÑA el precio.
 *
 * El euro no se puede desmarcar y se dice por qué: es la divisa en la que se
 * cobra y en la que se factura, así que no es una opción sino el suelo. Todo lo
 * demás es una conversión que se muestra.
 *
 * **La lista la manda el proveedor de tipo de cambio, no el código.** Antes eran
 * diez divisas escritas a mano: añadir la undécima era tocar el código y
 * desplegar, y se podían marcar divisas de las que el proveedor no publicaba
 * tasa —quedaban activadas sin ningún efecto en la tienda, que es la peor forma
 * de fallar: en silencio—. Ahora solo se puede elegir lo que se puede convertir,
 * y sin integración configurada no hay nada que elegir y se dice.
 *
 * Los nombres los da `Intl` en el idioma del panel. Una tabla a mano habría que
 * traducirla tres veces y quedaría anticuada.
 */
function ListaDivisas({
  activas,
  porDefecto,
  alCambiarActivas,
  alCambiarPorDefecto,
}: {
  activas: string[];
  porDefecto: string;
  alCambiarActivas: (v: string[]) => void;
  alCambiarPorDefecto: (v: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [filtro, setFiltro] = useState('');

  const disponibles = useQuery({
    queryKey: ['divisas-disponibles'],
    queryFn: () => get<{ divisas: string[] }>('/settings/divisas-disponibles'),
  });

  if (disponibles.isLoading) return <Cargando />;

  /*
   * El error se distingue de la lista vacía, que aquí no es lo mismo.
   *
   * Vacío significa «no hay proveedor configurado» y se explica; un fallo al
   * pedirla no significa eso, y enseñar ese texto haría creer que la integración
   * está sin configurar cuando lo que pasa es que no se ha podido preguntar.
   */
  if (disponibles.isError) {
    return <ErrorPanel error={disponibles.error} reintentar={() => void disponibles.refetch()} />;
  }

  const publicadas = disponibles.data?.divisas ?? [];

  /*
   * Las activas entran en la lista aunque el proveedor no las publique.
   *
   * Pasa cuando se cambia de proveedor o cuando uno deja de cubrir una divisa:
   * el ajuste guardado sigue teniéndola. Si no se pintara, quedaría activada y
   * sin forma de quitarla desde el panel, que es peor que enseñarla marcada
   * como lo que es —sin tasa, y por tanto sin efecto en la tienda—.
   */
  const codigos = [...new Set([DIVISA_BASE, ...publicadas, ...activas])].sort();

  if (publicadas.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('ajustes.divisas_sin_proveedor')}
      </p>
    );
  }

  const busqueda = filtro.trim().toLowerCase();
  const visibles = busqueda
    ? codigos.filter(
        (c) =>
          c.toLowerCase().includes(busqueda) ||
          nombreDivisa(c, i18n.language).toLowerCase().includes(busqueda),
      )
    : codigos;

  return (
    <>
      {/* El proveedor publica del orden de treinta: sin buscador, activar el
          zloty polaco es recorrer la lista entera con la vista. */}
      <input
        type="search"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder={t('ajustes.divisas_filtrar')}
        aria-label={t('ajustes.divisas_filtrar')}
        className="campo mb-3"
      />

      <ul className="grid gap-2 sm:grid-cols-2">
        {visibles.map((codigo) => {
          const esBase = codigo === DIVISA_BASE;
          const activa = activas.includes(codigo) || esBase;
          const sinTasa = !publicadas.includes(codigo);

          return (
            <li
              key={codigo}
              className="flex flex-wrap items-center gap-3 rounded-lg p-3"
              style={{ border: '1px solid var(--borde)' }}
            >
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={activa}
                  disabled={esBase}
                  onChange={(e) =>
                    alCambiarActivas(
                      e.target.checked
                        ? [...activas, codigo]
                        : activas.filter((c) => c !== codigo),
                    )
                  }
                />
                <span className="text-sm font-medium">{codigo}</span>
                <span className="text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {nombreDivisa(codigo, i18n.language)}
                </span>
                {sinTasa && <Etiqueta texto={t('ajustes.divisa_sin_tasa')} tono="aviso" />}
              </label>

              {esBase ? (
                <span className="ml-auto text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {t('ajustes.divisa_de_cobro')}
                </span>
              ) : (
                <label
                  className="ml-auto flex cursor-pointer items-center gap-2 text-xs"
                  style={{ color: activa ? undefined : 'var(--texto-tenue)' }}
                >
                  <input
                    type="radio"
                    name="divisa-por-defecto"
                    checked={porDefecto === codigo}
                    disabled={!activa}
                    onChange={() => alCambiarPorDefecto(codigo)}
                  />
                  {t('ajustes.por_defecto')}
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

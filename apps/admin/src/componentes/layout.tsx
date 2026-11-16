import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { Enlace } from './enlace';
import { useSesion } from '@/lib/sesion';
import { cambiarIdioma, IDIOMAS } from '@/i18n';
import { aplicarTema, esOscuro, temaGuardado } from '@/lib/tema';
import { Ico, ICONOS, useNavegacion } from '@/lib/navegacion';
import { Boton } from './ui/boton';
import { Menu } from './ui/menu';
import { Tooltip } from './ui/overlays';
import { useFocoAtrapado } from './ui/foco';
import { PaletaComandos, useAtajoPaleta, type AccionPaleta } from './ui/paleta';
import { Campana } from './ui/campana';

/**
 * Armazón del panel.
 *
 * Cuatro regiones y ninguna más: cabecera fija, navegación lateral, contenido y
 * pie. Cada una es un punto de referencia de ARIA (`banner`, `navigation`,
 * `main`, `contentinfo`), que es lo que permite a un lector de pantalla saltar
 * entre ellas en vez de recorrer la página entera.
 *
 * Decisiones que no se ven pero se notan:
 *
 *  · **Enlace de salto.** Primer elemento tabulable de la página. Sin él, llegar
 *    con teclado a la tabla que se viene a mirar cuesta las 25 entradas del
 *    menú, en cada carga.
 *  · **Lateral colapsable.** Se recuerda en `localStorage`. En pantallas de
 *    portátil, recuperar 190 px de ancho es una columna más de tabla visible.
 *  · **Off-canvas en móvil con el foco atrapado.** Un menú que se desliza por
 *    encima pero deja el foco paseándose por el contenido de detrás es un menú
 *    que no se puede usar sin ver la pantalla.
 *  · **La cabecera no repite el título.** El `<h1>` va justo debajo y dice lo
 *    mismo; duplicarlo obliga a deducir la ruta a mano y es lo que antes
 *    resaltaba mal el menú.
 */

const CLAVE_LATERAL = 'lateral-colapsado';

export function Layout() {
  const { t, i18n } = useTranslation();
  const { usuario, salir, puede } = useSesion();
  const { secciones } = useNavegacion();
  const navegar = useNavigate();

  const [menuMovil, setMenuMovil] = useState(false);
  const [colapsado, setColapsado] = useState(() => localStorage.getItem(CLAVE_LATERAL) === 'true');
  const [tema, setTema] = useState(temaGuardado());
  const [paleta, setPaleta] = useState(false);
  const [menuUsuario, setMenuUsuario] = useState(false);

  const lateral = useRef<HTMLElement>(null);
  const anclaUsuario = useRef<HTMLDivElement>(null);

  useAtajoPaleta(useCallback(() => setPaleta(true), []));
  useFocoAtrapado(
    lateral,
    menuMovil,
    useCallback(() => setMenuMovil(false), []),
  );

  // Al cambiar de pantalla el menú móvil tiene que cerrarse solo: si no, queda
  // tapando el contenido al que se acaba de navegar.
  useEffect(() => {
    if (!menuMovil) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuMovil]);

  const alternarTema = useCallback(() => {
    const siguiente = esOscuro(tema) ? 'light' : 'dark';
    aplicarTema(siguiente);
    setTema(siguiente);
  }, [tema]);

  const alternarLateral = () => {
    const siguiente = !colapsado;
    setColapsado(siguiente);
    localStorage.setItem(CLAVE_LATERAL, String(siguiente));
  };

  /** Acciones que la paleta ofrece además de las pantallas. */
  const accionesPaleta: AccionPaleta[] = useMemo(
    () => [
      {
        id: 'tema',
        etiqueta: t('ui.accion_tema'),
        grupo: t('ui.preferencias'),
        alias: ['oscuro', 'claro', 'dark', 'light'],
        ejecutar: alternarTema,
      },
      ...IDIOMAS.map((idioma) => ({
        id: `idioma-${idioma.codigo}`,
        etiqueta: t('ui.accion_idioma', { idioma: idioma.nombre }),
        grupo: t('ui.preferencias'),
        alias: [idioma.codigo, 'idioma', 'language'],
        ejecutar: () => cambiarIdioma(idioma.codigo),
      })),
      {
        id: 'salir',
        etiqueta: t('auth.salir'),
        grupo: t('ui.preferencias'),
        alias: ['logout', 'cerrar sesión'],
        ejecutar: () => void salir(),
      },
    ],
    [t, alternarTema, salir],
  );

  const iniciales = (usuario?.firstName?.[0] ?? usuario?.email?.[0] ?? '?').toUpperCase();

  return (
    <div className="armazon">
      {/* El primer elemento tabulable de toda la página. */}
      <a href="#contenido" className="salto">
        {t('ui.saltar_al_contenido')}
      </a>

      {/* ── Navegación lateral ── */}
      <aside
        ref={lateral}
        id="navegacion-lateral"
        className={[
          'lateral',
          colapsado ? 'lateral-estrecho' : '',
          menuMovil ? 'lateral-abierto' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="lateral-marca">
          <span className="marca-cuadro" aria-hidden="true">
            {t('app.titulo').charAt(0)}
          </span>
          {!colapsado && <span className="font-semibold tracking-tight">{t('app.titulo')}</span>}
        </div>

        <nav className="lateral-nav" aria-label={t('ui.nav_principal')}>
          {secciones.map((seccion, i) => (
            <div key={i} className="mb-4">
              {seccion.titulo && !colapsado && <p className="lateral-grupo">{seccion.titulo}</p>}
              {seccion.titulo && colapsado && (
                <div className="lateral-separador" role="presentation" />
              )}
              <ul className="space-y-0.5">
                {seccion.entradas.map((e) => (
                  <li key={e.ruta}>
                    {/*
                     * Contraído: la etiqueta va a la derecha y el envoltorio
                     * ocupa el ancho del carril. Debajo tapaba el icono
                     * siguiente, y sin `w-full` encogía el enlace hasta el
                     * tamaño del icono y lo dejaba descentrado contra el borde.
                     */}
                    {colapsado ? (
                      <Tooltip texto={e.etiqueta} posicion="derecha" className="w-full">
                        <Enlace
                          a={e.ruta}
                          onClick={() => setMenuMovil(false)}
                          className="lateral-enlace lateral-enlace-solo-icono"
                          aria-label={e.etiqueta}
                          activoExacto={e.ruta === '/'}
                          activo={ESTILO_ACTIVO}
                        >
                          {e.icono}
                        </Enlace>
                      </Tooltip>
                    ) : (
                      <Enlace
                        a={e.ruta}
                        onClick={() => setMenuMovil(false)}
                        className="lateral-enlace"
                        // La raíz prefija todas las rutas: sin `exact` estaría
                        // siempre activa y el menú resaltaría dos entradas.
                        activoExacto={e.ruta === '/'}
                        activo={ESTILO_ACTIVO}
                      >
                        {e.icono}
                        <span className="truncate">{e.etiqueta}</span>
                      </Enlace>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="lateral-pie">
          <Boton
            variante="fantasma"
            tamano="sm"
            soloIcono
            etiqueta={colapsado ? t('ui.expandir_menu') : t('ui.colapsar_menu')}
            onClick={alternarLateral}
            className="hidden lg:inline-flex"
            aria-expanded={!colapsado}
            aria-controls="navegacion-lateral"
            icono={<Ico d={colapsado ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} />}
          />
        </div>
      </aside>

      {menuMovil && (
        <button
          type="button"
          aria-label={t('app.cerrar')}
          onClick={() => setMenuMovil(false)}
          className="velo lg:hidden"
        />
      )}

      {/* ── Columna de contenido ── */}
      <div className="columna">
        <header className="cabecera">
          <Boton
            variante="fantasma"
            tamano="sm"
            soloIcono
            etiqueta={t('ui.abrir_menu')}
            onClick={() => setMenuMovil(true)}
            className="lg:hidden"
            aria-expanded={menuMovil}
            aria-controls="navegacion-lateral"
            icono={<Ico d="M3 12h18M3 6h18M3 18h18" />}
          />

          {/*
           * Buscador global.
           *
           * Es un botón, no un `input`: lo que abre es la paleta de comandos, y
           * fingir un campo que al escribir la primera letra te mueve el foco a
           * otro sitio desconcierta. Enseña su atajo para que la segunda vez ya
           * no haga falta buscarlo con el ratón.
           */}
          <button type="button" onClick={() => setPaleta(true)} className="buscador-global">
            <Ico d={ICONOS.buscar} />
            <span className="buscador-texto">{t('ui.buscar_global')}</span>
            <kbd className="tecla hidden sm:inline-block">⌘K</kbd>
          </button>

          {/*
           * La cuenta va en la esquina, que es donde se busca. Quién la empuja
           * hasta ahí es la rejilla de la cabecera, no un margen: así el hueco
           * se reparte entre los dos lados en vez de acumularse en uno.
           */}
          <div className="flex items-center gap-1">
            {/*
             * Entrada al Studio.
             *
             * Visible en la cabecera y no solo en el menú lateral: es una
             * herramienta distinta —pantalla completa, sin este armazón— y se
             * entra a ella con intención, no navegando entre pantallas del
             * panel. Quien no tiene permiso no la ve, como todo lo demás.
             */}
            {puede('studio:read') && (
              <Enlace a="/studio" className="btn btn-secundario text-sm hidden sm:inline-flex">
                <Ico d={ICONOS.studio} />
                <span>{t('studio.titulo')}</span>
              </Enlace>
            )}

            <Campana />

            <div ref={anclaUsuario} className="relative">
              {/*
               * El nombre lo pone `aria-label` y no la suma de lo que hay
               * dentro. Antes se leía «Aadmin@tienda.local admin@tienda.local»:
               * la inicial del avatar pegada al email y el email dos veces,
               * porque había un texto para lectores además del visible. Con la
               * etiqueta explícita se anuncia una sola frase que dice qué abre.
               */}
              <button
                type="button"
                className="avatar-boton objetivo"
                aria-haspopup="menu"
                aria-expanded={menuUsuario}
                aria-label={t('ui.menu_cuenta', { email: usuario?.email ?? '' })}
                onClick={() => setMenuUsuario((v) => !v)}
              >
                <span className="avatar" aria-hidden="true">
                  {iniciales}
                </span>
                <span className="avatar-email" aria-hidden="true">
                  {usuario?.email}
                </span>
              </button>

              <Menu
                abierto={menuUsuario}
                alCerrar={() => setMenuUsuario(false)}
                ancla={anclaUsuario}
                opciones={[
                  {
                    etiqueta: t('perfil.titulo'),
                    alElegir: () => void navegar({ to: '/perfil' as never }),
                    icono: (
                      <Ico d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8" />
                    ),
                  },
                  {
                    etiqueta: esOscuro(tema) ? t('ui.tema_claro') : t('ui.tema_oscuro'),
                    separada: true,
                    alElegir: alternarTema,
                    icono: (
                      <Ico
                        d={
                          esOscuro(tema)
                            ? 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4'
                            : 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z'
                        }
                      />
                    ),
                  },
                  ...IDIOMAS.map((idioma) => ({
                    etiqueta: idioma.nombre,
                    alElegir: () => cambiarIdioma(idioma.codigo),
                    separada: idioma.codigo === IDIOMAS[0]?.codigo,
                    desactivada: i18n.language === idioma.codigo,
                  })),
                  {
                    etiqueta: t('auth.salir'),
                    alElegir: () => void salir(),
                    separada: true,
                    peligro: true,
                    icono: <Ico d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />,
                  },
                ]}
              />
            </div>
          </div>
        </header>

        <main id="contenido" className="contenido" tabIndex={-1}>
          <Outlet />
        </main>

        <footer className="pie">
          <span>
            {t('app.titulo')} · {usuario?.email}
          </span>
          <span className="hidden sm:inline">{t('ui.atajo_paleta')}</span>
        </footer>
      </div>

      <PaletaComandos
        abierta={paleta}
        alCerrar={() => setPaleta(false)}
        acciones={accionesPaleta}
      />
    </div>
  );
}

/**
 * Estilo del ítem activo.
 *
 * Es el color de marca en su variante de TEXTO, no el de fondo: en tema oscuro
 * este era el único elemento del panel que no llegaba a AA. Y no va solo por
 * color —una barra a la izquierda lo marca también—, porque el color no puede
 * ser el único codificador de nada.
 */
const ESTILO_ACTIVO: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--marca-primario) 12%, transparent)',
  color: 'var(--marca-primario-texto)',
  fontWeight: 500,
  boxShadow: 'inset 3px 0 0 var(--marca-primario)',
};

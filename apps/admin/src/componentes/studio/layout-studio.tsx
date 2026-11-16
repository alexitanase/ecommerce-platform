import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet } from '@tanstack/react-router';
import { Enlace } from '@/componentes/enlace';
import { Ico } from '@/lib/navegacion';
import { useSesion } from '@/lib/sesion';
import { aplicarTema, esOscuro, temaGuardado } from '@/lib/tema';
import { SinPermiso } from '@/componentes/estados';
import { Boton } from '@/componentes/ui/boton';

/**
 * Armazón del Studio.
 *
 * Es la misma aplicación que el panel, pero por dentro no lo parece: aquí no
 * hay barra lateral, ni migas, ni buscador global. Un editor gráfico necesita
 * la pantalla entera, y las veinticinco entradas del menú del panel no solo
 * ocupan sitio — invitan a irse a otra cosa en mitad de un diseño.
 *
 * No se separó en otra aplicación porque eso significaría duplicar sesión,
 * refresco de token, cliente de API, idiomas, tokens de diseño, imagen de
 * Docker y entrada de nginx. Lo que se quiere aislar es la interfaz, y para eso
 * basta con colgar estas rutas de otro layout.
 *
 * La única precaución real es el peso: el lienzo y sus herramientas no pueden
 * entrar en el arranque del panel. Por eso todas las pantallas de aquí se
 * cargan de forma perezosa desde el enrutador.
 */
export function LayoutStudio() {
  const { t } = useTranslation();
  const { puede } = useSesion();
  const [tema, setTema] = useState(temaGuardado());

  const alternarTema = useCallback(() => {
    const siguiente = esOscuro(tema) ? 'light' : 'dark';
    aplicarTema(siguiente);
    setTema(siguiente);
  }, [tema]);

  /*
   * El Studio ocupa la ventana entera y gestiona su propio desplazamiento: el
   * lienzo se desplaza dentro de su caja, no arrastrando la página. Sin esto,
   * al arrastrar una capa cerca del borde se mueve el documento entero y la
   * capa se queda donde estaba.
   */
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  if (!puede('studio:read')) return <SinPermiso permiso="studio:read" />;

  return (
    <div className="studio">
      <header className="studio-barra">
        {/*
         * Volver es lo primero de la barra y lo único que sale del Studio.
         *
         * Va directo al panel, no al historial. Se intentó al revés —volver a
         * donde se venía— y era peor: después de un rato dentro del Studio, el
         * historial son quince pantallas suyas, y «volver» dejaba dando vueltas
         * por el propio Studio en lugar de sacarte de él, que es lo único para
         * lo que se pulsa este botón.
         */}
        <Enlace a="/" className="studio-volver objetivo">
          <Ico d="M19 12H5M12 19l-7-7 7-7" />
          <span>{t('studio.volver')}</span>
        </Enlace>

        <Enlace a="/studio" className="studio-marca objetivo">
          <span className="marca-cuadro" aria-hidden="true">
            S
          </span>
          <span className="font-semibold tracking-tight">{t('studio.titulo')}</span>
        </Enlace>

        <nav className="studio-nav" aria-label={t('studio.nav')}>
          <Enlace a="/studio" className="studio-enlace" activoExacto activo={ESTILO_ACTIVO}>
            {t('studio.campanas')}
          </Enlace>
          <Enlace a="/studio/biblioteca" className="studio-enlace" activo={ESTILO_ACTIVO}>
            {t('studio.biblioteca')}
          </Enlace>
        </nav>

        <Boton
          variante="fantasma"
          tamano="sm"
          soloIcono
          etiqueta={esOscuro(tema) ? t('ui.tema_claro') : t('ui.tema_oscuro')}
          onClick={alternarTema}
          icono={
            <Ico
              d={
                esOscuro(tema)
                  ? 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4'
                  : 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z'
              }
            />
          }
        />
      </header>

      <main id="contenido" className="studio-cuerpo" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

const ESTILO_ACTIVO: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--marca-primario) 14%, transparent)',
  color: 'var(--marca-primario-texto)',
  fontWeight: 500,
};

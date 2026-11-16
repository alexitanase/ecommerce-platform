import { useTranslation } from 'react-i18next';
import { Encabezado } from '@/componentes/encabezado';
import { Enlace } from '@/componentes/enlace';
import { Frescura, Vacio, ErrorPanel, Cargando } from '@/componentes/estados';
import { Tarjeta } from '@/componentes/ui/datos';
import { Boton } from '@/componentes/ui/boton';
import { useAvisos } from '@/lib/avisos';

/**
 * Centro de avisos.
 *
 * La versión en pantalla completa de la campana. No hay bandeja de
 * notificaciones guardadas y no hace falta: lo que importa es qué está parado
 * ahora mismo, y eso lo contesta la operativa. Un aviso desaparece cuando el
 * problema se resuelve, no cuando alguien lo marca como leído —que es como se
 * acaban ocultando los problemas en vez de arreglándolos—.
 */
export function Notificaciones() {
  const { t } = useTranslation();
  const { avisos, total, cargando, fallo, refrescar, actualizado } = useAvisos();

  return (
    <div>
      <Encabezado
        titulo={t('avisos.titulo')}
        descripcion={t('avisos.pagina_ayuda')}
        cargados={total}
        acciones={
          <Boton variante="secundario" onClick={refrescar} cargando={cargando}>
            {t('ui.actualizar')}
          </Boton>
        }
        frescura={
          <Frescura actualizado={actualizado} refrescando={cargando} alRefrescar={refrescar} />
        }
      />

      {fallo ? (
        <ErrorPanel error={fallo} reintentar={refrescar} />
      ) : cargando ? (
        <Cargando filas={4} />
      ) : avisos.length === 0 ? (
        <Vacio titulo={t('avisos.nada')} descripcion={t('avisos.nada_ayuda')} />
      ) : (
        <div className="rejilla">
          {avisos.map((a) => (
            <div key={a.id} className="col-4">
              <Tarjeta
                titulo={a.texto}
                pie={
                  <Enlace a={a.ruta} className="btn btn-secundario text-xs">
                    {t('avisos.resolver')}
                  </Enlace>
                }
              >
                <p className="cifra text-3xl font-semibold" style={{ color: `var(--${a.tono})` }}>
                  {a.cantidad}
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
                  {t(`avisos.tono_${a.tono}`)}
                </p>
              </Tarjeta>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

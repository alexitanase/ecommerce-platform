import { useTranslation } from 'react-i18next';
import { Enlace } from '@/componentes/enlace';
import { Boton } from '@/componentes/ui/boton';

/**
 * Pantallas de error.
 *
 * Las tres dicen lo mismo en la misma forma: qué ha pasado, por qué, y qué se
 * puede hacer ahora. Un 404 que solo pone «404» deja a quien lo ve pensando que
 * ha roto algo; lo que necesita es una salida.
 *
 * El código va en pequeño y al final: es lo único útil para quien va a mirar el
 * log, y lo que menos le importa a quien está intentando trabajar.
 */
export function PaginaError({
  codigo,
  detalle,
  reintentar,
}: {
  codigo: 403 | 404 | 500;
  /** Mensaje técnico o traceId, para poder reportarlo. */
  detalle?: string;
  reintentar?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="pagina-error">
      <p className="error-codigo" aria-hidden="true">
        {codigo}
      </p>
      <h1 className="text-xl font-semibold">{t(`errores.${codigo}.titulo`)}</h1>
      <p className="mt-2 max-w-md text-sm" style={{ color: 'var(--texto-suave)' }}>
        {t(`errores.${codigo}.ayuda`)}
      </p>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Enlace a="/" className="btn btn-primario">
          {t('errores.ir_al_panel')}
        </Enlace>
        {reintentar && (
          <Boton variante="secundario" onClick={reintentar}>
            {t('app.reintentar')}
          </Boton>
        )}
      </div>

      {detalle && (
        <p className="mt-6 font-mono text-xs" style={{ color: 'var(--texto-tenue)' }}>
          {detalle}
        </p>
      )}
    </div>
  );
}

export const NoEncontrada = () => <PaginaError codigo={404} />;
export const SinAcceso = () => <PaginaError codigo={403} />;

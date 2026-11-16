import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Cargando } from '@/componentes/estados';
import { listarFormatos, type FormatoServido } from '@/lib/studio';

/**
 * Elección de formato.
 *
 * No es un desplegable con treinta y ocho claves: un `300×250` y un `300×500`
 * escritos en una lista se confunden, y elegir mal significa rehacer la pieza.
 * Aquí se ve **la proporción real** de cada uno a escala, que es la información
 * que de verdad decide —lo que cabe en un 728×90 no cabe en un 160×600— junto
 * con el peso máximo, que es lo que después rechaza la red.
 */

export function useFormatos() {
  return useQuery({
    queryKey: ['studio', 'formatos'],
    // El catálogo sale del código del servidor: no cambia en toda la sesión.
    staleTime: Infinity,
    queryFn: listarFormatos,
  });
}

export function SelectorFormato({
  valor,
  alElegir,
  excluidos = [],
}: {
  valor?: string;
  alElegir: (clave: string) => void;
  /** Formatos que ya están en el documento, para no ofrecerlos dos veces. */
  excluidos?: string[];
}) {
  const { t } = useTranslation();
  const formatos = useFormatos();
  const [red, setRed] = useState('exoclick');

  const porRed = useMemo(() => {
    const fuera = new Set(excluidos);
    return (formatos.data?.formatos ?? []).filter((f) => f.red === red && !fuera.has(f.clave));
  }, [formatos.data, red, excluidos]);

  if (formatos.isLoading) return <Cargando />;

  const redes = formatos.data?.redes ?? {};

  return (
    <div className="space-y-3">
      <div className="pestanas" role="tablist">
        {Object.entries(redes).map(([clave, nombre]) => (
          <button
            key={clave}
            type="button"
            role="tab"
            aria-selected={red === clave}
            className={`pestana ${red === clave ? 'pestana-activa' : ''}`}
            onClick={() => setRed(clave)}
          >
            {nombre}
          </button>
        ))}
      </div>

      <div className="studio-formatos">
        {porRed.map((f) => (
          <FichaFormato
            key={f.clave}
            formato={f}
            elegido={f.clave === valor}
            alElegir={() => alElegir(f.clave)}
          />
        ))}
        {porRed.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
            {t('studio.formatos_todos_puestos')}
          </p>
        )}
      </div>
    </div>
  );
}

/** Alto máximo de la miniatura, en píxeles de pantalla. */
const ALTO_VISTA = 68;
const ANCHO_VISTA = 120;

function FichaFormato({
  formato,
  elegido,
  alElegir,
}: {
  formato: FormatoServido;
  elegido: boolean;
  alElegir: () => void;
}) {
  const { t } = useTranslation();

  // La miniatura conserva la proporción exacta dentro de una caja fija: es lo
  // único que hace comparable un 728×90 con un 160×600 de un vistazo.
  const escala = Math.min(ANCHO_VISTA / formato.ancho, ALTO_VISTA / formato.alto);

  return (
    <button
      type="button"
      onClick={alElegir}
      className={`studio-formato objetivo ${elegido ? 'studio-formato-elegido' : ''}`}
      aria-pressed={elegido}
    >
      <span className="studio-formato-vista" aria-hidden="true">
        <span
          className="studio-formato-caja"
          style={{ width: formato.ancho * escala, height: formato.alto * escala }}
        />
      </span>

      <span className="studio-formato-nombre">{formato.nombre}</span>
      <span className="studio-formato-dato">
        {formato.ancho}×{formato.alto} · {formato.pesoMaxKb} KB
      </span>

      {/*
       * Dos avisos que se pagan caros si no están a la vista al elegir: una
       * ficha que lleva medio año sin comprobarse contra la documentación de la
       * red, y una que salió de una guía de terceros y no de su panel.
       */}
      {formato.revisionCaducada && (
        <span className="studio-formato-aviso">{t('studio.revision_caducada')}</span>
      )}
      {!formato.revisionCaducada && formato.fuente === 'terceros' && (
        <span className="studio-formato-aviso">{t('studio.fuente_terceros')}</span>
      )}
    </button>
  );
}

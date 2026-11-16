import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cargando, ErrorPanel, Etiqueta, Vacio } from '@/componentes/estados';
import { Boton } from '@/componentes/ui/boton';
import { useToast } from '@/componentes/ui/toast';
import { Enlace } from '@/componentes/enlace';
import { useSesion } from '@/lib/sesion';
import { crearCampana, listarCampanas, TONO_CAMPANA, type Campana } from '@/lib/studio';
import { ModalCampana, type ValoresCampana } from '@/componentes/studio/modal-campana';

/**
 * Campañas del Studio.
 *
 * La pantalla de entrada, y a propósito no es una lista de archivos: lo primero
 * que se ve es **para qué** se está diseñando. Una biblioteca de banners sueltos
 * es lo que ya se tiene en cualquier carpeta compartida, y es justo lo que hace
 * imposible saber después qué se hizo para qué ni qué funcionó.
 */

export function CampanasStudio() {
  const { t } = useTranslation();
  const { puede } = useSesion();
  const qc = useQueryClient();
  const toast = useToast();
  const [estado, setEstado] = useState('');
  const [creando, setCreando] = useState(false);

  const campanas = useQuery({
    queryKey: ['studio', 'campanas', estado],
    queryFn: () => listarCampanas(estado ? { estado } : {}),
  });

  const crear = useMutation({
    mutationFn: (valores: ValoresCampana) =>
      crearCampana({
        name: valores.name,
        channel: valores.channel,
        objective: valores.objective,
        ...(valores.landingUrl ? { landingUrl: valores.landingUrl } : {}),
        ...(valores.brief ? { brief: valores.brief } : {}),
      }),
    onSuccess: () => {
      toast.exito(t('studio.campana_creada'));
      setCreando(false);
      void qc.invalidateQueries({ queryKey: ['studio', 'campanas'] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  if (campanas.isLoading) return <Cargando />;
  if (campanas.error)
    return <ErrorPanel error={campanas.error} reintentar={() => void campanas.refetch()} />;

  const items = campanas.data ?? [];

  return (
    <div className="studio-pagina">
      <div className="studio-titular">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('studio.campanas')}</h1>
          <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
            {t('studio.campanas_descripcion')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="campo w-auto"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
            aria-label={t('studio.filtrar_estado')}
          >
            <option value="">{t('studio.todas')}</option>
            {(['BORRADOR', 'ACTIVA', 'PAUSADA', 'ARCHIVADA'] as const).map((e) => (
              <option key={e} value={e}>
                {t(`studio.estado_campana.${e}`)}
              </option>
            ))}
          </select>

          {puede('studio:write') && (
            <Boton variante="primario" onClick={() => setCreando(true)}>
              + {t('studio.nueva_campana')}
            </Boton>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <Vacio
          titulo={t('studio.sin_campanas')}
          descripcion={t('studio.sin_campanas_ayuda')}
          {...(puede('studio:write')
            ? {
                accion: (
                  <Boton variante="primario" onClick={() => setCreando(true)}>
                    {t('studio.nueva_campana')}
                  </Boton>
                ),
              }
            : {})}
        />
      ) : (
        <div className="studio-rejilla">
          {items.map((c) => (
            <TarjetaCampana key={c.id} campana={c} />
          ))}
        </div>
      )}

      {creando && (
        <ModalCampana
          titulo={t('studio.nueva_campana')}
          guardando={crear.isPending}
          alCerrar={() => setCreando(false)}
          alGuardar={(valores) => crear.mutate(valores)}
        />
      )}
    </div>
  );
}

function TarjetaCampana({ campana }: { campana: Campana }) {
  const { t } = useTranslation();

  return (
    <Enlace
      a="/studio/campanas/$campaignId"
      params={{ campaignId: campana.id }}
      className="studio-tarjeta objetivo"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{campana.name}</span>
        <Etiqueta
          texto={t(`studio.estado_campana.${campana.status}`)}
          tono={TONO_CAMPANA[campana.status]}
        />
      </div>

      <p className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {campana.canal} · {t(`studio.objetivo.${campana.objective}`)}
      </p>

      <p className="text-sm">
        {t('studio.piezas', { count: campana.creatividades })}
        {campana.locales.length > 1 && ` · ${campana.locales.join(' / ')}`}
      </p>
    </Enlace>
  );
}

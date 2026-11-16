import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { Boton } from '@/componentes/ui/boton';
import { Modal } from '@/componentes/ui/overlays';
import { AreaTexto, Entrada, Seleccion } from '@/componentes/ui/formulario';
import type { EstadoCampana } from '@/lib/studio';

/**
 * Crear y editar una campaña, con el mismo formulario.
 *
 * Estaban separados y el de edición no existía: una campaña se creaba y se
 * quedaba en borrador para siempre, sin forma de corregir un destino mal
 * escrito ni de ponerla en marcha. Un solo componente evita además lo de
 * siempre —dos formularios del mismo objeto que van separándose campo a campo—.
 *
 * La única diferencia entre los dos usos es el estado: al crear no se ofrece
 * porque toda campaña nace en borrador, y al editar es justamente lo que más se
 * viene a tocar.
 */

interface Canal {
  clave: string;
  nombre: string;
  admiteAdulto: 'si' | 'limitado' | 'no';
  advertencia?: string;
}

export interface ValoresCampana {
  name: string;
  channel: string;
  objective: string;
  landingUrl: string;
  brief: string;
  status?: EstadoCampana;
}

const OBJETIVOS = ['venta', 'captacion', 'retargeting', 'marca'] as const;
const ESTADOS = ['BORRADOR', 'ACTIVA', 'PAUSADA', 'ARCHIVADA'] as const;

export function ModalCampana({
  titulo,
  inicial,
  conEstado = false,
  guardando = false,
  alGuardar,
  alCerrar,
}: {
  titulo: string;
  inicial?: Partial<ValoresCampana>;
  /** Ofrece el estado. Al crear no: toda campaña nace en borrador. */
  conEstado?: boolean;
  guardando?: boolean;
  alGuardar: (valores: ValoresCampana) => void;
  alCerrar: () => void;
}) {
  const { t } = useTranslation();

  const canales = useQuery({
    queryKey: ['studio', 'canales'],
    // El catálogo de canales sale del código del servidor: no cambia en toda la
    // sesión.
    staleTime: Infinity,
    queryFn: () => get<Canal[]>('/studio/canales'),
  });

  const [valores, setValores] = useState<ValoresCampana>({
    name: inicial?.name ?? '',
    channel: inicial?.channel ?? '',
    objective: inicial?.objective ?? 'venta',
    landingUrl: inicial?.landingUrl ?? '',
    brief: inicial?.brief ?? '',
    ...(conEstado ? { status: inicial?.status ?? 'BORRADOR' } : {}),
  });

  const cambiar = (campo: keyof ValoresCampana, valor: string) =>
    setValores((v) => ({ ...v, [campo]: valor }));

  const elegido = canales.data?.find((c) => c.clave === valores.channel);
  const listo = valores.name.trim().length >= 2 && valores.channel !== '';

  /*
   * Un canal guardado que ya no está en el catálogo se ofrece igual, marcado.
   *
   * Sin esto el desplegable se quedaba en «Elige…» y no había forma de saber
   * qué tenía la campaña ni de conservarlo al guardar otro campo: el valor
   * simplemente desaparecía. Pasa con campañas creadas antes de que el canal
   * existiera o con una clave escrita a mano.
   */
  const desconocido = Boolean(
    valores.channel && canales.data && !canales.data.some((c) => c.clave === valores.channel),
  );

  const opcionesCanal = [
    { valor: '', texto: t('studio.elige') },
    ...(desconocido
      ? [
          {
            valor: valores.channel,
            texto: t('studio.canal_desconocido', { clave: valores.channel }),
          },
        ]
      : []),
    ...(canales.data ?? []).map((c) => ({ valor: c.clave, texto: c.nombre })),
  ];

  return (
    <Modal abierto titulo={titulo} alCerrar={alCerrar} ancho="md">
      {/*
       * Una sola columna. `campos-formulario` reparte en dos, y con ella el pie
       * del modal caía en una celda de la rejilla en vez de debajo de todo:
       * los botones aparecían a media altura, al lado de un campo.
       */}
      <form
        className="studio-formulario"
        onSubmit={(e) => {
          e.preventDefault();
          if (listo) alGuardar({ ...valores, name: valores.name.trim() });
        }}
      >
        <Entrada
          etiqueta={t('studio.campo_nombre')}
          value={valores.name}
          onChange={(e) => cambiar('name', e.target.value)}
          required
          maxLength={120}
          autoFocus
        />

        <div className="studio-props-rejilla">
          {/*
           * La `key` cambia con las opciones a propósito. Un `<select>`
           * controlado al que le llegan las opciones DESPUÉS del valor se queda
           * en blanco: React no vuelve a aplicar un `value` que no ha cambiado,
           * aunque ahora sí exista la opción. Remontarlo lo resuelve.
           */}
          <Seleccion
            key={opcionesCanal.length}
            etiqueta={t('studio.campo_canal')}
            value={valores.channel}
            onChange={(e) => cambiar('channel', e.target.value)}
            required
            opciones={opcionesCanal}
          />

          <Seleccion
            etiqueta={t('studio.campo_objetivo')}
            value={valores.objective}
            onChange={(e) => cambiar('objective', e.target.value)}
            opciones={OBJETIVOS.map((o) => ({ valor: o, texto: t(`studio.objetivo.${o}`) }))}
          />
        </div>

        {/*
         * La advertencia del canal se enseña al elegirlo y no en una ayuda
         * escondida: hay canales que aceptan la cuenta y la cierran después, y
         * eso hay que saberlo antes de invertir tiempo, no cuando ya pasó.
         */}
        {elegido?.advertencia && (
          <p
            className="text-sm"
            style={{ color: elegido.admiteAdulto === 'no' ? 'var(--error)' : 'var(--texto-tenue)' }}
          >
            {elegido.advertencia}
          </p>
        )}

        {conEstado && (
          <Seleccion
            etiqueta={t('studio.campo_estado')}
            ayuda={t('studio.campo_estado_ayuda')}
            value={valores.status ?? 'BORRADOR'}
            onChange={(e) => cambiar('status', e.target.value)}
            opciones={ESTADOS.map((e) => ({ valor: e, texto: t(`studio.estado_campana.${e}`) }))}
          />
        )}

        <Entrada
          etiqueta={t('studio.campo_destino')}
          ayuda={t('studio.campo_destino_ayuda')}
          type="url"
          value={valores.landingUrl}
          onChange={(e) => cambiar('landingUrl', e.target.value)}
          placeholder="https://"
        />

        <AreaTexto
          etiqueta={t('studio.campo_brief')}
          ayuda={t('studio.campo_brief_ayuda')}
          value={valores.brief}
          onChange={(e) => cambiar('brief', e.target.value)}
          rows={4}
          maxLength={4000}
        />

        <div className="modal-pie">
          <Boton type="button" variante="secundario" onClick={alCerrar}>
            {t('app.cancelar')}
          </Boton>
          <Boton type="submit" variante="primario" cargando={guardando} disabled={!listo}>
            {t('app.guardar')}
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

import { useTranslation } from 'react-i18next';
import type { Capa, Documento, Mesa, Relleno } from '@ecom/shared';
import { Ico } from '@/lib/navegacion';
import { capasDe, type Alineacion } from '@/lib/studio-edicion';
import type { Activo } from '@/lib/studio';

/**
 * Los dos paneles del editor: el árbol de capas y las propiedades.
 *
 * Van juntos en un fichero porque comparten una decisión que solo se entiende
 * viéndolos a la vez: **todo valor se puede escribir a mano**. Arrastrar sirve
 * para colocar rápido; cuadrar un margen a 16 px exactos con el ratón es
 * imposible, y sin campos numéricos la gente acaba dándose por vencida con
 * «casi alineado», que en un lote de doce piezas se nota.
 */

// ── Árbol de capas ────────────────────────────────────────

const ICONO_CAPA: Record<string, string> = {
  texto: 'M4 7V4h16v3M9 20h6M12 4v16',
  imagen: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  forma: 'M4 4h16v16H4z',
  vector: 'M12 2l9 7-3.5 11h-11L3 9z',
  boton: 'M3 8h18v8H3zM7 12h10',
  producto: 'M21 16V8l-9-5-9 5v8l9 5zM3.3 7L12 12l8.7-5',
  video: 'M4 5h16v14H4zM10 9l5 3-5 3z',
  html: 'M4 4h16v16H4zM8 10l-2 2 2 2M16 10l2 2-2 2M13 8l-2 8',
  grupo: 'M4 4h7v7H4zM13 13h7v7h-7z',
  instancia: 'M12 2l4 4-4 4-4-4zM12 14l4 4-4 4-4-4z',
};

export function PanelCapas({
  documento,
  mesa,
  seleccion,
  alSeleccionar,
  alCambiar,
  alMover,
  alBorrar,
  editable,
}: {
  documento: Documento;
  mesa: Mesa;
  seleccion: string | null;
  alSeleccionar: (id: string) => void;
  alCambiar: (id: string, cambios: Record<string, unknown>) => void;
  alMover: (id: string, direccion: -1 | 1) => void;
  alBorrar: (id: string) => void;
  editable: boolean;
}) {
  const { t } = useTranslation();
  // De arriba abajo como se ven en el lienzo: la última pintada, la primera de
  // la lista. Al revés obliga a traducir mentalmente en cada clic.
  const capas = [...capasDe(documento, mesa.id)].reverse();

  if (capas.length === 0) {
    return (
      <p className="p-3 text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('studio.sin_capas')}
      </p>
    );
  }

  return (
    <ul className="studio-capas">
      {capas.map((capa) => (
        <li
          key={capa.id}
          className={`studio-capa-fila ${capa.id === seleccion ? 'studio-capa-fila-activa' : ''}`}
        >
          <button
            type="button"
            className="studio-capa-nombre objetivo"
            onClick={() => alSeleccionar(capa.id)}
          >
            <Ico d={ICONO_CAPA[capa.tipo] ?? ICONO_CAPA['forma']!} />
            <span className="truncate">{capa.nombre || t(`studio.capa.${capa.tipo}`)}</span>
          </button>

          <div className="studio-capa-acciones">
            <button
              type="button"
              className="objetivo"
              title={capa.visible ? t('studio.ocultar') : t('studio.mostrar')}
              aria-label={capa.visible ? t('studio.ocultar') : t('studio.mostrar')}
              onClick={() => alCambiar(capa.id, { visible: !capa.visible })}
            >
              <Ico
                d={
                  capa.visible
                    ? 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6'
                    : 'M17.9 17.9A10.1 10.1 0 0112 20C5 20 1 12 1 12a18 18 0 015.1-5.9M9.9 4.2A9 9 0 0112 4c7 0 11 8 11 8a18 18 0 01-2.2 3.2M1 1l22 22'
                }
              />
            </button>

            {editable && (
              <>
                <button
                  type="button"
                  className="objetivo"
                  title={capa.bloqueada ? t('studio.desbloquear') : t('studio.bloquear')}
                  aria-label={capa.bloqueada ? t('studio.desbloquear') : t('studio.bloquear')}
                  onClick={() => alCambiar(capa.id, { bloqueada: !capa.bloqueada })}
                >
                  <Ico
                    d={
                      capa.bloqueada
                        ? 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4'
                        : 'M5 11h14v10H5zM8 11V7a4 4 0 017.5-2'
                    }
                  />
                </button>
                <button
                  type="button"
                  className="objetivo"
                  title={t('studio.subir_capa')}
                  aria-label={t('studio.subir_capa')}
                  onClick={() => alMover(capa.id, 1)}
                >
                  <Ico d="M12 19V5M5 12l7-7 7 7" />
                </button>
                <button
                  type="button"
                  className="objetivo"
                  title={t('studio.bajar_capa')}
                  aria-label={t('studio.bajar_capa')}
                  onClick={() => alMover(capa.id, -1)}
                >
                  <Ico d="M12 5v14M19 12l-7 7-7-7" />
                </button>
                <button
                  type="button"
                  className="objetivo"
                  title={t('app.eliminar')}
                  aria-label={t('app.eliminar')}
                  onClick={() => alBorrar(capa.id)}
                >
                  <Ico d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                </button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Propiedades ───────────────────────────────────────────

export function PanelPropiedades({
  capa,
  activos,
  alCambiar,
  alAlinear,
  editable,
}: {
  capa: Capa | undefined;
  activos: Activo[];
  alCambiar: (cambios: Record<string, unknown>) => void;
  alAlinear: (como: Alineacion) => void;
  editable: boolean;
}) {
  const { t } = useTranslation();

  if (!capa) {
    return (
      <p className="p-3 text-sm" style={{ color: 'var(--texto-tenue)' }}>
        {t('studio.nada_seleccionado')}
      </p>
    );
  }

  const r = capa.recuadro;
  const geometria = (campo: 'x' | 'y' | 'ancho' | 'alto' | 'rotacion', valor: number) =>
    alCambiar({ recuadro: { ...r, [campo]: valor } });

  return (
    <div className="studio-props">
      <Seccion titulo={t('studio.prop_posicion')}>
        <div className="studio-props-rejilla">
          <Numero etiqueta="X" valor={r.x} alCambiar={(v) => geometria('x', v)} activo={editable} />
          <Numero etiqueta="Y" valor={r.y} alCambiar={(v) => geometria('y', v)} activo={editable} />
          <Numero
            etiqueta={t('studio.prop_ancho')}
            valor={r.ancho}
            min={1}
            alCambiar={(v) => geometria('ancho', v)}
            activo={editable}
          />
          <Numero
            etiqueta={t('studio.prop_alto')}
            valor={r.alto}
            min={1}
            alCambiar={(v) => geometria('alto', v)}
            activo={editable}
          />
          <Numero
            etiqueta={t('studio.prop_giro')}
            valor={r.rotacion}
            min={-360}
            max={360}
            alCambiar={(v) => geometria('rotacion', v)}
            activo={editable}
          />
          <Numero
            etiqueta={t('studio.prop_opacidad')}
            valor={Math.round(capa.opacidad * 100)}
            min={0}
            max={100}
            alCambiar={(v) => alCambiar({ opacidad: v / 100 })}
            activo={editable}
          />
        </div>

        {editable && (
          <div className="studio-alinear" role="group" aria-label={t('studio.alinear')}>
            {(
              [
                ['izquierda', 'M4 3v18M8 7h11v4H8zM8 13h7v4H8z'],
                ['centro-h', 'M12 3v18M7 7h10v4H7zM9 13h6v4H9z'],
                ['derecha', 'M20 3v18M5 7h11v4H5zM9 13h7v4H9z'],
                ['arriba', 'M3 4h18M7 8v11h4V8zM13 8v7h4V8z'],
                ['centro-v', 'M3 12h18M7 7v10h4V7zM13 9v6h4V9z'],
                ['abajo', 'M3 20h18M7 5v11h4V5zM13 9v7h4V9z'],
              ] as const
            ).map(([como, d]) => (
              <button
                key={como}
                type="button"
                className="objetivo"
                title={t(`studio.alinear_${como}`)}
                aria-label={t(`studio.alinear_${como}`)}
                onClick={() => alAlinear(como)}
              >
                <Ico d={d} />
              </button>
            ))}
          </div>
        )}

        {/*
         * El anclaje no hace nada visible hoy y por eso se explica: es lo que
         * decide dónde acaba esta capa cuando la pieza se lleve a otro tamaño.
         * Un logo anclado a la esquina se queda en la esquina; el mismo logo
         * sin anclar aparece a la mitad del banner apaisado.
         */}
        <div className="studio-props-rejilla">
          <Elegir
            etiqueta={t('studio.prop_ancla_x')}
            valor={capa.anclaje.x}
            opciones={['izquierda', 'centro', 'derecha', 'estirar']}
            traducir={(v) => t(`studio.ancla.${v}`)}
            alCambiar={(v) => alCambiar({ anclaje: { ...capa.anclaje, x: v } })}
            activo={editable}
          />
          <Elegir
            etiqueta={t('studio.prop_ancla_y')}
            valor={capa.anclaje.y}
            opciones={['arriba', 'centro', 'abajo', 'estirar']}
            traducir={(v) => t(`studio.ancla.${v}`)}
            alCambiar={(v) => alCambiar({ anclaje: { ...capa.anclaje, y: v } })}
            activo={editable}
          />
        </div>
      </Seccion>

      {capa.tipo === 'texto' && (
        <Seccion titulo={t('studio.prop_texto')}>
          <textarea
            className="campo"
            rows={3}
            value={capa.contenido.es ?? ''}
            disabled={!editable}
            aria-label={t('studio.prop_texto')}
            onChange={(e) => alCambiar({ contenido: { ...capa.contenido, es: e.target.value } })}
          />

          <div className="studio-props-rejilla">
            <Numero
              etiqueta={t('studio.prop_tamano')}
              valor={capa.tamano}
              min={4}
              alCambiar={(v) => alCambiar({ tamano: v })}
              activo={editable}
            />
            <Elegir
              etiqueta={t('studio.prop_peso')}
              valor={String(capa.peso)}
              opciones={['300', '400', '500', '600', '700', '800', '900']}
              alCambiar={(v) => alCambiar({ peso: Number(v) })}
              activo={editable}
            />
            <Numero
              etiqueta={t('studio.prop_interlineado')}
              valor={capa.interlineado}
              paso={0.05}
              min={0.6}
              max={3}
              alCambiar={(v) => alCambiar({ interlineado: v })}
              activo={editable}
            />
            <Numero
              etiqueta={t('studio.prop_espaciado')}
              valor={capa.espaciado}
              paso={0.5}
              min={-10}
              max={40}
              alCambiar={(v) => alCambiar({ espaciado: v })}
              activo={editable}
            />
          </div>

          <div className="studio-props-rejilla">
            <Color
              etiqueta={t('studio.prop_color')}
              valor={capa.color}
              alCambiar={(v) => alCambiar({ color: v })}
              activo={editable}
            />
            <Elegir
              etiqueta={t('studio.prop_alineacion')}
              valor={capa.alineacion}
              opciones={['izquierda', 'centro', 'derecha']}
              traducir={(v) => t(`studio.alineacion.${v}`)}
              alCambiar={(v) => alCambiar({ alineacion: v })}
              activo={editable}
            />
            <Elegir
              etiqueta={t('studio.prop_vertical')}
              valor={capa.alineacionVertical}
              opciones={['arriba', 'centro', 'abajo']}
              traducir={(v) => t(`studio.vertical.${v}`)}
              alCambiar={(v) => alCambiar({ alineacionVertical: v })}
              activo={editable}
            />
            <Elegir
              etiqueta={t('studio.prop_mayusculas')}
              valor={capa.transformar}
              opciones={['ninguna', 'mayusculas', 'minusculas']}
              traducir={(v) => t(`studio.transformar.${v}`)}
              alCambiar={(v) => alCambiar({ transformar: v })}
              activo={editable}
            />
          </div>

          <Elegir
            etiqueta={t('studio.prop_ajuste_texto')}
            ayuda={t('studio.prop_ajuste_texto_ayuda')}
            valor={capa.ajuste}
            opciones={['encoger', 'fijo', 'crecer']}
            traducir={(v) => t(`studio.ajuste_texto.${v}`)}
            alCambiar={(v) => alCambiar({ ajuste: v })}
            activo={editable}
          />
        </Seccion>
      )}

      {capa.tipo === 'forma' && (
        <Seccion titulo={t('studio.prop_forma')}>
          <Elegir
            etiqueta={t('studio.prop_forma')}
            valor={capa.forma}
            opciones={['rectangulo', 'elipse', 'linea', 'triangulo', 'estrella']}
            traducir={(v) => t(`studio.forma.${v}`)}
            alCambiar={(v) => alCambiar({ forma: v })}
            activo={editable}
          />
          <EditorRelleno
            relleno={capa.relleno}
            alCambiar={(relleno) => alCambiar({ relleno })}
            activo={editable}
          />
          <Numero
            etiqueta={t('studio.prop_radio')}
            valor={capa.radio}
            min={0}
            alCambiar={(v) => alCambiar({ radio: v })}
            activo={editable}
          />
        </Seccion>
      )}

      {capa.tipo === 'imagen' && (
        <Seccion titulo={t('studio.prop_imagen')}>
          <Elegir
            etiqueta={t('studio.prop_activo')}
            valor={capa.activoId}
            opciones={['', ...activos.map((a) => a.id)]}
            traducir={(v) => activos.find((a) => a.id === v)?.name ?? t('studio.elige')}
            alCambiar={(v) => alCambiar({ activoId: v })}
            activo={editable}
          />
          <Elegir
            etiqueta={t('studio.prop_encaje')}
            valor={capa.ajuste}
            opciones={['cubrir', 'contener', 'estirar']}
            traducir={(v) => t(`studio.encaje.${v}`)}
            alCambiar={(v) => alCambiar({ ajuste: v })}
            activo={editable}
          />
          <Numero
            etiqueta={t('studio.prop_radio')}
            valor={capa.radio}
            min={0}
            alCambiar={(v) => alCambiar({ radio: v })}
            activo={editable}
          />
        </Seccion>
      )}

      {capa.tipo === 'html' && (
        <Seccion titulo={t('studio.prop_html')}>
          {/*
           * Se edita el código, no una vista con capas: la gracia del bloque es
           * justamente que entra de una pieza. Lo que se escriba aquí lo sanea
           * el servidor al guardar, no el navegador.
           */}
          <textarea
            className="campo font-mono"
            rows={8}
            spellCheck={false}
            value={capa.html}
            disabled={!editable}
            aria-label={t('studio.prop_html')}
            onChange={(e) => alCambiar({ html: e.target.value })}
          />
          <label className="studio-campo">
            <span>{t('studio.prop_css')}</span>
            <textarea
              className="campo font-mono"
              rows={5}
              spellCheck={false}
              value={capa.css}
              disabled={!editable}
              onChange={(e) => alCambiar({ css: e.target.value })}
            />
            <small className="ayuda-campo">{t('studio.prop_css_ayuda')}</small>
          </label>
        </Seccion>
      )}

      {capa.tipo === 'boton' && (
        <Seccion titulo={t('studio.prop_boton')}>
          <input
            className="campo"
            value={capa.texto.es ?? ''}
            disabled={!editable}
            aria-label={t('studio.prop_texto')}
            onChange={(e) => alCambiar({ texto: { ...capa.texto, es: e.target.value } })}
          />
          <EditorRelleno
            relleno={capa.relleno}
            alCambiar={(relleno) => alCambiar({ relleno })}
            activo={editable}
          />
          <div className="studio-props-rejilla">
            <Color
              etiqueta={t('studio.prop_color')}
              valor={capa.color}
              alCambiar={(v) => alCambiar({ color: v })}
              activo={editable}
            />
            <Numero
              etiqueta={t('studio.prop_radio')}
              valor={capa.radio}
              min={0}
              alCambiar={(v) => alCambiar({ radio: v })}
              activo={editable}
            />
            <Numero
              etiqueta={t('studio.prop_tamano')}
              valor={capa.tamano}
              min={4}
              alCambiar={(v) => alCambiar({ tamano: v })}
              activo={editable}
            />
          </div>
        </Seccion>
      )}
    </div>
  );
}

/**
 * Relleno: sólido o degradado.
 *
 * El degradado está aquí porque el importador ya los conserva, y un relleno que
 * se puede traer pero no tocar es peor que no traerlo: se ve bien hasta que hay
 * que cambiar un color y no hay dónde.
 *
 * Las paradas se editan una a una y no con un selector visual sobre una barra.
 * Es menos vistoso y basta: un banner lleva dos o tres colores, y para eso una
 * lista de colores con su posición es más rápida que arrastrar marcadores.
 */
function EditorRelleno({
  relleno,
  alCambiar,
  activo,
}: {
  relleno: Relleno;
  alCambiar: (relleno: Relleno) => void;
  activo: boolean;
}) {
  const { t } = useTranslation();

  const cambiarTipo = (tipo: string) => {
    if (tipo === relleno.tipo) return;
    if (tipo === 'ninguno') return alCambiar({ tipo: 'ninguno' });
    if (tipo === 'solido') {
      // Al pasar de degradado a sólido se conserva su primer color, que es lo
      // que se espera: no volver al rojo por defecto.
      const color =
        relleno.tipo === 'degradado' ? (relleno.paradas[0]?.color ?? '#e11d48') : '#e11d48';
      return alCambiar({ tipo: 'solido', color });
    }
    const color = relleno.tipo === 'solido' ? relleno.color : '#e11d48';
    alCambiar({
      tipo: 'degradado',
      forma: 'lineal',
      angulo: 90,
      paradas: [
        { posicion: 0, color },
        { posicion: 1, color: '#7c3aed' },
      ],
    });
  };

  return (
    <>
      <Elegir
        etiqueta={t('studio.prop_relleno')}
        valor={relleno.tipo === 'imagen' ? 'solido' : relleno.tipo}
        opciones={['solido', 'degradado', 'ninguno']}
        traducir={(v) => t(`studio.relleno.${v}`)}
        alCambiar={cambiarTipo}
        activo={activo}
      />

      {relleno.tipo === 'solido' && (
        <Color
          etiqueta={t('studio.prop_color')}
          valor={relleno.color}
          alCambiar={(color) => alCambiar({ tipo: 'solido', color })}
          activo={activo}
        />
      )}

      {relleno.tipo === 'degradado' && (
        <>
          <div className="studio-props-rejilla">
            <Elegir
              etiqueta={t('studio.prop_degradado')}
              valor={relleno.forma}
              opciones={['lineal', 'radial']}
              traducir={(v) => t(`studio.degradado.${v}`)}
              alCambiar={(forma) => alCambiar({ ...relleno, forma })}
              activo={activo}
            />
            <Numero
              etiqueta={t('studio.prop_angulo')}
              valor={relleno.angulo}
              min={0}
              max={360}
              alCambiar={(angulo) => alCambiar({ ...relleno, angulo })}
              activo={activo && relleno.forma === 'lineal'}
            />
          </div>

          {relleno.paradas.map((parada, i) => (
            <div className="studio-props-rejilla" key={i}>
              <Color
                etiqueta={t('studio.prop_parada', { numero: i + 1 })}
                valor={parada.color}
                alCambiar={(color) =>
                  alCambiar({
                    ...relleno,
                    paradas: relleno.paradas.map((p, j) => (j === i ? { ...p, color } : p)),
                  })
                }
                activo={activo}
              />
              <Numero
                etiqueta="%"
                valor={Math.round(parada.posicion * 100)}
                min={0}
                max={100}
                alCambiar={(v) =>
                  alCambiar({
                    ...relleno,
                    paradas: relleno.paradas.map((p, j) =>
                      j === i ? { ...p, posicion: v / 100 } : p,
                    ),
                  })
                }
                activo={activo}
              />
            </div>
          ))}
        </>
      )}
    </>
  );
}

// ── Controles menudos ─────────────────────────────────────

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="studio-props-seccion">
      <p className="etiqueta-campo">{titulo}</p>
      {children}
    </section>
  );
}

function Numero({
  etiqueta,
  valor,
  alCambiar,
  min,
  max,
  paso = 1,
  activo,
}: {
  etiqueta: string;
  valor: number;
  alCambiar: (v: number) => void;
  min?: number;
  max?: number;
  paso?: number;
  activo: boolean;
}) {
  return (
    <label className="studio-campo">
      <span>{etiqueta}</span>
      <input
        className="campo"
        type="number"
        value={Number.isFinite(valor) ? valor : 0}
        step={paso}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        disabled={!activo}
        onChange={(e) => alCambiar(Number(e.target.value))}
      />
    </label>
  );
}

function Elegir<T extends string>({
  etiqueta,
  ayuda,
  valor,
  opciones,
  traducir,
  alCambiar,
  activo,
}: {
  etiqueta: string;
  ayuda?: string;
  valor: string;
  opciones: readonly T[];
  traducir?: (v: T) => string;
  alCambiar: (v: T) => void;
  activo: boolean;
}) {
  return (
    <label className="studio-campo">
      <span>{etiqueta}</span>
      <select
        className="campo"
        value={valor}
        disabled={!activo}
        onChange={(e) => alCambiar(e.target.value as T)}
      >
        {opciones.map((o) => (
          <option key={o} value={o}>
            {traducir ? traducir(o) : o}
          </option>
        ))}
      </select>
      {ayuda && <small className="ayuda-campo">{ayuda}</small>}
    </label>
  );
}

/**
 * Color.
 *
 * El selector nativo no admite referencias a estilos compartidos (`@primario`),
 * así que al lado va el campo de texto: es lo que permite escribir la
 * referencia y que ese color cambie en todas las mesas a la vez cuando cambie
 * el de la marca.
 */
function Color({
  etiqueta,
  valor,
  alCambiar,
  activo,
}: {
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  activo: boolean;
}) {
  const esReferencia = valor.startsWith('@');

  return (
    <label className="studio-campo">
      <span>{etiqueta}</span>
      <span className="studio-color">
        <input
          type="color"
          value={esReferencia ? '#000000' : valor.slice(0, 7)}
          disabled={!activo}
          aria-label={etiqueta}
          onChange={(e) => alCambiar(e.target.value)}
        />
        <input
          className="campo"
          value={valor}
          disabled={!activo}
          aria-label={`${etiqueta} (valor)`}
          onChange={(e) => alCambiar(e.target.value)}
        />
      </span>
    </label>
  );
}

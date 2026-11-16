import { useCallback, useRef, useState } from 'react';
import type { Capa, Documento, Mesa, Recuadro } from '@ecom/shared';
import { MesaHTML } from '@/componentes/studio/render/capas';
import { ajustarConGuias, capasDe, TOLERANCIA, type Guia } from '@/lib/studio-edicion';
import type { FormatoServido } from '@/lib/studio';

/**
 * El lienzo.
 *
 * Lo que se ve es el SVG del documento —el mismo que se exporta— y, por encima,
 * una capa transparente que se lleva toda la interacción: selección, arrastre y
 * tiradores. Están separados a propósito. Si los adornos de edición vivieran
 * dentro del dibujo habría que acordarse de limpiarlos antes de cada
 * exportación, y ese es justo el tipo de detalle que un día se olvida y mete un
 * tirador azul en un banner publicado.
 */

type Esquina = 'nw' | 'ne' | 'sw' | 'se';

interface Arrastre {
  capaId: string;
  esquina?: Esquina;
  inicioX: number;
  inicioY: number;
  original: Recuadro;
}

export function Lienzo({
  documento,
  mesa,
  formato,
  activos,
  zoom,
  seleccion,
  alSeleccionar,
  alCambiar,
  mostrarZonaSegura = true,
}: {
  documento: Documento;
  mesa: Mesa;
  formato?: FormatoServido | undefined;
  activos: Record<string, string>;
  zoom: number;
  seleccion: string | null;
  alSeleccionar: (id: string | null) => void;
  /** `final` distingue el arrastre en curso del resultado que va al historial. */
  alCambiar: (id: string, cambios: Record<string, unknown>, final: boolean) => void;
  mostrarZonaSegura?: boolean;
}) {
  const arrastre = useRef<Arrastre | null>(null);
  const [guias, setGuias] = useState<Guia[]>([]);

  const capas = capasDe(documento, mesa.id);
  const ancho = mesa.ancho * zoom;
  const alto = mesa.alto * zoom;

  /*
   * Memoizados los tres, y no por rendimiento: el arrastre en curso vive en una
   * `ref`, y sin `useCallback` el compilador de React ve ese acceso dentro del
   * cuerpo del render —lo que sería un error de verdad— en lugar de dentro de un
   * manejador de eventos.
   */
  const empezar = useCallback(
    (e: React.PointerEvent, capa: Capa, esquina?: Esquina) => {
      if (capa.bloqueada) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      alSeleccionar(capa.id);
      arrastre.current = {
        capaId: capa.id,
        ...(esquina ? { esquina } : {}),
        inicioX: e.clientX,
        inicioY: e.clientY,
        original: capa.recuadro,
      };
    },
    [alSeleccionar],
  );

  const mover = useCallback(
    (e: React.PointerEvent) => {
      const a = arrastre.current;
      if (!a) return;

      // El desplazamiento se divide por el zoom: a 400 % el ratón recorre cuatro
      // píxeles de pantalla por cada píxel del documento, y sin esta división la
      // capa se iría cuatro veces más lejos que el cursor.
      const dx = (e.clientX - a.inicioX) / zoom;
      const dy = (e.clientY - a.inicioY) / zoom;
      const o = a.original;

      let recuadro: Recuadro;

      if (a.esquina) {
        const izquierda = a.esquina === 'nw' || a.esquina === 'sw';
        const arriba = a.esquina === 'nw' || a.esquina === 'ne';

        let anchoNuevo = Math.max(4, izquierda ? o.ancho - dx : o.ancho + dx);
        let altoNuevo = Math.max(4, arriba ? o.alto - dy : o.alto + dy);

        // Con Mayúsculas se conserva la proporción: es lo que se espera al
        // redimensionar una foto, y sin ello se deforma sin que se note hasta
        // que la pieza está montada.
        if (e.shiftKey) {
          const factor = Math.max(anchoNuevo / o.ancho, altoNuevo / o.alto);
          anchoNuevo = o.ancho * factor;
          altoNuevo = o.alto * factor;
        }

        recuadro = {
          ...o,
          ancho: Math.round(anchoNuevo),
          alto: Math.round(altoNuevo),
          x: Math.round(izquierda ? o.x + o.ancho - anchoNuevo : o.x),
          y: Math.round(arriba ? o.y + o.alto - altoNuevo : o.y),
        };
        setGuias([]);
      } else {
        const propuesto = { ...o, x: o.x + dx, y: o.y + dy };
        // Con Alt se desactiva el ajuste: hace falta para colocar algo a dos
        // píxeles de un borde, que es donde el imán trabaja en tu contra.
        if (e.altKey) {
          recuadro = { ...propuesto, x: Math.round(propuesto.x), y: Math.round(propuesto.y) };
          setGuias([]);
        } else {
          const r = ajustarConGuias(
            propuesto,
            mesa,
            capas.filter((c) => c.id !== a.capaId),
            TOLERANCIA / zoom,
          );
          recuadro = r.recuadro;
          setGuias(r.guias);
        }
      }

      alCambiar(a.capaId, { recuadro }, false);
    },
    [alCambiar, capas, mesa, zoom],
  );

  const soltar = useCallback(() => {
    const a = arrastre.current;
    arrastre.current = null;
    setGuias([]);
    // El commit al historial se hace aquí y no en cada movimiento: si no,
    // deshacer una vez retrocedería un píxel y haría falta pulsarlo cien veces
    // para volver al punto de partida.
    if (a) alCambiar(a.capaId, {}, true);
  }, [alCambiar]);

  const zona = mostrarZonaSegura ? formato?.zonaSegura : undefined;

  return (
    <div
      className="studio-lienzo"
      style={{ width: ancho, height: alto }}
      onPointerDown={() => alSeleccionar(null)}
      onPointerMove={mover}
      onPointerUp={soltar}
      onPointerCancel={soltar}
    >
      {/*
       * El documento se maqueta SIEMPRE a su tamaño real y se amplía con
       * `scale`. Pintarlo directamente al tamaño ampliado daría otro resultado:
       * a 200 % el navegador re-maqueta con los dobles, un texto que cabía en
       * dos líneas pasa a caber en una, y lo que se ve deja de ser lo que se
       * exporta.
       */}
      <div
        className="studio-lienzo-dibujo"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      >
        <MesaHTML mesa={mesa} documento={documento} activos={activos} />
      </div>

      {/*
       * Zona segura.
       *
       * Se pinta encima y no se explica en un texto de ayuda: en un vertical la
       * interfaz de la app tapa arriba y abajo, y es exactamente donde acaba el
       * precio si nadie lo ve mientras coloca.
       */}
      {zona && (
        <div
          className="studio-zona-segura"
          style={{
            top: (zona.arriba ?? 0) * zoom,
            bottom: (zona.abajo ?? 0) * zoom,
            left: (zona.izquierda ?? 0) * zoom,
            right: (zona.derecha ?? 0) * zoom,
          }}
          aria-hidden="true"
        />
      )}

      {/* Capa de interacción: en orden inverso, para que la de arriba se lleve
          el clic igual que se lleva el pintado. */}
      {[...capas].reverse().map((capa) => (
        <ZonaDeCapa
          key={capa.id}
          capa={capa}
          zoom={zoom}
          elegida={capa.id === seleccion}
          alEmpezar={empezar}
        />
      ))}

      {guias.map((g, i) => (
        <div
          key={i}
          className={`studio-guia studio-guia-${g.eje}`}
          style={g.eje === 'x' ? { left: g.posicion * zoom } : { top: g.posicion * zoom }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

/**
 * La zona sensible de una capa, con sus tiradores.
 *
 * Es un componente aparte y no un trozo del `map` de arriba porque el arrastre
 * vive en una `ref`: dentro de una función de mapeo, el compilador de React no
 * puede distinguir un acceso a la ref en el render de uno en un manejador, y
 * avisa. Aquí el manejador es del componente y no hay ambigüedad.
 */
function ZonaDeCapa({
  capa,
  zoom,
  elegida,
  alEmpezar,
}: {
  capa: Capa;
  zoom: number;
  elegida: boolean;
  alEmpezar: (e: React.PointerEvent, capa: Capa, esquina?: Esquina) => void;
}) {
  const r = capa.recuadro;

  return (
    <div
      className={`studio-capa-zona ${elegida ? 'studio-capa-elegida' : ''} ${capa.bloqueada ? 'studio-capa-bloqueada' : ''}`}
      style={{
        left: r.x * zoom,
        top: r.y * zoom,
        width: r.ancho * zoom,
        height: r.alto * zoom,
        transform: r.rotacion ? `rotate(${r.rotacion}deg)` : undefined,
      }}
      onPointerDown={(e) => alEmpezar(e, capa)}
    >
      {elegida &&
        !capa.bloqueada &&
        (['nw', 'ne', 'sw', 'se'] as const).map((esquina) => (
          <span
            key={esquina}
            className={`studio-tirador studio-tirador-${esquina}`}
            onPointerDown={(e) => alEmpezar(e, capa, esquina)}
          />
        ))}
    </div>
  );
}

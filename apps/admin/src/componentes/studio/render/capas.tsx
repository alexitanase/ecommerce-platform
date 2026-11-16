import type { Capa, Documento, Mesa } from '@ecom/shared';
import { resolverColor } from '@ecom/shared';
import {
  acotarCss,
  ALINEACION,
  cuerpoQueCabe,
  estiloBase,
  familiaDe,
  fondoCss,
  FUENTES,
  recorteDeForma,
  trazoCss,
  XMLNS_XHTML,
  type ContextoRender,
} from '@/componentes/studio/render/dibujo';

/**
 * El motor de dibujo del Studio: HTML y CSS.
 *
 * **Uno solo.** Dos implementaciones —una para la vista previa y otra para el
 * archivo final— acaban divergiendo siempre, y el síntoma es el peor posible:
 * el banner se ve bien mientras se edita y sale mal exportado. Aquí lo que se
 * pinta en pantalla es literalmente lo que se rasteriza al exportar, y lo mismo
 * servirá cuando el renderizado se haga en el servidor con Chromium.
 *
 * Empezó siendo SVG y se pasó a HTML por una razón de fondo: SVG no tiene motor
 * de maquetación. No hay flexbox, no hay `object-fit`, y el ajuste de línea del
 * texto había que escribirlo a mano. Con HTML todo eso lo pone el navegador, y
 * lo pone **mejor** de lo que se puede reimplementar. Lo que se perdía al
 * cambiar era la exportación —el navegador no sabe rasterizar un árbol de
 * `<div>`—, y eso lo resuelve envolverlo en un `<foreignObject>` (ver
 * `studio-exportar.tsx`).
 *
 * El documento no se enteró del cambio: no hay una línea de SVG ni de HTML en
 * su esquema.
 *
 * La interacción —selección, tiradores, arrastre— no vive aquí: va en una capa
 * aparte por encima. Mezclarlas obligaría a limpiar los adornos antes de cada
 * exportación, que es exactamente el tipo de detalle que un día se olvida y
 * mete un tirador azul en un banner publicado.
 */

// ── Capas ─────────────────────────────────────────────────

function CapaHTML({ capa, ctx }: { capa: Capa; ctx: ContextoRender }) {
  const { documento: doc, activos } = ctx;

  if (!capa.visible) return null;

  const base = estiloBase(capa, doc);

  switch (capa.tipo) {
    case 'forma': {
      const recorte = recorteDeForma(capa.forma, capa.puntas);
      return (
        <div
          style={{
            ...base,
            background: fondoCss(capa.relleno, doc, activos),
            borderRadius: capa.forma === 'elipse' ? '50%' : capa.radio,
            ...trazoCss(capa.trazo, doc),
            ...(capa.forma === 'linea'
              ? { height: capa.trazo?.grosor ?? 2, top: capa.recuadro.y + capa.recuadro.alto / 2 }
              : {}),
            ...(recorte ? { clipPath: recorte } : {}),
          }}
        />
      );
    }

    case 'texto': {
      const contenido = capa.contenido.es ?? Object.values(capa.contenido)[0] ?? '';
      const cuerpo = cuerpoQueCabe(capa, contenido);

      return (
        <div
          style={{
            ...base,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: ALINEACION[capa.alineacionVertical],
            alignItems: ALINEACION[capa.alineacion],
            textAlign:
              capa.alineacion === 'izquierda'
                ? 'left'
                : capa.alineacion === 'derecha'
                  ? 'right'
                  : 'center',
            fontFamily: familiaDe(capa.fuente),
            fontSize: cuerpo,
            fontWeight: capa.peso,
            lineHeight: capa.interlineado,
            letterSpacing: capa.espaciado || undefined,
            color: resolverColor(doc, capa.color),
            textTransform:
              capa.transformar === 'mayusculas'
                ? 'uppercase'
                : capa.transformar === 'minusculas'
                  ? 'lowercase'
                  : 'none',
            // Respeta los saltos de línea escritos a mano y deja que el resto lo
            // parta el navegador, que es lo que sabe hacerlo bien.
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            ...(capa.contorno
              ? {
                  WebkitTextStroke: `${capa.contorno.grosor}px ${resolverColor(doc, capa.contorno.color)}`,
                  paintOrder: 'stroke fill',
                }
              : {}),
          }}
        >
          {contenido}
        </div>
      );
    }

    case 'imagen': {
      const url = capa.activoId ? activos[capa.activoId] : undefined;
      if (!url) return <Hueco estilo={base} texto="Imagen" />;

      return (
        <div
          style={{
            ...base,
            borderRadius: capa.radio,
            overflow: 'hidden',
            ...trazoCss(capa.trazo, doc),
          }}
        >
          <img
            src={url}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
              objectFit:
                capa.ajuste === 'estirar'
                  ? 'fill'
                  : capa.ajuste === 'contener'
                    ? 'contain'
                    : 'cover',
              objectPosition: `${capa.foco.x * 100}% ${capa.foco.y * 100}%`,
              ...(capa.filtros
                ? {
                    filter: `brightness(${capa.filtros.brillo}) contrast(${capa.filtros.contraste}) saturate(${capa.filtros.saturacion})${capa.filtros.desenfoque ? ` blur(${capa.filtros.desenfoque}px)` : ''}`,
                  }
                : {}),
            }}
          />
        </div>
      );
    }

    case 'boton': {
      const texto = capa.texto.es ?? Object.values(capa.texto)[0] ?? '';
      return (
        <div
          style={{
            ...base,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            background: fondoCss(capa.relleno, doc, activos),
            borderRadius: capa.radio,
            color: resolverColor(doc, capa.color),
            fontFamily: familiaDe(capa.fuente),
            fontSize: capa.tamano,
            fontWeight: capa.peso,
            padding: '0 8px',
            boxSizing: 'border-box',
          }}
        >
          {texto}
        </div>
      );
    }

    case 'vector':
      return (
        <div
          style={{
            ...base,
            ...(capa.color ? { color: resolverColor(doc, capa.color), fill: 'currentColor' } : {}),
          }}
          dangerouslySetInnerHTML={{ __html: capa.svg }}
        />
      );

    case 'html':
      return (
        <div style={{ ...base, overflow: 'hidden' }} data-capa={capa.id}>
          {capa.css && <style dangerouslySetInnerHTML={{ __html: acotarCss(capa.css, capa.id) }} />}
          <div dangerouslySetInnerHTML={{ __html: capa.html }} />
        </div>
      );

    // Los tres que llegan en la fase B se dibujan como hueco identificado en
    // lugar de no dibujarse: un espacio en blanco parecería un fallo del editor,
    // y así se ve que la capa está y qué le falta para pintar.
    case 'producto':
      return <Hueco estilo={base} texto="Producto" />;
    case 'video':
      return <Hueco estilo={base} texto="Vídeo" />;
    case 'instancia':
      return <Hueco estilo={base} texto="Componente" />;

    case 'grupo':
      return null; // El grupo no pinta: pintan sus hijos, ya ordenados.
  }
}

function Hueco({ estilo, texto }: { estilo: React.CSSProperties; texto: string }) {
  const alto = typeof estilo.height === 'number' ? estilo.height : 40;

  return (
    <div
      style={{
        ...estilo,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(148,163,184,.25)',
        border: '1px dashed rgba(148,163,184,.7)',
        boxSizing: 'border-box',
        color: 'rgba(100,116,139,.9)',
        fontFamily: FUENTES['marca'],
        fontSize: Math.max(9, Math.min(14, alto / 4)),
      }}
    >
      {texto}
    </div>
  );
}

/**
 * Una mesa entera.
 *
 * Se maqueta siempre a su tamaño real y se amplía con `transform: scale`, no
 * recalculando medidas. Es lo que garantiza que el zoom no pueda introducir
 * diferencias entre lo que se ve y lo que se exporta: a cualquier aumento, el
 * documento se maqueta exactamente con los mismos números.
 */
export function MesaHTML({
  mesa,
  documento,
  activos,
  ...resto
}: {
  mesa: Mesa;
  documento: Documento;
  activos: Record<string, string>;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ctx: ContextoRender = { documento, activos };
  const capas = documento.capas
    .filter((c) => c.mesaId === mesa.id)
    .sort((a, b) => a.orden - b.orden);

  return (
    <div
      {...XMLNS_XHTML}
      style={{
        position: 'relative',
        width: mesa.ancho,
        height: mesa.alto,
        overflow: 'hidden',
        background: fondoCss(mesa.fondo, documento, activos),
      }}
      {...resto}
    >
      {capas.map((capa) => (
        <CapaHTML key={capa.id} capa={capa} ctx={ctx} />
      ))}
    </div>
  );
}

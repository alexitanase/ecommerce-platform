import {
  newId,
  type Capa,
  type Documento,
  type Mesa,
  type Recuadro,
  type TipoCapa,
} from '@ecom/shared';

/**
 * Operaciones de edición sobre un documento.
 *
 * Todas devuelven un documento nuevo en lugar de mutar el que reciben. No es
 * purismo: el historial de deshacer guarda referencias a los documentos
 * anteriores, y con mutación en sitio deshacer devolvería el mismo objeto ya
 * modificado —es decir, no desharía nada—.
 */

export const capasDe = (doc: Documento, mesaId: string): Capa[] =>
  doc.capas.filter((c) => c.mesaId === mesaId).sort((a, b) => a.orden - b.orden);

export const capaPorId = (doc: Documento, id: string): Capa | undefined =>
  doc.capas.find((c) => c.id === id);

/** Nombre por defecto de cada tipo, para que el árbol de capas se lea. */
const NOMBRES: Record<TipoCapa, string> = {
  texto: 'Texto',
  imagen: 'Imagen',
  forma: 'Forma',
  vector: 'Vector',
  boton: 'Botón',
  producto: 'Producto',
  video: 'Vídeo',
  html: 'Bloque HTML',
  grupo: 'Grupo',
  instancia: 'Componente',
};

/**
 * Capa nueva, con valores que se vean bien de entrada.
 *
 * Un texto de 12 px en un 1080×1920 es invisible y un rectángulo de 100×100 en
 * un 300×100 no cabe. Los tamaños salen de la mesa, no de constantes, para que
 * lo que se añade sea utilizable sin tocar cuatro campos primero.
 */
export function capaNueva(
  tipo: TipoCapa,
  mesa: Mesa,
  orden: number,
  extra: Record<string, unknown> = {},
): Capa {
  const base = {
    id: newId(),
    mesaId: mesa.id,
    orden,
    nombre: NOMBRES[tipo],
    visible: true,
    bloqueada: false,
    opacidad: 1,
    fusion: 'normal' as const,
    anclaje: { x: 'izquierda' as const, y: 'arriba' as const },
  };

  const margen = Math.round(Math.min(mesa.ancho, mesa.alto) * 0.06);
  const recuadro = (ancho: number, alto: number): Recuadro => ({
    x: Math.round((mesa.ancho - ancho) / 2),
    y: Math.round((mesa.alto - alto) / 2),
    ancho: Math.round(ancho),
    alto: Math.round(alto),
    rotacion: 0,
  });

  switch (tipo) {
    case 'texto': {
      const tamano = Math.max(10, Math.round(mesa.alto * 0.12));
      return {
        ...base,
        tipo: 'texto',
        recuadro: recuadro(mesa.ancho - margen * 2, tamano * 2.2),
        contenido: { es: 'Escribe aquí' },
        fuente: 'marca',
        peso: 700,
        tamano,
        interlineado: 1.15,
        espaciado: 0,
        alineacion: 'centro',
        alineacionVertical: 'centro',
        transformar: 'ninguna',
        color: '#111111',
        ajuste: 'encoger',
        ...extra,
      };
    }
    case 'forma':
      return {
        ...base,
        tipo: 'forma',
        recuadro: recuadro(mesa.ancho * 0.5, mesa.alto * 0.4),
        forma: 'rectangulo',
        relleno: { tipo: 'solido', color: '#e11d48' },
        radio: 0,
        puntas: 5,
        ...extra,
      };
    case 'imagen':
      return {
        ...base,
        tipo: 'imagen',
        recuadro: recuadro(mesa.ancho * 0.6, mesa.alto * 0.6),
        activoId: '',
        ajuste: 'cubrir',
        foco: { x: 0.5, y: 0.5 },
        radio: 0,
        ...extra,
      };
    case 'html':
      return {
        ...base,
        tipo: 'html',
        // Ocupa la mesa entera y anclado a los cuatro bordes: un bloque de HTML
        // se trae para que ocupe la pieza, y así al llevarlo a otro formato se
        // estira en vez de quedarse en una esquina.
        recuadro: { x: 0, y: 0, ancho: mesa.ancho, alto: mesa.alto, rotacion: 0 },
        anclaje: { x: 'estirar', y: 'estirar' },
        html: '<div style="display:flex;align-items:center;justify-content:center;height:100%">Pega aquí tu HTML</div>',
        css: '',
        ...extra,
      };

    case 'boton': {
      const alto = Math.max(24, Math.round(mesa.alto * 0.18));
      return {
        ...base,
        tipo: 'boton',
        recuadro: recuadro(Math.min(mesa.ancho - margen * 2, alto * 5), alto),
        texto: { es: 'Comprar' },
        relleno: { tipo: 'solido', color: '#e11d48' },
        color: '#ffffff',
        radio: Math.round(alto / 4),
        tamano: Math.max(9, Math.round(alto * 0.42)),
        fuente: 'marca',
        peso: 700,
        ...extra,
      };
    }
    default:
      return {
        ...base,
        tipo: 'forma',
        recuadro: recuadro(mesa.ancho * 0.4, mesa.alto * 0.4),
        forma: 'rectangulo',
        relleno: { tipo: 'solido', color: '#94a3b8' },
        radio: 0,
        puntas: 5,
        ...extra,
      };
  }
}

export const anadirCapa = (doc: Documento, capa: Capa): Documento => ({
  ...doc,
  capas: [...doc.capas, capa],
});

export function actualizarCapa(
  doc: Documento,
  id: string,
  cambios: Record<string, unknown>,
): Documento {
  return {
    ...doc,
    capas: doc.capas.map((c) => (c.id === id ? { ...c, ...cambios } : c)),
  };
}

export const borrarCapa = (doc: Documento, id: string): Documento => ({
  ...doc,
  // Se van también las que estuvieran dentro, o quedarían capas huérfanas que
  // el documento no sabe pintar y que solo dan la cara al exportar.
  capas: doc.capas.filter((c) => c.id !== id && c.padreId !== id),
});

export function duplicarCapa(doc: Documento, id: string): { doc: Documento; nuevaId: string } {
  const original = capaPorId(doc, id);
  if (!original) return { doc, nuevaId: id };

  const copia = {
    ...original,
    id: newId(),
    nombre: `${original.nombre} copia`,
    orden: original.orden + 1,
    // Desplazada, o la copia quedaría exactamente encima y parecería que no ha
    // pasado nada.
    recuadro: { ...original.recuadro, x: original.recuadro.x + 12, y: original.recuadro.y + 12 },
    // La copia nace sin enlace: es una capa nueva, no la hermana de otra mesa.
    enlace: undefined,
  } as Capa;

  return { doc: anadirCapa(doc, copia), nuevaId: copia.id };
}

/** Sube o baja una capa en el orden de pintado. */
export function moverEnOrden(doc: Documento, id: string, direccion: -1 | 1): Documento {
  const capa = capaPorId(doc, id);
  if (!capa) return doc;

  const hermanas = capasDe(doc, capa.mesaId);
  const i = hermanas.findIndex((c) => c.id === id);
  const j = i + direccion;
  if (i < 0 || j < 0 || j >= hermanas.length) return doc;

  const orden = new Map(hermanas.map((c, k) => [c.id, k]));
  orden.set(hermanas[i]!.id, j);
  orden.set(hermanas[j]!.id, i);

  return {
    ...doc,
    capas: doc.capas.map((c) => (orden.has(c.id) ? { ...c, orden: orden.get(c.id)! } : c)),
  };
}

export const siguienteOrden = (doc: Documento, mesaId: string): number =>
  capasDe(doc, mesaId).length;

// ── Guías y ajuste magnético ──────────────────────────────

/** A cuántos píxeles de pantalla salta el ajuste. */
export const TOLERANCIA = 6;

export interface Guia {
  eje: 'x' | 'y';
  posicion: number;
}

/**
 * Ajusta un recuadro a los bordes y centros de la mesa y de las demás capas.
 *
 * Es la diferencia entre alinear a ojo y alinear. Sin esto, dos textos que
 * deberían compartir margen acaban con dos píxeles de diferencia que no se ven
 * en pantalla y sí se ven en el banner exportado, uno al lado del otro.
 *
 * La tolerancia se recibe ya convertida a coordenadas del documento: a zoom
 * 400 % un salto de seis píxeles de pantalla es píxel y medio del documento, y
 * usar la misma cifra en los dos sitios haría el ajuste inservible al ampliar.
 */
export function ajustarConGuias(
  recuadro: Recuadro,
  mesa: Mesa,
  otras: Capa[],
  tolerancia: number,
): { recuadro: Recuadro; guias: Guia[] } {
  const candidatosX = [0, mesa.ancho / 2, mesa.ancho];
  const candidatosY = [0, mesa.alto / 2, mesa.alto];

  for (const o of otras) {
    candidatosX.push(
      o.recuadro.x,
      o.recuadro.x + o.recuadro.ancho / 2,
      o.recuadro.x + o.recuadro.ancho,
    );
    candidatosY.push(
      o.recuadro.y,
      o.recuadro.y + o.recuadro.alto / 2,
      o.recuadro.y + o.recuadro.alto,
    );
  }

  const guias: Guia[] = [];
  let { x, y } = recuadro;

  const bordesX = [x, x + recuadro.ancho / 2, x + recuadro.ancho];
  let mejorX: { d: number; destino: number; borde: number } | null = null;
  for (const destino of candidatosX) {
    for (const borde of bordesX) {
      const d = Math.abs(destino - borde);
      if (d <= tolerancia && (!mejorX || d < mejorX.d)) mejorX = { d, destino, borde };
    }
  }
  if (mejorX) {
    x += mejorX.destino - mejorX.borde;
    guias.push({ eje: 'x', posicion: mejorX.destino });
  }

  const bordesY = [y, y + recuadro.alto / 2, y + recuadro.alto];
  let mejorY: { d: number; destino: number; borde: number } | null = null;
  for (const destino of candidatosY) {
    for (const borde of bordesY) {
      const d = Math.abs(destino - borde);
      if (d <= tolerancia && (!mejorY || d < mejorY.d)) mejorY = { d, destino, borde };
    }
  }
  if (mejorY) {
    y += mejorY.destino - mejorY.borde;
    guias.push({ eje: 'y', posicion: mejorY.destino });
  }

  return { recuadro: { ...recuadro, x: redondear(x), y: redondear(y) }, guias };
}

const redondear = (n: number) => Math.round(n * 100) / 100;

// ── Alinear y distribuir ──────────────────────────────────

export type Alineacion = 'izquierda' | 'centro-h' | 'derecha' | 'arriba' | 'centro-v' | 'abajo';

/** Alinea una capa respecto a su mesa. */
export function alinear(doc: Documento, id: string, mesa: Mesa, como: Alineacion): Documento {
  const capa = capaPorId(doc, id);
  if (!capa) return doc;
  const r = capa.recuadro;

  const nuevo: Recuadro = { ...r };
  if (como === 'izquierda') nuevo.x = 0;
  if (como === 'centro-h') nuevo.x = Math.round((mesa.ancho - r.ancho) / 2);
  if (como === 'derecha') nuevo.x = mesa.ancho - r.ancho;
  if (como === 'arriba') nuevo.y = 0;
  if (como === 'centro-v') nuevo.y = Math.round((mesa.alto - r.alto) / 2);
  if (como === 'abajo') nuevo.y = mesa.alto - r.alto;

  return actualizarCapa(doc, id, { recuadro: nuevo });
}

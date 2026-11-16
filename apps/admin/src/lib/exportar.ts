/**
 * Exportar lo que hay en pantalla: CSV, PNG y PDF.
 *
 * Se exporta **la vista**, con sus filtros aplicados, no «todo». Un botón de
 * exportar que ignora el filtro devuelve un fichero que no se parece a lo que
 * se estaba mirando, y quien lo abre da por hecho que el panel se equivoca.
 *
 * Las tres salidas se generan en el navegador y sin dependencias nuevas: los
 * datos ya están cargados, así que pedirlos otra vez al servidor solo añade
 * espera y una segunda versión de la verdad.
 */

/** Separador que espera Excel en configuración regional española. */
const SEPARADOR = ';';
/** Marca de orden de bytes: sin ella Excel lee el fichero como Latin-1. */
const BOM = '﻿';

function escapar(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 19).replace('T', ' ');

  /*
   * Un objeto puesto tal cual sale como «[object Object]»: no es un error
   * visible, es una columna entera de basura que solo se descubre al abrir el
   * fichero. Se serializa en JSON, que al menos conserva el dato.
   */
  const texto =
    typeof valor === 'string' ||
    typeof valor === 'number' ||
    typeof valor === 'boolean' ||
    typeof valor === 'bigint'
      ? String(valor)
      : JSON.stringify(valor);

  return /["\n\r;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function descargar(contenido: Blob, nombre: string) {
  const url = URL.createObjectURL(contenido);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  // Sin revocar, cada exportación deja el fichero entero retenido en memoria.
  URL.revokeObjectURL(url);
}

export interface ColumnaExport<T> {
  clave: string;
  titulo: string;
  valor: (fila: T) => unknown;
}

/** Nombre con la fecha dentro: tres exportaciones seguidas no pueden llamarse igual. */
export function nombreFichero(base: string, extension: string): string {
  const ahora = new Date();
  const sello = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(
    ahora.getDate(),
  ).padStart(2, '0')}-${String(ahora.getHours()).padStart(2, '0')}${String(
    ahora.getMinutes(),
  ).padStart(2, '0')}`;
  return `${base}-${sello}.${extension}`;
}

export function exportarCsv<T>(nombre: string, filas: T[], columnas: ColumnaExport<T>[]): void {
  const cabecera = columnas.map((c) => escapar(c.titulo)).join(SEPARADOR);
  const cuerpo = filas.map((f) => columnas.map((c) => escapar(c.valor(f))).join(SEPARADOR));
  const csv = BOM + [cabecera, ...cuerpo].join('\r\n');

  descargar(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), nombreFichero(nombre, 'csv'));
}

/**
 * PNG de un gráfico.
 *
 * Los gráficos son SVG, así que se serializan y se pintan en un canvas. Se
 * fija el fondo del tema en vez de dejarlo transparente: un PNG transparente
 * pegado en un documento con fondo blanco pierde todo el texto claro del tema
 * oscuro.
 */
export async function exportarPng(svg: SVGSVGElement, nombre: string): Promise<void> {
  const caja = svg.getBoundingClientRect();
  const ancho = Math.max(caja.width, 320);
  const alto = Math.max(caja.height, 200);
  const escala = 2; // Para que no se vea borroso en pantallas de densidad alta.

  const copia = svg.cloneNode(true) as SVGSVGElement;
  copia.setAttribute('width', String(ancho));
  copia.setAttribute('height', String(alto));
  copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Los colores vienen de variables CSS que no existen fuera del documento:
  // se resuelven ahora, o el PNG sale en negro sobre negro.
  const estilos = getComputedStyle(document.documentElement);
  const fondo = estilos.getPropertyValue('--fondo-panel').trim() || '#ffffff';

  const fuente = new XMLSerializer().serializeToString(copia);
  const imagen = new Image();
  imagen.crossOrigin = 'anonymous';

  await new Promise<void>((resolver, rechazar) => {
    imagen.onload = () => resolver();
    imagen.onerror = () => rechazar(new Error('No se ha podido convertir el gráfico'));
    imagen.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fuente)}`;
  });

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho * escala;
  lienzo.height = alto * escala;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('El navegador no ha dado contexto de canvas');

  ctx.scale(escala, escala);
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(imagen, 0, 0, ancho, alto);

  await new Promise<void>((resolver) => {
    lienzo.toBlob((blob) => {
      if (blob) descargar(blob, nombreFichero(nombre, 'png'));
      resolver();
    }, 'image/png');
  });
}

/**
 * PDF de la vista.
 *
 * Se usa la impresión del navegador («Guardar como PDF») en lugar de meter una
 * librería de PDF de 300 kB en el paquete. A cambio hay que preparar la página:
 * se marca lo que se quiere imprimir y la hoja de estilos de impresión oculta
 * el resto, para que no salga el menú lateral ni la cabecera pegajosa.
 */
export function exportarPdf(elemento: HTMLElement): void {
  const marca = 'imprimiendo';
  elemento.setAttribute('data-imprimir', 'true');
  document.body.classList.add(marca);

  const limpiar = () => {
    elemento.removeAttribute('data-imprimir');
    document.body.classList.remove(marca);
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);

  window.print();
}

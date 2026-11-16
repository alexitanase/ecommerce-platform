import type { Documento } from '@ecom/shared';
import { del, get, patch, post, put } from '@/lib/api';

/**
 * Cliente del Studio.
 *
 * Los tipos se declaran aquí y no en cada pantalla porque los comparten cuatro:
 * la lista de campañas, la ficha, el editor y la biblioteca. El documento en sí
 * NO se redeclara —viene de `@ecom/shared`, el mismo esquema que valida la API y
 * que usará el renderizador del servidor—: una copia local sería la primera
 * cosa que se desincroniza.
 */

export type EstadoCampana = 'BORRADOR' | 'ACTIVA' | 'PAUSADA' | 'ARCHIVADA';
export type EstadoCreatividad = 'BORRADOR' | 'EN_REVISION' | 'APROBADA' | 'PUBLICADA' | 'ARCHIVADA';

export interface Campana {
  id: string;
  name: string;
  slug: string;
  objective: string;
  channel: string;
  canal: string;
  status: EstadoCampana;
  brief: string | null;
  audience: string | null;
  locales: string[];
  landingUrl: string | null;
  budgetCents: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  startsAt: string | null;
  endsAt: string | null;
  creatividades: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatividadResumen {
  id: string;
  campaignId: string;
  name: string;
  kind: string;
  format: string;
  locale: string;
  status: EstadoCreatividad;
  utmContent: string;
  currentVersion: number;
  variantOfId: string | null;
  updatedAt: string;
  /**
   * El enlace marcado, ya montado.
   *
   * Solo viene en la ficha de la campaña, que es donde se copia para pegarlo en
   * el panel de la red. Lo compone el servidor a propósito: la sintaxis del
   * marcaje vive en un solo sitio y un `utm_` mal escrito no da ningún error,
   * simplemente deja esa pieza fuera del informe.
   */
  enlace?: string | null;
}

export interface CampanaConPiezas extends Omit<Campana, 'creatividades'> {
  marcaje: { fuente: string; medio?: string; campana?: string; contenido?: string };
  /** Cada pieza con su documento vigente, para pintar la vista previa. */
  creatividades: (CreatividadResumen & { documento: Documento | null })[];
}

export interface Creatividad extends CreatividadResumen {
  documento: Documento | null;
  enlace: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  campaign: {
    id: string;
    name: string;
    slug: string;
    channel: string;
    brief: string | null;
    audience: string | null;
    locales: string[];
    landingUrl: string | null;
  };
}

export interface VersionCreatividad {
  id: string;
  version: number;
  label: string | null;
  authorId: string | null;
  authorModel: string | null;
  prompt: string | null;
  parentVersion: number | null;
  createdAt: string;
}

export interface Activo {
  id: string;
  kind: 'IMAGEN' | 'VIDEO' | 'AUDIO' | 'VECTOR';
  name: string;
  url: string;
  storageKey: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  blurhash: string | null;
  source: 'SUBIDA' | 'IA' | 'CATALOGO' | 'PROVEEDOR';
  productId: string | null;
  model: string | null;
  prompt: string | null;
  tags: string[];
  createdAt: string;
}

/** La ficha de un formato tal y como la sirve la API, con su aviso de revisión. */
export interface FormatoServido {
  clave: string;
  red: string;
  familia: string;
  nombre: string;
  ancho: number;
  alto: number;
  tipos: string[];
  pesoMaxKb: number;
  pesoMaxVideoKb?: number;
  duracionMaxS?: number;
  buclesMax?: number;
  textos?: { titulo?: number; descripcion?: number; marca?: number };
  zonaSegura?: { arriba?: number; abajo?: number; izquierda?: number; derecha?: number };
  fuente: 'oficial' | 'terceros' | 'convencion' | 'propio';
  revisado: string;
  notas?: string;
  revisionCaducada: boolean;
}

export interface CatalogoFormatos {
  redes: Record<string, string>;
  formatos: FormatoServido[];
}

// ── Llamadas ──────────────────────────────────────────────

export const listarFormatos = () => get<CatalogoFormatos>('/studio/formatos');

export const listarCampanas = (filtros: Record<string, string> = {}) => {
  const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
  return get<Campana[]>(`/studio/campanas${q.size ? `?${q.toString()}` : ''}`);
};

export const verCampana = (id: string) => get<CampanaConPiezas>(`/studio/campanas/${id}`);
export const crearCampana = (datos: Record<string, unknown>) =>
  post<Campana>('/studio/campanas', datos);
export const editarCampana = (id: string, datos: Record<string, unknown>) =>
  patch<Campana>(`/studio/campanas/${id}`, datos);
export const archivarCampana = (id: string) => del(`/studio/campanas/${id}`);

export const verCreatividad = (id: string) => get<Creatividad>(`/studio/creatividades/${id}`);
export const crearCreatividad = (datos: Record<string, unknown>) =>
  post<CreatividadResumen>('/studio/creatividades', datos);

/**
 * Guarda el documento.
 *
 * `versionEsperada` es la versión que se abrió. Si el servidor tiene otra
 * devuelve un 409 y quien edita se entera antes de seguir trabajando sobre algo
 * que va a perder.
 */
export const guardarDocumento = (
  id: string,
  documento: Documento,
  versionEsperada: number,
  etiqueta?: string,
) =>
  put<{ version: number; reabierta: boolean }>(`/studio/creatividades/${id}/documento`, {
    documento,
    versionEsperada,
    ...(etiqueta ? { etiqueta } : {}),
  });

export const versionesDe = (id: string) =>
  get<VersionCreatividad[]>(`/studio/creatividades/${id}/versiones`);
export const restaurarVersion = (id: string, version: number) =>
  post<{ version: number }>(`/studio/creatividades/${id}/versiones/${version}/restaurar`);

export const cambiarEstadoCreatividad = (
  id: string,
  paso: 'revision' | 'devolver' | 'aprobar' | 'publicar',
  motivo?: string,
) => post<CreatividadResumen>(`/studio/creatividades/${id}/${paso}`, motivo ? { motivo } : {});

export const archivarCreatividad = (id: string) => del(`/studio/creatividades/${id}`);
export const crearVariante = (id: string, datos: Record<string, unknown> = {}) =>
  post<CreatividadResumen>(`/studio/creatividades/${id}/variantes`, datos);

export const listarActivos = (filtros: Record<string, string> = {}) => {
  const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
  return get<Activo[]>(`/studio/activos${q.size ? `?${q.toString()}` : ''}`);
};
export const renombrarActivo = (id: string, datos: Record<string, unknown>) =>
  patch<Activo>(`/studio/activos/${id}`, datos);
export const retirarActivo = (id: string) => del(`/studio/activos/${id}`);

// ── Presentación ──────────────────────────────────────────

export const TONO_ESTADO: Record<EstadoCreatividad, 'neutro' | 'info' | 'aviso' | 'exito'> = {
  BORRADOR: 'neutro',
  EN_REVISION: 'aviso',
  APROBADA: 'info',
  PUBLICADA: 'exito',
  ARCHIVADA: 'neutro',
};

export const TONO_CAMPANA: Record<EstadoCampana, 'neutro' | 'info' | 'aviso' | 'exito'> = {
  BORRADOR: 'info',
  ACTIVA: 'exito',
  PAUSADA: 'aviso',
  ARCHIVADA: 'neutro',
};

/**
 * Copia al portapapeles y dice si pudo.
 *
 * Con respaldo por si el navegador no da permiso —o si el panel se abre sin
 * HTTPS en una máquina de pruebas, donde la API moderna no existe—: peor que no
 * copiar es un botón que parece que copia y no copia.
 */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const campo = document.createElement('textarea');
      campo.value = texto;
      campo.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(campo);
      campo.select();
      const hecho = document.execCommand('copy');
      campo.remove();
      return hecho;
    } catch {
      return false;
    }
  }
}

/** Peso legible: 148 KB, 1,5 MB. */
export function pesoLegible(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

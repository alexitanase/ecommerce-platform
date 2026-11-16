import { documentoSchema } from '@ecom/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Entradas del Studio.
 *
 * El documento se valida con el MISMO esquema que usa el editor para pintarlo y
 * el renderizador para exportarlo. Aceptar aquí un JSON cualquiera dejaría
 * pasar documentos que revientan al renderizar, y eso se descubre en la cola de
 * exportación de madrugada, no al guardar.
 */

const clave = z
  .string()
  .trim()
  .max(60)
  .regex(/^[a-z0-9._-]*$/, 'Solo minúsculas, números, punto, guion y guion bajo');

export const objetivoCampana = z.enum(['venta', 'captacion', 'retargeting', 'marca']);
export const estadoCampana = z.enum(['BORRADOR', 'ACTIVA', 'PAUSADA', 'ARCHIVADA']);
export const estadoCreatividad = z.enum([
  'BORRADOR',
  'EN_REVISION',
  'APROBADA',
  'PUBLICADA',
  'ARCHIVADA',
]);
export const tipoCreatividad = z.enum([
  'banner',
  'social',
  'short',
  'nativo',
  'push',
  'correo',
  'captacion',
]);

// ── Campañas ──────────────────────────────────────────────

/**
 * Los campos de una campaña, **sin valores por defecto**.
 *
 * Los defectos se ponen solo al crear. Es una separación que parece
 * quisquillosa y no lo es: `.partial()` deja los campos opcionales pero **no**
 * quita los `.default()`, así que un esquema de edición derivado del de
 * creación rellena solo lo que no se manda. En una edición eso no significa «no
 * tocar»: significa escribir el valor por defecto encima.
 *
 * Costó un idioma. Al guardar solo un cambio de estado, la campaña pasó de
 * `es / ca` a `es` sin que nadie tocara los idiomas y sin ningún error por
 * ninguna parte: el DTO recibía `locales: ['es']` de un `default` y el servicio
 * lo guardaba como si lo hubiera pedido alguien.
 */
const camposCampana = {
  name: z.string().trim().min(2).max(120),
  objective: objetivoCampana,
  /** Clave del catálogo de canales: organico, newsletter, exoclick… */
  channel: clave.min(2),
  brief: z.string().trim().max(4000),
  audience: z.string().trim().max(500),
  locales: z
    .array(z.enum(['es', 'ca', 'en']))
    .min(1)
    .max(3),
  landingUrl: z.url('Tiene que ser una dirección completa, con https://'),
  budgetCents: z.number().int().min(0).max(100_000_000),
  utmSource: clave,
  utmMedium: clave,
  utmCampaign: clave,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
};

export const crearCampanaSchema = z.object({
  ...camposCampana,
  objective: camposCampana.objective.default('venta'),
  locales: camposCampana.locales.default(['es']),
  brief: camposCampana.brief.optional(),
  audience: camposCampana.audience.optional(),
  landingUrl: camposCampana.landingUrl.optional(),
  budgetCents: camposCampana.budgetCents.optional(),
  utmSource: camposCampana.utmSource.optional(),
  utmMedium: camposCampana.utmMedium.optional(),
  utmCampaign: camposCampana.utmCampaign.optional(),
  startsAt: camposCampana.startsAt.optional(),
  endsAt: camposCampana.endsAt.optional(),
});

export class CrearCampanaDto extends createZodDto(crearCampanaSchema) {}

/** Todo opcional y sin defectos: lo que no se manda, no se toca. */
export const actualizarCampanaSchema = z
  .object({ ...camposCampana, status: estadoCampana })
  .partial();

export class ActualizarCampanaDto extends createZodDto(actualizarCampanaSchema) {}

export const listarCampanasSchema = z.object({
  estado: estadoCampana.optional(),
  canal: clave.optional(),
  texto: z.string().trim().max(120).optional(),
});

export class ListarCampanasDto extends createZodDto(listarCampanasSchema) {}

// ── Creatividades ─────────────────────────────────────────

/**
 * Una pieza nace de un formato del catálogo **o** de un tamaño a medida.
 *
 * Lo segundo hace falta más de lo que parece: una cabecera para un sitio
 * concreto o una prueba rápida no son ningún formato de red, y obligar a elegir
 * uno lleva a coger el que menos desentone y trabajar con el peso máximo
 * equivocado. Sin ficha de red no hay peso que validar, y eso es correcto.
 */
export const crearCreatividadSchema = z
  .object({
    campaignId: z.string().min(1).max(40),
    name: z.string().trim().min(2).max(120),
    kind: tipoCreatividad.default('banner'),
    /** Clave del catálogo de formatos: 'exoclick.display.300x250'. */
    format: z
      .string()
      .trim()
      .min(3)
      .max(60)
      .regex(/^[a-z0-9.]+x?[a-z0-9.]*$/i, 'Formato desconocido')
      .optional(),
    /** Medidas cuando es a medida. Los topes son los de la mesa del documento. */
    ancho: z.number().int().min(16).max(8000).optional(),
    alto: z.number().int().min(16).max(8000).optional(),
    locale: z.enum(['es', 'ca', 'en']).default('es'),
    /** Plantilla de la que partir, si se parte de una. */
    templateId: z.string().min(1).max(40).optional(),
  })
  .refine((d) => Boolean(d.format) || (d.ancho !== undefined && d.alto !== undefined), {
    message: 'Elige un formato del catálogo o indica ancho y alto.',
    path: ['format'],
  });

export class CrearCreatividadDto extends createZodDto(crearCreatividadSchema) {}

export const listarCreatividadesSchema = z.object({
  campaignId: z.string().min(1).max(40).optional(),
  estado: estadoCreatividad.optional(),
  formato: z.string().trim().max(60).optional(),
});

export class ListarCreatividadesDto extends createZodDto(listarCreatividadesSchema) {}

/**
 * Guardado del documento con control de concurrencia.
 *
 * `versionEsperada` es la versión que tenía el documento cuando se abrió. Si en
 * el servidor hay otra, alguien guardó por medio y se devuelve un conflicto en
 * vez de pisarlo. No hay edición simultánea, pero sí dos pestañas abiertas, que
 * es lo que pasa de verdad y lo que hace perder media hora de trabajo sin que
 * nadie se entere.
 */
export const guardarDocumentoSchema = z.object({
  documento: documentoSchema,
  versionEsperada: z.number().int().min(0),
  /** Nombre del hito, si se guarda a propósito. */
  etiqueta: z.string().trim().max(80).optional(),
});

export class GuardarDocumentoDto extends createZodDto(guardarDocumentoSchema) {}

/**
 * Por qué se aprueba, se rechaza o se archiva. Queda en la auditoría.
 *
 * El cuerpo entero es opcional —`default({})`— porque estas rutas son acciones
 * y lo normal es invocarlas sin datos. Sin el valor por defecto, un POST sin
 * cuerpo lo rechaza la validación con «Los datos enviados no son válidos», que
 * no dice nada y convierte los botones de aprobar y publicar en botones
 * muertos. Es el mismo tropiezo que ya hubo con el `Content-Type` del panel.
 */
export const motivoSchema = z
  .object({
    motivo: z.string().trim().max(500).optional(),
  })
  .default({});

export class MotivoDto extends createZodDto(motivoSchema) {}

export const crearVarianteSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  /** Qué se cambia respecto a la original; solo para dejarlo escrito. */
  hipotesis: z.string().trim().max(500).optional(),
});

export class CrearVarianteDto extends createZodDto(crearVarianteSchema) {}

// ── Activos ───────────────────────────────────────────────

export const listarActivosSchema = z.object({
  tipo: z.enum(['IMAGEN', 'VIDEO', 'AUDIO', 'VECTOR']).optional(),
  origen: z.enum(['SUBIDA', 'IA', 'CATALOGO', 'PROVEEDOR']).optional(),
  texto: z.string().trim().max(120).optional(),
  productId: z.string().trim().max(40).optional(),
});

export class ListarActivosDto extends createZodDto(listarActivosSchema) {}

export const actualizarActivoSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export class ActualizarActivoDto extends createZodDto(actualizarActivoSchema) {}

/** Un activo traído del catálogo, para poder usar la foto de un producto. */
export const importarDelCatalogoSchema = z.object({
  mediaId: z.string().min(1).max(40),
});

export class ImportarDelCatalogoDto extends createZodDto(importarDelCatalogoSchema) {}

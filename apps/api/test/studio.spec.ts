import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Documento } from '@ecom/shared';
import { crearEntorno, vaciarBase, type EntornoPruebas, type ErrorApi } from './entorno.js';

/**
 * El Studio, de punta a punta.
 *
 * Lo que se comprueba aquí es lo que no se ve con lógica pura: que el marcaje
 * de cada pieza sea único de verdad contra la base, que dos pestañas editando
 * no se pisen, y que el ciclo de aprobación no se pueda saltar. Las tres cosas
 * fallan en silencio si están mal —marcaje repetido mezcla las ventas de dos
 * banners, un guardado pisado se pierde sin avisar, y una pieza publicada sin
 * revisar acaba corriendo en una red de anuncios—.
 */

let entorno: EntornoPruebas;

interface Campana {
  id: string;
  slug: string;
  status: string;
}

interface Creatividad {
  id: string;
  status: string;
  utmContent: string;
  currentVersion: number;
}

interface CreatividadCompleta extends Creatividad {
  documento: Documento;
  enlace: string | null;
  format: string;
}

async function crearCampana(token: string, nombre = 'Rebajas de verano') {
  const r = await entorno.peticion<Campana>({
    metodo: 'POST',
    ruta: '/api/v1/studio/campanas',
    token,
    cuerpo: {
      name: nombre,
      channel: 'exoclick',
      landingUrl: 'https://chispaynoche.com/rebajas',
    },
  });
  expect(r.estado).toBe(201);
  return r.datos;
}

async function crearCreatividad(token: string, campaignId: string, name = 'Banner principal') {
  const r = await entorno.peticion<Creatividad>({
    metodo: 'POST',
    ruta: '/api/v1/studio/creatividades',
    token,
    cuerpo: { campaignId, name, format: 'exoclick.display.300x250' },
  });
  expect(r.estado).toBe(201);
  return r.datos;
}

const abrir = (token: string, id: string) =>
  entorno.peticion<CreatividadCompleta>({
    metodo: 'GET',
    ruta: `/api/v1/studio/creatividades/${id}`,
    token,
  });

const guardar = (token: string, id: string, documento: Documento, versionEsperada: number) =>
  entorno.peticion<{ version: number; reabierta: boolean } & ErrorApi>({
    metodo: 'PUT',
    ruta: `/api/v1/studio/creatividades/${id}/documento`,
    token,
    cuerpo: { documento, versionEsperada },
  });

beforeAll(async () => {
  entorno = await crearEntorno();
});

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
});

describe('Crear campañas y piezas', () => {
  it('la pieza nace con su documento y su marcaje', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);
    const pieza = await crearCreatividad(token, campana.id);

    expect(pieza.status).toBe('BORRADOR');
    expect(pieza.currentVersion).toBe(1);
    expect(pieza.utmContent).toMatch(/^banner-principal-[a-z0-9]{6}$/);

    const abierta = await abrir(token, pieza.id);
    expect(abierta.datos.documento.mesas[0]?.ancho).toBe(300);
    expect(abierta.datos.documento.mesas[0]?.alto).toBe(250);
    expect(abierta.datos.enlace).toContain(`utm_content=${pieza.utmContent}`);
  });

  /*
   * El marcaje repetido es peor que no medir: mezcla las ventas de dos piezas
   * y da una lectura falsa con aspecto de buena.
   */
  it('dos piezas con el mismo nombre no comparten marcaje', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);

    const una = await crearCreatividad(token, campana.id);
    const otra = await crearCreatividad(token, campana.id);

    expect(una.utmContent).not.toBe(otra.utmContent);
  });

  it('dos campañas con el mismo nombre no comparten slug', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);

    const una = await crearCampana(token);
    const otra = await crearCampana(token);

    expect(una.slug).toBe('rebajas-de-verano');
    expect(otra.slug).toBe('rebajas-de-verano-2');
  });

  it('acepta un tamaño a medida, sin ficha de red detrás', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);

    const r = await entorno.peticion<Creatividad>({
      metodo: 'POST',
      ruta: '/api/v1/studio/creatividades',
      token,
      cuerpo: { campaignId: campana.id, name: 'Cabecera del blog', ancho: 970, alto: 300 },
    });
    expect(r.estado).toBe(201);

    const abierta = await abrir(token, r.datos.id);
    expect(abierta.datos.documento.mesas[0]?.ancho).toBe(970);
    expect(abierta.datos.documento.mesas[0]?.alto).toBe(300);
    expect(abierta.datos.format).toBe('personalizado.970x300');
  });

  it('sin formato ni medidas no se crea nada', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);

    const r = await entorno.peticion<ErrorApi>({
      metodo: 'POST',
      ruta: '/api/v1/studio/creatividades',
      token,
      cuerpo: { campaignId: campana.id, name: 'Sin nada' },
    });

    expect(r.estado).toBe(400);
  });

  /*
   * El enlace se monta en el servidor y viaja ya hecho: es lo que se copia de
   * un botón para pegarlo en el panel de la red, y componerlo en el navegador
   * significaría dos sitios donde equivocarse con la sintaxis del marcaje.
   */
  it('la lista de la campaña trae el enlace de cada pieza', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);
    const pieza = await crearCreatividad(token, campana.id);

    const r = await entorno.peticion<{ creatividades: { enlace: string | null }[] }>({
      metodo: 'GET',
      ruta: `/api/v1/studio/campanas/${campana.id}`,
      token,
    });

    expect(r.datos.creatividades[0]?.enlace).toContain(`utm_content=${pieza.utmContent}`);
    expect(r.datos.creatividades[0]?.enlace).toContain('utm_source=exoclick');
  });

  it('un formato que no está en el catálogo se rechaza con un mensaje útil', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);

    const r = await entorno.peticion<ErrorApi>({
      metodo: 'POST',
      ruta: '/api/v1/studio/creatividades',
      token,
      cuerpo: { campaignId: campana.id, name: 'Mala', format: 'exoclick.display.1x1' },
    });

    expect(r.estado).toBe(400);
    expect(r.datos.message).toContain('no está en el catálogo');
  });
});

describe('Editar una campaña', () => {
  it('cambia el estado', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);

    const r = await entorno.peticion<Campana>({
      metodo: 'PATCH',
      ruta: `/api/v1/studio/campanas/${campana.id}`,
      token,
      cuerpo: { status: 'ACTIVA' },
    });

    expect(r.estado).toBe(200);
    expect(r.datos.status).toBe('ACTIVA');
  });

  /*
   * El fallo que esto vigila no da ningún error y se lleva datos por delante:
   * `.partial()` deja los campos opcionales pero NO quita los `.default()`, así
   * que un esquema de edición derivado del de creación rellena solo lo que no
   * se manda. Editar el estado devolvía los idiomas de la campaña a «solo es».
   */
  it('lo que no se manda no se toca', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);

    const creada = await entorno.peticion<Campana & { locales: string[]; objective: string }>({
      metodo: 'POST',
      ruta: '/api/v1/studio/campanas',
      token,
      cuerpo: {
        name: 'Con dos idiomas',
        channel: 'exoclick',
        objective: 'captacion',
        locales: ['es', 'ca'],
      },
    });
    expect(creada.datos.locales).toEqual(['es', 'ca']);

    const editada = await entorno.peticion<Campana & { locales: string[]; objective: string }>({
      metodo: 'PATCH',
      ruta: `/api/v1/studio/campanas/${creada.datos.id}`,
      token,
      cuerpo: { status: 'ACTIVA' },
    });

    expect(editada.datos.locales).toEqual(['es', 'ca']);
    expect(editada.datos.objective).toBe('captacion');
  });

  it('rechaza un canal que no está en el catálogo', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);

    const r = await entorno.peticion<ErrorApi>({
      metodo: 'PATCH',
      ruta: `/api/v1/studio/campanas/${campana.id}`,
      token,
      cuerpo: { channel: 'una-red-inventada' },
    });

    expect(r.estado).toBe(400);
    expect(r.datos.message).toContain('no está en el catálogo');
  });
});

describe('Guardar el documento', () => {
  it('cada guardado deja una versión nueva', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);
    const pieza = await crearCreatividad(token, campana.id);
    const abierta = await abrir(token, pieza.id);

    const guardada = await guardar(token, pieza.id, abierta.datos.documento, 1);
    expect(guardada.datos.version).toBe(2);

    const versiones = await entorno.peticion<{ version: number }[]>({
      metodo: 'GET',
      ruta: `/api/v1/studio/creatividades/${pieza.id}/versiones`,
      token,
    });
    expect(versiones.datos.map((v) => v.version)).toEqual([2, 1]);
  });

  /*
   * El caso que de verdad importa: no hay edición simultánea, pero sí dos
   * pestañas abiertas. Sin este control, la segunda pisa a la primera y media
   * hora de retoques desaparece sin que nada avise.
   */
  it('guardar desde una versión vieja da conflicto en vez de pisar', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);
    const pieza = await crearCreatividad(token, campana.id);
    const abierta = await abrir(token, pieza.id);

    await guardar(token, pieza.id, abierta.datos.documento, 1);
    const segunda = await guardar(token, pieza.id, abierta.datos.documento, 1);

    expect(segunda.estado).toBe(409);
    expect(segunda.datos.message).toContain('Abre la última');
  });

  it('recuperar una versión anterior no borra las de en medio', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);
    const pieza = await crearCreatividad(token, campana.id);
    const abierta = await abrir(token, pieza.id);

    await guardar(token, pieza.id, abierta.datos.documento, 1);

    const recuperada = await entorno.peticion<{ version: number }>({
      metodo: 'POST',
      ruta: `/api/v1/studio/creatividades/${pieza.id}/versiones/1/restaurar`,
      token,
    });

    expect(recuperada.datos.version).toBe(3);
  });
});

describe('Aprobación', () => {
  it('no se publica sin pasar por aprobada', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write', 'studio:publish']);
    const campana = await crearCampana(token);
    const pieza = await crearCreatividad(token, campana.id);

    const r = await entorno.peticion<ErrorApi>({
      metodo: 'POST',
      ruta: `/api/v1/studio/creatividades/${pieza.id}/publicar`,
      token,
    });

    expect(r.estado).toBe(400);
    expect(r.datos.message).toContain('revisarla alguien');
  });

  /*
   * Quien diseña propone; aprobar es una decisión del negocio. Sin esta
   * separación, dar el Studio a alguien de fuera significa dejarle publicar en
   * una red de anuncios lo que quiera.
   */
  it('quien solo diseña no puede aprobar', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(token);
    const pieza = await crearCreatividad(token, campana.id);

    await entorno.peticion({
      metodo: 'POST',
      ruta: `/api/v1/studio/creatividades/${pieza.id}/revision`,
      token,
    });

    const r = await entorno.peticion<ErrorApi>({
      metodo: 'POST',
      ruta: `/api/v1/studio/creatividades/${pieza.id}/aprobar`,
      token,
    });

    expect(r.estado).toBe(403);
  });

  it('editar algo aprobado lo devuelve a borrador', async () => {
    const { token } = await entorno.personal(['studio:read', 'studio:write', 'studio:publish']);
    const campana = await crearCampana(token);
    const pieza = await crearCreatividad(token, campana.id);

    for (const paso of ['revision', 'aprobar']) {
      await entorno.peticion({
        metodo: 'POST',
        ruta: `/api/v1/studio/creatividades/${pieza.id}/${paso}`,
        token,
      });
    }

    const abierta = await abrir(token, pieza.id);
    expect(abierta.datos.status).toBe('APROBADA');

    const guardada = await guardar(
      token,
      pieza.id,
      abierta.datos.documento,
      abierta.datos.currentVersion,
    );
    expect(guardada.datos.reabierta).toBe(true);

    const despues = await abrir(token, pieza.id);
    expect(despues.datos.status).toBe('BORRADOR');
  });
});

describe('Permisos', () => {
  it('sin studio:write se puede mirar pero no crear', async () => {
    const { token: escritor } = await entorno.personal(['studio:read', 'studio:write']);
    const campana = await crearCampana(escritor);

    const { token: lector } = await entorno.personal(['studio:read']);

    const lectura = await entorno.peticion({
      metodo: 'GET',
      ruta: `/api/v1/studio/campanas/${campana.id}`,
      token: lector,
    });
    expect(lectura.estado).toBe(200);

    const escritura = await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/studio/creatividades',
      token: lector,
      cuerpo: { campaignId: campana.id, name: 'Otra', format: 'exoclick.display.300x250' },
    });
    expect(escritura.estado).toBe(403);
  });

  it('sin studio:read no se entra al catálogo de formatos', async () => {
    const { token } = await entorno.personal(['products:read']);

    const r = await entorno.peticion({
      metodo: 'GET',
      ruta: '/api/v1/studio/formatos',
      token,
    });

    expect(r.estado).toBe(403);
  });
});

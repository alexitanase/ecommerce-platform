import { expect, test, type Page } from '@playwright/test';

/**
 * La ficha de producto.
 *
 * Lo que se comprueba aquí no es maquetación: es que el precio que se lee sea el
 * que se va a cobrar. En un producto importado de AliExpress con once colores,
 * los precios van de 18,99 € a 54,99 €, y la ficha enseñaba SIEMPRE el más
 * barato en grande mientras el botón de comprar decía otro. Eso no es un detalle
 * estético —es anunciar un precio que no se cobra— y no lo detecta ninguna
 * prueba unitaria, porque el precio grande lo pinta el servidor y el del botón
 * el navegador.
 *
 * Las pruebas descubren el producto sobre el que trabajar en lugar de fijar un
 * slug: el catálogo de desarrollo lo va cambiando quien prueba cosas, y una
 * prueba atada a «botas-de-cuero» se convierte en una prueba que hay que
 * arreglar cada vez.
 */

const API = process.env['E2E_API'] ?? 'http://localhost:3001';

interface Valor {
  id: string;
  value: string;
  labels: Record<string, string> | null;
}

interface Ficha {
  handle: string;
  options: { id: string; key: string; esEnvio: boolean; values: Valor[] }[];
  variants: {
    id: string;
    priceCents: number;
    stock: number;
    optionValues: { optionValue: Valor }[];
    entrega: { minDias: number; maxDias: number; estimado: boolean; origen: string | null } | null;
  }[];
  translations: { locale: string; slug: string }[];
}

const euros = (centimos: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(centimos / 100);

/** Los slugs publicados, según la propia tienda. */
async function slugsPublicados(page: Page): Promise<string[]> {
  const respuesta = await page.request.get(`${API}/api/v1/search?limite=20`);
  expect(respuesta.ok(), 'el buscador de la tienda debe responder').toBeTruthy();
  const { hits } = (await respuesta.json()) as { hits: { slug: string }[] };
  return hits.map((h) => h.slug);
}

async function ficha(page: Page, slug: string): Promise<Ficha | null> {
  const r = await page.request.get(`${API}/api/v1/catalog/products/by-slug/es/${slug}`);
  return r.ok() ? ((await r.json()) as Ficha) : null;
}

/**
 * Un producto donde cambiar UNA opción cambia el precio.
 *
 * Es el caso que se quiere probar y no todos los productos lo cumplen. Se busca
 * en el catálogo real en lugar de crear datos: crear un producto con variantes,
 * fotos y opciones desde la prueba son quince llamadas que se rompen en cuanto
 * cambia un DTO, y lo que hay que comprobar es el comportamiento de la ficha, no
 * el importador.
 */
async function productoConPreciosDistintos(page: Page): Promise<{
  slug: string;
  datos: Ficha;
  /** Etiqueta del botón que hay que pulsar. */
  etiqueta: string;
  precioInicial: number;
  precioDestino: number;
} | null> {
  for (const slug of await slugsPublicados(page)) {
    const datos = await ficha(page, slug);
    if (!datos) continue;

    // La misma regla que aplican la tienda y el servidor: la primera con stock.
    const inicial = datos.variants.find((v) => v.stock > 0) ?? datos.variants[0];
    if (!inicial) continue;

    const valoresDe = (v: Ficha['variants'][number]) =>
      new Set(v.optionValues.map((ov) => ov.optionValue.id));
    const suyos = valoresDe(inicial);

    for (const otra of datos.variants) {
      if (otra.id === inicial.id || otra.priceCents === inicial.priceCents || otra.stock <= 0) {
        continue;
      }

      // Solo sirve si se llega pulsando UN botón: dos cambios a la vez no se
      // pueden hacer en un clic y la prueba mediría un estado intermedio.
      const distintos = [...valoresDe(otra)].filter((id) => !suyos.has(id));
      if (distintos.length !== 1) continue;

      const idValor = distintos[0];
      const valor = datos.options
        .filter((o) => !o.esEnvio)
        .flatMap((o) => o.values)
        .find((v) => v.id === idValor);
      if (!valor) continue;

      return {
        slug,
        datos,
        etiqueta: valor.labels?.['es'] ?? valor.value,
        precioInicial: inicial.priceCents,
        precioDestino: otra.priceCents,
      };
    }
  }

  return null;
}

async function abrir(page: Page, slug: string): Promise<void> {
  await page.goto(`/es/producto/${slug}`);
  // La opción más respetuosa del aviso de cookies, que además tapa el botón de
  // comprar en el móvil.
  await page
    .getByRole('button', { name: 'Rechazar todas' })
    .click({ timeout: 5_000 })
    .catch(() => null);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
}

test.describe('Ficha de producto', () => {
  test('el precio grande sigue a la variante elegida', async ({ page }) => {
    const caso = await productoConPreciosDistintos(page);
    expect(
      caso,
      'no hay ningún producto publicado con dos variantes de precio distinto: sin eso esta prueba no comprueba nada',
    ).not.toBeNull();
    if (!caso) return;

    await abrir(page, caso.slug);

    const grande = page.locator('[data-prueba="precio-ficha"]');
    const boton = page.getByRole('button', { name: /carrito/i }).first();

    // De salida, el precio grande es el de la variante preseleccionada y no el
    // «desde» del producto.
    await expect(grande).toHaveText(euros(caso.precioInicial));

    await page.getByRole('button', { name: caso.etiqueta, exact: true }).first().click();

    await expect(grande).toHaveText(euros(caso.precioDestino));
    // Y lo que dice el botón coincide: es la contradicción que se quiere evitar.
    await expect(boton).toContainText(euros(caso.precioDestino));
  });

  test('el rótulo sobre la foto dice qué variante se está mirando', async ({ page }) => {
    const caso = await productoConPreciosDistintos(page);
    if (!caso) return;

    await abrir(page, caso.slug);

    const rotulo = page.locator('[data-prueba="rotulo-variante"]');
    await expect(rotulo).toBeVisible();
    const antes = await rotulo.textContent();

    await page.getByRole('button', { name: caso.etiqueta, exact: true }).first().click();

    await expect(rotulo).toHaveText(new RegExp(caso.etiqueta, 'i'));
    expect(await rotulo.textContent()).not.toBe(antes);

    // El país de origen no entra en el rótulo: describe el artículo, no el envío.
    const envio = caso.datos.options.find((o) => o.esEnvio);
    if (envio?.values[0]) {
      expect(await rotulo.textContent()).not.toContain(envio.values[0].value);
    }
  });

  test('la ficha dice cuándo llega y desde dónde sale', async ({ page }) => {
    /*
     * `anunciados` no es un adorno.
     *
     * La comprobación tiene dos ramas —con plazo se enseña, sin plazo no— y sin
     * este contador un catálogo donde ningún producto tuviera plazo pasaría la
     * prueba sin haber mirado el bloque ni una vez.
     */
    let anunciados = 0;

    for (const slug of await slugsPublicados(page)) {
      const datos = await ficha(page, slug);
      const primera = datos?.variants.find((v) => v.stock > 0) ?? datos?.variants[0];
      if (!datos || !primera) continue;

      await abrir(page, slug);
      const bloque = page.locator('[data-prueba="entrega"]');

      if (!primera.entrega) {
        // Sin plazo no se promete ninguna fecha: es lo contrario de un fallo.
        await expect(bloque).toHaveCount(0);
        continue;
      }

      anunciados += 1;
      await expect(bloque).toBeVisible();
      // Una fecha, no un «tarda entre 12 y 22 días»: el cliente quiere saber si
      // llega antes del fin de semana.
      await expect(bloque).toContainText(/\d{1,2}\s+de\s+\w+/);

      if (primera.entrega.origen) {
        await expect(bloque).toContainText(/Env[íi]o desde/i);
      }
      if (primera.entrega.estimado) {
        // Estimado y dicho: el plazo lo calculamos nosotros por el país de
        // origen, y anunciarlo como firme sería prometer lo que nadie ha dicho.
        await expect(bloque).toContainText(/estimada/i);
      }

      // La opción de origen con un solo valor no se pinta como un botón más:
      // era una pastilla que decía «China Mainland» y no informaba de nada.
      const envio = datos.options.find((o) => o.esEnvio);
      if (envio && envio.values.length === 1 && envio.values[0]) {
        await expect(
          page.getByRole('button', { name: envio.values[0].value, exact: true }),
        ).toHaveCount(0);
      }
    }

    expect(
      anunciados,
      'ningún producto del catálogo anuncia plazo de entrega: la prueba no ha comprobado el bloque',
    ).toBeGreaterThan(0);
  });

  test('los valores de cada opción salen del más barato al más caro', async ({ page }) => {
    /*
     * El orden que trae el proveedor no significa nada: es el que tenía en su
     * ficha. En el catálogo real eso ponía el color de 54,99 € delante del de
     * 18,99 €, y la tarjeta del catálogo anunciaba «desde 18,99 €».
     *
     * Se comprueba contra el precio MÍNIMO de cada valor, que es el criterio: un
     * color que existe en dos tallas cuesta lo que la más barata de las dos.
     *
     * AVISO sobre su alcance: esta prueba **no discrimina si el catálogo ya viene
     * ordenado**. Comprobado quitando el arreglo con el catálogo de desarrollo:
     * pasa igual, porque ahí los valores ya salían de menor a mayor por
     * casualidad. Sirve como red para el catálogo real —donde el orden del
     * proveedor no tiene nada que ver con el precio— y quien prueba de verdad la
     * regla son las pruebas unitarias de `valoresPorPrecio`.
     */
    let comprobadas = 0;

    for (const slug of await slugsPublicados(page)) {
      const datos = await ficha(page, slug);
      if (!datos || datos.options.length === 0) continue;

      const minimos = new Map<string, number>();
      for (const v of datos.variants) {
        for (const { optionValue } of v.optionValues) {
          const actual = minimos.get(optionValue.id);
          if (actual === undefined || v.priceCents < actual)
            minimos.set(optionValue.id, v.priceCents);
        }
      }

      // Solo interesan las opciones cuyos valores cuestan cosas distintas: donde
      // todos valen igual, el orden correcto es el de siempre y no prueba nada.
      const conVariedad = datos.options.filter(
        (o) => !o.esEnvio && new Set(o.values.map((v) => minimos.get(v.id))).size > 1,
      );
      if (conVariedad.length === 0) continue;

      await abrir(page, slug);

      for (const opcion of conVariedad) {
        const nombre =
          opcion.values.length > 0
            ? (opcion.values[0]?.labels?.['es'] ?? opcion.values[0]?.value)
            : '';
        const campo = page
          .locator('fieldset')
          .filter({ has: page.getByRole('button', { name: nombre ?? '' }) })
          .first();
        const pintados = await campo.getByRole('button').allInnerTexts();

        const precios = pintados.map((texto) => {
          const valor = opcion.values.find(
            (v) => (v.labels?.['es'] ?? v.value).trim() === texto.trim(),
          );
          return valor ? (minimos.get(valor.id) ?? Number.POSITIVE_INFINITY) : Number.NaN;
        });

        // Ninguno cuesta menos que el anterior.
        const ordenados = [...precios].sort((a, b) => a - b);
        expect(precios, `los valores de ${opcion.key} no van de menor a mayor precio`).toEqual(
          ordenados,
        );
        comprobadas += 1;
      }
    }

    expect(
      comprobadas,
      'ningún producto tiene una opción con precios distintos: la prueba no ha comprobado el orden',
    ).toBeGreaterThan(0);
  });

  test('la ficha pública no publica el coste ni el margen del proveedor', async ({ page }) => {
    /*
     * Esto era una fuga real, comprobada en producción con un `curl`: la ficha
     * pública devolvía el objeto entero del panel, con lo que cuesta el artículo
     * en AliExpress, el margen calculado y el identificador del producto en el
     * proveedor. Con eso se replica el catálogo o se publica el margen.
     *
     * Se comprueba sobre el JSON en crudo y no sobre campos concretos: lo que
     * importa es que la cadena no aparezca por ninguna vía.
     */
    const slugs = await slugsPublicados(page);
    expect(slugs.length, 'hace falta al menos un producto publicado').toBeGreaterThan(0);

    for (const slug of slugs) {
      const respuesta = await page.request.get(`${API}/api/v1/catalog/products/by-slug/es/${slug}`);
      if (!respuesta.ok()) continue;

      const crudo = await respuesta.text();
      const datos = JSON.parse(crudo) as Record<string, unknown> & {
        variants: Record<string, unknown>[];
      };

      expect(datos, `${slug} publica los proveedores`).not.toHaveProperty('proveedores');
      for (const prohibido of [
        'margenPorcentaje',
        'costeTotalCents',
        'supplierKey',
        'externalProductId',
      ]) {
        expect(crudo, `${slug} publica ${prohibido}`).not.toContain(prohibido);
      }
      for (const v of datos.variants) {
        expect(v, `${slug} publica el coste de una variante`).not.toHaveProperty('costCents');
      }
    }
  });
});

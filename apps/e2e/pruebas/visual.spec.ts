import { expect, test, type Page } from '@playwright/test';

/**
 * Regresión visual.
 *
 * Compara cada pantalla con una captura de referencia. Detecta lo que ninguna
 * otra prueba ve: un margen que descuadra media portada, un color que cambia al
 * tocar un token, una tarjeta que se rompe al añadir un campo. Cosas que no dan
 * error, no fallan ningún assert y llegan a producción porque nadie volvió a
 * mirar esa página.
 *
 * **Solo se ejecuta dentro del contenedor** (`pnpm e2e:visual`). La tienda usa
 * la tipografía del sistema, así que fuera de él las capturas no coinciden ni
 * con la página intacta. Ver el README.
 *
 * Cada pantalla se captura en claro y en oscuro: son dos paletas distintas, no
 * una inversión, y una se rompe sin que la otra se entere.
 */

/** Lo que cambia entre ejecuciones y no es una regresión. */
async function estabilizar(page: Page): Promise<void> {
  // Las fotos vienen del proveedor y de un CDN: una que tarde de más deja un
  // hueco gris y falla la comparación por algo que no es nuestro.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      /* El cursor parpadeante de un campo enfocado cambia de fotograma. */
      * { caret-color: transparent !important; }
      /*
       * El indicador de las herramientas de Next, fuera.
       *
       * En desarrollo Next pinta una pastilla flotante abajo a la izquierda con
       * el número de avisos que lleva acumulados el servidor. Eso no es la
       * tienda: cambia según lo que se haya visitado antes —y este mismo
       * estabilizador provoca uno, porque el estilo entra antes de que React
       * termine de hidratar y el aviso de hidratación se cuenta— así que la
       * misma página daba capturas distintas según el momento. Era el único
       * fallo que aparecía y desaparecía solo en toda la suite.
       */
      nextjs-portal { display: none !important; }
    `,
  });

  await page.evaluate(() => document.fonts.ready);
  // Las imágenes perezosas solo cargan al entrar en pantalla.
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map((img) => new Promise((listo) => img.addEventListener('load', listo, { once: true }))),
    );
  });
}

/**
 * Tolerancia de las capturas de página completa.
 *
 * Llevan mucho más texto que un recorte, y el antialiasing del texto es el
 * único ruido real entre ejecuciones. El resto —cabecera, tarjeta— se queda
 * con el valor estricto de la configuración.
 */
const TOLERANCIA_PAGINA = { maxDiffPixels: 2500 };

const PAGINAS = [
  { nombre: 'portada', ruta: '/es' },
  { nombre: 'catalogo', ruta: '/es/buscar' },
  { nombre: 'carrito-vacio', ruta: '/es/carrito' },
];

test.describe('Regresión visual', () => {
  for (const { nombre, ruta } of PAGINAS) {
    for (const tema of ['light', 'dark'] as const) {
      test(`${nombre} · tema ${tema === 'light' ? 'claro' : 'oscuro'}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: tema });
        await page.goto(ruta);
        await expect(page.locator('main')).toBeVisible();
        await estabilizar(page);

        await expect(page).toHaveScreenshot(`${nombre}-${tema}.png`, {
          fullPage: true,
          // Las fotos de producto vienen del proveedor y cambian al
          // resincronizar el catálogo: se tapan para que la comparación sea
          // sobre la maqueta, que es lo que se quiere vigilar.
          mask: [page.locator('img')],
          ...TOLERANCIA_PAGINA,
        });
      });
    }
  }

  test('tarjeta de producto · claro y oscuro', async ({ page }) => {
    // El componente que más se repite en la tienda: si se descuadra, se
    // descuadran el catálogo, la portada y los resultados de búsqueda a la vez.
    for (const tema of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: tema });
      await page.goto('/es/buscar');
      await estabilizar(page);

      const tarjeta = page.locator('a[href*="/es/producto/"]').first();
      await expect(tarjeta).toBeVisible();

      await expect(tarjeta).toHaveScreenshot(`tarjeta-producto-${tema}.png`, {
        mask: [tarjeta.locator('img')],
      });
    }
  });

  test('cabecera con buscador · claro y oscuro', async ({ page }) => {
    // Sale en todas las páginas: un fallo aquí se ve en toda la tienda.
    for (const tema of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: tema });
      await page.goto('/es');
      await estabilizar(page);

      await expect(page.locator('header').first()).toHaveScreenshot(`cabecera-${tema}.png`, {
        mask: [page.locator('header img')],
      });
    }
  });

  /*
   * Las mismas pantallas en móvil.
   *
   * No es redundante con las de escritorio: en la tienda, móvil no es la
   * versión estrecha de escritorio, es donde se compra. La cabecera reordena
   * el buscador a su propia fila, el checkout pasa a una columna y las
   * tarjetas cambian de rejilla — tres cosas que se rompen por su cuenta y que
   * ninguna captura de 1280 px llega a ver.
   *
   * 360 px es el ancho real de un móvil de gama media, no el del iPhone de
   * quien programa.
   */
  test.describe('En móvil', () => {
    test.use({ viewport: { width: 360, height: 780 } });

    for (const { nombre, ruta } of PAGINAS) {
      test(`${nombre} · móvil`, async ({ page }) => {
        await page.goto(ruta);
        await expect(page.locator('main')).toBeVisible();
        await estabilizar(page);

        await expect(page).toHaveScreenshot(`${nombre}-movil.png`, {
          fullPage: true,
          mask: [page.locator('img')],
          ...TOLERANCIA_PAGINA,
        });
      });
    }
  });
});

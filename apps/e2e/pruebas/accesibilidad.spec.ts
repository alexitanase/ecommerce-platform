import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Auditoría de accesibilidad automatizada.
 *
 * No es una casilla que marcar: la tienda vende al público en España, y el
 * Real Decreto 193/2023 y la EN 301 549 exigen WCAG 2.1 AA. Una tienda que no
 * se puede usar con teclado o con lector de pantalla deja fuera a clientes y
 * expone a sanción.
 *
 * Lo que axe detecta —contraste insuficiente, campos sin etiqueta, imágenes sin
 * texto alternativo, encabezados desordenados— es aproximadamente el 40 % de
 * los problemas reales, pero es el 40 % que se cuela sin querer y que nadie ve
 * hasta que alguien lo sufre. El resto (orden de foco, sentido del texto
 * alternativo) sigue necesitando una persona.
 *
 * **Las páginas se auditan en claro Y en oscuro.** El tema oscuro no es una
 * inversión de colores: tiene su propia paleta, y un contraste que cumple en
 * uno puede fallar en el otro. Ya pasó en este proyecto.
 */

/** Las páginas que un cliente recorre para comprar. */
const PAGINAS = [
  { nombre: 'portada', ruta: '/es' },
  { nombre: 'catálogo', ruta: '/es/buscar' },
  { nombre: 'carrito', ruta: '/es/carrito' },
  { nombre: 'lista de deseos', ruta: '/es/deseos' },
  { nombre: 'preferencias', ruta: '/es/preferencias' },
  // Formularios: es donde más falla la accesibilidad y donde más caro sale.
  // Aquí se detectó que la ayuda de la contraseña, metida dentro de la
  // etiqueta, pasaba a formar parte del nombre del campo.
  { nombre: 'entrar', ruta: '/es/entrar' },
  { nombre: 'registro', ruta: '/es/registro' },
];

/**
 * Fija el tema sin depender de la preferencia del sistema.
 *
 * Se pone antes de cargar la página: hacerlo después provoca un parpadeo y, en
 * la primera pintura, axe mediría los colores del tema anterior.
 */
async function conTema(page: Page, tema: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: tema });
}

/**
 * Analiza la página y devuelve las infracciones legibles.
 *
 * Se limita a WCAG 2.1 nivel A y AA porque es lo exigible por ley; las reglas
 * "best-practice" de axe son recomendaciones y meterlas en un test que bloquea
 * el merge acaba en que alguien lo desactiva entero.
 */
async function auditar(page: Page): Promise<string[]> {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  return resultado.violations.map((v) => {
    // El selector del primer elemento afectado: sin él, "contraste
    // insuficiente" obliga a buscar a mano por toda la página.
    const donde = v.nodes[0]?.target.join(' ') ?? '?';
    return `${v.id} (${v.impact ?? 'sin impacto'}) en «${donde}» — ${v.help}`;
  });
}

test.describe('Accesibilidad de la tienda', () => {
  // Solo en escritorio: axe analiza el DOM y las reglas no cambian con el
  // tamaño de pantalla, así que repetirlo en móvil dobla el tiempo sin
  // encontrar nada nuevo. Lo que sí es propio del móvil —desbordes, áreas de
  // pulsación— está en `movil.spec.ts`.
  test.skip(({ isMobile }) => isMobile, 'La auditoría se hace una vez, en escritorio');

  for (const { nombre, ruta } of PAGINAS) {
    for (const tema of ['light', 'dark'] as const) {
      test(`la ${nombre} cumple WCAG AA en tema ${tema === 'light' ? 'claro' : 'oscuro'}`, async ({
        page,
      }) => {
        await conTema(page, tema);
        await page.goto(ruta);
        await expect(page.locator('main')).toBeVisible();

        const infracciones = await auditar(page);

        expect(infracciones, infracciones.join('\n')).toEqual([]);
      });
    }
  }

  test('la ficha de producto cumple WCAG AA', async ({ page }) => {
    // Es la página que más se visita y la que más contenido variable tiene:
    // fotos del proveedor, descripciones traducidas, selector de variantes.
    await page.goto('/es');
    await page.locator('a[href*="/es/producto/"]').first().click();
    await expect(page.locator('main')).toBeVisible();

    const infracciones = await auditar(page);

    expect(infracciones, infracciones.join('\n')).toEqual([]);
  });

  test('el checkout cumple WCAG AA con el carrito lleno', async ({ page }) => {
    // El formulario donde se pierde una venta si algo no se puede rellenar.
    // Vacío no sirve de nada: los errores de etiquetado salen con los campos
    // pintados y el resumen del pedido cargado.
    await page.goto('/es');
    await page.locator('a[href*="/es/producto/"]').first().click();
    await page.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.goto('/es/checkout');
    await expect(page.getByRole('button', { name: /Pagar/ })).toBeVisible();

    const infracciones = await auditar(page);

    expect(infracciones, infracciones.join('\n')).toEqual([]);
  });

  test('se puede llegar al carrito solo con el teclado', async ({ page }) => {
    // axe no comprueba esto: mide el DOM, no el recorrido. Un enlace alcanzable
    // por tabulador es la diferencia entre poder comprar y no poder.
    await page.goto('/es');
    await expect(page.locator('main')).toBeVisible();

    let alcanzado = false;
    for (let i = 0; i < 40 && !alcanzado; i++) {
      await page.keyboard.press('Tab');
      const destino = await page.evaluate(
        () => (document.activeElement as HTMLAnchorElement | null)?.getAttribute('href') ?? '',
      );
      if (destino.includes('/carrito')) alcanzado = true;
    }

    expect(alcanzado, 'El carrito no se alcanza con el tabulador en 40 saltos').toBe(true);
  });

  test('el foco se ve siempre que se tabula', async ({ page }) => {
    // Un `outline: none` sin sustituto deja a quien navega con teclado sin
    // saber dónde está. Es de los fallos más fáciles de introducir con CSS.
    await page.goto('/es');
    await page.keyboard.press('Tab');

    const visible = await page.evaluate(() => {
      const activo = document.activeElement;
      if (!activo || activo === document.body) return false;

      const estilo = getComputedStyle(activo);
      const conContorno = estilo.outlineStyle !== 'none' && parseFloat(estilo.outlineWidth) > 0;
      const conSombra = estilo.boxShadow !== 'none';
      return conContorno || conSombra;
    });

    expect(visible, 'El elemento enfocado no muestra ninguna marca visible').toBe(true);
  });
});

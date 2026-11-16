import crypto from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { necesitaCuerpoCrudo, registrarCuerpoCrudo } from './cuerpo-crudo.js';

/**
 * Lo que se protege aquí es la verificación de firma de los webhooks de pago.
 *
 * Si el cuerpo crudo se pierde, la API verifica contra el JSON reserializado y
 * **ninguna** notificación de Revolut cuadra: los pagos con tarjeta se quedan
 * todos sin confirmar y el fallo no aparece hasta producción, porque en
 * desarrollo los webhooks no llegan.
 */

/** Servidor mínimo con el hook puesto, que devuelve lo que ha guardado. */
async function servidor() {
  const app = Fastify();
  registrarCuerpoCrudo(app);

  app.post('/api/v1/payments/webhook/:pasarela', (peticion, respuesta) =>
    respuesta.send({ crudo: peticion.cuerpoCrudo ?? null, parseado: peticion.body ?? null }),
  );
  app.post('/api/v1/orders', (peticion, respuesta) =>
    respuesta.send({ crudo: peticion.cuerpoCrudo ?? null, parseado: peticion.body ?? null }),
  );

  await app.ready();
  return app;
}

/** El mismo servidor sin el hook, para comparar comportamientos. */
async function servidorSinHook() {
  const app = Fastify();

  app.post('/api/v1/payments/webhook/:pasarela', (peticion, respuesta) =>
    respuesta.send({ crudo: peticion.cuerpoCrudo ?? null, parseado: peticion.body ?? null }),
  );
  app.post('/api/v1/orders', (peticion, respuesta) =>
    respuesta.send({ crudo: peticion.cuerpoCrudo ?? null, parseado: peticion.body ?? null }),
  );

  await app.ready();
  return app;
}

describe('Rutas que necesitan el cuerpo crudo', () => {
  it('reconoce los webhooks de pasarelas y proveedores', () => {
    expect(necesitaCuerpoCrudo('/api/v1/payments/webhook/revolut')).toBe(true);
    expect(necesitaCuerpoCrudo('/api/v1/suppliers/webhook/aliexpress')).toBe(true);
  });

  it('no se lo guarda al resto', () => {
    // Duplicar en memoria cada cuerpo que entra, con el límite de 10 MB
    // configurado, es un coste que solo compensa donde hace falta.
    expect(necesitaCuerpoCrudo('/api/v1/orders')).toBe(false);
    expect(necesitaCuerpoCrudo('/api/v1/products')).toBe(false);
  });

  it('la query no despista', () => {
    expect(necesitaCuerpoCrudo('/api/v1/payments/webhook/revolut?reintento=1')).toBe(true);
  });

  it('no se activa con una ruta que solo empieza parecido', () => {
    expect(necesitaCuerpoCrudo('/api/v1/payments/webhooks-falso')).toBe(false);
  });
});

describe('Analizador que conserva el cuerpo', () => {
  it('guarda los bytes exactos, con su espaciado', async () => {
    const app = await servidor();
    // Espaciado raro a propósito: es lo que distingue el crudo del
    // reserializado, y lo único que hace que la firma cuadre.
    const cuerpo = '{\n  "event"  : "ORDER_COMPLETED",\n  "order_id": "ord-1"\n}';

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook/revolut',
      headers: { 'content-type': 'application/json' },
      payload: cuerpo,
    });

    const cuerpoRespuesta = r.json<{ crudo: string; parseado: Record<string, string> }>();
    expect(cuerpoRespuesta.crudo).toBe(cuerpo);
    expect(cuerpoRespuesta.crudo).not.toBe(JSON.stringify(cuerpoRespuesta.parseado));
    // Y el cuerpo parseado sigue llegando normal: esto no sustituye nada.
    expect(cuerpoRespuesta.parseado['order_id']).toBe('ord-1');

    await app.close();
  });

  it('el crudo conservado verifica la firma de Revolut; el reserializado no', async () => {
    const app = await servidor();
    const secreto = 'wsk_prueba';
    const marca = Date.now();
    const cuerpo = JSON.stringify({ event: 'ORDER_COMPLETED', order_id: 'ord-1' }, null, 2);
    const firma = crypto
      .createHmac('sha256', secreto)
      .update(`v1.${marca}.${cuerpo}`)
      .digest('hex');

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook/revolut',
      headers: { 'content-type': 'application/json' },
      payload: cuerpo,
    });

    const { crudo, parseado } = r.json<{ crudo: string; parseado: unknown }>();

    const firmaDelCrudo = crypto
      .createHmac('sha256', secreto)
      .update(`v1.${marca}.${crudo}`)
      .digest('hex');
    const firmaDelReserializado = crypto
      .createHmac('sha256', secreto)
      .update(`v1.${marca}.${JSON.stringify(parseado)}`)
      .digest('hex');

    expect(firmaDelCrudo).toBe(firma);
    expect(firmaDelReserializado).not.toBe(firma);

    await app.close();
  });

  it('no lo guarda en las rutas normales', async () => {
    const app = await servidor();

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":"cliente@ejemplo.es"}',
    });

    const cuerpo = r.json<{ crudo: string | null; parseado: Record<string, string> }>();
    expect(cuerpo.crudo).toBeNull();
    expect(cuerpo.parseado['email']).toBe('cliente@ejemplo.es');

    await app.close();
  });

  it('no cambia cómo responde Fastify a los casos raros', async () => {
    // El hook no debe alterar el comportamiento de nada, y menos en la propia
    // ruta de webhook: un cambio aquí se traduce en avisos de pago perdidos.
    // Se compara contra un servidor idéntico sin el hook, en vez de fijar
    // códigos a mano, para que la comparación siga valiendo si Fastify cambia.
    const con = await servidor();
    const sin = await servidorSinHook();

    for (const [caso, payload] of [
      ['cuerpo vacío', ''],
      ['JSON mal formado', '{esto no es json'],
      ['JSON válido', '{"order_id":"ord-1"}'],
    ] as const) {
      for (const url of ['/api/v1/orders', '/api/v1/payments/webhook/revolut']) {
        const opciones = {
          method: 'POST' as const,
          url,
          headers: { 'content-type': 'application/json' },
          payload,
        };
        const a = await con.inject(opciones);
        const b = await sin.inject(opciones);

        expect(`${caso} en ${url}: ${a.statusCode}`).toBe(`${caso} en ${url}: ${b.statusCode}`);
      }
    }

    await con.close();
    await sin.close();
  });

  it('rechaza un cuerpo desmesurado en vez de tragárselo entero', async () => {
    // El límite general de Fastify lo aplica el analizador, que corre después
    // de este hook: sin tope propio, el cuerpo se acumularía completo en
    // memoria antes de que nadie pudiera rechazarlo.
    const app = await servidor();

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook/revolut',
      headers: { 'content-type': 'application/json' },
      payload: `{"relleno":"${'x'.repeat(2 * 1024 * 1024)}"}`,
    });

    expect(r.statusCode).toBe(413);
    await app.close();
  });

  it('acepta caracteres no ASCII sin alterarlos', async () => {
    // El reserializado escapa los acentos y las emes con tilde de otra forma
    // según el motor; el crudo tiene que llegar tal cual salió.
    const app = await servidor();
    const cuerpo = '{"order_id":"ord-1","descripcion":"Camión ñandú €"}';

    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/webhook/revolut',
      headers: { 'content-type': 'application/json' },
      payload: cuerpo,
    });

    expect(r.json<{ crudo: string }>().crudo).toBe(cuerpo);
    await app.close();
  });
});

import { describe, expect, it } from 'vitest';
import {
  decidirIva,
  decidirIvaDelPedido,
  esPaisUE,
  estadoDelUmbral,
  exigeNetificar,
  fueraDelTerritorioIva,
  LIMITE_IOSS_CENTS,
  necesitaRevisionDeTipo,
  TIPOS_UE,
  tipoAplicable,
  UMBRAL_OSS_CENTS,
  type ContextoVenta,
} from './iva-transfronterizo.js';

/**
 * El error que esto evita no es equivocarse de tipo: es no enterarse de que se
 * ha cruzado el umbral y seguir cobrando el 21 % español cuando tocaba el 25 %
 * danés. Cuando Hacienda lo regulariza, la diferencia sale del margen porque al
 * cliente ya no se le puede reclamar.
 */

const venta = (parcial: Partial<ContextoVenta> = {}): ContextoVenta => ({
  paisDestino: 'ES',
  codigoPostalDestino: '28001',
  paisOrigen: 'ES',
  valorEnvioCents: 8999,
  acumuladoAnualCents: 0,
  tieneIoss: false,
  tipoNacional: 21,
  ...parcial,
});

describe('Territorio', () => {
  it('reconoce los estados miembros', () => {
    expect(esPaisUE('ES')).toBe(true);
    expect(esPaisUE('de')).toBe(true);
    expect(esPaisUE('GB')).toBe(false);
    expect(esPaisUE('CN')).toBe(false);
  });

  it('deja Canarias, Ceuta y Melilla fuera del IVA', () => {
    // Son España salvo para esto. Tratarlos como "ES" a secas es facturar IVA
    // español a quien no debe pagarlo.
    expect(fueraDelTerritorioIva('ES', '35001')).toBe(true); // Las Palmas
    expect(fueraDelTerritorioIva('ES', '38001')).toBe(true); // Tenerife
    expect(fueraDelTerritorioIva('ES', '51001')).toBe(true); // Ceuta
    expect(fueraDelTerritorioIva('ES', '52001')).toBe(true); // Melilla
    expect(fueraDelTerritorioIva('ES', '28001')).toBe(false); // Madrid
  });
});

describe('Venta interior', () => {
  it('aplica el IVA español', () => {
    const d = decidirIva(venta());
    expect(d.regimen).toBe('INTERIOR');
    expect(d.tipo).toBe(21);
    expect(d.paisRecaudador).toBe('ES');
  });

  it('va exenta a Canarias', () => {
    const d = decidirIva(venta({ codigoPostalDestino: '35001' }));
    expect(d.regimen).toBe('EXENTA');
    expect(d.tipo).toBe(0);
    expect(d.avisoCliente).toContain('aduana');
  });
});

describe('Umbral de los 10.000 €', () => {
  it('cobra IVA español por debajo del umbral', () => {
    const d = decidirIva(venta({ paisDestino: 'FR', acumuladoAnualCents: 500000 }));
    expect(d.regimen).toBe('NACIONAL_POR_UMBRAL');
    expect(d.tipo).toBe(21);
    expect(d.paisRecaudador).toBe('ES');
  });

  it('cobra IVA de destino una vez superado', () => {
    const d = decidirIva(venta({ paisDestino: 'DK', acumuladoAnualCents: UMBRAL_OSS_CENTS }));
    expect(d.regimen).toBe('OSS');
    expect(d.tipo).toBe(25);
    expect(d.paisRecaudador).toBe('DK');
  });

  it('la operación que cruza el umbral ya tributa en destino', () => {
    // No la siguiente: el umbral se mira con esta venta incluida. Aplicarlo a
    // partir de la próxima deja una operación mal facturada.
    const justoDebajo = decidirIva(
      venta({
        paisDestino: 'DE',
        acumuladoAnualCents: UMBRAL_OSS_CENTS - 10000,
        valorEnvioCents: 9999,
      }),
    );
    const laQueCruza = decidirIva(
      venta({
        paisDestino: 'DE',
        acumuladoAnualCents: UMBRAL_OSS_CENTS - 10000,
        valorEnvioCents: 10001,
      }),
    );

    expect(justoDebajo.regimen).toBe('NACIONAL_POR_UMBRAL');
    expect(laQueCruza.regimen).toBe('OSS');
    expect(laQueCruza.tipo).toBe(TIPOS_UE.DE);
  });

  it('usa el tipo de cada país', () => {
    const alto = UMBRAL_OSS_CENTS + 100000;
    expect(decidirIva(venta({ paisDestino: 'HU', acumuladoAnualCents: alto })).tipo).toBe(27);
    expect(decidirIva(venta({ paisDestino: 'LU', acumuladoAnualCents: alto })).tipo).toBe(17);
  });
});

describe('Importaciones', () => {
  it('cobra el IVA de destino con IOSS hasta 150 €', () => {
    const d = decidirIva(
      venta({ paisOrigen: 'CN', paisDestino: 'FR', tieneIoss: true, valorEnvioCents: 12000 }),
    );
    expect(d.regimen).toBe('IOSS');
    expect(d.tipo).toBe(20);
    expect(d.avisoCliente).toBeUndefined();
  });

  it('no aplica IOSS por encima de 150 €', () => {
    const d = decidirIva(
      venta({ paisOrigen: 'CN', tieneIoss: true, valorEnvioCents: LIMITE_IOSS_CENTS + 1 }),
    );
    expect(d.regimen).toBe('IMPORTACION_SIN_IOSS');
    expect(d.tipo).toBe(0);
  });

  it('avisa de que el cliente pagará en aduana', () => {
    // Callarlo es la omisión engañosa que hace que el paquete se rechace en la
    // entrega y la venta se pierda entera.
    const d = decidirIva(venta({ paisOrigen: 'CN', tieneIoss: false }));
    expect(d.regimen).toBe('IMPORTACION_SIN_IOSS');
    expect(d.avisoCliente).toContain('IVA de importación');
    expect(d.avisoCliente).toContain('arancel');
  });

  it('el origen manda sobre el destino', () => {
    // Enviar desde China a Madrid no es una venta interior por mucho que el
    // cliente sea español.
    const d = decidirIva(venta({ paisOrigen: 'CN', paisDestino: 'ES' }));
    expect(d.regimen).not.toBe('INTERIOR');
  });

  it('justo en los 150 € todavía cabe en IOSS', () => {
    const d = decidirIva(
      venta({ paisOrigen: 'CN', tieneIoss: true, valorEnvioCents: LIMITE_IOSS_CENTS }),
    );
    expect(d.regimen).toBe('IOSS');
  });
});

describe('Aviso del umbral', () => {
  it('no molesta cuando queda margen', () => {
    expect(estadoDelUmbral(100000).aviso).toBeUndefined();
  });

  it('avisa al acercarse', () => {
    // Antes de cruzarlo: después habría que regularizar ventas ya facturadas.
    const estado = estadoDelUmbral(850000);
    expect(estado.aviso).toContain('alta en OSS');
    expect(estado.porcentaje).toBe(85);
    expect(estado.superado).toBe(false);
  });

  it('lo dice claro una vez superado', () => {
    const estado = estadoDelUmbral(UMBRAL_OSS_CENTS + 1);
    expect(estado.superado).toBe(true);
    expect(estado.aviso).toContain('369');
    expect(estado.restanteCents).toBe(0);
  });
});

describe('Tipos reducidos', () => {
  it('marca para revisión lo que no lleva el tipo general', () => {
    // Un libro es 4 % en España, 5,5 % en Francia y 0 % en Irlanda: no hay dos
    // listas iguales y adivinarlo daría un número equivocado con apariencia de
    // correcto.
    expect(necesitaRevisionDeTipo(4, 21)).toBe(true);
    expect(necesitaRevisionDeTipo(10, 21)).toBe(true);
    expect(necesitaRevisionDeTipo(21, 21)).toBe(false);
  });
});

describe('Tipo que se aplica a la línea', () => {
  it('respeta el reducido en una venta interior', () => {
    const interior = decidirIva(venta());
    expect(tipoAplicable(interior, 4)).toBe(4);
    expect(exigeNetificar(interior.regimen)).toBe(false);
  });

  it('mantiene el IVA español por debajo del umbral aunque el destino sea otro', () => {
    const d = decidirIva(venta({ paisDestino: 'FR' }));
    expect(tipoAplicable(d, 10)).toBe(10);
  });

  it('aplica el general de destino en OSS, también a los reducidos', () => {
    // Un libro español al 4 % pasa al 25 % danés. Es lo que dice la norma por
    // defecto, y por eso queda marcado para revisión: puede que Dinamarca
    // tenga un reducido propio para ese producto.
    const d = decidirIva(venta({ paisDestino: 'DK', acumuladoAnualCents: UMBRAL_OSS_CENTS }));
    expect(tipoAplicable(d, 4)).toBe(25);
    expect(necesitaRevisionDeTipo(4, 21)).toBe(true);
  });

  it('deja a cero y obliga a netificar lo exento y la importación sin IOSS', () => {
    // El precio del catálogo lleva el 21 % dentro. Si no se quita, se le cobra
    // al cliente un IVA español que no procede y que además volverá a pagar en
    // la aduana.
    const canarias = decidirIva(venta({ codigoPostalDestino: '35001' }));
    const importacion = decidirIva(venta({ paisOrigen: 'CN' }));

    expect(tipoAplicable(canarias, 21)).toBe(0);
    expect(tipoAplicable(importacion, 21)).toBe(0);
    expect(exigeNetificar(canarias.regimen)).toBe(true);
    expect(exigeNetificar(importacion.regimen)).toBe(true);
  });
});

describe('Pedido con varios envíos', () => {
  const base = {
    paisDestino: 'FR',
    codigoPostalDestino: '75001',
    acumuladoAnualCents: 0,
    tieneIoss: true,
    tipoNacional: 21,
  };

  it('mide el límite de 150 € por envío, no por pedido', () => {
    // Dos paquetes de 100 € que llegan por separado caben los dos en IOSS.
    // Sumarlos y tratarlos como un envío de 200 € dejaría fuera a ambos.
    const d = decidirIvaDelPedido(base, [
      { id: 'prov-a', paisOrigen: 'CN', valorCents: 10_000 },
      { id: 'prov-b', paisOrigen: 'CN', valorCents: 10_000 },
    ]);

    expect(d.regimen).toBe('IOSS');
    expect(d.envios.every((e) => e.decision.regimen === 'IOSS')).toBe(true);
    expect(d.paisRecaudador).toBe('FR');
  });

  it('marca el pedido como MIXTO cuando cada envío sale de un sitio', () => {
    const d = decidirIvaDelPedido(base, [
      { id: 'almacen', paisOrigen: 'ES', valorCents: 5000 },
      { id: 'proveedor', paisOrigen: 'CN', valorCents: 20_000 },
    ]);

    expect(d.regimen).toBe('MIXTO');
    expect(d.envios[0]?.decision.regimen).toBe('NACIONAL_POR_UMBRAL');
    expect(d.envios[1]?.decision.regimen).toBe('IMPORTACION_SIN_IOSS');
    // El de más de 150 € pasa por aduana: hay que decirlo antes de cobrar.
    expect(d.avisos).toHaveLength(1);
    expect(d.avisos[0]).toContain('IVA de importación');
  });

  it('el umbral crece dentro del propio pedido', () => {
    // Llegando a 9.900 €, el primer envío de 100 € todavía es nacional y el
    // segundo ya cruza: evaluarlos con el mismo acumulado dejaría uno mal
    // facturado.
    const d = decidirIvaDelPedido(
      { ...base, acumuladoAnualCents: UMBRAL_OSS_CENTS - 10_000, tieneIoss: false },
      [
        { id: 'a', paisOrigen: 'ES', valorCents: 9_000 },
        { id: 'b', paisOrigen: 'ES', valorCents: 9_000 },
      ],
    );

    expect(d.envios[0]?.decision.regimen).toBe('NACIONAL_POR_UMBRAL');
    expect(d.envios[1]?.decision.regimen).toBe('OSS');
    expect(d.regimen).toBe('MIXTO');
    expect(d.paisRecaudador).toBe('');
  });

  it('solo consume umbral lo que es venta a distancia intracomunitaria', () => {
    // Una importación no cuenta para los 10.000 €. Sumarla adelantaría el alta
    // en OSS y, peor, haría cobrar IVA de destino cuando aún no tocaba.
    const d = decidirIvaDelPedido(base, [
      { id: 'ue', paisOrigen: 'ES', valorCents: 4000 },
      { id: 'china', paisOrigen: 'CN', valorCents: 9000 },
    ]);

    expect(d.consumeUmbralCents).toBe(4000);
  });
});

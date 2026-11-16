import { describe, expect, it } from 'vitest';
import {
  REGLAS_POR_DEFECTO,
  evaluarReferido,
  generarCodigo,
  normalizarCodigo,
  type ReglasReferidos,
  type SolicitudReferido,
} from './referidos.js';

/**
 * Programa de referidos.
 *
 * Aquí se prueba sobre todo lo que **no** debe premiarse. Un referido mal
 * validado no da ningún error: emite un cupón y ya está. Se descubre semanas
 * después, cuadrando cuentas, cuando ya se han regalado cientos de euros — y
 * para entonces no hay forma de recuperarlos.
 */

const REGLAS: ReglasReferidos = { ...REGLAS_POR_DEFECTO, activo: true };

const SOLICITUD: SolicitudReferido = {
  referidorId: 'usr-1',
  emailReferidor: 'ana@ejemplo.es',
  emailReferido: 'luis@ejemplo.es',
  referidoYaEraCliente: false,
  referidosCompletados: 0,
  totalPedidoCents: 4999,
  yaFueReferido: false,
};

const con = (cambios: Partial<SolicitudReferido>): SolicitudReferido => ({
  ...SOLICITUD,
  ...cambios,
});

describe('Un referido legítimo', () => {
  it('se premia a los dos', () => {
    const d = evaluarReferido(SOLICITUD, REGLAS);

    expect(d.valido).toBe(true);
    expect(d.premios?.referidorCents).toBe(REGLAS.premioReferidorCents);
    expect(d.premios?.referidoCents).toBe(REGLAS.premioReferidoCents);
  });

  it('justo en el pedido mínimo, cuenta', () => {
    expect(
      evaluarReferido(con({ totalPedidoCents: REGLAS.pedidoMinimoCents }), REGLAS).valido,
    ).toBe(true);
  });
});

describe('Lo que no se premia', () => {
  it('el programa apagado no reparte nada', () => {
    // Un programa que regala dinero no puede activarse solo porque se
    // despliegue una versión nueva.
    const d = evaluarReferido(SOLICITUD, REGLAS_POR_DEFECTO);

    expect(d.valido).toBe(false);
    expect(d.motivo).toBe('PROGRAMA_APAGADO');
  });

  it('referirse a uno mismo', () => {
    const d = evaluarReferido(con({ emailReferido: 'ana@ejemplo.es' }), REGLAS);

    expect(d.motivo).toBe('AUTOREFERIDO');
  });

  it('referirse a uno mismo con otra caja o espacios de más', () => {
    // Es el intento más obvio y el que se cuela si no se normaliza.
    const d = evaluarReferido(con({ emailReferido: '  ANA@Ejemplo.ES ' }), REGLAS);

    expect(d.motivo).toBe('AUTOREFERIDO');
  });

  it('quien ya era cliente', () => {
    // El programa trae gente nueva. Premiar a un cliente de siempre por
    // "llegar recomendado" es regalar descuentos por ventas que ya se tenían.
    const d = evaluarReferido(con({ referidoYaEraCliente: true }), REGLAS);

    expect(d.motivo).toBe('YA_ERA_CLIENTE');
  });

  it('una dirección que ya fue referida por otro', () => {
    const d = evaluarReferido(con({ yaFueReferido: true }), REGLAS);

    expect(d.motivo).toBe('YA_FUE_REFERIDO');
  });

  it('un pedido por debajo del mínimo', () => {
    // Sin mínimo, alguien se refiere a sí mismo con veinte correos, hace
    // veinte pedidos de un euro y se queda con veinte descuentos.
    const d = evaluarReferido(con({ totalPedidoCents: 100 }), REGLAS);

    expect(d.motivo).toBe('PEDIDO_INSUFICIENTE');
    // El detalle lleva las dos cifras: quien lo lee en el panel necesita saber
    // por cuánto se quedó corto.
    expect(d.detalle).toContain('1.00');
    expect(d.detalle).toContain('25.00');
  });

  it('quien ya ha traído a demasiada gente', () => {
    const d = evaluarReferido(con({ referidosCompletados: REGLAS.maximoPorReferidor }), REGLAS);

    expect(d.motivo).toBe('LIMITE_ALCANZADO');
  });

  it('sin límite configurado, no hay tope', () => {
    const sinTope = { ...REGLAS, maximoPorReferidor: 0 };

    expect(evaluarReferido(con({ referidosCompletados: 500 }), sinTope).valido).toBe(true);
  });

  it('un rechazo nunca devuelve premios', () => {
    // La comprobación que impide el peor fallo posible: emitir el cupón
    // aunque la validación haya dicho que no.
    for (const solicitud of [
      con({ emailReferido: 'ana@ejemplo.es' }),
      con({ referidoYaEraCliente: true }),
      con({ totalPedidoCents: 1 }),
      con({ yaFueReferido: true }),
    ]) {
      const d = evaluarReferido(solicitud, REGLAS);
      expect(d.valido).toBe(false);
      expect(d.premios).toBeUndefined();
    }
  });
});

describe('El código de invitación', () => {
  it('no lleva letras que se confunden al dictarlo', () => {
    // Se dice por teléfono y se escribe a mano: la I con el 1 y la L, la O con
    // el 0. Cuesta menos generarlo legible que atender la reclamación.
    let codigos = '';
    for (let i = 0; i < 200; i++) codigos += generarCodigo();

    expect(codigos).not.toMatch(/[ILO01]/);
  });

  it('tiene siempre la misma longitud', () => {
    for (let i = 0; i < 20; i++) {
      expect(generarCodigo()).toHaveLength(8);
    }
  });

  it('con la misma semilla sale el mismo código', () => {
    // El generador es inyectable para poder probarlo; sin eso, cualquier
    // prueba sobre el código sería un sorteo.
    const fijo = () => 0.5;

    expect(generarCodigo(fijo)).toBe(generarCodigo(fijo));
  });

  it('dos códigos seguidos no son iguales', () => {
    const generados = new Set(Array.from({ length: 500 }, () => generarCodigo()));

    // Con 31^8 combinaciones, 500 repetidos sería una señal de que el
    // generador está roto.
    expect(generados.size).toBe(500);
  });
});

describe('Cuando alguien lo escribe a mano', () => {
  it('da igual la caja y los espacios', () => {
    expect(normalizarCodigo(' ab3d-ef7h ')).toBe('AB3DEF7H');
  });

  it('no inventa correcciones imposibles', () => {
    // El alfabeto no tiene O, 0, I, L ni 1: "corregir" una O por un cero
    // produciría un carácter que no puede existir en ningún código. Se deja
    // tal cual y sencillamente no se encuentra, que es la respuesta correcta.
    expect(normalizarCodigo('ABODEFGH')).toBe('ABODEFGH');
  });
});

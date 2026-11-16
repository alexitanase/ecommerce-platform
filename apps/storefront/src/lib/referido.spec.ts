import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturarReferido, leerReferido, olvidarReferido } from './referido.js';

/**
 * Código de invitación.
 *
 * Lo que se prueba aquí es sobre todo que no se pierda: el enlace se abre un
 * día y la compra pasa otro, y un código que no sobrevive a esa espera hace
 * que el programa no premie prácticamente nunca. Lo segundo es que no acepte
 * cualquier cosa venida de la URL, que es texto que escribe quien quiera.
 */

const almacen = new Map<string, string>();

beforeEach(() => {
  almacen.clear();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => almacen.get(k) ?? null,
      setItem: (k: string, v: string) => almacen.set(k, v),
      removeItem: (k: string) => almacen.delete(k),
    },
  });
});

describe('Capturar el código de la URL', () => {
  it('lo guarda y lo devuelve', () => {
    capturarReferido('?ref=AB3DEF7H');

    expect(leerReferido()).toBe('AB3DEF7H');
  });

  it('lo normaliza a mayúsculas', () => {
    capturarReferido('?ref=ab3def7h');

    expect(leerReferido()).toBe('AB3DEF7H');
  });

  it('sin parámetro no guarda nada', () => {
    capturarReferido('?utm_source=correo');

    expect(leerReferido()).toBeNull();
  });

  it('no se sobrescribe el primero que llegó', () => {
    // Quien trajo a la persona a la tienda es quien recomendó primero. Si el
    // último enlace ganara, bastaría con enviar el propio a alguien que ya
    // estaba navegando para quedarse con el premio de otro.
    capturarReferido('?ref=PRIMERO1');
    capturarReferido('?ref=SEGUNDO2');

    expect(leerReferido()).toBe('PRIMERO1');
  });
});

describe('Lo que no se acepta de la URL', () => {
  it('caracteres raros', () => {
    // Va directo al cuerpo de la petición del pedido: aquí no entra nada que
    // no tenga forma de código.
    capturarReferido('?ref=<script>alert(1)</script>');

    expect(leerReferido()).toBeNull();
  });

  it('demasiado corto o demasiado largo', () => {
    capturarReferido('?ref=AB');
    expect(leerReferido()).toBeNull();

    capturarReferido(`?ref=${'A'.repeat(40)}`);
    expect(leerReferido()).toBeNull();
  });
});

describe('Caducidad', () => {
  it('a los 30 días deja de valer', () => {
    almacen.set(
      'ref',
      JSON.stringify({ codigo: 'VIEJO123', guardadoEl: Date.now() - 31 * 86_400_000 }),
    );

    expect(leerReferido()).toBeNull();
  });

  it('a los 29 sigue valiendo', () => {
    // El enlace se abre y la compra llega días después: si el código no
    // sobreviviera a esa espera, el programa no premiaría casi nunca.
    almacen.set(
      'ref',
      JSON.stringify({ codigo: 'RECIENTE', guardadoEl: Date.now() - 29 * 86_400_000 }),
    );

    expect(leerReferido()).toBe('RECIENTE');
  });
});

describe('Cuando el almacenamiento no está disponible', () => {
  it('no revienta, simplemente no hay código', () => {
    // Navegación privada con almacenamiento bloqueado. Se pierde el referido,
    // pero la compra tiene que seguir funcionando.
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('bloqueado');
        },
        setItem: () => {
          throw new Error('bloqueado');
        },
        removeItem: () => {
          throw new Error('bloqueado');
        },
      },
    });

    expect(() => {
      capturarReferido('?ref=AB3DEF7H');
    }).not.toThrow();
    expect(leerReferido()).toBeNull();
    expect(() => {
      olvidarReferido();
    }).not.toThrow();
  });

  it('un valor corrupto se trata como si no hubiera', () => {
    almacen.set('ref', 'esto no es json');

    expect(leerReferido()).toBeNull();
  });
});

describe('Después de usarlo', () => {
  it('se olvida', () => {
    capturarReferido('?ref=AB3DEF7H');
    olvidarReferido();

    expect(leerReferido()).toBeNull();
  });
});

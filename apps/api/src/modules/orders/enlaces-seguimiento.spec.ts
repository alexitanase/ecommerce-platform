import { describe, expect, it } from 'vitest';
import {
  codigoDeSeguimiento,
  enlaceDeSeguimiento,
  nombreDeTransportista,
  reconocerTransportista,
} from './enlaces-seguimiento.js';

/**
 * El enlace de seguimiento.
 *
 * Lo escribe una persona a mano, deprisa y desde la web del proveedor, así que
 * lo que llega no es un identificador limpio: es «correos exprés», «SEUR 24h» o
 * «GLS Spain». Lo que se comprueba aquí es que de ese texto salga igualmente un
 * enlace que funcione, porque ese enlace va dentro del correo que recibe el
 * cliente.
 */

describe('reconocer el transportista', () => {
  it('reconoce el nombre tal cual', () => {
    expect(reconocerTransportista('SEUR')?.nombre).toBe('SEUR');
    expect(reconocerTransportista('correos')?.nombre).toBe('Correos');
  });

  it('no distingue mayúsculas, tildes ni puntuación', () => {
    // Nadie escribe dos veces igual el nombre de un transportista.
    expect(reconocerTransportista('Correos Exprés')?.nombre).toBe('Correos Express');
    expect(reconocerTransportista('correos-express')?.nombre).toBe('Correos Express');
    expect(reconocerTransportista('C.E.X.')?.nombre).toBe('Correos Express');
  });

  it('lo encuentra dentro de una frase', () => {
    // Los proveedores lo escriben con coletillas: «GLS Spain — Terrestre».
    expect(reconocerTransportista('GLS Spain — Terrestre')?.nombre).toBe('GLS');
    expect(reconocerTransportista('Envío por SEUR 24h')?.nombre).toBe('SEUR');
  });

  it('distingue Correos de Correos Express, que son dos empresas', () => {
    // Y dos webs de seguimiento distintas: confundirlas manda al cliente a una
    // página que le dice que su envío no existe. Gana el nombre más específico
    // aunque el otro esté contenido dentro.
    expect(reconocerTransportista('Correos Express')?.nombre).toBe('Correos Express');
    expect(reconocerTransportista('Enviado por Correos Express 24h')?.nombre).toBe(
      'Correos Express',
    );
    expect(reconocerTransportista('correos exprés')?.nombre).toBe('Correos Express');
    expect(reconocerTransportista('Correos')?.nombre).toBe('Correos');
  });

  it('devuelve null cuando no es ninguno conocido', () => {
    expect(reconocerTransportista('Transportes Paco')).toBeNull();
    expect(reconocerTransportista('')).toBeNull();
  });
});

describe('construir el enlace', () => {
  it('usa la página oficial del transportista', () => {
    const enlace = enlaceDeSeguimiento('SEUR', '12345678');

    expect(enlace).toContain('seur.com');
    expect(enlace).toContain('12345678');
  });

  it('cae en un buscador universal si no lo reconoce', () => {
    // Peor que el enlace oficial y muchísimo mejor que un número suelto que el
    // cliente no sabe dónde pegar.
    const enlace = enlaceDeSeguimiento('Transportes Paco', 'AB123456789ES');

    expect(enlace).toContain('17track');
    expect(enlace).toContain('AB123456789ES');
  });

  it('escapa lo que iría a parar a la URL', () => {
    // Un número con un espacio o un «&» copiado de su web rompería la
    // dirección y el enlace del correo llevaría a ninguna parte.
    const enlace = enlaceDeSeguimiento('Correos', 'AB 123&x');

    expect(enlace).toContain('AB%20123%26x');
    expect(enlace).not.toContain('AB 123&x');
  });

  it('sin número no hay enlace', () => {
    expect(enlaceDeSeguimiento('SEUR', '   ')).toBeNull();
  });

  /*
   * Las direcciones de los tres transportistas que más se usan, comprobadas
   * contra sus webs.
   *
   * Estas tres aserciones existen porque los enlaces se pudren en silencio: el
   * de Correos Express llevaba a un 503 —la web entera había cambiado de
   * dominio— y nadie se enteró, porque el único que abre ese enlace es el
   * cliente que acaba de recibir el correo de «tu pedido va en camino». Aquí
   * al menos queda escrito cuál es el bueno y por qué.
   */
  it('Correos Express: el localizador que existe hoy, con el número escrito', () => {
    const enlace = enlaceDeSeguimiento('Correos Express', '12345678');

    // `shippingNumber` es el nombre del campo en su formulario, comprobado
    // contra la página: con cualquier otro sale el buscador en blanco.
    expect(enlace).toBe('https://s.correosexpress.com/?shippingNumber=12345678');
  });

  it('SEUR: la dirección definitiva, no la que redirige', () => {
    expect(enlaceDeSeguimiento('SEUR', '12345678')).toBe(
      'https://www.seur.com/miseur/mis-envios?code=12345678',
    );
  });

  it('Nacex se reconoce pero va al buscador universal', () => {
    /*
     * No es una carencia de la lista: Nacex resuelve el seguimiento con un
     * formulario POST de dos campos (agencia y albarán), así que no existe
     * ninguna dirección con el número dentro que lleve al envío.
     *
     * Lo que sí importa es que el NOMBRE se siga reconociendo: es lo que
     * corrige «nacex» a «Nacex» en el correo y lo que da su código para
     * consultar el estado por API.
     */
    expect(reconocerTransportista('Nacex')?.nombre).toBe('Nacex');

    const enlace = enlaceDeSeguimiento('Nacex', '12189825');
    expect(enlace).toContain('17track');
    expect(enlace).toContain('12189825');
  });
});

describe('código para consultar el estado', () => {
  it('lo da para los transportistas que se usan en España', () => {
    expect(codigoDeSeguimiento('Nacex')).toBe(100436);
    expect(codigoDeSeguimiento('SEUR')).toBe(100438);
    expect(codigoDeSeguimiento('Correos Express')).toBe(100048);
  });

  it('no lo inventa para uno que no conoce', () => {
    // Mandar un código equivocado es peor que no mandar ninguno: se consulta a
    // la empresa que no es y responde que el envío no existe. Sin código,
    // 17TRACK lo deduce del propio número.
    expect(codigoDeSeguimiento('Transportes Paco')).toBeUndefined();
  });
});

describe('nombre del transportista', () => {
  it('lo corrige cuando lo reconoce', () => {
    // Acaba en el correo del cliente: «correos exprés» ahí parece descuido.
    expect(nombreDeTransportista('correos exprés')).toBe('Correos Express');
  });

  it('respeta lo escrito cuando no lo conoce', () => {
    expect(nombreDeTransportista('  Transportes Paco  ')).toBe('Transportes Paco');
  });
});

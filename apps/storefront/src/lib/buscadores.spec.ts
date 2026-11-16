import { describe, expect, it } from 'vitest';
import rangos from './rangos-buscadores.json';
import {
  agenteDeBuscador,
  esBuscadorVerificado,
  ipDeBuscador,
  ipDelCliente,
  parsearDireccion,
} from './buscadores';

/**
 * La puerta de edad deja pasar a los buscadores, y de esto depende que siga
 * siendo una puerta.
 *
 * Lo que hay que cubrir no es el camino bueno —que Googlebot entre— sino el malo:
 * que declararse Googlebot desde una IP cualquiera NO sirva. Si eso se rompiera,
 * la tienda quedaría abierta a cualquiera capaz de cambiar su user-agent, y el
 * fallo no se vería nunca desde dentro: la puerta seguiría saliéndole a quien la
 * mira, y el agujero solo lo conocería quien fuera a buscarlo.
 */

const UA_GOOGLE = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const UA_NAVEGADOR =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/** Una IP que de verdad está en la lista publicada, sacada del propio fichero. */
function ipDentroDeRango(robot: 'googlebot' | 'bingbot'): string {
  const prefijo = (rangos as Record<string, string[]>)[robot]?.find((p) => p.includes('.'));
  if (!prefijo) throw new Error(`Sin prefijos IPv4 para ${robot}`);
  // `66.249.64.0/27` → `66.249.64.0`, que pertenece a su propio rango.
  return prefijo.split('/')[0] as string;
}

const cabeceras = (valores: Record<string, string>) => new Headers(valores);

describe('parsearDireccion', () => {
  it('entiende IPv4', () => {
    expect(parsearDireccion('192.0.2.1')).toEqual({ familia: 4, valor: 3221225985n });
  });

  it('entiende IPv6 abreviada', () => {
    expect(parsearDireccion('2001:4860::1')?.familia).toBe(6);
    // `::` expandido tiene que dar lo mismo que escribirlo entero.
    expect(parsearDireccion('2001:db8::1')).toEqual(
      parsearDireccion('2001:0db8:0000:0000:0000:0000:0000:0001'),
    );
  });

  it('entiende una IPv4 mapeada en IPv6', () => {
    // Es como llega una IPv4 cuando quien la reenvía habla IPv6; sin tratarla,
    // un robot legítimo se quedaría fuera.
    const mapeada = parsearDireccion('::ffff:192.0.2.1');
    expect(mapeada?.familia).toBe(6);
    expect(mapeada?.valor).toBe(0xffffn * 2n ** 32n + 3221225985n);
  });

  it('rechaza lo que no es una dirección', () => {
    for (const basura of ['', '  ', '999.0.0.1', '1.2.3', '1.2.3.4.5', 'no-una-ip', '2001:::1']) {
      expect(parsearDireccion(basura), basura).toBeNull();
    }
  });
});

describe('ipDeBuscador', () => {
  it('reconoce una IP de la lista publicada de Google', () => {
    expect(ipDeBuscador(ipDentroDeRango('googlebot'))).toBe(true);
  });

  it('reconoce una IP de la lista publicada de Bing', () => {
    expect(ipDeBuscador(ipDentroDeRango('bingbot'))).toBe(true);
  });

  it('no reconoce una IP cualquiera', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '192.168.1.10', '2001:db8::1']) {
      expect(ipDeBuscador(ip), ip).toBe(false);
    }
  });

  it('la lista tiene suficientes rangos como para ser la de verdad', () => {
    // Si una descarga a medias dejara el fichero con cuatro prefijos, la puerta
    // dejaría fuera a casi todo el rastreador sin que nada fallara.
    const total = Object.values(rangos as Record<string, string[]>).flat().length;
    expect(total).toBeGreaterThan(100);
  });
});

describe('ipDelCliente', () => {
  it('prefiere la cabecera de Cloudflare', () => {
    expect(
      ipDelCliente(cabeceras({ 'cf-connecting-ip': '66.249.64.1', 'x-forwarded-for': '1.2.3.4' })),
    ).toBe('66.249.64.1');
  });

  it('se queda con el primero de x-forwarded-for, que es el cliente', () => {
    expect(ipDelCliente(cabeceras({ 'x-forwarded-for': '66.249.64.1, 172.68.0.1' }))).toBe(
      '66.249.64.1',
    );
  });

  it('devuelve null si no hay ninguna', () => {
    expect(ipDelCliente(cabeceras({}))).toBeNull();
  });
});

describe('agenteDeBuscador', () => {
  it('reconoce a los que dicen ser buscadores', () => {
    expect(agenteDeBuscador(UA_GOOGLE)).toBe(true);
    expect(agenteDeBuscador('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true);
    // El de «Inspeccionar URL» de Search Console, que es con el que se comprueba.
    expect(agenteDeBuscador('Mozilla/5.0 (compatible; Google-InspectionTool/1.0)')).toBe(true);
  });

  it('no reconoce a un navegador ni a un robot de vista previa', () => {
    expect(agenteDeBuscador(UA_NAVEGADOR)).toBe(false);
    expect(agenteDeBuscador('WhatsApp/2.23.20.0')).toBe(false);
    expect(agenteDeBuscador(null)).toBe(false);
  });
});

describe('esBuscadorVerificado', () => {
  it('deja pasar a Googlebot desde una IP de Google', () => {
    expect(
      esBuscadorVerificado(
        cabeceras({ 'user-agent': UA_GOOGLE, 'cf-connecting-ip': ipDentroDeRango('googlebot') }),
      ),
    ).toBe(true);
  });

  it('NO deja pasar a quien se hace pasar por Googlebot desde otra IP', () => {
    // Es el caso que justifica todo el módulo: hoy basta con esta cabecera para
    // colarse por la puerta usando la lista de robots de vista previa.
    expect(
      esBuscadorVerificado(cabeceras({ 'user-agent': UA_GOOGLE, 'cf-connecting-ip': '8.8.8.8' })),
    ).toBe(false);
  });

  it('NO deja pasar a un navegador normal desde una IP de Google', () => {
    // Una IP de Google sin decir que rastrea no tiene nada que indexar.
    expect(
      esBuscadorVerificado(
        cabeceras({ 'user-agent': UA_NAVEGADOR, 'cf-connecting-ip': ipDentroDeRango('googlebot') }),
      ),
    ).toBe(false);
  });

  it('NO deja pasar si no se puede saber de dónde viene', () => {
    expect(esBuscadorVerificado(cabeceras({ 'user-agent': UA_GOOGLE }))).toBe(false);
  });
});

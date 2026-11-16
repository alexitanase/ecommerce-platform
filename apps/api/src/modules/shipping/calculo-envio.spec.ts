import { describe, expect, it } from 'vitest';
import {
  elegirZona,
  opcionesAplicables,
  precioTarifa,
  tarifaAplica,
  zonaCubre,
  type TarifaEnvio,
  type ZonaEnvio,
} from './calculo-envio.js';

function tarifa(p: Partial<TarifaEnvio> = {}): TarifaEnvio {
  return {
    id: 't1',
    name: 'Estándar',
    carrier: null,
    type: 'FLAT',
    priceCents: 495,
    freeFromCents: null,
    minWeightGrams: null,
    maxWeightGrams: null,
    minOrderCents: null,
    maxOrderCents: null,
    minDays: 3,
    maxDays: 7,
    ...p,
  };
}

function zona(p: Partial<ZonaEnvio> = {}): ZonaEnvio {
  return {
    id: 'z1',
    name: 'Zona',
    countries: ['ES'],
    postalPrefixes: [],
    excludedPostalPrefixes: [],
    outsideVatTerritory: false,
    customsWarning: false,
    priority: 0,
    rates: [tarifa()],
    ...p,
  };
}

// Las cuatro zonas que necesita cualquier tienda española.
const PENINSULA = zona({
  id: 'peninsula',
  name: 'Península',
  postalPrefixes: [],
  excludedPostalPrefixes: ['35', '38', '51', '52', '07'],
});
const CANARIAS = zona({
  id: 'canarias',
  name: 'Canarias',
  postalPrefixes: ['35', '38'],
  outsideVatTerritory: true,
  customsWarning: true,
});
const CEUTA_MELILLA = zona({
  id: 'ceuta-melilla',
  name: 'Ceuta y Melilla',
  postalPrefixes: ['51', '52'],
  outsideVatTerritory: true,
  customsWarning: true,
});
const BALEARES = zona({ id: 'baleares', name: 'Baleares', postalPrefixes: ['07'] });

const TODAS = [PENINSULA, CANARIAS, CEUTA_MELILLA, BALEARES];

describe('Zonas de envío', () => {
  describe('territorio español', () => {
    it('Madrid va a Península', () => {
      expect(elegirZona(TODAS, 'ES', '28001')?.name).toBe('Península');
    });

    it('Las Palmas y Tenerife van a Canarias, no a Península', () => {
      // Si cayeran en Península se les cobraría IVA español, que es un error
      // fiscal: Canarias está fuera del territorio de aplicación del IVA.
      expect(elegirZona(TODAS, 'ES', '35001')?.name).toBe('Canarias');
      expect(elegirZona(TODAS, 'ES', '38001')?.name).toBe('Canarias');
    });

    it('Ceuta y Melilla tampoco son Península', () => {
      expect(elegirZona(TODAS, 'ES', '51001')?.name).toBe('Ceuta y Melilla');
      expect(elegirZona(TODAS, 'ES', '52001')?.name).toBe('Ceuta y Melilla');
    });

    it('Baleares es zona propia pero SÍ lleva IVA', () => {
      // Se separa por coste de transporte, no por fiscalidad: Baleares está
      // dentro del territorio IVA, al contrario que Canarias.
      const z = elegirZona(TODAS, 'ES', '07001');
      expect(z?.name).toBe('Baleares');
      expect(z?.outsideVatTerritory).toBe(false);
    });

    it('marca las zonas que van sin IVA y con aviso de aduanas', () => {
      expect(elegirZona(TODAS, 'ES', '35001')?.outsideVatTerritory).toBe(true);
      expect(elegirZona(TODAS, 'ES', '52001')?.customsWarning).toBe(true);
      expect(elegirZona(TODAS, 'ES', '28001')?.outsideVatTerritory).toBe(false);
    });
  });

  describe('coincidencia de zona', () => {
    it('un país que no cubrimos no encuentra zona', () => {
      expect(elegirZona(TODAS, 'FR', '75001')).toBeNull();
    });

    it('acepta el código postal con espacios o guiones', () => {
      expect(elegirZona(TODAS, 'ES', '35 001')?.name).toBe('Canarias');
      expect(elegirZona(TODAS, 'ES', '38-001')?.name).toBe('Canarias');
    });

    it('el país se compara sin distinguir mayúsculas', () => {
      expect(elegirZona(TODAS, 'es', '28001')?.name).toBe('Península');
    });

    it('con igual prioridad gana la zona más específica', () => {
      // Un descuido habitual: crear "España" genérica y "Canarias" con la misma
      // prioridad. Sin esta regla, Las Palmas caería en la genérica y se le
      // cobraría IVA.
      const generica = zona({ id: 'es', name: 'España entera', postalPrefixes: [] });
      const especifica = zona({
        id: 'can',
        name: 'Canarias',
        postalPrefixes: ['35', '38'],
        outsideVatTerritory: true,
      });

      expect(elegirZona([generica, especifica], 'ES', '35001')?.name).toBe('Canarias');
      expect(elegirZona([especifica, generica], 'ES', '35001')?.name).toBe('Canarias');
    });

    it('la prioridad manda sobre la especificidad', () => {
      const generica = zona({ id: 'es', name: 'España entera', priority: 10 });
      const especifica = zona({ id: 'can', name: 'Canarias', postalPrefixes: ['35'], priority: 1 });
      expect(elegirZona([generica, especifica], 'ES', '35001')?.name).toBe('España entera');
    });

    it('un prefijo excluido descarta la zona aunque coincida el país', () => {
      expect(zonaCubre(PENINSULA, 'ES', '35001')).toBe(false);
      expect(zonaCubre(PENINSULA, 'ES', '28001')).toBe(true);
    });
  });
});

describe('Tarifas', () => {
  describe('tramos de peso', () => {
    const ligero = tarifa({ type: 'WEIGHT', maxWeightGrams: 1000, priceCents: 395 });
    const pesado = tarifa({ type: 'WEIGHT', minWeightGrams: 1000, priceCents: 895 });

    it('elige el tramo correcto', () => {
      expect(tarifaAplica(ligero, 5000, 500)).toBe(true);
      expect(tarifaAplica(pesado, 5000, 500)).toBe(false);
      expect(tarifaAplica(pesado, 5000, 2000)).toBe(true);
    });

    it('los tramos contiguos no se solapan en el límite', () => {
      // Justo en 1000 g debe aplicar uno solo, no los dos: si aplicaran ambos
      // se ofrecería el envío barato para un paquete que cuesta el doble.
      expect(tarifaAplica(ligero, 5000, 1000)).toBe(false);
      expect(tarifaAplica(pesado, 5000, 1000)).toBe(true);
    });

    it('sin peso declarado se descarta la tarifa por peso', () => {
      // Suponer 0 g metería el paquete en el tramo más barato y regalaría el
      // porte de algo que puede pesar cinco kilos.
      expect(tarifaAplica(ligero, 5000, 0)).toBe(false);
    });
  });

  describe('tramos por importe', () => {
    const barato = tarifa({ type: 'ORDER_VALUE', maxOrderCents: 3000, priceCents: 595 });
    const caro = tarifa({ type: 'ORDER_VALUE', minOrderCents: 3000, priceCents: 295 });

    it('aplica según el subtotal', () => {
      expect(tarifaAplica(barato, 2000, 0)).toBe(true);
      expect(tarifaAplica(caro, 2000, 0)).toBe(false);
      expect(tarifaAplica(caro, 5000, 0)).toBe(true);
    });

    it('tampoco se solapan en el límite', () => {
      expect(tarifaAplica(barato, 3000, 0)).toBe(false);
      expect(tarifaAplica(caro, 3000, 0)).toBe(true);
    });
  });

  describe('envío gratis por importe', () => {
    const conUmbral = tarifa({ priceCents: 495, freeFromCents: 5000 });

    it('cobra por debajo del umbral', () => {
      expect(precioTarifa(conUmbral, 4999)).toBe(495);
    });

    it('es gratis justo al alcanzarlo', () => {
      expect(precioTarifa(conUmbral, 5000)).toBe(0);
      expect(precioTarifa(conUmbral, 9000)).toBe(0);
    });

    it('sin umbral siempre se cobra', () => {
      expect(precioTarifa(tarifa({ freeFromCents: null }), 100_000)).toBe(495);
    });

    it('el umbral se mide sobre el subtotal, no sobre el total con envío', () => {
      // Con 49,50 € de productos y 4,95 € de envío, el total sí llegaría a 50 €.
      // Si el umbral mirara el total, el propio envío se pagaría el ser gratis.
      expect(precioTarifa(conUmbral, 4950)).toBe(495);
    });
  });

  describe('opciones ofrecidas al cliente', () => {
    it('salen ordenadas de más barata a más cara', () => {
      const z = zona({
        rates: [
          tarifa({ id: 'urgente', name: 'Urgente', priceCents: 995, minDays: 1 }),
          tarifa({ id: 'estandar', name: 'Estándar', priceCents: 495, minDays: 3 }),
        ],
      });

      const opciones = opcionesAplicables(z, 2000, 500);
      expect(opciones.map((o) => o.tarifa.id)).toEqual(['estandar', 'urgente']);
    });

    it('a igual precio, primero la más rápida', () => {
      const z = zona({
        rates: [
          tarifa({ id: 'lenta', priceCents: 495, minDays: 7 }),
          tarifa({ id: 'rapida', priceCents: 495, minDays: 2 }),
        ],
      });
      expect(opcionesAplicables(z, 2000, 500)[0]?.tarifa.id).toBe('rapida');
    });

    it('descarta las que no encajan con el peso', () => {
      const z = zona({
        rates: [
          tarifa({ id: 'ligero', type: 'WEIGHT', maxWeightGrams: 1000 }),
          tarifa({ id: 'pesado', type: 'WEIGHT', minWeightGrams: 1000 }),
        ],
      });

      const opciones = opcionesAplicables(z, 2000, 3000);
      expect(opciones).toHaveLength(1);
      expect(opciones[0]?.tarifa.id).toBe('pesado');
    });

    it('una zona sin tarifas aplicables devuelve lista vacía', () => {
      const z = zona({ rates: [tarifa({ type: 'WEIGHT', minWeightGrams: 10_000 })] });
      expect(opcionesAplicables(z, 2000, 500)).toHaveLength(0);
    });

    it('marca como gratis la que supera el umbral', () => {
      const z = zona({ rates: [tarifa({ priceCents: 495, freeFromCents: 5000 })] });
      expect(opcionesAplicables(z, 6000, 500)[0]?.precioCents).toBe(0);
    });
  });
});

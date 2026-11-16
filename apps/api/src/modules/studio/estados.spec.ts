import { describe, expect, it } from 'vitest';
import { ESTADOS_CREATIVIDAD, TRANSICIONES, motivoRechazo, puedeTransitar } from './estados.js';

describe('transiciones de estado', () => {
  /*
   * La regla que sostiene el resto: publicar exige haber pasado por aprobada.
   * Con creatividades generadas por un modelo, saltarse esto significa que algo
   * que nadie miró acaba corriendo en una red de anuncios.
   */
  it('solo se publica desde aprobada', () => {
    for (const desde of ESTADOS_CREATIVIDAD) {
      expect(puedeTransitar(desde, 'PUBLICADA'), desde).toBe(desde === 'APROBADA');
    }
  });

  it('nunca se transita a sí mismo', () => {
    for (const estado of ESTADOS_CREATIVIDAD) {
      expect(puedeTransitar(estado, estado), estado).toBe(false);
    }
  });

  it('desde cualquier estado se puede volver a borrador o archivar', () => {
    for (const desde of ESTADOS_CREATIVIDAD) {
      if (desde === 'BORRADOR') continue;
      expect(puedeTransitar(desde, 'BORRADOR'), desde).toBe(true);
    }
    for (const desde of ESTADOS_CREATIVIDAD) {
      if (desde === 'ARCHIVADA') continue;
      expect(puedeTransitar(desde, 'ARCHIVADA'), desde).toBe(true);
    }
  });

  it('lo archivado se recupera antes de volver a tocarlo', () => {
    expect(TRANSICIONES.ARCHIVADA).toEqual(['BORRADOR']);
  });

  it('todos los destinos declarados son estados que existen', () => {
    const validos = new Set<string>(ESTADOS_CREATIVIDAD);
    for (const [desde, destinos] of Object.entries(TRANSICIONES)) {
      for (const d of destinos) expect(validos.has(d), `${desde} → ${d}`).toBe(true);
    }
  });
});

describe('mensajes de rechazo', () => {
  it('explica por qué no se puede publicar sin revisar', () => {
    expect(motivoRechazo('BORRADOR', 'PUBLICADA')).toMatch(/revisarla alguien/);
  });

  it('avisa cuando ya está en ese estado', () => {
    expect(motivoRechazo('APROBADA', 'APROBADA')).toMatch(/ya está/);
  });

  it('el mensaje genérico nombra los dos estados en castellano', () => {
    const m = motivoRechazo('ARCHIVADA', 'EN_REVISION');
    expect(m).toContain('Archivada');
    expect(m).toContain('En revisión');
  });
});

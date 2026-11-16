import { describe, expect, it } from 'vitest';
import { conexionCifrada, explicarFallo } from './cifrado-smtp.js';

describe('conexionCifrada', () => {
  it('el 465 va cifrado aunque la casilla esté sin marcar', () => {
    /*
     * El fallo real que esto evita.
     *
     * La casilla «Conexión cifrada» viene desmarcada de fábrica, así que quien
     * configura un buzón de toda la vida —Arsys, Ionos, OVH, todos en el 465—
     * rellena servidor, usuario y clave, no toca la casilla porque nadie le ha
     * dicho que deba, y los correos dejan de salir con un tiempo de espera
     * agotado. Desde el móvil el mismo buzón funciona, así que ni siquiera
     * parece un problema de configuración.
     */
    expect(conexionCifrada(465, false)).toBe(true);
    expect(conexionCifrada(465, true)).toBe(true);
  });

  it('el 587 y el 25 empiezan en claro aunque se marque', () => {
    // El error simétrico, y con el mismo síntoma: saludar con TLS a un puerto
    // que espera texto deja la conexión colgada igual.
    expect(conexionCifrada(587, true)).toBe(false);
    expect(conexionCifrada(25, true)).toBe(false);
  });

  it('en un puerto raro decide quien configura', () => {
    // Ahí no hay convención que valga, así que manda la casilla.
    expect(conexionCifrada(2525, true)).toBe(true);
    expect(conexionCifrada(2525, false)).toBe(false);
  });
});

describe('explicarFallo', () => {
  it('convierte el plantón en algo accionable', () => {
    const error = Object.assign(new Error('Greeting never received'), { code: 'ETIMEDOUT' });

    const texto = explicarFallo(error, 'smtp.ejemplo.com', 465);

    expect(texto).toContain('smtp.ejemplo.com');
    expect(texto).toContain('465');
    expect(texto).toMatch(/cortafuegos/);
  });

  it('un fallo de credenciales se cuenta tal cual', () => {
    // Ahí el mensaje del servidor ya es el bueno: añadirle una teoría sobre
    // puertos solo despista.
    const error = Object.assign(new Error('535 Authentication failed'), { code: 'EAUTH' });

    expect(explicarFallo(error, 'smtp.ejemplo.com', 465)).toBe('535 Authentication failed');
  });
});

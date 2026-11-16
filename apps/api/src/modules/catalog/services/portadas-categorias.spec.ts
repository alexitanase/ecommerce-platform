import { describe, expect, it } from 'vitest';
import { siguientePortada } from './portadas-categorias.service.js';

/**
 * La rotación de la foto de una categoría.
 *
 * Lo que se prueba aquí es que la portada **cambia de verdad** cada vez que le
 * toca turno. Es lo único que separa «una categoría con una foto que se renueva
 * cada tres semanas» de «una categoría con la foto del primer producto que se
 * importó, para siempre»: el repaso periódico se ejecutaría igual de bien en
 * los dos casos y nadie se enteraría hasta mirar la tienda meses después.
 */
describe('siguiente portada de categoría', () => {
  const fotos = ['/a.jpg', '/b.jpg', '/c.jpg'];

  it('avanza a la siguiente cada vez que se renueva', () => {
    expect(siguientePortada(fotos, '/a.jpg')).toBe('/b.jpg');
    expect(siguientePortada(fotos, '/b.jpg')).toBe('/c.jpg');
  });

  it('vuelve a empezar al llegar al final', () => {
    expect(siguientePortada(fotos, '/c.jpg')).toBe('/a.jpg');
  });

  it('recorre todas antes de repetir ninguna', () => {
    // Con un sorteo esto fallaría: es la propiedad que justifica avanzar.
    const vistas = new Set<string>();
    let actual: string | null = null;
    for (let i = 0; i < fotos.length; i++) {
      actual = siguientePortada(fotos, actual);
      if (actual) vistas.add(actual);
    }
    expect(vistas.size).toBe(fotos.length);
  });

  it('empieza por la primera cuando la categoría no tenía foto', () => {
    expect(siguientePortada(fotos, null)).toBe('/a.jpg');
  });

  it('empieza por la primera cuando la que tenía ya no está en el catálogo', () => {
    // El producto se despublicó o se le borró la foto: quedarse con una imagen
    // que ya no sirve a nadie sería peor que reiniciar la vuelta.
    expect(siguientePortada(fotos, '/borrada.jpg')).toBe('/a.jpg');
  });

  it('deja la categoría sin foto cuando no hay ningún producto con imagen', () => {
    // Nulo y no la anterior: si la rama se ha quedado vacía, enseñar la foto
    // de un producto que ya no está es enseñar algo que no se puede comprar.
    expect(siguientePortada([], '/a.jpg')).toBeNull();
  });

  it('no cambia nada cuando solo hay una candidata', () => {
    expect(siguientePortada(['/unica.jpg'], '/unica.jpg')).toBe('/unica.jpg');
  });
});

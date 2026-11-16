import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@ecom/shared';
import { ENV } from '../../config/config.module.js';

/**
 * Purga el caché de páginas de la tienda.
 *
 * La tienda pregenera las fichas de producto y las sirve sin tocar la API
 * (ISR). Eso es justo lo que aguanta un pico de campaña, pero significa que un
 * precio cambiado en el admin no se ve hasta que la página caduque sola. Este
 * servicio avisa a Next para que la descarte al momento.
 *
 * Es deliberadamente "el que avisa": si la llamada falla, el `revalidate` de
 * cada página sigue siendo la red de seguridad. Nunca puede hacer que guardar
 * un producto falle.
 */
@Injectable()
export class StorefrontCacheService {
  private readonly logger = new Logger(StorefrontCacheService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * @param etiquetas las mismas que usa la tienda al pedir los datos
   */
  async purgar(etiquetas: string[]): Promise<void> {
    const secreto = this.env.REVALIDATE_SECRET;
    if (!secreto || etiquetas.length === 0) return;

    try {
      // Tiempo corto: la tienda no puede retener una operación del admin. Si no
      // contesta en dos segundos, se sigue y el ISR se encarga por su cuenta.
      const respuesta = await fetch(`${this.env.STOREFRONT_URL}/api/revalidar`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': secreto,
        },
        body: JSON.stringify({ etiquetas }),
        signal: AbortSignal.timeout(2000),
      });

      if (!respuesta.ok) {
        this.logger.warn(`La tienda ha respondido ${respuesta.status} al purgar su caché`);
      }
    } catch (error) {
      this.logger.warn(
        `No se ha podido purgar el caché de la tienda: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** Purga la ficha de un producto en los tres idiomas y los listados. */
  async purgarProducto(slugs: string[]): Promise<void> {
    await this.purgar(['catalogo', ...slugs.map((s) => `producto-${s}`)]);
  }
}

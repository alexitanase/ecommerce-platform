import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'ruta_publica';

/**
 * Marca una ruta como accesible sin autenticación.
 *
 * El guard de JWT es global: por defecto TODO exige token. Abrir una ruta es
 * un acto explícito, de modo que olvidarse de proteger un endpoint nuevo no
 * puede ocurrir por descuido.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

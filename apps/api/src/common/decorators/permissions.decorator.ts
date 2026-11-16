import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permisos_requeridos';

/**
 * Permisos necesarios para usar la ruta. Se exigen TODOS los indicados.
 *
 *   @RequirePermissions('orders:refund')
 *   @RequirePermissions('orders:read', 'payments:read')
 */
export const RequirePermissions = (...permisos: string[]) => SetMetadata(PERMISSIONS_KEY, permisos);

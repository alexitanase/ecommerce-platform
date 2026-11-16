import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PASARELAS_DISPONIBLES } from '@ecom/payments';
import { IntegracionesService } from './integraciones.service.js';
import { StorageService } from '../storage/storage.service.js';
import { SearchService } from '../search/search.service.js';
import { MailService } from '../mail/mail.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { SeguimientoTransportistaService } from '../orders/seguimiento-transportista.service.js';
import { TipoCambioService } from '../settings/tipo-cambio.service.js';

/**
 * Enchufa cada servicio a su comprobación en el panel.
 *
 * Vive aparte del servicio de integraciones a propósito: si el registro se
 * hiciera allí, ese módulo tendría que importar los pagos, el correo, el
 * almacenamiento y el buscador —y los cuatro lo importan a él, así que sería un
 * ciclo. Aquí se cierra el círculo en un solo sitio y sin dependencias cruzadas.
 */
@Injectable()
export class ComprobadoresService implements OnModuleInit {
  constructor(
    private readonly integraciones: IntegracionesService,
    private readonly storage: StorageService,
    private readonly search: SearchService,
    private readonly mail: MailService,
    private readonly payments: PaymentsService,
    private readonly seguimiento: SeguimientoTransportistaService,
    private readonly cambio: TipoCambioService,
  ) {}

  onModuleInit(): void {
    this.integraciones.registrarComprobador('s3', () => this.storage.probar());

    this.integraciones.registrarComprobador('meilisearch', async () => {
      const estado = await this.search.estado();
      return estado.disponible
        ? { ok: true }
        : { ok: false, mensaje: 'El buscador no responde en esa dirección.' };
    });

    this.integraciones.registrarComprobador('smtp', () => this.mail.verificarConexion());

    this.integraciones.registrarComprobador('17track', () => this.seguimiento.probar());

    this.integraciones.registrarComprobador('tipo_cambio', () => this.cambio.probar());

    for (const pasarela of PASARELAS_DISPONIBLES) {
      this.integraciones.registrarComprobador(pasarela.key, () =>
        this.payments.probarPasarela(pasarela.key),
      );
    }
  }
}

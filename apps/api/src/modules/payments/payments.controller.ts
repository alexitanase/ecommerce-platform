import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import type { ClavePasarela } from '@ecom/payments';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { PaymentsService } from './payments.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import { GuardarPasarelasDto, IniciarCobroDto } from './dto/payments.dto.js';

@ApiTags('Pagos')
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Get('methods')
  @ApiOperation({ summary: 'Pasarelas disponibles en el checkout, en orden' })
  metodos(@Query('orderId') orderId?: string) {
    // Con el pedido se aplican también los límites por importe, para no pintar
    // un botón que al pulsarlo responde que esa forma de pago no vale.
    return this.payments.pasarelasActivas(undefined, orderId);
  }

  @Public()
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  @ApiOperation({ summary: 'Iniciar el cobro de un pedido' })
  iniciar(@Body() dto: IniciarCobroDto) {
    return this.payments.iniciarCobro(dto.orderId, {
      ...(dto.provider ? { provider: dto.provider } : {}),
      ...(dto.payCurrency ? { payCurrency: dto.payCurrency } : {}),
    });
  }

  @Public()
  @Get(':paymentId/status')
  @ApiOperation({ summary: 'Estado del cobro (para el contador del checkout)' })
  estado(@Param('paymentId') paymentId: string) {
    return this.payments.estadoCobro(paymentId);
  }

  /**
   * Callback de la pasarela.
   *
   * Público porque lo llama un servidor externo, pero la firma se verifica en
   * el servicio: sin ella, cualquiera podría enviarnos un "pago confirmado".
   *
   * Se usa el cuerpo CRUDO —el que guarda `registrarCuerpoCrudo`— y no el JSON
   * ya parseado: Revolut firma los bytes exactos que envió, y volver a
   * serializar el objeto cambia espaciado, formato de números y escapado. Con
   * el reserializado no verificaría **ninguna** notificación legítima y los
   * pagos con tarjeta se quedarían todos sin confirmar.
   */
  @Public()
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async webhook(
    @Param('provider') provider: ClavePasarela,
    @Req() req: FastifyRequest,
    @Headers() cabeceras: Record<string, string>,
  ) {
    const cuerpo =
      req.cuerpoCrudo ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

    const resultado = await this.payments.procesarWebhook(provider, cuerpo, cabeceras);

    // Siempre 200: si devolviéramos error, la pasarela reintentaría en bucle
    // un webhook que ya sabemos que no vamos a poder procesar.
    return { ok: resultado.procesado, ...(resultado.motivo ? { motivo: resultado.motivo } : {}) };
  }

  // ── Admin ─────────────────────────────────────────────────

  @ApiBearerAuth('access-token')
  @Get('providers')
  @RequirePermissions('payments:read')
  @ApiOperation({ summary: 'Catálogo de pasarelas y su estado de implementación' })
  proveedores() {
    return this.payments.pasarelasDisponibles();
  }

  @ApiBearerAuth('access-token')
  @Get('gateways')
  @RequirePermissions('payments:read')
  @ApiOperation({ summary: 'Estado y configuración de cada pasarela' })
  pasarelas() {
    return this.payments.estadoPasarelas();
  }

  @ApiBearerAuth('access-token')
  @Put('gateways')
  @RequirePermissions('payments:write')
  @ApiOperation({ summary: 'Activar, ordenar y limitar las formas de pago' })
  guardarPasarelas(
    @Body() dto: GuardarPasarelasDto,
    @CurrentUser() u: UsuarioAutenticado,
    @Req() req: FastifyRequest,
  ) {
    return this.payments.guardarPasarelas(dto.pasarelas, { actorId: u.id, actorIp: req.ip });
  }

  @ApiBearerAuth('access-token')
  @Post('gateways/:key/test')
  @HttpCode(HttpStatus.OK)
  // Contra el servidor de la pasarela: sin freno, el botón se convierte en una
  // forma cómoda de que nos limiten la cuenta por exceso de peticiones.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('payments:write')
  @ApiOperation({ summary: 'Comprobar que las credenciales de la pasarela funcionan' })
  probar(@Param('key') key: ClavePasarela) {
    return this.payments.probarPasarela(key);
  }

  @ApiBearerAuth('access-token')
  @Post(':paymentId/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments:read')
  @ApiOperation({ summary: 'Forzar la sincronización de un cobro con la pasarela' })
  reconciliar(@Param('paymentId') paymentId: string) {
    return this.payments.reconciliar(paymentId);
  }
}

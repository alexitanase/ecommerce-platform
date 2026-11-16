import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LOCALES, type Locale } from '@ecom/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CartService } from './cart.service.js';
import { RecuperacionService } from './recuperacion.service.js';
import {
  AñadirAlCarritoDto,
  CambiarCantidadDto,
  EmailCarritoDto,
  SincronizarCarritoDto,
} from './dto/cart.dto.js';

/**
 * Carrito de la tienda.
 *
 * Todas las rutas son públicas porque un invitado tiene que poder comprar sin
 * registrarse. La identificación del carrito va en una cookie httpOnly: si el
 * token viajara en el cuerpo o en localStorage, cualquier script inyectado en
 * la página podría leerlo y ver —o vaciar— el carrito del cliente.
 */
const COOKIE_CARRITO = 'cart_token';

@ApiTags('Carrito')
@Controller({ path: 'cart', version: '1' })
export class CartController {
  constructor(
    private readonly cart: CartService,
    private readonly recuperacion: RecuperacionService,
  ) {}

  /**
   * Resuelve el carrito de la petición y refresca la cookie.
   *
   * Se llama en cada operación porque el carrito puede cambiar de identidad a
   * media sesión: al iniciar sesión, el de invitado se fusiona con el de la
   * cuenta y el id resultante es otro.
   */
  private async resolver(
    req: FastifyRequest,
    reply: FastifyReply,
    userId?: string,
    locale?: Locale,
  ): Promise<string> {
    const token = req.cookies[COOKIE_CARRITO];

    const carrito = await this.cart.obtenerOCrear({
      ...(token ? { token } : {}),
      ...(userId ? { userId } : {}),
      ...(locale ? { locale } : {}),
    });

    if (carrito.token !== token) {
      void reply.setCookie(COOKIE_CARRITO, carrito.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.protocol === 'https',
        path: '/',
        maxAge: 90 * 86_400,
      });
    }

    return carrito.id;
  }

  private idioma(valor?: string): Locale {
    return LOCALES.includes(valor as Locale) ? (valor as Locale) : 'es';
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Contenido del carrito, con precios y stock al día' })
  async ver(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser('id') userId?: string,
    @Query('locale') locale?: string,
  ) {
    const idioma = this.idioma(locale);
    const cartId = await this.resolver(req, reply, userId, idioma);
    return this.cart.ver(cartId, idioma);
  }

  @Public()
  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Añadir un producto al carrito' })
  async añadir(
    @Body() dto: AñadirAlCarritoDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser('id') userId?: string,
    @Query('locale') locale?: string,
  ) {
    const idioma = this.idioma(locale);
    const cartId = await this.resolver(req, reply, userId, idioma);
    await this.cart.añadir(cartId, dto.variantId, dto.cantidad);
    // Se devuelve el carrito entero para que la interfaz no tenga que pedirlo
    // otra vez: son dos viajes menos en la operación más repetida de la tienda.
    return this.cart.ver(cartId, idioma);
  }

  @Public()
  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Cambiar la cantidad de una línea' })
  async cambiar(
    @Param('itemId') itemId: string,
    @Body() dto: CambiarCantidadDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser('id') userId?: string,
    @Query('locale') locale?: string,
  ) {
    const idioma = this.idioma(locale);
    const cartId = await this.resolver(req, reply, userId, idioma);
    await this.cart.cambiarCantidad(cartId, itemId, dto.cantidad);
    return this.cart.ver(cartId, idioma);
  }

  @Public()
  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Quitar una línea del carrito' })
  async quitar(
    @Param('itemId') itemId: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser('id') userId?: string,
    @Query('locale') locale?: string,
  ) {
    const idioma = this.idioma(locale);
    const cartId = await this.resolver(req, reply, userId, idioma);
    await this.cart.quitar(cartId, itemId);
    return this.cart.ver(cartId, idioma);
  }

  @Public()
  @Delete()
  @ApiOperation({ summary: 'Vaciar el carrito' })
  async vaciar(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser('id') userId?: string,
    @Query('locale') locale?: string,
  ) {
    const idioma = this.idioma(locale);
    const cartId = await this.resolver(req, reply, userId, idioma);
    await this.cart.vaciar(cartId);
    return this.cart.ver(cartId, idioma);
  }

  @Public()
  @Post('email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Guardar el email para poder recuperar el carrito' })
  async email(
    @Body() dto: EmailCarritoDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser('id') userId?: string,
  ) {
    const cartId = await this.resolver(req, reply, userId);
    await this.cart.guardarEmail(cartId, dto.email);
  }

  /**
   * Copia del carrito del navegador, para poder recuperarlo si se abandona.
   *
   * La llama el checkout en cuanto hay un email válido. Antes de eso no hay
   * nada que hacer con el carrito: sin dirección de correo no se puede
   * escribir a nadie, y guardarlo solo acumularía filas.
   */
  @Public()
  @Post('sync')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reflejar en el servidor el carrito del navegador' })
  async sincronizar(
    @Body() dto: SincronizarCarritoDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser('id') userId?: string,
  ) {
    const cartId = await this.resolver(req, reply, userId, this.idioma(dto.locale));
    await this.cart.sincronizar(cartId, {
      ...(dto.email ? { email: dto.email } : {}),
      lineas: dto.lineas,
    });
  }

  /**
   * Recupera un carrito desde el enlace de un correo de abandono.
   *
   * Deja la cookie apuntando a ese carrito, así que funciona aunque el cliente
   * abra el correo en otro dispositivo —que es lo normal: se mira en el móvil
   * y se compra en el portátil.
   */
  @Public()
  @Post('recover/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recuperar un carrito abandonado desde el enlace del correo' })
  async recuperar(
    @Param('token') token: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query('locale') locale?: string,
  ) {
    const idioma = this.idioma(locale);
    const carrito = await this.cart.porToken(token);

    void reply.setCookie(COOKIE_CARRITO, carrito.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      path: '/',
      maxAge: 90 * 86_400,
    });

    return this.cart.ver(carrito.id, idioma);
  }

  /** Baja de los avisos de carrito abandonado, desde el enlace del correo. */
  @Public()
  @Post('recover/:token/unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'No volver a recibir avisos de carrito abandonado' })
  async darDeBaja(@Param('token') token: string) {
    await this.recuperacion.darDeBaja(token);
  }
}

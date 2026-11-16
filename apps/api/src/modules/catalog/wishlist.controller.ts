import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LOCALES, type Locale } from '@ecom/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { UsuarioAutenticado } from '../../common/types/request.js';
import type { FastifyRequest } from 'fastify';
import { WishlistService } from './services/wishlist.service.js';
import { AgeService } from '../age/age.service.js';

const fusionarSchema = z.object({
  /** Lo que el invitado tenía guardado en este navegador. */
  productIds: z.array(z.string().min(1).max(40)).max(200),
});

class FusionarDeseosDto extends createZodDto(fusionarSchema) {}

/**
 * Lista de deseos.
 *
 * Salvo `resolve`, todo exige sesión: la lista del invitado vive en su
 * navegador y no toca el servidor hasta que se identifica.
 */
@ApiTags('Lista de deseos')
@Controller({ path: 'wishlist', version: '1' })
export class WishlistController {
  constructor(
    private readonly wishlist: WishlistService,
    private readonly age: AgeService,
  ) {}

  /**
   * Datos de una lista de productos que el visitante lleva en su navegador.
   *
   * Es público porque lo usa quien no tiene cuenta: su lista de deseos y su
   * historial de vistos viven en el navegador, y aquí solo se piden datos de
   * catálogo que ya son públicos. No revela nada que no esté en la tienda.
   */
  @Public()
  @Get('resolve')
  @ApiOperation({ summary: 'Datos de catálogo de una lista de identificadores' })
  async resolver(
    @Req() req: FastifyRequest,
    @Query('ids') ids?: string,
    @Query('locale') locale?: string,
    @CurrentUser('id') userId?: string,
  ) {
    const idioma = LOCALES.includes(locale as Locale) ? (locale as Locale) : 'es';
    const lista = (ids ?? '').split(',').filter(Boolean);

    const incluirAdulto = await this.age.puedeVerAdulto(req, userId);

    return this.wishlist.resumenDe(lista, idioma, incluirAdulto);
  }

  @ApiBearerAuth('access-token')
  @Get()
  @ApiOperation({ summary: 'Mis productos guardados' })
  listar(@CurrentUser() u: UsuarioAutenticado, @Query('locale') locale?: string) {
    const idioma = LOCALES.includes(locale as Locale) ? (locale as Locale) : 'es';
    return this.wishlist.listar(u.id, idioma);
  }

  @ApiBearerAuth('access-token')
  @Get('ids')
  @ApiOperation({ summary: 'Identificadores guardados, para pintar el corazón en los listados' })
  ids(@CurrentUser() u: UsuarioAutenticado) {
    return this.wishlist.ids(u.id);
  }

  @ApiBearerAuth('access-token')
  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fundir la lista del navegador con la de la cuenta al entrar' })
  fusionar(@Body() dto: FusionarDeseosDto, @CurrentUser() u: UsuarioAutenticado) {
    return this.wishlist.fusionar(u.id, dto.productIds);
  }

  @ApiBearerAuth('access-token')
  @Post(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Guardar un producto' })
  anadir(@Param('productId') productId: string, @CurrentUser() u: UsuarioAutenticado) {
    return this.wishlist.anadir(u.id, productId);
  }

  @ApiBearerAuth('access-token')
  @Delete(':productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Quitar un producto de la lista' })
  quitar(@Param('productId') productId: string, @CurrentUser() u: UsuarioAutenticado) {
    return this.wishlist.quitar(u.id, productId);
  }
}

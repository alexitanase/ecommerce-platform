import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { newId } from '@ecom/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CrearDireccionDto, ActualizarDireccionDto } from './dto/addresses.dto.js';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(userId: string) {
    return this.prisma.client.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async crear(userId: string, dto: CrearDireccionDto) {
    const total = await this.prisma.client.address.count({
      where: { userId, type: dto.type, deletedAt: null },
    });

    // La primera dirección de cada tipo es la predeterminada aunque no se pida:
    // si no, el checkout no tendría ninguna que preseleccionar.
    const predeterminada = dto.isDefault || total === 0;

    if (predeterminada) {
      await this.quitarPredeterminada(userId, dto.type);
    }

    return this.prisma.client.address.create({
      data: {
        id: newId(),
        userId,
        type: dto.type,
        firstName: dto.firstName,
        lastName: dto.lastName,
        company: dto.company ?? null,
        taxId: dto.taxId ?? null,
        line1: dto.line1,
        line2: dto.line2 ?? null,
        city: dto.city,
        province: dto.province,
        postalCode: dto.postalCode,
        countryCode: dto.countryCode,
        phone: dto.phone ?? null,
        isDefault: predeterminada,
      },
    });
  }

  async actualizar(userId: string, addressId: string, dto: ActualizarDireccionDto) {
    const actual = await this.buscarPropia(userId, addressId);

    if (dto.isDefault) {
      await this.quitarPredeterminada(userId, dto.type ?? actual.type);
    }

    return this.prisma.client.address.update({
      where: { id: addressId },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.company !== undefined ? { company: dto.company } : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
        ...(dto.line1 !== undefined ? { line1: dto.line1 } : {}),
        ...(dto.line2 !== undefined ? { line2: dto.line2 } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.province !== undefined ? { province: dto.province } : {}),
        ...(dto.postalCode !== undefined ? { postalCode: dto.postalCode } : {}),
        ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      },
    });
  }

  async eliminar(userId: string, addressId: string): Promise<void> {
    const direccion = await this.buscarPropia(userId, addressId);

    // Borrado lógico: un pedido antiguo debe seguir mostrando a dónde se envió,
    // y la factura ya emitida no puede quedarse sin dirección.
    await this.prisma.client.address.update({
      where: { id: addressId },
      data: { deletedAt: new Date(), isDefault: false },
    });

    // Si era la predeterminada, se asciende la siguiente para que el checkout
    // no se quede sin ninguna seleccionada.
    if (direccion.isDefault) {
      const siguiente = await this.prisma.client.address.findFirst({
        where: { userId, type: direccion.type, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (siguiente) {
        await this.prisma.client.address.update({
          where: { id: siguiente.id },
          data: { isDefault: true },
        });
      }
    }
  }

  async marcarPredeterminada(userId: string, addressId: string) {
    const direccion = await this.buscarPropia(userId, addressId);
    await this.quitarPredeterminada(userId, direccion.type);
    return this.prisma.client.address.update({
      where: { id: addressId },
      data: { isDefault: true },
    });
  }

  // ── Internos ──────────────────────────────────────────────

  /**
   * Comprueba que la dirección existe Y pertenece a quien la pide.
   *
   * Sin esta comprobación, cambiar el ID en la URL permitiría leer o modificar
   * la dirección de otro cliente: es la vulnerabilidad más común en APIs REST
   * (IDOR), y aquí expone nombre, teléfono y domicilio de un tercero.
   */
  private async buscarPropia(userId: string, addressId: string) {
    const direccion = await this.prisma.client.address.findUnique({ where: { id: addressId } });

    if (!direccion || direccion.deletedAt) {
      throw new NotFoundException('Dirección no encontrada');
    }
    if (direccion.userId !== userId) {
      // Mismo mensaje que si no existiera: confirmar que existe pero es de otro
      // ya filtra información.
      throw new ForbiddenException('Dirección no encontrada');
    }

    return direccion;
  }

  private async quitarPredeterminada(userId: string, tipo: 'SHIPPING' | 'BILLING'): Promise<void> {
    await this.prisma.client.address.updateMany({
      where: { userId, type: tipo, isDefault: true, deletedAt: null },
      data: { isDefault: false },
    });
  }
}

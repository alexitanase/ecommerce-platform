// Simula dos clientes reservando a la vez la última unidad disponible.
const { createPrismaClient } =
  await import('/home/iulian/Workspace/Pown/EcommercePlatform/packages/db/dist/index.js');
const prisma = createPrismaClient(process.env.DATABASE_URL);

// Dejamos una variante con stock exactamente 1
const v = await prisma.productVariant.findFirst({ where: { sku: 'BOT-N-42' } });
await prisma.productVariant.update({ where: { id: v.id }, data: { stock: 1 } });
await prisma.stockReservation.deleteMany({ where: { variantId: v.id } });
console.log(`Variante ${v.sku} preparada con stock = 1\n`);

// Copia mínima de la lógica de reserva del servicio, para probarla directamente
async function reservar(cartId, variantId, cantidad) {
  return prisma.$transaction(async (tx) => {
    const [fila] = await tx.$queryRaw`
      SELECT stock, "allowBackorder" FROM product_variants WHERE id = ${variantId} FOR UPDATE`;
    const [agg] = await tx.$queryRaw`
      SELECT COALESCE(SUM(quantity),0)::bigint AS total FROM stock_reservations
      WHERE "variantId" = ${variantId} AND "expiresAt" > NOW() AND ("cartId" IS DISTINCT FROM ${cartId})`;
    const disponible = fila.stock - Number(agg.total);
    if (disponible < cantidad) return { cartId, ok: false, disponible };
    await tx.stockReservation.create({
      data: {
        id: 'res_' + cartId,
        variantId,
        cartId,
        quantity: cantidad,
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    return { cartId, ok: true };
  });
}

const [a, b] = await Promise.all([reservar('carritoA', v.id, 1), reservar('carritoB', v.id, 1)]);
console.log(
  'Cliente A:',
  a.ok ? '✓ reserva conseguida' : `✗ rechazado (disponible: ${a.disponible})`,
);
console.log(
  'Cliente B:',
  b.ok ? '✓ reserva conseguida' : `✗ rechazado (disponible: ${b.disponible})`,
);
const exitos = [a, b].filter((r) => r.ok).length;
console.log(
  `\nReservas concedidas: ${exitos} → ${exitos === 1 ? '✓ CORRECTO (solo una)' : '✗ FALLO: sobreventa'}`,
);
const total = await prisma.stockReservation.aggregate({
  where: { variantId: v.id },
  _sum: { quantity: true },
});
console.log(`Unidades reservadas en total: ${total._sum.quantity ?? 0} (stock: 1)`);
await prisma.stockReservation.deleteMany({ where: { variantId: v.id } });
await prisma.productVariant.update({ where: { id: v.id }, data: { stock: 3 } });
await prisma.$disconnect();

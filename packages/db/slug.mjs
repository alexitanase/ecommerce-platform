import { prisma } from './dist/index.js';
const t = await prisma.productTranslation.findFirst({
  where: { locale: 'es', product: { status: 'ACTIVE', deletedAt: null } },
  select: { slug: true },
});
console.log(t?.slug ?? 'SIN_PRODUCTO');
process.exit(0);

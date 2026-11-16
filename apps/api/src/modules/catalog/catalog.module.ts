import { Module } from '@nestjs/common';
import { BrandsController } from './brands.controller.js';
import { CatalogController } from './catalog.controller.js';
import { ReviewsController } from './reviews.controller.js';
import { AttributesService } from './services/attributes.service.js';
import { BrandsService } from './services/brands.service.js';
import { CategoriesService } from './services/categories.service.js';
import { InventoryService } from './services/inventory.service.js';
import { PricingService } from './services/pricing.service.js';
import { PriceHistoryService } from './services/price-history.service.js';
import { PortadasCategoriasService } from './services/portadas-categorias.service.js';
import { ProductsService } from './services/products.service.js';
import { RelacionadosService } from './services/relacionados.service.js';
import { SolicitudResenasService } from './services/solicitud-resenas.service.js';
import { ReviewsService } from './services/reviews.service.js';
import { WishlistController } from './wishlist.controller.js';
import { WishlistService } from './services/wishlist.service.js';

@Module({
  controllers: [BrandsController, CatalogController, ReviewsController, WishlistController],
  providers: [
    AttributesService,
    BrandsService,
    PriceHistoryService,
    ProductsService,
    CategoriesService,
    PortadasCategoriasService,
    RelacionadosService,
    SolicitudResenasService,
    InventoryService,
    ReviewsService,
    PricingService,
    WishlistService,
  ],
  exports: [
    BrandsService,
    PriceHistoryService,
    ProductsService,
    CategoriesService,
    PortadasCategoriasService,
    SolicitudResenasService,
    InventoryService,
    PricingService,
  ],
})
export class CatalogModule {}

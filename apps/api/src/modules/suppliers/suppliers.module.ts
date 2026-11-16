import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto.service.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { TraduccionModule } from '../translation/traduccion.module.js';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';
import { SupplierSyncService } from './sync.service.js';
import { SupplierImportService } from './import.service.js';
import { AutorizacionProveedoresService } from './autorizacion.service.js';
import { CatalogoDreamloveService } from './dreamlove/catalogo.service.js';
import { ImportacionCatalogoService } from './dreamlove/importacion-catalogo.service.js';
import { ImportacionMasivaService } from './dreamlove/importacion-masiva.service.js';
import { SubidaCatalogoService } from './dreamlove/subida-catalogo.service.js';
import { CategoriasProveedorService } from './categorias-proveedor.service.js';

@Module({
  imports: [CatalogModule, TraduccionModule],
  controllers: [SuppliersController],
  providers: [
    SuppliersService,
    SupplierSyncService,
    SupplierImportService,
    AutorizacionProveedoresService,
    CryptoService,
    // Proveedores sin API: su catálogo se guarda aquí y se sirve desde aquí.
    CatalogoDreamloveService,
    ImportacionCatalogoService,
    ImportacionMasivaService,
    SubidaCatalogoService,
    CategoriasProveedorService,
  ],
  exports: [
    SuppliersService,
    SupplierSyncService,
    SupplierImportService,
    AutorizacionProveedoresService,
    CatalogoDreamloveService,
  ],
})
export class SuppliersModule {}

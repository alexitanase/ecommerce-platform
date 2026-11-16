import { Module } from '@nestjs/common';
import { ContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
import { PortadaService } from './portada.service.js';
import { MenuService } from './menu.service.js';
import { BlogService } from './blog.service.js';
import { SitemapService } from './sitemap.service.js';

@Module({
  controllers: [ContentController],
  providers: [ContentService, PortadaService, MenuService, BlogService, SitemapService],
  exports: [ContentService, PortadaService, MenuService],
})
export class ContentModule {}

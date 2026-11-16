import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service.js';
import { StorefrontCacheService } from '../../cache/storefront-cache.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * La foto con la que se enseña cada categoría.
 *
 * La tienda quiere enseñar las categorías con imagen —en la portada, en la
 * página de categorías y en los filtros del buscador— y no hay ninguna: subir
 * una a mano por cada una de las cientos que trae el catálogo del proveedor no
 * va a pasar nunca. Así que se toma prestada la de uno de sus productos.
 *
 * Lo que NO se hace es calcularla al servir. Sacar «una foto de la rama» es un
 * `LIKE` sobre el path más un salto a `media`, y eso multiplicado por las doce
 * categorías de la portada y por cada visita es un coste fijo en la pantalla
 * más visitada de la tienda para un dato que cambia una vez al mes. Se calcula
 * una vez, se guarda en la propia categoría (`coverUrl`) y a partir de ahí es
 * un campo más de la fila que ya se estaba leyendo.
 *
 * **Rota, no se congela.** Una portada fija convierte la categoría en la foto
 * de un producto concreto —el que se importó primero— para siempre. Cada
 * repaso avanza a la siguiente candidata, así que quien vuelve a las tres
 * semanas ve otra cosa y la sección parece viva. La rotación es determinista
 * (la siguiente de la lista, no una al azar) para que dos ejecuciones seguidas
 * no puedan repetir la misma foto y para poder probarla.
 */
/**
 * La foto que le toca ahora: la que va después de la actual.
 *
 * Se avanza en vez de sortear porque un sorteo puede repetir la que ya estaba
 * —con cuatro candidatas, una de cada cuatro renovaciones no cambia nada— y
 * porque una decisión al azar no se puede probar. Avanzar garantiza que la
 * foto cambia siempre que haya más de una, y recorre todas antes de repetir
 * ninguna.
 */
export function siguientePortada(candidatas: string[], actual: string | null): string | null {
  if (candidatas.length === 0) return null;

  const posicion = actual ? candidatas.indexOf(actual) : -1;
  // Si la actual ya no está entre las candidatas —se despublicó el producto,
  // se borró la foto— se empieza de nuevo por la primera.
  if (posicion === -1) return candidatas[0] ?? null;

  return candidatas[(posicion + 1) % candidatas.length] ?? null;
}

@Injectable()
export class PortadasCategoriasService {
  private readonly logger = new Logger(PortadasCategoriasService.name);

  /**
   * Días que vale una portada antes de renovarse.
   *
   * Dieciocho, que cae dentro de las dos o tres semanas que se buscaban. No es
   * un número redondo a propósito: con 14 o 21 todas las categorías importadas
   * el mismo día caducarían siempre en el mismo día de la semana, y el repaso
   * de ese día haría el trabajo de tres.
   */
  static readonly DIAS_DE_VIGENCIA = 18;

  /**
   * Cuántas se renuevan como mucho en un repaso.
   *
   * El primer repaso de una tienda recién importada se encuentra el catálogo
   * entero sin portada. Sin tope, ese repaso recorrería cientos de ramas de
   * golpe —cada una con su consulta— mientras la API atiende tráfico. Con
   * tope, la primera semana las va calculando poco a poco y de paso quedan
   * repartidas en el calendario, que es justo lo que evita que vuelvan a
   * caducar todas juntas.
   */
  static readonly POR_REPASO = 150;

  /**
   * Entre cuántos productos de la rama se rota.
   *
   * Suficientes para que la foto cambie durante años sin repetirse y pocos
   * como para que la consulta siga siendo barata. Son los más recientes: son
   * los que mejor representan lo que hay hoy en la categoría.
   */
  private static readonly CANDIDATOS = 40;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly storefront: StorefrontCacheService,
  ) {}

  /**
   * Renueva las portadas que ya han cumplido, empezando por las más viejas.
   *
   * Las que nunca han tenido (`coverAt` nulo) van primero: una categoría sin
   * foto se ve peor que una con foto repetida.
   */
  async refrescarCaducadas(): Promise<{ revisadas: number; cambiadas: number }> {
    const limite = new Date(Date.now() - PortadasCategoriasService.DIAS_DE_VIGENCIA * 86_400_000);

    const pendientes = await this.prisma.client.category.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        OR: [{ coverAt: null }, { coverAt: { lt: limite } }],
      },
      orderBy: { coverAt: { sort: 'asc', nulls: 'first' } },
      take: PortadasCategoriasService.POR_REPASO,
      select: { id: true },
    });

    let cambiadas = 0;
    for (const categoria of pendientes) {
      // Una rama que falle no puede llevarse por delante el repaso entero: las
      // demás categorías se quedarían sin foto por un problema de la vecina.
      try {
        if (await this.refrescar(categoria.id)) cambiadas++;
      } catch (error) {
        this.logger.warn(
          `No se ha podido calcular la portada de la categoría ${categoria.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (cambiadas > 0) {
      /*
       * Purgar lo que enseña estas fotos, o no se ven hasta que caduque.
       *
       * La portada la cachea la propia API cinco minutos y la tienda guarda el
       * árbol de categorías diez. Sin purgar, el repaso cambia la foto en la
       * base de datos y la tienda sigue enseñando la anterior un buen rato: no
       * es grave —son minutos— pero convierte «he renovado las portadas» en
       * «las he renovado, vuelve luego», que es justo lo que hace dudar de si
       * la tarea funciona. Es la misma purga que hace el menú al guardarse.
       */
      await this.cache.invalidarEspacio('portada');
      await this.storefront.purgar(['catalogo', 'categorias', 'portada']);
    }

    if (pendientes.length > 0) {
      this.logger.log(
        `Portadas de categoría: ${pendientes.length} revisadas, ${cambiadas} cambiadas`,
      );
    }

    return { revisadas: pendientes.length, cambiadas };
  }

  /**
   * Elige la portada de una categoría y la guarda.
   *
   * Devuelve `true` si la foto ha cambiado. Una rama sin productos con foto
   * también se marca como revisada —con la portada a nulo— para que el repaso
   * del día siguiente no vuelva a mirarla: sin eso, las categorías vacías se
   * llevarían el cupo del repaso todos los días y las que sí tienen productos
   * nunca llegarían a calcularse.
   */
  async refrescar(categoryId: string): Promise<boolean> {
    const categoria = await this.prisma.client.category.findUnique({
      where: { id: categoryId },
      select: { path: true, coverUrl: true },
    });
    if (!categoria) return false;

    const candidatas = await this.candidatas(categoria.path);
    const elegida = siguientePortada(candidatas, categoria.coverUrl);

    await this.prisma.client.category.update({
      where: { id: categoryId },
      data: { coverUrl: elegida, coverAt: new Date() },
    });

    return elegida !== categoria.coverUrl;
  }

  /**
   * Las fotos entre las que se rota, en orden estable.
   *
   * Se mira la RAMA entera, no solo la categoría: los productos cuelgan de la
   * hoja más concreta, así que una raíz como «Lovetoys» tiene cero productos
   * propios y miles por debajo. Buscar solo los suyos la dejaría sin foto justo
   * a ella, que es la que sale en la portada.
   */
  private async candidatas(path: string): Promise<string[]> {
    const productos = await this.prisma.client.product.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        category: { path: { startsWith: path }, deletedAt: null },
        media: { some: { deletedAt: null, kind: 'IMAGE' } },
      },
      // Los más nuevos primero, y el identificador como desempate: sin él, dos
      // productos publicados en el mismo segundo —lo normal en una importación
      // masiva— podrían salir en distinto orden en cada consulta y la rotación
      // dejaría de avanzar.
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: PortadasCategoriasService.CANDIDATOS,
      select: {
        media: {
          where: { deletedAt: null, kind: 'IMAGE' },
          orderBy: { position: 'asc' },
          take: 1,
          select: { url: true },
        },
      },
    });

    return productos.flatMap((p) => (p.media[0] ? [p.media[0].url] : []));
  }
}

import type { ArticuloDreamlove, GrupoDreamlove, RepositorioCatalogoDreamlove } from './tipos.js';

/**
 * Catálogo de Dreamlove en memoria.
 *
 * La implementación de verdad vive en la API y consulta Postgres. Esta existe
 * para poder probar el adaptador —y el contrato común de proveedores— sin base
 * de datos, y para que quien lea el adaptador tenga delante un ejemplo
 * completo de lo que se espera del repositorio.
 *
 * Reproduce a propósito el comportamiento que importa: la búsqueda ignora
 * mayúsculas y tildes, y las respuestas vienen agrupadas por familia.
 */
export class CatalogoDreamloveEnMemoria implements RepositorioCatalogoDreamlove {
  constructor(private readonly articulos: ArticuloDreamlove[]) {}

  private grupos(articulos = this.articulos): GrupoDreamlove[] {
    const porClave = new Map<string, GrupoDreamlove>();

    for (const articulo of articulos) {
      const grupo = porClave.get(articulo.claveGrupo) ?? [];
      grupo.push(articulo);
      porClave.set(articulo.claveGrupo, grupo);
    }

    return [...porClave.values()];
  }

  buscar(parametros: {
    texto?: string;
    soloDisponibles?: boolean;
    pagina: number;
    porPagina: number;
    orden?: 'relevancia' | 'precio_asc' | 'precio_desc' | 'ventas';
  }): Promise<{ grupos: GrupoDreamlove[]; total: number }> {
    const buscado = normalizar(parametros.texto ?? '');

    let grupos = this.grupos().filter((grupo) =>
      buscado === '' ? true : grupo.some((a) => normalizar(textoBuscable(a)).includes(buscado)),
    );

    if (parametros.soloDisponibles) {
      grupos = grupos.filter((g) => g.some((a) => a.disponible));
    }

    const coste = (g: GrupoDreamlove): number => Math.min(...g.map((a) => a.costeCents));
    if (parametros.orden === 'precio_asc') grupos.sort((a, b) => coste(a) - coste(b));
    if (parametros.orden === 'precio_desc') grupos.sort((a, b) => coste(b) - coste(a));

    const desde = (parametros.pagina - 1) * parametros.porPagina;

    return Promise.resolve({
      grupos: grupos.slice(desde, desde + parametros.porPagina),
      total: grupos.length,
    });
  }

  grupoPorReferencia(referencia: string): Promise<GrupoDreamlove | null> {
    const buscada = referencia.trim().toLowerCase();

    const encontrado = this.articulos.find(
      (a) =>
        a.externalId.toLowerCase() === buscada ||
        a.codigo.toLowerCase() === buscada ||
        a.claveGrupo.toLowerCase() === buscada ||
        a.eans.some((e) => e.toLowerCase() === buscada),
    );

    if (!encontrado) return Promise.resolve(null);

    return Promise.resolve(this.articulos.filter((a) => a.claveGrupo === encontrado.claveGrupo));
  }

  gruposPorClaves(claves: string[]): Promise<GrupoDreamlove[]> {
    const buscadas = new Set(claves);
    return Promise.resolve(this.grupos(this.articulos.filter((a) => buscadas.has(a.claveGrupo))));
  }
}

const normalizar = (texto: string): string =>
  texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const textoBuscable = (a: ArticuloDreamlove): string =>
  [a.titulo, a.tituloGrupo, a.marca, a.marcaRaiz, a.codigo, ...a.eans].filter(Boolean).join(' ');

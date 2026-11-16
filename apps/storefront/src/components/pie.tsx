import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { BotonPreferenciasCookies } from '@/components/aviso-cookies';
import { CerrarAccesoAdulto } from '@/components/puerta-edad';
import { MetodosDePago } from '@/components/metodos-pago';
import { CARRIL } from './ui/pagina';

/**
 * Pie de página.
 *
 * Los enlaces legales son obligatorios en España: aviso legal, privacidad,
 * cookies y condiciones de venta. El contenido lo edita el admin y se renderiza
 * en páginas dinámicas.
 */
export async function PieDePagina({
  locale,
  marca,
}: {
  locale: string;
  marca: Record<string, unknown>;
}) {
  const t = await getTranslations('nav');
  const nombre = (marca['brand.name'] as string) ?? 'Tienda';
  const razonSocial = (marca['legal.companyName'] as string) || nombre;
  const nif = marca['legal.taxId'] as string | undefined;
  const logo = marca['brand.logoLight'] as string | null;

  const legales = [
    { slug: 'aviso-legal', es: 'Aviso legal', ca: 'Avís legal', en: 'Legal notice' },
    { slug: 'privacidad', es: 'Privacidad', ca: 'Privacitat', en: 'Privacy' },
    { slug: 'cookies', es: 'Cookies', ca: 'Galetes', en: 'Cookies' },
    {
      slug: 'condiciones',
      es: 'Condiciones de venta',
      ca: 'Condicions de venda',
      en: 'Terms of sale',
    },
    { slug: 'envios', es: 'Envíos', ca: 'Enviaments', en: 'Shipping' },
    { slug: 'devoluciones', es: 'Devoluciones', ca: 'Devolucions', en: 'Returns' },
  ];

  return (
    <footer className="mt-16 border-t border-[var(--borde)] bg-[var(--fondo-sutil)]">
      <div className={`mx-auto ${CARRIL} px-4 py-10 sm:px-6`}>
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div>
            {/*
              El logotipo si lo hay, y entonces el nombre no se repite debajo:
              el logotipo ya lo lleva escrito dentro. Es la misma regla que la
              cabecera. Lo que sí se queda siempre es la razón social con el
              NIF, que va aparte y es obligatorio (art. 10 LSSI).

              Se usa el logotipo claro, igual que la cabecera. Toda la tienda
              cambia de tema con variables CSS y no con clases, así que un
              logotipo por tema exigiría montar aquí un mecanismo que no existe
              en ningún otro sitio; el día que haga falta, se hace en los dos a
              la vez.
            */}
            {logo ? (
              <Image
                src={logo}
                alt={nombre}
                width={200}
                height={32}
                className="h-8 w-auto object-contain"
              />
            ) : (
              <p className="font-semibold">{nombre}</p>
            )}
            {/* Un poco más de aire bajo el logotipo que bajo el nombre: una
                imagen no lleva la interlínea que sí trae un párrafo, y pegada
                queda apretada. Sin logotipo se deja como estaba. */}
            <p className={`${logo ? 'mt-2' : 'mt-1'} text-sm text-[var(--texto-tenue)]`}>
              {razonSocial}
              {nif ? ` · ${nif}` : ''}
            </p>
          </div>

          {/*
            El catálogo y su índice, siempre.

            La sub-barra la configura quien lleva la tienda y admite seis
            enlaces: en cuanto se llena de categorías de campaña, el índice
            completo se cae del menú y deja de haber forma de llegar a las
            categorías que no están en él. Aquí no se cae nunca, y el pie es
            donde la gente ya busca el mapa de un sitio.
          */}
          <nav aria-label={t('menu_tienda')}>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href="/buscar"
                  className="text-[var(--texto-suave)] transition-colors hover:text-[var(--texto)]"
                >
                  {t('productos')}
                </Link>
              </li>
              <li>
                <Link
                  href="/categorias"
                  className="text-[var(--texto-suave)] transition-colors hover:text-[var(--texto)]"
                >
                  {t('categorias')}
                </Link>
              </li>
              <li>
                <Link
                  href="/ofertas"
                  className="text-[var(--texto-suave)] transition-colors hover:text-[var(--texto)]"
                >
                  {t('ofertas')}
                </Link>
              </li>
              <li>
                <Link
                  href="/marcas"
                  className="text-[var(--texto-suave)] transition-colors hover:text-[var(--texto)]"
                >
                  {t('marcas')}
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label={t('inicio')}>
            <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              {legales.map((l) => (
                <li key={l.slug}>
                  <Link
                    href={{ pathname: '/[slug]', params: { slug: l.slug } } as never}
                    className="text-[var(--texto-suave)] transition-colors hover:text-[var(--texto)]"
                  >
                    {(l as Record<string, string>)[locale] ?? l.es}
                  </Link>
                </li>
              ))}
              <li>
                {/* Retirar el consentimiento tiene que costar lo mismo que
                    darlo: si no se puede cambiar de opinión desde cualquier
                    página, el consentimiento no es libre y no vale. */}
                <BotonPreferenciasCookies />
              </li>
              <li>
                {/* Solo se pinta si hay acceso +18 abierto. Un ordenador
                    compartido es el escenario que más probablemente pone el
                    catálogo delante de un menor. */}
                <CerrarAccesoAdulto />
              </li>
            </ul>
          </nav>
        </div>

        {/* Debajo de los enlaces y encima del aviso de copyright: es donde se
            mira cuando ya se ha decidido comprar y falta la última duda. */}
        <MetodosDePago />

        <p className="mt-8 border-t border-[var(--borde)] pt-6 text-xs text-[var(--texto-tenue)]">
          © {new Date().getFullYear()} {razonSocial}
        </p>
      </div>
    </footer>
  );
}

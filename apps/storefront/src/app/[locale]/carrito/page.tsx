import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { RecuperarCarrito } from '@/components/recuperar-carrito';
import { VistaCarrito } from '@/components/vista-carrito';
import { CARRIL } from '@/components/ui/pagina';

export default async function PaginaCarrito({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Todo el carrito vive en el navegador, así que la página es un contenedor
  // del componente de cliente. No tiene sentido renderizarlo en servidor: el
  // servidor no sabe qué hay en el carrito de este visitante.
  return (
    <>
      {/* Lee la query (`?recuperar=`, `?baja=`), así que necesita Suspense para
          no obligar a renderizar toda la página en cada visita. */}
      <div className={`mx-auto w-full ${CARRIL} px-4 pt-6 sm:px-6`}>
        <Suspense fallback={null}>
          <RecuperarCarrito />
        </Suspense>
      </div>
      <VistaCarrito locale={locale} />
    </>
  );
}

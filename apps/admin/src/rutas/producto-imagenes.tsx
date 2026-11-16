import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, del, post } from '@/lib/api';
import { Tarjeta } from '@/componentes/ui/datos';
import { Boton } from '@/componentes/ui/boton';
import { SubirArchivo } from '@/componentes/ui/formulario';
import { ConfirmarPeligro } from '@/componentes/ui/overlays';
import { RecorteImagen } from '@/componentes/ui/recorte-imagen';
import { useToast } from '@/componentes/ui/toast';

/**
 * Imágenes del producto.
 *
 * En dropshipping las fotos llegan del proveedor y casi nunca sirven tal cual:
 * vienen con marcas de agua en una esquina, con relaciones distintas entre sí
 * —que descuadran la ficha— o con el producto perdido en un tercio del encuadre.
 * Hasta ahora la única salida era descargarlas, abrir un editor aparte y volver
 * a subirlas.
 *
 * La primera imagen es la que sale en el listado y en las redes sociales cuando
 * alguien comparte el enlace, así que poder elegir cuál es importa más de lo que
 * parece.
 */

export interface ImagenProducto {
  id: string;
  url: string;
  alt: string | null;
}

export function ImagenesProducto({
  productId,
  imagenes,
}: {
  productId: string;
  imagenes: ImagenProducto[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [recortando, setRecortando] = useState<ImagenProducto | null>(null);
  const [borrando, setBorrando] = useState<ImagenProducto | null>(null);

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: ['producto', productId] });
    void qc.invalidateQueries({ queryKey: ['productos'] });
  };

  const subir = useMutation({
    mutationFn: async (fichero: Blob) => {
      const cuerpo = new FormData();
      // El nombre importa: el servidor comprueba el contenido real, pero sin
      // nombre algunos navegadores mandan la parte sin `filename` y Fastify la
      // descarta como si no hubiera fichero.
      cuerpo.append('file', fichero, fichero instanceof File ? fichero.name : 'recorte.jpg');
      return api(`/media/upload/${productId}`, { method: 'POST', body: cuerpo });
    },
    onSuccess: () => {
      refrescar();
      setRecortando(null);
      toast.exito(t('imagenes.subida'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const borrar = useMutation({
    mutationFn: (id: string) => del(`/media/${id}`),
    onSuccess: () => {
      refrescar();
      setBorrando(null);
      toast.exito(t('imagenes.borrada'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reordenar = useMutation({
    mutationFn: (ids: string[]) => post('/media/reorder', { ids }),
    onSuccess: () => {
      refrescar();
      toast.exito(t('imagenes.orden_guardado'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Descarga la imagen tal cual está, sin pasar por el servidor. */
  const descargar = async (imagen: ImagenProducto) => {
    try {
      const respuesta = await fetch(imagen.url);
      const blob = await respuesta.blob();
      const enlace = document.createElement('a');
      enlace.href = URL.createObjectURL(blob);
      enlace.download = `${imagen.id}.jpg`;
      enlace.click();
      URL.revokeObjectURL(enlace.href);
    } catch {
      toast.error(t('imagenes.descarga_fallo'));
    }
  };

  /** Mueve una imagen al principio: es la que se ve en todas partes. */
  const hacerPrincipal = (id: string) => {
    reordenar.mutate([id, ...imagenes.filter((m) => m.id !== id).map((m) => m.id)]);
  };

  return (
    <Tarjeta titulo={t('productos.imagenes')} descripcion={t('imagenes.ayuda_principal')}>
      <SubirArchivo
        etiqueta={t('imagenes.subir')}
        ayuda={t('imagenes.subir_ayuda')}
        acepta="image/jpeg,image/png,image/webp,image/avif"
        alElegir={(ficheros) => {
          for (const f of ficheros) subir.mutate(f);
        }}
      />

      {imagenes.length === 0 ? (
        <p className="mt-4 text-sm" style={{ color: 'var(--texto-tenue)' }}>
          {t('productos.sin_imagenes')}
        </p>
      ) : (
        <ul className="galeria mt-4">
          {imagenes.map((m, i) => (
            <li key={m.id} className="galeria-item">
              <img src={m.url} alt={m.alt ?? ''} loading="lazy" className="galeria-imagen" />

              {i === 0 && <span className="galeria-principal">{t('imagenes.principal')}</span>}

              <div className="galeria-acciones">
                <Boton tamano="sm" variante="secundario" onClick={() => setRecortando(m)}>
                  {t('imagenes.recortar')}
                </Boton>
                <Boton tamano="sm" variante="secundario" onClick={() => void descargar(m)}>
                  {t('imagenes.descargar')}
                </Boton>
                {i !== 0 && (
                  <Boton
                    tamano="sm"
                    variante="fantasma"
                    disabled={reordenar.isPending}
                    onClick={() => hacerPrincipal(m.id)}
                  >
                    {t('imagenes.hacer_principal')}
                  </Boton>
                )}
                <Boton tamano="sm" variante="fantasma" onClick={() => setBorrando(m)}>
                  {t('app.eliminar')}
                </Boton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {recortando && (
        <RecorteImagen
          abierto
          url={recortando.url}
          guardando={subir.isPending}
          alCerrar={() => setRecortando(null)}
          // El recorte entra como imagen nueva y la original se queda: si el
          // encuadre no convence, deshacerlo es borrar la nueva, no volver a
          // pedirle la foto al proveedor.
          alGuardar={(blob) => subir.mutate(blob)}
          alFallar={() => toast.error(t('imagenes.recorte_fallo'))}
        />
      )}

      <ConfirmarPeligro
        abierto={borrando !== null}
        alCerrar={() => setBorrando(null)}
        alConfirmar={() => borrando && borrar.mutate(borrando.id)}
        trabajando={borrar.isPending}
        titulo={t('imagenes.borrar_titulo')}
        descripcion={t('imagenes.borrar_ayuda')}
        textoConfirmar={t('app.eliminar')}
      />
    </Tarjeta>
  );
}

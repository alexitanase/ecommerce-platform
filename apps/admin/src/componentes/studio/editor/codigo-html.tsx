import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Capa, Documento, Mesa } from '@ecom/shared';
import { Boton } from '@/componentes/ui/boton';
import { Modal } from '@/componentes/ui/overlays';
import { Alerta, Cargando } from '@/componentes/estados';
import { useToast } from '@/componentes/ui/toast';
import { copiar } from '@/lib/studio';
import { formatearHtml, marcadoDeMesa } from '@/lib/studio-exportar';
import { importarHtmlComoCapas } from '@/lib/studio-importar-html';

/**
 * El código de la pieza, a la vista y editable.
 *
 * Es la otra cara del motor de dibujo: como lo que se pinta ES HTML, se puede
 * enseñar tal cual. Sirve para tres cosas que antes no había forma de hacer —
 * copiar la maqueta y llevársela, retocar algo más rápido escribiéndolo que
 * arrastrándolo, y entender por qué una capa se ve como se ve—.
 *
 * Aplicar los cambios **no es gratis y se avisa**: el código vuelve a entrar por
 * el importador, así que las capas se rehacen desde cero. Se conservan la
 * posición y los estilos, se pierden los nombres que se les hubiera puesto y la
 * relación con los activos de la biblioteca. Para tocar un color no compensa;
 * para reescribir la maqueta entera, sí.
 */
export function CodigoHtml({
  documento,
  mesa,
  activos,
  alCerrar,
  alAplicar,
  editable,
}: {
  documento: Documento;
  mesa: Mesa;
  activos: Record<string, string>;
  alCerrar: () => void;
  alAplicar: (capas: Capa[]) => void;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const [codigo, setCodigo] = useState<string | null>(null);
  const [tocado, setTocado] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [error, setError] = useState('');

  // Sin incrustar las imágenes: una foto en `data:` son cien mil caracteres de
  // base64 y dejan el código ilegible, que es justo lo contrario de para lo
  // que se abre esta ventana.
  useEffect(() => {
    let cancelado = false;

    void marcadoDeMesa(documento, mesa, activos, { incrustar: false })
      .then((html) => {
        if (!cancelado) setCodigo(formatearHtml(html));
      })
      .catch((e: unknown) => {
        if (!cancelado) setError((e as Error).message);
      });

    return () => {
      cancelado = true;
    };
  }, [documento, mesa, activos]);

  const aplicar = async () => {
    if (!codigo) return;
    setAplicando(true);
    setError('');

    try {
      const r = await importarHtmlComoCapas(codigo, mesa);
      if (r.capas.length === 0) {
        setError(t('studio.codigo_vacio'));
        return;
      }
      alAplicar(r.capas);
      for (const aviso of r.avisos) toast.mostrar(aviso);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAplicando(false);
    }
  };

  return (
    <Modal
      abierto
      titulo={t('studio.codigo_html')}
      descripcion={t('studio.codigo_html_ayuda')}
      alCerrar={alCerrar}
      ancho="lg"
    >
      {codigo === null && !error ? (
        <Cargando />
      ) : (
        <div className="studio-formulario">
          <textarea
            className="campo font-mono"
            rows={16}
            spellCheck={false}
            value={codigo ?? ''}
            readOnly={!editable}
            aria-label={t('studio.codigo_html')}
            onChange={(e) => {
              setCodigo(e.target.value);
              setTocado(true);
              setError('');
            }}
          />

          {tocado && <Alerta tono="aviso">{t('studio.codigo_rehace')}</Alerta>}
          {error && <Alerta tono="error">{error}</Alerta>}

          <div className="modal-pie">
            <Boton
              variante="secundario"
              onClick={() => {
                void copiar(codigo ?? '').then((hecho) =>
                  hecho
                    ? toast.exito(t('studio.codigo_copiado'))
                    : toast.error(t('studio.enlace_no_copiado')),
                );
              }}
            >
              {t('studio.copiar')}
            </Boton>
            <Boton variante="secundario" onClick={alCerrar}>
              {t('app.cerrar')}
            </Boton>
            {editable && (
              <Boton
                variante="primario"
                cargando={aplicando}
                disabled={!tocado}
                onClick={() => void aplicar()}
              >
                {t('studio.aplicar_codigo')}
              </Boton>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

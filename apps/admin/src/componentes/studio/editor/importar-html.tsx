import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Capa, Mesa } from '@ecom/shared';
import { Boton } from '@/componentes/ui/boton';
import { Modal } from '@/componentes/ui/overlays';
import { Alerta } from '@/componentes/estados';
import { importarHtmlComoBloque, importarHtmlComoCapas } from '@/lib/studio-importar-html';

/**
 * Traer un HTML al Studio.
 *
 * Dos modos, y la diferencia entre ellos es lo único que hay que entender:
 *
 *  · **En capas.** El navegador maqueta el fichero y se lee dónde ha puesto
 *    cada cosa. Salen capas de verdad —se mueven, se reescriben, se adaptan a
 *    otro formato— a cambio de perder la maquetación fluida: lo que era un
 *    `flex` pasa a ser una posición fija. En un banner, que es de tamaño fijo,
 *    eso es exactamente lo que se quiere.
 *  · **Tal cual.** Entra de una pieza y se toca el código. Conserva animaciones
 *    y comportamiento, pero no se puede arrastrar nada por separado.
 *
 * Quien duda, casi siempre quiere el primero: lo trae para retocarlo.
 */
export function ImportarHtml({
  mesa,
  alCerrar,
  alImportar,
}: {
  mesa: Mesa;
  alCerrar: () => void;
  alImportar: (capas: Capa[], avisos: string[]) => void;
}) {
  const { t } = useTranslation();
  const entrada = useRef<HTMLInputElement>(null);

  const [html, setHtml] = useState('');
  const [nombre, setNombre] = useState('');
  const [modo, setModo] = useState<'capas' | 'bloque'>('capas');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');

  const leerFichero = async (ficheros: FileList | null) => {
    const fichero = ficheros?.[0];
    if (!fichero) return;
    setNombre(fichero.name);
    setHtml(await fichero.text());
    setError('');
  };

  const importar = async () => {
    if (!html.trim()) return;
    setTrabajando(true);
    setError('');

    try {
      if (modo === 'bloque') {
        alImportar([importarHtmlComoBloque(html, mesa, nombre || 'Bloque HTML')], []);
        return;
      }

      const r = await importarHtmlComoCapas(html, mesa);
      if (r.capas.length === 0) {
        setError(t('studio.importar_vacio'));
        return;
      }

      const avisos = [...r.avisos];
      if (r.imagenesExternas.length > 0) {
        // Las imágenes del fichero no existen dentro del Studio: la capa queda
        // con su sitio reservado y hay que subirlas a la biblioteca. Se dice
        // ahora y no cuando se vea el hueco.
        avisos.push(t('studio.importar_imagenes', { count: r.imagenesExternas.length }));
      }

      alImportar(r.capas, avisos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Modal
      abierto
      titulo={t('studio.importar_html')}
      descripcion={t('studio.importar_html_ayuda')}
      alCerrar={alCerrar}
      ancho="lg"
    >
      <div className="studio-formulario">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={entrada}
            type="file"
            accept=".html,.htm,text/html"
            className="hidden"
            onChange={(e) => void leerFichero(e.target.files)}
          />
          <Boton variante="secundario" onClick={() => entrada.current?.click()}>
            {t('studio.elegir_fichero')}
          </Boton>
          {nombre && (
            <span className="text-sm" style={{ color: 'var(--texto-tenue)' }}>
              {nombre}
            </span>
          )}
        </div>

        <label className="studio-campo">
          <span>{t('studio.o_pegar')}</span>
          <textarea
            className="campo font-mono"
            rows={8}
            value={html}
            spellCheck={false}
            placeholder="<div style=…>"
            onChange={(e) => {
              setHtml(e.target.value);
              setError('');
            }}
          />
        </label>

        <fieldset className="studio-modos">
          <legend className="etiqueta-campo">{t('studio.importar_modo')}</legend>

          {(
            [
              ['capas', t('studio.importar_capas'), t('studio.importar_capas_ayuda')],
              ['bloque', t('studio.importar_bloque'), t('studio.importar_bloque_ayuda')],
            ] as const
          ).map(([valor, titulo, ayuda]) => (
            <label
              key={valor}
              className={`studio-modo ${modo === valor ? 'studio-modo-elegido' : ''}`}
            >
              <input
                type="radio"
                name="modo-importacion"
                checked={modo === valor}
                onChange={() => setModo(valor)}
              />
              <span>
                <strong>{titulo}</strong>
                <small>{ayuda}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {error && <Alerta tono="error">{error}</Alerta>}

        <div className="modal-pie">
          <Boton variante="secundario" onClick={alCerrar}>
            {t('app.cancelar')}
          </Boton>
          <Boton
            variante="primario"
            cargando={trabajando}
            disabled={!html.trim()}
            onClick={() => void importar()}
          >
            {t('studio.importar')}
          </Boton>
        </div>
      </div>
    </Modal>
  );
}

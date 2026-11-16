import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boton, GrupoBotones } from './boton';

/**
 * Editor de la descripción larga.
 *
 * Es un editor de código con vista previa, no un procesador de textos. La razón
 * es que el HTML que hay que arreglar no lo hemos escrito nosotros: viene de
 * AliExpress lleno de `<font>`, tablas anidadas, estilos en línea y anchuras
 * fijas en píxeles que descuadran la ficha en el móvil. Un editor visual esconde
 * justamente eso —lo pinta y ya— y no deja quitarlo. Aquí se ve y se corrige.
 *
 * La vista previa es una aproximación honesta pero **no es la tienda**: el
 * saneado de verdad lo hace el servidor al guardar, y puede quitar cosas que
 * aquí se ven. Por eso se avisa en la propia pantalla en lugar de prometer un
 * «tal cual se verá».
 */

/** Etiquetas que el servidor conserva. Se enseñan para no escribir a ciegas. */
const PERMITIDAS =
  'p br hr h2 h3 h4 strong b em i u s small sup sub ul ol li blockquote table thead tbody tr th td a img span div';

/**
 * Envuelve o inserta una etiqueta en la selección.
 *
 * Trabaja sobre el `textarea` real y no sobre el estado porque hay que respetar
 * el cursor: insertar al final obliga a cortar y pegar a mano, que es
 * exactamente lo que se quiere evitar.
 */
function envolver(area: HTMLTextAreaElement, apertura: string, cierre: string): string {
  const { value, selectionStart, selectionEnd } = area;
  const dentro = value.slice(selectionStart, selectionEnd);
  return value.slice(0, selectionStart) + apertura + dentro + cierre + value.slice(selectionEnd);
}

/**
 * Limpia el HTML del proveedor.
 *
 * No es seguridad —de eso se encarga el servidor— sino legibilidad: quita lo que
 * hace que una descripción importada se vea mal en la tienda. Los estilos en
 * línea y las anchuras fijas son los culpables de que la ficha se salga de la
 * pantalla en el móvil.
 */
function limpiar(html: string): string {
  return (
    html
      // Etiquetas de presentación que el servidor va a tirar de todas formas.
      .replace(/<\/?(font|center|big|tt|marquee)[^>]*>/gi, '')
      // Estilos, clases, ids y anchuras fijas.
      .replace(
        /\s(style|class|id|width|height|align|bgcolor|border|cellpadding|cellspacing)="[^"]*"/gi,
        '',
      )
      .replace(/\s(style|class|id|width|height|align)='[^']*'/gi, '')
      // Atributos `data-*`, que solo sirven al sitio de origen.
      .replace(/\sdata-[\w-]+="[^"]*"/gi, '')
      // Comentarios, que a veces traen el HTML entero de su plantilla.
      .replace(/<!--[\s\S]*?-->/g, '')
      // Párrafos y divs que se quedan vacíos tras la limpieza.
      .replace(/<(p|div|span)>\s*<\/\1>/gi, '')
      .replace(/(\r?\n\s*){3,}/g, '\n\n')
      .trim()
  );
}

export function EditorHtml({
  valor,
  alGuardar,
  filas = 12,
  etiqueta,
}: {
  valor: string;
  /** Se llama al salir del campo, solo si el contenido ha cambiado. */
  alGuardar: (html: string) => void;
  filas?: number;
  etiqueta: string;
}) {
  const { t } = useTranslation();
  const [texto, setTexto] = useState(valor);
  const [vista, setVista] = useState<'codigo' | 'previa'>('codigo');
  const id = useId();

  const guardarSiCambia = () => {
    if (texto !== valor) alGuardar(texto);
  };

  const accion = (apertura: string, cierre: string) => {
    const area = document.getElementById(id) as HTMLTextAreaElement | null;
    if (!area) return;
    setTexto(envolver(area, apertura, cierre));
    area.focus();
  };

  // La previa se recalcula solo cuando hace falta: en una descripción larga
  // rehacerla en cada tecla se nota al escribir.
  const previa = useMemo(() => (vista === 'previa' ? texto : ''), [vista, texto]);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {etiqueta}
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <GrupoBotones etiqueta={t('editor.formato')}>
            <Boton tamano="sm" variante="secundario" onClick={() => accion('<p>', '</p>')}>
              ¶
            </Boton>
            <Boton
              tamano="sm"
              variante="secundario"
              etiqueta={t('editor.negrita')}
              onClick={() => accion('<strong>', '</strong>')}
            >
              <strong>B</strong>
            </Boton>
            <Boton
              tamano="sm"
              variante="secundario"
              etiqueta={t('editor.cursiva')}
              onClick={() => accion('<em>', '</em>')}
            >
              <em>I</em>
            </Boton>
            <Boton tamano="sm" variante="secundario" onClick={() => accion('<h3>', '</h3>')}>
              H3
            </Boton>
            <Boton
              tamano="sm"
              variante="secundario"
              etiqueta={t('editor.lista')}
              onClick={() => accion('<ul>\n  <li>', '</li>\n</ul>')}
            >
              •
            </Boton>
          </GrupoBotones>

          {/* Lo que arregla de una vez una descripción importada. */}
          <Boton
            tamano="sm"
            variante="secundario"
            onClick={() => setTexto((h) => limpiar(h))}
            disabled={texto.trim() === ''}
          >
            {t('editor.limpiar')}
          </Boton>

          <GrupoBotones etiqueta={t('editor.vista')}>
            <Boton
              tamano="sm"
              variante={vista === 'codigo' ? 'primario' : 'secundario'}
              aria-pressed={vista === 'codigo'}
              onClick={() => setVista('codigo')}
            >
              {t('editor.codigo')}
            </Boton>
            <Boton
              tamano="sm"
              variante={vista === 'previa' ? 'primario' : 'secundario'}
              aria-pressed={vista === 'previa'}
              onClick={() => setVista('previa')}
            >
              {t('editor.previa')}
            </Boton>
          </GrupoBotones>
        </div>
      </div>

      {vista === 'codigo' ? (
        <textarea
          id={id}
          rows={filas}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={guardarSiCambia}
          spellCheck={false}
          className="campo font-mono text-base sm:text-xs"
        />
      ) : (
        <>
          {/*
           * `dangerouslySetInnerHTML` con HTML que aún no ha pasado por el
           * servidor. Es aceptable aquí y solo aquí: quien lo ve es quien
           * acaba de escribirlo, en su propio panel, y el objetivo del campo es
           * precisamente ver qué hace ese HTML. En la tienda se pinta el que ya
           * viene saneado de la base de datos, nunca este.
           */}
          <div
            className="contenido-html rounded-lg border p-3"
            style={{ borderColor: 'var(--borde)', minHeight: `${filas * 1.5}rem` }}
            dangerouslySetInnerHTML={{ __html: previa }}
          />
          <Boton tamano="sm" variante="secundario" className="mt-2" onClick={guardarSiCambia}>
            {t('app.guardar')}
          </Boton>
        </>
      )}

      <p className="mt-1 text-xs" style={{ color: 'var(--texto-tenue)' }}>
        {t('editor.ayuda')} <code className="font-mono">{PERMITIDAS}</code>
      </p>
    </div>
  );
}

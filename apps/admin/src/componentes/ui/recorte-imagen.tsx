import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boton, GrupoBotones } from './boton';
import { Modal } from './overlays';

/**
 * Recorte de imagen.
 *
 * Se hace en el navegador y no en el servidor por dos motivos. El primero es
 * que quien recorta necesita VER el resultado antes de guardarlo, y un recorte
 * a ciegas por coordenadas no lo permite. El segundo es que la imagen ya está
 * en la máquina de quien edita: subirla, recortarla y volver a bajarla para
 * enseñarla son tres viajes para algo que el canvas resuelve al instante.
 *
 * Lo que sale es un JPEG de calidad alta con el fondo en blanco: si el original
 * tiene transparencia, aplanarla contra blanco es lo que espera cualquiera que
 * recorta una foto de producto, y no hacerlo deja los bordes en negro.
 *
 * Las proporciones fijas están porque una ficha con imágenes de distinta
 * relación se ve descuadrada en la tienda, y cuadrarlas a ojo arrastrando es
 * imposible.
 */

interface Seleccion {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

type Arrastre =
  | { tipo: 'mover'; dx: number; dy: number }
  | { tipo: 'redimensionar'; esquina: 'ne' | 'nw' | 'se' | 'sw' }
  | { tipo: 'dibujar'; x0: number; y0: number }
  | null;

const PROPORCIONES: { etiqueta: string; valor: number | null }[] = [
  { etiqueta: 'Libre', valor: null },
  { etiqueta: '1:1', valor: 1 },
  { etiqueta: '4:5', valor: 4 / 5 },
  { etiqueta: '16:9', valor: 16 / 9 },
];

export function RecorteImagen({
  abierto,
  url,
  alCerrar,
  alGuardar,
  alFallar,
  guardando = false,
}: {
  abierto: boolean;
  url: string;
  alCerrar: () => void;
  /** Recibe el recorte ya convertido en fichero, listo para subir. */
  alGuardar: (recorte: Blob) => void;
  /** Se llama si el navegador no deja leer la imagen recortada. */
  alFallar?: () => void;
  guardando?: boolean;
}) {
  const { t } = useTranslation();
  const caja = useRef<HTMLDivElement>(null);
  const imagen = useRef<HTMLImageElement>(null);
  /*
   * Selección inicial: el 80 % centrado.
   *
   * Va en el valor inicial y no en un efecto porque este componente se monta de
   * cero cada vez que se abre —el padre lo pinta solo cuando hay imagen que
   * recortar—, así que el estado ya nace limpio. Ponerlo en un efecto obligaba
   * a pintar dos veces: una sin selección y otra con ella.
   */
  const [seleccion, setSeleccion] = useState<Seleccion | null>({
    x: 10,
    y: 10,
    ancho: 80,
    alto: 80,
  });
  const [proporcion, setProporcion] = useState<number | null>(null);
  const [arrastre, setArrastre] = useState<Arrastre>(null);
  const [medidas, setMedidas] = useState({ ancho: 0, alto: 0 });

  /** Coordenadas del puntero relativas a la imagen, en porcentaje. */
  const posicion = useCallback((e: React.PointerEvent | PointerEvent) => {
    const rect = imagen.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  }, []);

  /**
   * Ajusta la altura para respetar la proporción pedida.
   *
   * La proporción llega como argumento y no se lee del estado a propósito: al
   * pulsar «1:1» hay que cambiar el modo Y recuadrar la selección en el mismo
   * evento, y una función que leyera el estado usaría todavía el valor
   * anterior. El síntoma era que el primer clic en una proporción no hacía
   * nada y el segundo sí.
   */
  const conProporcion = useCallback((s: Seleccion, ratio: number | null): Seleccion => {
    if (ratio === null) return s;
    const rect = imagen.current?.getBoundingClientRect();
    if (!rect) return s;

    // La proporción es de píxeles y el porcentaje va sobre lados distintos:
    // sin convertir, un 1:1 sale rectangular en cuanto la foto no es cuadrada.
    let ancho = s.ancho;
    let alto = (((ancho / 100) * rect.width) / ratio / rect.height) * 100;

    // Si no cabe a lo alto, se recorta por el otro lado en vez de deformar.
    if (s.y + alto > 100) {
      alto = 100 - s.y;
      ancho = (((alto / 100) * rect.height * ratio) / rect.width) * 100;
    }

    return { ...s, ancho, alto };
  }, []);

  useEffect(() => {
    if (!arrastre) return;

    const mover = (e: PointerEvent) => {
      const { x, y } = posicion(e);

      setSeleccion((s) => {
        if (!s) return s;

        if (arrastre.tipo === 'mover') {
          return {
            ...s,
            x: Math.min(100 - s.ancho, Math.max(0, x - arrastre.dx)),
            y: Math.min(100 - s.alto, Math.max(0, y - arrastre.dy)),
          };
        }

        if (arrastre.tipo === 'dibujar') {
          return conProporcion(
            {
              x: Math.min(arrastre.x0, x),
              y: Math.min(arrastre.y0, y),
              ancho: Math.abs(x - arrastre.x0),
              alto: Math.abs(y - arrastre.y0),
            },
            proporcion,
          );
        }

        const derecha = s.x + s.ancho;
        const abajo = s.y + s.alto;
        const nueva = { ...s };

        if (arrastre.esquina.includes('w')) {
          nueva.x = Math.min(x, derecha - 5);
          nueva.ancho = derecha - nueva.x;
        } else {
          nueva.ancho = Math.max(5, x - s.x);
        }

        if (arrastre.esquina.includes('n')) {
          nueva.y = Math.min(y, abajo - 5);
          nueva.alto = abajo - nueva.y;
        } else {
          nueva.alto = Math.max(5, y - s.y);
        }

        return conProporcion(nueva, proporcion);
      });
    };

    const soltar = () => setArrastre(null);

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
  }, [arrastre, posicion, conProporcion, proporcion]);

  /** Recorta de verdad, sobre el original a tamaño completo. */
  const recortar = () => {
    const img = imagen.current;
    if (!img || !seleccion) return;

    // `naturalWidth` y no el tamaño en pantalla: recortar sobre la versión
    // reducida perdería la mitad de la resolución sin avisar.
    const sx = (seleccion.x / 100) * img.naturalWidth;
    const sy = (seleccion.y / 100) * img.naturalHeight;
    const sw = (seleccion.ancho / 100) * img.naturalWidth;
    const sh = (seleccion.alto / 100) * img.naturalHeight;

    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(sw);
    lienzo.height = Math.round(sh);

    const ctx = lienzo.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, lienzo.width, lienzo.height);

    // Leer el canvas puede fallar si el almacenamiento de imágenes deja de
    // mandar cabeceras CORS. Se avisa en lugar de no hacer nada: un botón que
    // no responde manda a buscar el problema donde no está.
    try {
      lienzo.toBlob(
        (blob) => {
          if (blob) alGuardar(blob);
          else alFallar?.();
        },
        'image/jpeg',
        0.92,
      );
    } catch {
      alFallar?.();
    }
  };

  /*
   * Tamaño real del recorte, a partir de las medidas guardadas al cargar la
   * imagen y no leyendo la referencia al vuelo: durante el render una
   * referencia puede no apuntar todavía a nada, y lo que se enseñaría sería un
   * tamaño de la pasada anterior.
   */
  const medida =
    seleccion && medidas.ancho > 0
      ? {
          ancho: Math.round((seleccion.ancho / 100) * medidas.ancho),
          alto: Math.round((seleccion.alto / 100) * medidas.alto),
        }
      : null;

  return (
    <Modal
      abierto={abierto}
      alCerrar={alCerrar}
      titulo={t('imagenes.recortar')}
      descripcion={t('imagenes.recortar_ayuda')}
      ancho="lg"
      pie={
        <>
          <Boton variante="secundario" onClick={alCerrar}>
            {t('app.cancelar')}
          </Boton>
          <Boton variante="primario" onClick={recortar} cargando={guardando} disabled={!seleccion}>
            {t('imagenes.guardar_recorte')}
          </Boton>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <GrupoBotones etiqueta={t('imagenes.proporcion')}>
          {PROPORCIONES.map((p) => (
            <Boton
              key={p.etiqueta}
              tamano="sm"
              variante={proporcion === p.valor ? 'primario' : 'secundario'}
              aria-pressed={proporcion === p.valor}
              onClick={() => {
                setProporcion(p.valor);
                setSeleccion((s) => (s ? conProporcion(s, p.valor) : s));
              }}
            >
              {p.etiqueta}
            </Boton>
          ))}
        </GrupoBotones>

        {medida && (
          <span className="cifra text-xs" style={{ color: 'var(--texto-tenue)' }}>
            {medida.ancho} × {medida.alto} px
            {medidas.ancho > 0 && ` · ${t('imagenes.original')} ${medidas.ancho} × ${medidas.alto}`}
          </span>
        )}
      </div>

      <div
        ref={caja}
        className="recorte-lienzo"
        onPointerDown={(e) => {
          // Arrastrar sobre el fondo dibuja una selección nueva; sobre la
          // selección, la mueve. Es lo que hace cualquier editor y lo que la
          // gente prueba sin que se lo expliquen.
          if (e.target === imagen.current) {
            const { x, y } = posicion(e);
            setSeleccion({ x, y, ancho: 0, alto: 0 });
            setArrastre({ tipo: 'dibujar', x0: x, y0: y });
          }
        }}
      >
        <img
          ref={imagen}
          src={url}
          alt=""
          /*
           * Sin esto el recorte no funciona, y falla de la peor manera: en
           * silencio.
           *
           * Las imágenes viven en otro origen (el almacenamiento de objetos).
           * Cargadas sin modo CORS, el navegador deja pintarlas en un canvas
           * pero marca el canvas como «contaminado» y `toBlob()` lanza una
           * excepción de seguridad al intentar leerlo. El botón de guardar
           * parecía no hacer nada.
           */
          crossOrigin="anonymous"
          draggable={false}
          onLoad={(e) =>
            setMedidas({
              ancho: e.currentTarget.naturalWidth,
              alto: e.currentTarget.naturalHeight,
            })
          }
          className="recorte-imagen"
        />

        {seleccion && (
          <div
            className="recorte-seleccion"
            style={{
              left: `${seleccion.x}%`,
              top: `${seleccion.y}%`,
              width: `${seleccion.ancho}%`,
              height: `${seleccion.alto}%`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const { x, y } = posicion(e);
              setArrastre({ tipo: 'mover', dx: x - seleccion.x, dy: y - seleccion.y });
            }}
          >
            {(['nw', 'ne', 'sw', 'se'] as const).map((esquina) => (
              <span
                key={esquina}
                className={`recorte-tirador recorte-${esquina}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setArrastre({ tipo: 'redimensionar', esquina });
                }}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

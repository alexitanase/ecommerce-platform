import { describe, expect, it } from 'vitest';
import {
  aplicarVariables,
  capasDeMesa,
  clonarMesa,
  desenlazar,
  documentoSchema,
  documentoVacio,
  escalarTipografia,
  problemasDelDocumento,
  recolocarRecuadro,
  resolverColor,
  sincronizarEnlace,
  type Anclaje,
  type Capa,
  type Documento,
} from './documento-creatividad.js';

let n = 0;
const nuevoId = () => `id${++n}`;

const doc300x250 = (): Documento => {
  n = 0;
  return documentoVacio('exoclick.display.300x250', nuevoId);
};

/** Mesa por posición, con error claro: `doc.mesas[i]` puede ser undefined. */
const mesaDe = (doc: Documento, i: number) => {
  const mesa = doc.mesas[i];
  if (!mesa) throw new Error(`No hay mesa en la posición ${i}`);
  return mesa;
};

const capaDe = (doc: Documento, mesa: number, i = 0): Capa => {
  const capa = capasDeMesa(doc, mesaDe(doc, mesa).id)[i];
  if (!capa) throw new Error(`No hay capa ${i} en la mesa ${mesa}`);
  return capa;
};

const comoTexto = (capa: Capa) => {
  if (capa.tipo !== 'texto') throw new Error(`La capa es ${capa.tipo}, no texto`);
  return capa;
};

/** Cambia el titular de una capa de texto sin tocar nada más. */
const cambiarTitular = (doc: Documento, id: string, es: string): Documento => ({
  ...doc,
  capas: doc.capas.map((c) =>
    c.id === id && c.tipo === 'texto' ? { ...c, contenido: { es } } : c,
  ),
});

const texto = (doc: Documento, extra: Record<string, unknown> = {}): Capa =>
  ({
    id: nuevoId(),
    mesaId: mesaDe(doc, 0).id,
    tipo: 'texto',
    orden: 0,
    nombre: 'Titular',
    visible: true,
    bloqueada: false,
    opacidad: 1,
    fusion: 'normal',
    recuadro: { x: 20, y: 20, ancho: 200, alto: 60, rotacion: 0 },
    anclaje: { x: 'izquierda', y: 'arriba' },
    contenido: { es: 'Hasta -40 %' },
    fuente: 'marca',
    peso: 700,
    tamano: 24,
    interlineado: 1.15,
    espaciado: 0,
    alineacion: 'izquierda',
    alineacionVertical: 'arriba',
    transformar: 'ninguna',
    color: '#111111',
    ajuste: 'encoger',
    ...extra,
  }) as unknown as Capa;

describe('documentoVacio', () => {
  it('crea una mesa del formato pedido y la marca maestra', () => {
    const doc = doc300x250();
    expect(doc.mesas).toHaveLength(1);
    expect(mesaDe(doc, 0).ancho).toBe(300);
    expect(mesaDe(doc, 0).alto).toBe(250);
    expect(mesaDe(doc, 0).maestra).toBe(true);
    expect(doc.capas).toEqual([]);
  });

  it('falla claro con un formato que no existe', () => {
    expect(() => documentoVacio('exoclick.display.1x1', nuevoId)).toThrow(/Formato desconocido/);
  });

  it('el documento vacío pasa su propio esquema', () => {
    expect(documentoSchema.safeParse(doc300x250()).success).toBe(true);
  });
});

describe('recolocarRecuadro', () => {
  const origen = { ancho: 300, alto: 250 };
  const anclado = (x: Anclaje['x'], y: Anclaje['y']): Anclaje => ({ x, y });

  it('escala con el factor uniforme más pequeño, sin deformar', () => {
    // De 300×250 a 600×250: el factor uniforme es 1, no 2. Duplicar el ancho de
    // una foto y no su alto es exactamente lo que hace que un banner adaptado
    // se note adaptado.
    const r = recolocarRecuadro(
      { x: 0, y: 0, ancho: 100, alto: 50, rotacion: 0 },
      anclado('izquierda', 'arriba'),
      origen,
      { ancho: 600, alto: 250 },
    );
    expect(r.ancho).toBe(100);
    expect(r.alto).toBe(50);
  });

  it('mantiene pegada a su esquina una capa anclada abajo a la derecha', () => {
    const r = recolocarRecuadro(
      { x: 240, y: 200, ancho: 40, alto: 30, rotacion: 0 },
      anclado('derecha', 'abajo'),
      origen,
      { ancho: 900, alto: 250 },
    );
    // Margen original: 20 px a la derecha y 20 abajo. El factor uniforme es 1.
    expect(900 - (r.x + r.ancho)).toBeCloseTo(20, 1);
    expect(250 - (r.y + r.alto)).toBeCloseTo(20, 1);
  });

  it('conserva el centro de una capa centrada', () => {
    const r = recolocarRecuadro(
      { x: 100, y: 100, ancho: 100, alto: 50, rotacion: 0 },
      anclado('centro', 'centro'),
      origen,
      { ancho: 1080, alto: 1920 },
    );
    expect(r.x + r.ancho / 2).toBeCloseTo(540, 0);
    expect(r.y + r.alto / 2).toBeCloseTo(960, 0);
  });

  it('estira un fondo de borde a borde', () => {
    const r = recolocarRecuadro(
      { x: 0, y: 0, ancho: 300, alto: 250, rotacion: 0 },
      anclado('estirar', 'estirar'),
      origen,
      { ancho: 728, alto: 90 },
    );
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.ancho).toBe(728);
    expect(r.alto).toBe(90);
  });

  it('nunca devuelve un tamaño de cero', () => {
    const r = recolocarRecuadro(
      { x: 0, y: 0, ancho: 1, alto: 1, rotacion: 0 },
      anclado('izquierda', 'arriba'),
      { ancho: 1920, alto: 1080 },
      { ancho: 160, alto: 600 },
    );
    expect(r.ancho).toBeGreaterThanOrEqual(1);
    expect(r.alto).toBeGreaterThanOrEqual(1);
  });

  it('conserva la rotación', () => {
    const r = recolocarRecuadro(
      { x: 10, y: 10, ancho: 50, alto: 50, rotacion: -12 },
      anclado('izquierda', 'arriba'),
      origen,
      { ancho: 600, alto: 500 },
    );
    expect(r.rotacion).toBe(-12);
  });
});

describe('escalarTipografia', () => {
  it('escala con el factor y nunca baja de lo legible', () => {
    expect(escalarTipografia(48, 0.5)).toBe(24);
    expect(escalarTipografia(6, 0.1)).toBe(4);
  });
});

describe('clonarMesa', () => {
  it('crea la mesa nueva con las capas recolocadas y enlazadas', () => {
    let doc = doc300x250();
    doc = { ...doc, capas: [texto(doc)] };
    const antes = capaDe(doc, 0);

    doc = clonarMesa(doc, mesaDe(doc, 0).id, 'exoclick.display.728x90', nuevoId);

    expect(doc.mesas).toHaveLength(2);
    expect(mesaDe(doc, 1).ancho).toBe(728);
    expect(mesaDe(doc, 1).maestra).toBe(false);

    const copiada = capaDe(doc, 1);
    expect(copiada.id).not.toBe(antes.id);
    expect(copiada.enlace).toBe(antes.id);
    // La original también recibe el enlace, o la sincronización iría en un solo
    // sentido y arreglar el titular en la copia no lo arreglaría en el origen.
    expect(doc.capas.find((c) => c.id === antes.id)?.enlace).toBe(antes.id);
  });

  it('encoge el cuerpo del texto al ir a una mesa más pequeña', () => {
    let doc = doc300x250();
    doc = { ...doc, capas: [texto(doc, { tamano: 40 })] };
    doc = clonarMesa(doc, mesaDe(doc, 0).id, 'exoclick.display.300x100', nuevoId);

    expect(comoTexto(capaDe(doc, 1)).tamano).toBeLessThan(40);
  });

  it('no deja las mesas amontonadas en el mismo sitio del lienzo', () => {
    let doc = doc300x250();
    doc = clonarMesa(doc, mesaDe(doc, 0).id, 'exoclick.display.728x90', nuevoId);
    expect(mesaDe(doc, 1).posicion.x).toBeGreaterThanOrEqual(mesaDe(doc, 0).ancho);
  });

  it('el resultado sigue siendo un documento válido', () => {
    let doc = doc300x250();
    doc = { ...doc, capas: [texto(doc)] };
    doc = clonarMesa(doc, mesaDe(doc, 0).id, 'social.vertical.1080x1920', nuevoId);
    expect(documentoSchema.safeParse(doc).success).toBe(true);
    expect(problemasDelDocumento(doc)).toEqual([]);
  });
});

describe('sincronizarEnlace', () => {
  it('propaga el contenido y deja la geometría en paz', () => {
    let doc = doc300x250();
    doc = { ...doc, capas: [texto(doc)] };
    doc = clonarMesa(doc, mesaDe(doc, 0).id, 'exoclick.display.728x90', nuevoId);

    const origen = capaDe(doc, 0);
    const copiaAntes = capaDe(doc, 1);

    doc = cambiarTitular(doc, origen.id, 'Nuevo titular');
    doc = sincronizarEnlace(doc, origen.id);

    const copia = capaDe(doc, 1);
    expect(comoTexto(copia).contenido.es).toBe('Nuevo titular');
    expect(copia.recuadro).toEqual(copiaAntes.recuadro);
  });

  it('una capa desenlazada deja de recibir cambios', () => {
    let doc = doc300x250();
    doc = { ...doc, capas: [texto(doc)] };
    doc = clonarMesa(doc, mesaDe(doc, 0).id, 'exoclick.display.728x90', nuevoId);

    const origen = capaDe(doc, 0);
    doc = desenlazar(doc, capaDe(doc, 1).id);

    doc = cambiarTitular(doc, origen.id, 'Cambiado');
    doc = sincronizarEnlace(doc, origen.id);

    expect(comoTexto(capaDe(doc, 1)).contenido.es).toBe('Hasta -40 %');
  });
});

describe('estilos y variables', () => {
  it('resuelve una referencia a un color compartido', () => {
    const doc: Documento = {
      ...doc300x250(),
      estilos: { colores: [{ id: 'primario', nombre: 'Primario', valor: '#e11d48' }], textos: [] },
    };
    expect(resolverColor(doc, '@primario')).toBe('#e11d48');
    expect(resolverColor(doc, '#123456')).toBe('#123456');
  });

  it('un estilo borrado no pinta negro por sorpresa', () => {
    expect(resolverColor(doc300x250(), '@noexiste', '#ffffff')).toBe('#ffffff');
  });

  it('sustituye variables y deja intactas las que no existen', () => {
    const doc: Documento = {
      ...doc300x250(),
      variables: [{ clave: 'descuento', tipo: 'texto', etiqueta: '', valor: '40 %' }],
    };
    expect(aplicarVariables('Hasta {{descuento}} y {{otra}}', doc)).toBe('Hasta 40 % y {{otra}}');
  });
});

describe('problemasDelDocumento', () => {
  it('detecta una capa huérfana', () => {
    const doc = doc300x250();
    const suelta: Capa = { ...texto(doc), mesaId: 'mesa-fantasma' };
    expect(problemasDelDocumento({ ...doc, capas: [suelta] })).toHaveLength(1);
  });

  it('detecta dos mesas maestras', () => {
    const doc = doc300x250();
    const primera = mesaDe(doc, 0);
    const otra = { ...primera, id: 'otra' };
    expect(problemasDelDocumento({ ...doc, mesas: [primera, otra] })[0]).toMatch(/maestra/);
  });

  it('detecta identificadores repetidos', () => {
    const doc = doc300x250();
    const a = texto(doc);
    expect(problemasDelDocumento({ ...doc, capas: [a, { ...a }] })[0]).toMatch(
      /mismo identificador/,
    );
  });
});

describe('esquema', () => {
  it('rechaza un color que no es ni hexadecimal ni referencia', () => {
    const doc = doc300x250();
    const mala = texto(doc, { color: 'javascript:alert(1)' });
    expect(documentoSchema.safeParse({ ...doc, capas: [mala] }).success).toBe(false);
  });

  it('rellena los valores por defecto de una capa mínima', () => {
    const doc = doc300x250();
    const parsed = documentoSchema.parse({
      version: 1,
      mesas: doc.mesas,
      capas: [
        {
          id: 'c1',
          mesaId: mesaDe(doc, 0).id,
          tipo: 'forma',
          recuadro: { x: 0, y: 0, ancho: 10, alto: 10 },
        },
      ],
    });
    const capa = parsed.capas[0];
    expect(capa?.visible).toBe(true);
    expect(capa?.opacidad).toBe(1);
    expect(capa?.recuadro.rotacion).toBe(0);
    expect(capa?.anclaje).toEqual({ x: 'izquierda', y: 'arriba' });
  });
});

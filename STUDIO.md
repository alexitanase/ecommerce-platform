# Studio · Estudio de creatividades y campañas

Especificación de la herramienta, y el porqué de cada decisión.

**Estado a 09-08-2026:** la fase A está en marcha y el Studio ya se usa. Existen
el catálogo de formatos, el esquema del documento, las tablas, los permisos, la
API, el armazón con su layout propio, el editor con capas de texto, forma,
imagen y botón, la biblioteca de activos y la exportación a PNG, JPG y WebP. El
progreso tarea a tarea está en las fases 17 y 18 de
[la roadmap v1](./docs/historico/ROADMAP-v1.html), ya cerrada.

---

## 1 · Qué es y por qué existe

Studio es el sitio donde se **fabrica el material de marketing** de la tienda:
banners para las redes de publicidad adulta, piezas para redes sociales y
shorts, cabeceras de newsletter, ventanas de captación de correo y las
creatividades de la propia portada.

La razón de que exista es concreta y viene de una limitación del negocio: con
catálogo +18 **Google Ads y Meta Ads están cerrados** —no es que sean caros, es
que cierran la cuenta—, y lo que queda es SEO, correo propio, afiliación,
comunidades y las redes de publicidad adulta (ExoClick, TrafficStars,
TrafficJunky, JuicyAds). Todas esas menos el SEO se alimentan de **piezas
gráficas**, en tamaños fijos, con pesos máximos ridículos y reglas propias. Sin
una herramienta se acaba haciendo lo de siempre: Canva, exportar a mano, un
Drive con cincuenta archivos llamados `banner_final_v3_bueno.png` y ninguna
forma de saber cuál vendió.

Lo que Studio aporta y una herramienta de diseño genérica no puede aportar:

- **Conoce el catálogo.** Un banner puede llevar un bloque «producto» atado a un
  producto real: foto, nombre, precio y descuento salen de la base de datos. Si
  el precio cambia, el banner se regenera. Y de una plantilla salen treinta
  banners para treinta productos sin repetir el trabajo treinta veces.
- **Conoce los formatos.** El catálogo de tamaños y pesos de cada red vive en el
  código y se valida antes de exportar. Una creatividad rechazada por pesar
  160 KB es un día perdido en la cola de revisión de la red.
- **Conoce la marca.** Logo, colores, tipografías y aviso +18 salen del kit de
  marca que ya se configura en el panel.
- **Cierra el círculo.** Cada creatividad lleva su propio `utm_content`, así que
  el informe de canales que ya existe puede decir **qué banner concreto trajo
  las ventas**, no solo qué red.
- **La IA produce estructura, no píxeles.** El asistente devuelve documentos
  editables —capas, textos, animación—, no un JPEG plano que hay que rehacer
  cuando cambia el precio.

**El editor es la herramienta; la IA es opcional.** Studio es antes que nada un
editor gráfico de verdad, del estilo de Figma: lienzo, capas, formas, texto,
imágenes, estilos, componentes, alineación magnética y línea de tiempo. Todo se
puede hacer a mano, de principio a fin, sin que intervenga ningún modelo. La IA
se enchufa encima como un ayudante más —escribe un titular, propone un fondo,
adapta a doce tamaños— y **se puede desactivar entera**: sin la integración
configurada, el panel de conversación ni siquiera aparece y el resto funciona
igual. Ningún flujo del Studio depende de que haya una GPU encendida.

### Qué NO es

No es un editor vectorial (curvas Bézier, trazados), no es edición de vídeo por
línea de tiempo con pistas de audio, no es un DAM con gestión de derechos, no
tiene edición simultánea entre varias personas y no imprime (nada de CMYK ni
sangrado). Cada una de esas cosas es un producto entero; meterlas retrasa la
única que hace falta ya, que es sacar banners que la red acepte.

---

## 2 · Dónde vive y cómo se entra

Studio es **una aplicación distinta por dentro de la misma aplicación**: al
entrar desaparecen la barra lateral, la cabecera del panel y las migas, y queda
una pantalla completa de trabajo con un botón «← Panel» y la barra de contexto
de la campaña.

### Por qué no es un proyecto aparte

Separarlo en `apps/studio` significa duplicar sesión, refresco de token, cliente
de API, i18n, tokens de diseño, imagen de Docker, entrada de nginx y una cuarta
imagen en el despliegue. El aislamiento que se busca es **de interfaz**, no de
despliegue: se consigue colgando las rutas de otro layout.

```
enrutador.tsx
  rutaRaiz
    ├── rutaLayout      → Layout      (cabecera + lateral + migas)   /pedidos, /productos…
    └── rutaStudio      → LayoutStudio (pantalla completa, sin menú) /studio/*
```

La única precaución real es el **peso del paquete**: el lienzo, el codificador
de GIF y el reproductor de la línea de tiempo no pueden entrar en el arranque
del panel. Con `lazyRouteComponent`, que ya se usa en todas las pantallas, el
Studio es un trozo aparte que solo descarga quien entra.

### Ida y vuelta

- **Del panel al Studio:** botón «Studio» en la cabecera, junto al tema y las
  notificaciones, y una entrada en el grupo Marketing de la navegación. Ambos
  ocultos sin el permiso `studio:read`, como el resto.
- **Del Studio al panel:** botón «← Panel» arriba a la izquierda. Vuelve a la
  pantalla de la que se vino, no siempre al inicio.
- **Enlaces cruzados:** desde la ficha de un producto, «Crear creatividad» abre
  el Studio con ese producto ya seleccionado. Desde una campaña del Studio,
  «Ver ventas» abre el informe de canales filtrado por esa campaña.

### Rutas

| Ruta                                 | Pantalla                                         |
| ------------------------------------ | ------------------------------------------------ |
| `/studio`                            | Campañas: lista, estado, resultados              |
| `/studio/campanas/$id`               | Campaña: brief, creatividades, enlaces, gasto    |
| `/studio/creatividades/$id`          | Editor (lienzo, capas, línea de tiempo, IA)      |
| `/studio/creatividades/$id/exportar` | Formatos de salida, validación y descarga        |
| `/studio/biblioteca`                 | Activos: subidas, generados con IA, del catálogo |
| `/studio/plantillas`                 | Plantillas propias y de partida                  |
| `/studio/marca`                      | Kit de marca (lee de Ajustes → Marca)            |

---

## 3 · Conceptos

Siete piezas, y conviene que los nombres no se mezclen porque cada una tiene su
ciclo de vida.

| Concepto        | Qué es                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| **Campaña**     | El paraguas: objetivo, canal, fechas, presupuesto, brief y marcaje UTM. |
| **Creatividad** | Una idea dentro de una campaña, en un idioma. Tiene versiones.          |
| **Documento**   | El contenido de una versión: capas, texto, animación, variables.        |
| **Variante**    | Una creatividad hermana para probar A/B (otro titular, otro color).     |
| **Render**      | Un archivo concreto: `300x250.gif`, `1080x1920.mp4`. Es desechable.     |
| **Activo**      | Una imagen, vídeo o audio de la biblioteca, con su procedencia.         |
| **Plantilla**   | Un documento con huecos, reutilizable en otra campaña u otro producto.  |

Lo importante de la distinción entre **documento** y **render**: el documento es
la fuente y pesa kilobytes; los renders son derivados y ocupan. Multiplicando
formatos × idiomas × variantes se llega a cientos de archivos por campaña. Por
eso los renders **caducan** —se borran a los N días— y se rehacen desde el
documento cuando hagan falta. Lo que nunca se borra es el documento.

---

## 4 · El documento: una pieza, muchos tamaños

El corazón del Studio. Un documento es JSON validado con Zod, y vive en
`packages/shared` por el mismo motivo que los bloques de la portada: lo valida
la API al guardar, lo pinta el editor y lo pinta el renderizador del servidor.
Con tres copias, la primera que se desincroniza rompe una exportación y no se
nota hasta que la red rechaza el archivo.

```ts
Documento {
  version: number
  mesas:   Mesa[]              // una por formato de salida, sobre un lienzo infinito
  capas:   Capa[]              // árbol; cada capa cuelga de una mesa o de un grupo
  estilos: { colores, textos } // estilos compartidos del documento
  componentes: Componente[]    // piezas reutilizables con instancias
  animacion?: { duracionMs, bucles, pistas }
  variables: Record<string, Valor>   // texto/color/imagen sustituibles por idioma o producto
}
```

### Mesas de trabajo: doce tamaños a la vez

Un documento no es un banner: es un **lienzo infinito con mesas de trabajo**,
una por formato de salida, todas visibles a la vez. Es el modelo de Figma y lo
es a propósito — quien haya tocado una herramienta de diseño no tiene nada que
aprender, y ver el 300×250 al lado del 728×90 y del 1080×1920 es exactamente lo
que hace falta para que una campaña se vea coherente.

Se trabaja con las dos manos:

- **A mano, mesa por mesa.** Cada mesa es independiente: se mueve, se dibuja y
  se retoca como en cualquier editor. Nada obliga a que se parezcan entre sí.
- **Enlazando capas.** Una capa puede estar _enlazada_ a su gemela de la mesa
  maestra: cambia el titular en una y cambia en todas. Se rompe el enlace de una
  capa concreta con un clic —«en el 728×90 el titular va a una línea y la foto a
  la derecha»— y esa se queda como esté, sin afectar al resto.

Con eso, «responsive» aquí significa lo que de verdad se necesita: se diseña una
vez, se pulsa **Añadir formatos**, aparecen las once mesas restantes con el
contenido recolocado por las reglas de anclaje, se retocan las tres o cuatro que
queden raras y se exporta todo de una tacada. Un banner no se refluye como una
web: de 728×90 a 300×500 hay que recomponer, y esto es lo que hace que
recomponer sean cinco minutos y no una tarde.

Dentro de cada mesa, la geometría es **relativa y con anclajes** —posición
respecto a un borde o al centro, márgenes en porcentaje, tamaño de fuente
relativo a la altura—, que es lo que permite que 300×250 → 336×280 o
1080×1080 → 1080×1350 salgan bien sin tocar nada.

### Capas

| Tipo        | Para qué                                                                      |
| ----------- | ----------------------------------------------------------------------------- |
| `texto`     | Titular, subtítulo, precio, aviso legal. Traducible por idioma.               |
| `imagen`    | De la biblioteca, del catálogo o generada con IA.                             |
| `forma`     | Rectángulo, elipse, línea, polígono, estrella. La mitad de un banner es esto. |
| `vector`    | SVG importado: logos, iconos, sellos.                                         |
| `boton`     | Forma + texto con estilo de la marca, con su enlace.                          |
| `producto`  | Bloque compuesto atado a un `productId`: foto, nombre, precio, antes/ahora.   |
| `video`     | MP4 recortado, para banners de vídeo y shorts.                                |
| `html`      | Un bloque de HTML tal cual, con su CSS. La vía de escape del editor.          |
| `grupo`     | Capas que se mueven, se recortan y se animan juntas.                          |
| `instancia` | Copia viva de un componente: cambia el original, cambian todas.               |

### Lo que el editor sabe hacer

Esto no es una lista de deseos: es el mínimo por debajo del cual la gente se va
a Canva y vuelve con un PNG que no se puede editar.

**Dibujar y componer.** Formas con radio de esquina; relleno sólido, degradado
lineal o radial e imagen; trazo con grosor, alineación y línea discontinua;
sombra exterior e interior; desenfoque; opacidad y modos de fusión; recorte por
forma (máscara); operaciones de unión, resta e intersección entre formas.

**Texto.** Tipografías del kit de marca más las que se suban; tamaño,
interlineado, espaciado entre letras, alineación, mayúsculas, contorno y sombra;
caja de texto con **ajuste automático para caber**, que no es un capricho:
el mismo titular en catalán o inglés se sale de un 300×100 y en un lote de
treinta banners nadie lo revisa uno a uno.

**Imágenes.** Recorte y encuadre dentro del marco (reutilizando el recortador
que ya existe en el panel), escala y posición, esquinas redondeadas, brillo,
contraste, saturación y desenfoque, y quitar el fondo —a mano con una máscara o
de un tirón si la IA está activa.

**Organizar.** Árbol de capas con nombres, grupos, reordenar arrastrando,
bloquear, ocultar y buscar capa por nombre.

**Precisión.** Reglas, guías arrastrables, rejilla, **ajuste magnético** a
bordes, centros y a las demás capas con las distancias en pantalla, alinear y
distribuir, valores numéricos editables en el panel de propiedades, zoom hasta
el píxel y vista al 100 % —un 300×250 hay que verlo a tamaño real antes de
darlo por bueno, porque a 300 % todo se lee.

**Reutilizar.** Estilos de color y de texto compartidos: se cambia el color de
marca y cambia en todas las mesas. Componentes con instancias: el sello de
«-40 %», el botón, la franja de aviso +18 se definen una vez y se actualizan en
todas las campañas que los usan.

**Historial.** Deshacer y rehacer con historial largo, versiones con nombre y
comparación antes/después.

**Entrar y salir.** Arrastrar imágenes al lienzo, pegar desde el portapapeles,
importar SVG, duplicar un documento entero y copiar capas de un documento a
otro.

Lo que **no** lleva y conviene decirlo: pluma Bézier para dibujar vectores desde
cero (para eso está la importación de SVG), prototipado y edición simultánea
entre varias personas.

### Animación

Fotogramas clave por propiedad (`x`, `y`, `escala`, `opacidad`, `rotación`,
`recorte`) con curvas de suavizado, más un juego de animaciones preparadas
—entrada por deslizamiento, aparición, latido del botón, zoom lento sobre la
foto (_Ken Burns_), cambio de mensaje en tres escenas— porque el 90 % de los
banners animados son eso y nadie quiere tocar una línea de tiempo para hacerlo.

Con límites metidos en el propio editor: si la animación pasa de lo que admite
el formato elegido (duración o número de bucles), se avisa mientras se edita, no
al exportar.

---

## 4 bis · Traer un HTML de fuera

Se puede subir un fichero `.html` o pegar el marcado, y entra de dos formas
distintas. La diferencia entre ellas es lo único que hay que entender.

**En capas editables.** El fichero se pinta en un marco aislado del tamaño de la
mesa y se le pregunta al navegador dónde ha puesto cada cosa —
`getBoundingClientRect` y `getComputedStyle`—. Cada elemento con contenido
visible sale como una capa con su posición, su tipografía y sus colores ya
resueltos: un `<h1>` es una capa de texto con su cuerpo y su peso reales, un
`<div>` con fondo es una capa de forma, una `<img>` es una capa de imagen.

Se hace así, y no leyendo el CSS para deducir la maquetación, porque deducirla
es reimplementar el navegador y salir perdiendo. El navegador ya sabe maquetar;
lo único que hace falta es preguntarle.

Se conserva el estilo, no solo la posición: tipografía, cuerpo, grosor, color,
alineación, esquinas redondeadas, bordes y **degradados** —lineales y radiales,
con sus paradas y su ángulo, leídos del valor calculado que el navegador ya ha
normalizado—. Un degradado importado entra como degradado y se sigue editando
como tal, con sus colores y sus porcentajes en el panel.

Lo que no se puede traducir se dice en pantalla en vez de dibujar otra cosa: los
degradados cónicos y repetidos, y las imágenes de fondo, que necesitarían un
activo en la biblioteca.

Lo que se pierde, y conviene decirlo: **la maquetación fluida**. Lo que era un
`flex` que se recolocaba solo pasa a ser una posición absoluta. En un banner
—lienzo de tamaño fijo— eso es exactamente lo que hace falta; en una página, no.

**Tal cual, como bloque.** El HTML entra entero en una capa `html` y se edita
como código. Conserva animaciones y comportamiento, y a cambio no se puede
arrastrar nada por separado. Es la vía para una plantilla que ya funciona y que
no interesa despiezar, y es también lo que se entrega en los formatos «en
iframe» de las redes.

El CSS de un bloque se aplica **acotado a su capa**: sin eso, un `p{color:red}`
de una plantilla cualquiera repintaría medio panel de administración.

### Y la vuelta

HTML también es una salida, no solo una entrada: una pieza se exporta como
`.html` suelto, se abre en cualquier sitio y se vuelve a importar al Studio. Es
la garantía de que el trabajo no queda encerrado aquí dentro.

Y se puede **ver el código sin salir del editor**. Como lo que se pinta es HTML,
se enseña tal cual: sirve para copiar la maqueta, para retocar algo más rápido
escribiéndolo que arrastrándolo, y para entender por qué una capa se ve como se
ve. Aplicar lo editado vuelve a pasar por el importador, así que las capas se
rehacen: se conservan posición y estilos, se pierden los nombres que se les
hubiera puesto y la relación con los activos de la biblioteca. Se avisa en la
propia ventana en cuanto se toca una letra.

### Lo que se sanea, y dónde

Todo ese marcado acaba pintándose **dentro del panel**, en el mismo origen donde
vive la sesión de quien tiene todos los permisos. Un `<script>` en una plantilla
descargada de internet es un XSS almacenado con acceso a los pedidos, a los
clientes y a las claves de las pasarelas.

Por eso el saneado va **en el servidor, al guardar**, y no en el importador del
navegador: una limpieza que solo corre en el cliente no protege de nada —basta
llamar a la API directamente—. Se quitan scripts, manejadores de eventos,
`javascript:`, marcos y objetos incrustados; en SVG, además, el `foreignObject`,
que es la puerta de vuelta al HTML. El importador, por su parte, pinta en un
marco con `sandbox` **sin** permiso de scripts: nada de lo que traiga el fichero
llega a ejecutarse ni siquiera para medirlo.

---

## 5 · Catálogo de formatos

Un fichero declarativo, con la misma forma que `canales.ts` o el catálogo de
integraciones: la letra pequeña escrita en el código en vez de en la cabeza de
quien la averiguó.

```ts
Formato {
  clave: 'exoclick.display.300x250'
  red: 'exoclick' | 'trafficstars' | 'social' | 'propio' | 'email'
  familia: 'display' | 'nativo' | 'push' | 'intersticial' | 'video' | 'social' | 'correo'
  nombre, ancho, alto
  tipos: ('jpg'|'png'|'gif'|'mp4'|'webm'|'html5')[]
  pesoMaxKb: number
  duracionMaxS?: number
  textos?: { titulo?: number; descripcion?: number; marca?: number }
  notas?: string
}
```

### ExoClick

Según su documentación de formatos ([Ad Formats](https://www.exoclick.com/advertisers/ad-formats/)):

| Formato                              | Tamaños                                             | Tipos                    | Peso máx.       | Textos                              |
| ------------------------------------ | --------------------------------------------------- | ------------------------ | --------------- | ----------------------------------- |
| Display banner                       | 300×100, 300×250, 300×500, 728×90, 160×600, 900×250 | JPG, PNG, GIF            | 150 KB          | —                                   |
| Banner adhesivo (sticky)             | los mismos, según posición                          | JPG, PNG, GIF            | 150 KB          | —                                   |
| Pie grande (large footer)            | 900×250                                             | JPG, PNG, GIF            | 150 KB          | —                                   |
| Banner de vídeo                      | 160×600, 300×100, 300×250, 728×90                   | MP4                      | 1,5 MB          | —                                   |
| Intersticial escritorio              | 1600×900                                            | JPG/PNG/GIF, MP4, iframe | 300 KB / 1,5 MB | —                                   |
| Intersticial móvil                   | 900×1600                                            | JPG/PNG/GIF, MP4, iframe | 300 KB / 1,5 MB | —                                   |
| Push / In-page push                  | 192×192 (icono) y 720×480 (imagen)                  | JPG, PNG, GIF            | 150 KB          | título 50, descripción 90, marca 30 |
| Nativo (recomendación)               | de 300×300 a 900×900                                | JPG, PNG                 | 150 KB          | título 50, descripción 90, marca 30 |
| Banner dentro de vídeo               | 300×250, 728×90                                     | JPG, PNG, GIF            | 150 KB          | —                                   |
| Vídeo (outstream, in-stream, slider) | libre / 9:16 en vertical                            | MP4                      | 50 MB           | —                                   |
| Popunder, direct link                | solo URL de destino                                 | —                        | —               | —                                   |

**Dos avisos sobre esta tabla.** El primero: ExoClick publica cifras distintas
en sitios distintos —150 KB como norma general desde 2020, y una nota que
menciona 300 KB para los tamaños IAB clásicos—, así que el catálogo se queda con
**el valor conservador** y se anota la duda; que te acepten un archivo de más no
cuesta nada, que te lo rechacen sí. El segundo: **estas cifras caducan**. El
catálogo lleva fecha de revisión y una nota en cada formato, y se comprueba
contra su documentación antes de una campaña grande.

### Otras redes adultas

Se añaden con la misma estructura conforme se abran cuentas: TrafficStars
(300×250, 300×300, 900×250, 300×100), TrafficJunky (300×250, 728×90, 300×600,
970×250, 300×100), JuicyAds (300×250, 728×90, 468×60). Los pesos que circulan en
guías de terceros no coinciden entre sí; se confirman en el panel de cada red
antes de darlos por buenos.

### Social y shorts

| Sitio                               | Tamaño    | Notas                                 |
| ----------------------------------- | --------- | ------------------------------------- |
| Feed cuadrado (Instagram, Facebook) | 1080×1080 |                                       |
| Feed vertical                       | 1080×1350 | El que más superficie ocupa           |
| Story / Reel / TikTok / Shorts      | 1080×1920 | Zona segura: 250 px arriba, 350 abajo |
| Miniatura de vídeo                  | 1280×720  |                                       |
| X / Telegram                        | 1600×900  |                                       |
| Pinterest                           | 1000×1500 |                                       |

La **zona segura** se pinta en el lienzo como una guía: en un short, la interfaz
de la app tapa arriba y abajo, y ahí es donde acaba el precio si nadie avisa.

### Propios

Portada (hero 1920×720 y 960×540 en móvil), banner de categoría, bloque
promocional, ventana de captación, cabecera de newsletter (600 px de ancho).
Estos, además de exportarse, **se pueden publicar directamente** en los bloques
de portada que ya existen.

### Tamaños a medida

No todo lo que se diseña es un formato de anuncio. Una cabecera para un sitio
concreto o una prueba rápida no tienen ficha de red, y obligar a elegir una del
catálogo lleva a coger la que menos desentone y trabajar con el peso máximo
equivocado. Por eso se puede crear una pieza indicando ancho y alto: su clave
pasa a ser `personalizado.970x300` y el validador sabe que ahí **no hay peso que
comprobar**, que es lo correcto.

### El validador

Antes de exportar y antes de publicar, cada render pasa por una comprobación
contra la ficha de su formato:

- Dimensiones exactas y peso por debajo del máximo.
- Duración y número de bucles de la animación.
- Longitud de los textos del formato (título, descripción, marca).
- Contraste mínimo del texto sobre su fondo — un titular ilegible en un 300×100
  no lo rechaza la red, simplemente no lo pulsa nadie.
- Reglas de contenido: presencia del aviso +18 donde la red lo exige, ausencia
  de promesas de precio que no cuadran con el catálogo, y la lista de lo que
  cada red prohíbe.

Falla en rojo diciendo qué hay que corregir, y con lo que se pueda corregir solo
(bajar calidad, reducir paleta del GIF) ofrece hacerlo.

---

## 6 · El motor de dibujo, y cómo se exporta

Un documento, **un solo motor de dibujo, y es HTML y CSS**. Dos
implementaciones —una para la vista previa y otra para el archivo final— acaban
divergiendo siempre, y el síntoma es el peor posible: el banner se ve bien al
editarlo y sale mal exportado.

### Por qué HTML y no SVG

El motor empezó siendo SVG por una razón práctica: un SVG se serializa, se carga
en un `<img>` y se vuelca a un canvas, así que exportar no costaba ninguna
infraestructura. Duró poco, porque **SVG no tiene motor de maquetación**: no hay
flexbox, no hay `object-fit`, y el ajuste de línea del texto había que
escribirlo a mano. Con HTML todo eso lo pone el navegador, y lo pone mejor de lo
que se puede reimplementar.

Lo que se perdía al cambiar era justamente la exportación —el navegador **no
sabe** rasterizar un árbol de `<div>`, no existe esa API—. Y eso se resuelve
envolviéndolo en un `<svg><foreignObject>`, que sí sabe rasterizar. Comprobado
antes de cambiar nada: flexbox, degradados, `object-fit`, `clip-path`, `filter`,
`box-shadow` y `transform` rasterizan todos, y los colores salen exactos.

Tres detalles sin los cuales esto no funciona, y ninguno avisa al fallar:

- El `<div>` raíz necesita el `xmlns` de XHTML. Sin él, la imagen no carga.
- Dentro tiene que ser **XML válido**. Un `<br>` suelto de un bloque importado
  rompe el documento entero, así que se normaliza —parser de HTML, que perdona
  todo, y serializador de XML, que no perdona nada— antes de envolver.
- Las imágenes tienen que ir en `data:`. Vienen de otro origen y, si no, el
  canvas queda contaminado y `toBlob` lanza una excepción de seguridad.

**El documento no se enteró del cambio.** No hay una línea de SVG ni de HTML en
su esquema: es geometría, texto y estilo. Cambiar el motor no tocó la API, ni el
editor, ni obligó a migrar un solo documento guardado. Esa separación es lo que
convierte una decisión así en reversible.

### Dónde se hace cada salida

| Salida                              | Dónde se hace                             |
| ----------------------------------- | ----------------------------------------- |
| PNG, JPG, WebP (estáticos)          | En el navegador, `foreignObject` + canvas |
| HTML suelto (creatividad en iframe) | En el navegador                           |
| GIF animado, MP4, WebM              | En el servidor, en cola                   |
| Lote (todos los formatos × idiomas) | En el servidor, en cola                   |

Los estáticos en el navegador porque son instantáneos y no requieren
infraestructura ninguna: se puede sacar el primer banner el día uno.

Lo animado en el servidor porque codificar un MP4 en el navegador funciona hasta
que alguien pide cuarenta a la vez, y porque un lote no puede depender de que no
se cierre la pestaña. Cuando llegue ese contenedor, abrirá el mismo HTML —es lo
que Chromium sabe hacer— y no habrá que reescribir el motor otra vez.

### El contenedor de renderizado

Un servicio propio, `studio-render`, con Chromium sin ventana y ffmpeg, al que
la API le pasa trabajo por la cola de BullMQ que ya existe. Abre el mismo
renderizador que el editor, captura fotograma a fotograma y monta el archivo.

No va dentro de la imagen de la API: Chromium más ffmpeg son cerca de un giga y
la API se despliega varias veces al día. Va aparte, se escala aparte y se puede
apagar cuando no hay campañas. En el servidor actual (4 vCPU / 8 GB) hay que
limitarlo a un trabajo a la vez y darle memoria acotada, porque compite con
Postgres y con la tienda.

Dos detalles que se olvidan siempre y rompen la exportación:

- **Las tipografías.** Chromium del contenedor no tiene las fuentes de la marca.
  Se instalan en la imagen y se comprueba al arrancar; si falta una, el texto
  cae a otra fuente y el banner sale distinto sin que nada falle.
- **El peso del GIF.** 150 KB con animación es poquísimo. Hace falta reducción
  de paleta, tramado y recorte de fotogramas guiados por el objetivo de tamaño:
  se codifica, se mide y se vuelve a codificar más agresivo hasta entrar. Si aun
  así no entra, se dice —y se sugiere MP4, que en esos tamaños pesa la mitad.

---

## 7 · La IA, que es opcional

### Primero, cómo se apaga

La IA es una capa **encima** del editor, nunca un requisito. Se puede quedar
apagada para siempre y el Studio sigue siendo un editor completo.

- **Sin configurar, no existe.** Como el resto de la plataforma: si no hay
  integración de ComfyUI ni clave de la API de texto, el panel de conversación
  no aparece, los botones de «generar» no se pintan y no se carga ni un byte de
  nada. Nadie ve una función rota ni un botón que da error.
- **Interruptor propio.** Un ajuste en el Studio para apagarla aunque esté
  configurada —por ejemplo mientras se controla el gasto—, y el permiso
  `ai_images:run` para decidir quién la usa.
- **Toda acción de IA tiene equivalente manual.** Escribir el titular, elegir un
  fondo de la biblioteca, adaptar a otro formato copiando la mesa, crear una
  variante duplicando: todo se hace a mano y con menos clics de los que parece.
- **Si se cae, no se cae el Studio.** Con la GPU apagada o ComfyUI caído se sigue
  editando, renderizando y exportando. Lo único que desaparece es el ayudante.
- **Nada entra solo.** Lo que devuelve el modelo aterriza en el lienzo como
  capas normales, editables y deshacibles, y ninguna creatividad generada se
  publica sin aprobación humana.

Dicho eso, cuando está encendida el flujo es el que buscabas: se elige o se crea
una campaña, se pulsa **Crear media**, se elige el tipo, y a partir de ahí se
conversa hasta tener la pieza —con la posibilidad de partir de otra existente—.
Y lo que sale es un documento que se sigue retocando a mano en el mismo editor.

### Lo que el asistente sabe sin que se lo cuentes

Al abrir la conversación se le da el contexto que ya está en la plataforma, y
esto es lo que separa esto de escribirle a un chat cualquiera:

- La campaña: objetivo, canal, público, fechas, brief.
- El formato elegido, con sus límites de texto y sus reglas.
- El kit de marca: colores, tipografías, logo, tono de voz, avisos obligatorios.
- Los productos seleccionados: nombre, precio, descuento, categoría, atributos y
  las reseñas mejor valoradas, que son la mejor fuente de argumentos de venta.
- El idioma de salida (es / ca / en).
- **Qué funcionó antes**: las creatividades de campañas anteriores ordenadas por
  ventas atribuidas. Si un titular vendió, que lo tenga delante.

### Lo que puede hacer

El asistente no «genera una imagen»: manipula el documento con herramientas.

| Herramienta            | Qué hace                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| `proponer_conceptos`   | Tres o cinco ángulos distintos antes de dibujar nada.                      |
| `escribir_textos`      | Titular, subtítulo y llamada a la acción, dentro del límite de caracteres. |
| `generar_imagen`       | Fondo, escena o elemento, con el estilo de la marca.                       |
| `editar_imagen`        | Sobre una referencia: cambiar fondo, luz, encuadre, quitar objetos.        |
| `montar_documento`     | Elige plantilla y rellena variables. Devuelve algo **editable**.           |
| `adaptar_a_formatos`   | Recompone la pieza a la lista de tamaños marcados.                         |
| `crear_variantes`      | N hermanas cambiando una sola cosa, para poder probar A/B.                 |
| `revisar_cumplimiento` | Pasa el validador y explica qué falla.                                     |

Todo lo que hace queda como un paso deshacible en el historial del documento, y
cada versión guarda quién la hizo —persona o modelo, con el prompt—. Sin eso, a
la tercera iteración nadie sabe de dónde salió lo que hay en pantalla.

### Partir de otra pieza

Cuatro modos, porque «basarse en» significa cosas distintas:

1. **Remezcla:** el mismo documento con otro producto u otro idioma. Es el que
   más se usa y el más barato: no interviene ningún modelo.
2. **Referencia de estilo:** se suben una o varias imágenes y se extrae de ellas
   una paleta, una tipografía aproximada y un tipo de composición, que quedan
   como preset aplicable a cualquier documento.
3. **Imagen a imagen:** una foto de partida y una instrucción de cambio,
   conservando la composición.
4. **Ganadora:** se toma la estructura de la creatividad con más ventas
   atribuidas y se cambia lo que se pida. Es la forma de que el aprendizaje se
   acumule en vez de empezar de cero cada campaña.

### Qué modelo hace qué

Aquí la restricción del catálogo +18 manda, igual que en la fase 4:

| Tarea                      | Motor                                                                                     | Por qué                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Conversación, textos, plan | API de Claude (`claude-sonnet-5`; `claude-opus-5` para briefs largos)                     | Es lo que mejor sigue instrucciones con límites de caracteres y tono.                                               |
| Imagen y edición           | ComfyUI propio (SDXL, FLUX.1 schnell, Qwen-Image-Edit, IC-Light)                          | Los servicios gestionados rechazan este catálogo. Ya está previsto en la fase 4 y comparte GPU, cola e integración. |
| Vídeo corto                | v1: animación del propio documento sobre fotos. Más adelante, modelo de vídeo autoalojado | Un short de producto es un encadenado con movimiento y texto; el modelo de vídeo es caro y todavía impredecible.    |
| Voz en off                 | Fuera de la v1                                                                            | —                                                                                                                   |

**Aviso honesto sobre los textos.** Las políticas de uso de las APIs comerciales
restringen el contenido sexual explícito. Publicidad de una tienda legal de
productos para adultos, con lenguaje comercial y no explícito, entra sin
problema; lenguaje explícito, no. El asistente de textos se ciñe a lo primero, y
si algún día hace falta lo segundo, la salida es la misma que en imagen: un
modelo abierto autoalojado. Está escrito aquí para que no sorprenda a mitad de
una campaña.

### Coste

Mismo tratamiento que la fase 4, porque es el mismo problema: cada generación
guarda proveedor, modelo, parámetros, tokens o segundos de GPU y **coste**;
deduplicación por hash para no pagar dos veces lo mismo; tope de gasto mensual
configurable que corta y avisa; y una pantalla con el coste por campaña. Una
herramienta de IA sin contador es una factura sorpresa.

---

## 8 · Captación de correo

De todos los canales que quedan abiertos, la lista propia es el único que no
puede cerrarte nadie. Studio produce también las piezas que la alimentan:

- **Ventanas y barras de captación** para la tienda: diseñadas en el mismo
  lienzo, con reglas de aparición (a los N segundos, al intentar salir, en
  determinadas categorías), el segmento al que dan de alta y el descuento de
  bienvenida si lo hay. Se conectan al alta con doble opt-in que ya existe.
- **Mini-landings de campaña** en nuestro dominio. Importa más de lo que parece:
  llevar tráfico pagado directamente a una ficha de producto convierte peor que
  llevarlo a una página hecha para esa campaña, y además la landing es nuestra,
  así que la podemos medir entera.
- **Plantillas de correo**: cabecera de newsletter y cuerpos con bloques de
  producto que salen del catálogo. Ojo, el correo es HTML de tablas con estilos
  en línea, no una imagen: es un renderizador aparte que comparte el documento
  solo en las partes gráficas. Un correo que es una imagen grande acaba en spam
  y no se ve con las imágenes desactivadas.

---

## 9 · Compra de medios y el círculo cerrado

### Lo que se hace desde el primer día

Cada creatividad genera su **enlace marcado**, construido con el generador de
UTM que ya existe, con `utm_content` = identificador de la creatividad. Ese
identificador viaja hasta el pedido, así que el informe de canales pasa de decir
«ExoClick trajo 12 ventas» a decir **cuál de los nueve banners** las trajo.
Sin esto, probar creatividades es tirar los dados.

Y un **registro de campaña**: qué se gastó, dónde, en qué fechas. Aunque el gasto
se introduzca a mano al principio, tenerlo al lado de las ventas atribuidas es lo
que convierte la compra de medios en una decisión y no en una intuición.

### Lo que llega después

Publicar en la red desde aquí: ExoClick y TrafficStars tienen API para crear
campañas, subir creatividades y leer estadísticas. Con eso, el ciclo completo
—crear, publicar, medir, quedarse con la que gana y regenerar variantes de
ella— ocurre dentro del Studio.

Requiere cuenta y presupuesto real, así que hasta entonces queda como bloqueo
documentado y el Studio se usa exportando y subiendo a mano, que es exactamente
igual de válido para las primeras campañas.

---

## 10 · Modelo de datos

Prisma, con la convención de la casa: identificadores cuid2, `@@map` en
snake_case, borrado suave con `deletedAt` y sellos de tiempo.

| Modelo            | Contenido                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Campaign`        | nombre, slug, objetivo, canal (clave de `CANALES`), estado, fechas, presupuesto, brief, público, idiomas, UTM por defecto, URL de destino |
| `Creative`        | campaña, nombre, tipo, formato, idioma, estado, versión actual, variante de, `utm_content`                                                |
| `CreativeVersion` | documento JSON, número, autor (persona o modelo), versión padre, nota                                                                     |
| `CreativeRender`  | creatividad, formato, tipo de archivo, ancho, alto, bytes, clave en almacenamiento, URL, hash, resultado de validación, caducidad         |
| `StudioAsset`     | tipo, clave, URL, dimensiones, duración, origen (subida/IA/catálogo/proveedor), prompt, modelo, semilla, derivado de, etiquetas           |
| `StudioTemplate`  | nombre, familia de formatos, documento con huecos, si es de sistema o propia                                                              |
| `StudioComponent` | pieza reutilizable entre campañas (sello de descuento, botón, franja +18): capas, variantes y quién la usa                                |
| `AiGeneration`    | proveedor, modelo, parámetros, entradas, salidas, coste, actor, campaña, creatividad                                                      |
| `CampaignSpend`   | campaña, red, fecha, importe, impresiones, clics — a mano o por API                                                                       |

Los estados de una creatividad: `borrador → en_revision → aprobada → publicada →
archivada`. La revisión no es burocracia: **ninguna imagen generada se publica
sin visto bueno humano**, que es la misma regla de la fase 4 y por el mismo
motivo — un modelo generativo produce a veces cosas que no se pueden publicar, y
el sitio de descubrirlo no es la red de anuncios.

El kit de marca no es un modelo nuevo: sale de los ajustes de marca que ya
existen. Duplicarlo garantizaría que un día el logo del banner y el de la tienda
sean distintos.

---

## 11 · API

Bajo `/api/v1/studio`, con los DTO en Zod y la misma paginación y filtros que el
resto del panel.

```
GET    /studio/formatos                      catálogo de formatos y sus reglas
GET    /studio/campanas                      lista con filtros
POST   /studio/campanas
GET    /studio/campanas/:id
PATCH  /studio/campanas/:id
GET    /studio/campanas/:id/rendimiento      ventas, gasto y ranking de creatividades

GET    /studio/creatividades                 filtrable por campaña, estado, formato
POST   /studio/creatividades
GET    /studio/creatividades/:id
PUT    /studio/creatividades/:id/documento   guarda versión nueva
GET    /studio/creatividades/:id/versiones
POST   /studio/creatividades/:id/estado      enviar a revisión, aprobar, archivar
POST   /studio/creatividades/:id/variantes
POST   /studio/creatividades/:id/adaptar     a una lista de formatos

POST   /studio/renders                       encola uno o un lote
GET    /studio/renders/:id                   estado y URL cuando termina
POST   /studio/renders/:id/validar

GET    /studio/activos                       biblioteca
POST   /studio/activos                       subida
POST   /studio/ia/conversacion               turno del asistente (SSE)
POST   /studio/ia/imagen                     encola generación
GET    /studio/plantillas
GET    /studio/componentes                   piezas reutilizables entre campañas
```

El guardado del documento es **optimista con número de versión**: si dos
pestañas editan la misma creatividad, la segunda recibe un conflicto explícito
en vez de pisar el trabajo de la primera en silencio. No hay edición
simultánea, pero sí hay dos pestañas abiertas, que es lo que pasa de verdad.

---

## 12 · Permisos y auditoría

| Permiso             | Para qué                                            |
| ------------------- | --------------------------------------------------- |
| `studio:read`       | Entrar, ver campañas y creatividades                |
| `studio:write`      | Crear y editar campañas, creatividades y plantillas |
| `studio:publish`    | Aprobar, publicar y exportar en lote                |
| `ai_images:run`     | Lanzar generaciones (ya existe)                     |
| `ai_images:approve` | Aprobar lo generado (ya existe)                     |

Con esto sale un rol nuevo, **Creativo**: entra al Studio y a la biblioteca, y
nada más. Ni pedidos, ni clientes, ni ajustes. Es el rol que se le da a alguien
de fuera que hace las creatividades, y sin él habría que darle admin.

Al registro de auditoría van los cambios de estado, las aprobaciones, las
publicaciones y el gasto. No las ediciones del lienzo: eso ya está en el
historial de versiones y llenaría la auditoría de ruido.

---

## 13 · La pantalla

Barra de herramientas, lienzo infinito y dos paneles, que es lo que espera
cualquiera que haya abierto Figma:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Panel │ Campaña «Rebajas verano» · ES ▾        [Añadir formatos] [Exportar] │
├───┬──────────┬────────────────────────────────────────┬──────────────────┤
│ ▶ │ Capas    │   ┌─300×250──┐   ┌─728×90───────────┐  │ Propiedades      │
│ ▭ │  ▾ Mesa  │   │          │   │                  │  │  X  Y  An  Al    │
│ ○ │    Fondo │   │          │   └──────────────────┘  │  Relleno ▸       │
│ T │    Foto  │   └──────────┘                         │  Trazo   ▸       │
│ ⬈ │    Titular│  ┌─1080×1920────┐                     │  Sombra  ▸       │
│ ✂ │  ▸ Mesa  │   │ ····zona····│                      │──────────────────│
│ 🖼 │ Activos  │   │             │                      │ Capa · Estilos · │
│   │ Plantillas│  │ ····segura··│                      │ IA (si está on)  │
├───┴──────────┴────────────────────────────────────────┴──────────────────┤
│ ▶  ├──────●───────────────────────────────┤  0:00 / 0:06   bucles: 3     │
└──────────────────────────────────────────────────────────────────────────┘
```

Decisiones de interfaz que importan:

- **Todas las mesas en el mismo lienzo, no un selector de tamaño.** Ver el
  300×250 al lado del 1080×1920 mientras se edita es lo que evita que la campaña
  salga con doce piezas que no se parecen. Con un doble clic se hace zoom a una
  y se trabaja como si fuera la única.
- **La IA es una pestaña del panel derecho, ni una ventana modal ni una pantalla
  aparte.** Se conversa viendo el lienzo cambiar. Y si está apagada, la pestaña
  no está: el panel enseña propiedades y estilos, y no queda ningún hueco raro.
- **La zona segura se pinta encima**, no se explica en un texto de ayuda. En un
  short, la interfaz de la app tapa arriba y abajo, y es donde acaba el precio.
- **Teclado, como en cualquier editor.** `V` seleccionar, `T` texto, `R`
  rectángulo, `O` elipse, espacio para mover el lienzo, flechas para desplazar,
  mayúsculas para pasos grandes, `Alt` arrastrando para duplicar, `Cmd/Ctrl+G`
  agrupar, `Cmd/Ctrl+D` duplicar, `Cmd/Ctrl+Z` deshacer con historial largo.
  Diseñar solo con el ratón es lento y se nota a la décima creatividad.
- **Guardado automático** con indicador visible, y versión nueva solo en los
  hitos (al exportar, al aprobar, al pedirlo). Guardar una versión por
  pulsación llenaría el historial de basura.
- **Accesible en lo que se puede.** El editor de un lienzo nunca será navegable
  con lector de pantalla, pero la lista de capas, los formularios de propiedades
  y toda la gestión de campañas sí, con el mismo listón que el resto del panel.

---

## 14 · Cumplimiento

- **+18.** Cada red tiene sus reglas y algunas exigen marca de edad visible en la
  creatividad. Está en la ficha del formato y lo comprueba el validador.
- **Publicidad identificable.** La ley española obliga a que un anuncio se
  reconozca como tal; afecta sobre todo a las piezas nativas y a lo que se
  publique en redes sociales.
- **Nada de precios que no existen.** Si el banner dice «-40 %» y el catálogo
  dice otra cosa, eso es publicidad engañosa. Los bloques de producto leen del
  catálogo precisamente para que no pueda pasar; los descuentos escritos a mano
  en un texto libre se avisan en el validador.
- **Procedencia de cada imagen.** La biblioteca guarda de dónde salió cada
  activo: subida, generada (con qué modelo y qué prompt), del proveedor o del
  catálogo. Sirve para dos cosas — saber qué se puede usar comercialmente y
  poder responder si alguien reclama.
- **Personas.** Nada de caras generadas que se parezcan a alguien real, y ningún
  material con personas sin autorización de uso registrada.

---

## 15 · Plan por fases

Cada fase termina en algo utilizable; ninguna deja una mitad esperando a la
siguiente.

**Fase A · Que salga el primer banner para la red, a mano.** Armazón del Studio
con su layout propio y los botones de ida y vuelta. Campañas (CRUD, brief, UTM).
Catálogo de formatos, empezando por los de ExoClick. **Editor**: lienzo con una
mesa, capas de texto, imagen, forma y vector, propiedades completas (relleno,
trazo, sombra, opacidad), árbol de capas, guías y ajuste magnético, alinear y
distribuir, deshacer/rehacer, atajos de teclado y kit de marca. Exportación
estática en el navegador. Biblioteca de activos. Enlace marcado con
`utm_content` por creatividad — barato, y sin él la primera compra de tráfico ya
no se puede medir.
→ _Se puede diseñar un banner de principio a fin y subirlo a mano a ExoClick._

**Fase B · Que salgan cuarenta y se sepa qué costaron.** Varias mesas por
documento con capas enlazadas y «Añadir formatos». Estilos compartidos y
componentes con instancias. Bloque de producto atado al catálogo. Plantillas.
Animación con presets y línea de tiempo. Contenedor de renderizado con GIF y
MP4. Validador completo. Exportación en lote y por idioma. Registro de gasto por
campaña y ranking de creatividades por ventas atribuidas.
→ _Una campaña entera en una tarde, y al final del mes se sabe qué banner pagó._

**Fase C · Que la IA ayude.** Conversación con contexto de campaña, producto y
formato. Textos con límite de caracteres. Generación y edición de imagen sobre
ComfyUI. Los cuatro modos de partir de una referencia. Variantes automáticas.
Cola de aprobación y control de coste. «Crear variantes de la ganadora».
→ _De un brief a cinco conceptos montados._

**Fase D · Canales propios y publicación automática.** Piezas de captación y
mini-landings. Plantillas de correo. Publicación en los bloques de la tienda.
API de ExoClick y TrafficStars: subir creatividades, ajustar pujas y traerse las
estadísticas al mismo sitio donde están las ventas.
→ _El círculo cerrado sin salir del Studio._

El orden no es negociable en un punto: **el editor va antes que la IA.** Un
asistente que produce documentos necesita que exista el documento y que se pueda
retocar lo que devuelve. Al revés, lo que sale es un generador de JPEG que no se
puede corregir, que es justo lo que ya se puede hacer con cualquier chat.

Y una consecuencia que conviene tener presente: **al terminar la fase B el
Studio ya es la herramienta completa**. Se diseñan las piezas a mano, se adaptan
a todos los formatos, se animan, se exportan validadas y se mide qué vendió. La
fase C no añade nada imprescindible: añade velocidad. Si la GPU se retrasa o el
gasto en IA no compensa, se puede saltar sin que quede nada a medias.

---

## 16 · Riesgos

| Riesgo                                    | Qué se hace                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| El Studio engorda el panel                | Trozo aparte, carga perezosa; se vigila el tamaño del paquete en CI                              |
| Vista previa y exportación no coinciden   | Un solo renderizador; comparación automática de la previsualización con el render en las pruebas |
| Fuentes distintas en el contenedor        | Se instalan en la imagen y se comprueba al arrancar                                              |
| El GIF no baja de 150 KB                  | Codificación iterativa contra el objetivo, y sugerencia de MP4 cuando no entra                   |
| Los renders llenan el almacenamiento      | Caducan; el documento es la fuente y se rehace bajo demanda                                      |
| El renderizado se come el servidor        | Contenedor con memoria y concurrencia limitadas, apagable                                        |
| La API de texto rechaza contenido         | Uso comercial no explícito por norma; salida a modelo abierto autoalojado                        |
| Las especificaciones de las redes cambian | Catálogo con fecha de revisión y aviso al usar un formato sin revisar en 6 meses                 |
| Se acumulan campañas sin resultados       | El rendimiento entra en fase D, no al final: sin él no se aprende nada                           |

---

## 17 · Decisiones tomadas

Iulian, 09-08-2026:

1. **La v1 empieza por los banners de las redes adultas.** ExoClick primero; los
   canales propios (portada, correo, captación) van en la fase D. Consecuencia:
   el catálogo de formatos y el validador entran desde el primer día, porque un
   archivo rechazado por peso es un día perdido.
2. **La IA de imagen comparte GPU e instancia de ComfyUI con la fase 4.** Una
   sola infraestructura de inferencia para fotos de producto y creatividades,
   con la misma cola, la misma integración y el mismo control de gasto. Ojo con
   el orden: la fase 4 todavía está pendiente, así que la fase C del Studio
   **depende** de que esa GPU exista.
3. **El contenedor de renderizado se monta en la fase B.** Chromium y ffmpeg
   aparte de la imagen de la API, con memoria y concurrencia limitadas para
   convivir con Postgres y la tienda en el droplet actual, y apagable cuando no
   hay campañas.
4. **Va a haber compra de tráfico en los próximos meses.** Por eso el
   `utm_content` por creatividad entra ya en la fase A, el gasto y el ranking en
   la B, y la integración por API de la red en la D. Hará falta cuenta de
   anunciante en ExoClick con presupuesto: mientras no exista, queda anotado en
   BLOQUEOS.md y se trabaja exportando y subiendo a mano.
5. **La IA es opcional y el editor manual es la herramienta.** Studio se
   construye como un editor gráfico completo, tipo Figma, utilizable de
   principio a fin sin ningún modelo. La IA se enchufa encima, se puede
   desactivar entera y no aparece siquiera si no está configurada. Consecuencia
   en el plan: todo el editor cabe en las fases A y B, y la fase C es
   prescindible.

---

## Fuentes

- [ExoClick · Ad Formats](https://www.exoclick.com/advertisers/ad-formats/)
- [ExoClick · Documentación de formatos](https://docs.exoclick.com/docs/general/ad-formats/)
- [ExoClick · Alineación de tamaños con el estándar IAB](https://www.exoclick.com/advertisers-exoclick-aligns-banner-advertising-sizes-with-iab-standards/)
- [ExoClick · Guidelines](https://www.exoclick.com/guidelines/)
- [Guía comparativa de especificaciones en redes adultas](https://hawtads.com/blog/the-complete-adult-ad-creative-specs-guide-trafficjunky-exoclick-trafficstars-more/) — de terceros, sus cifras no siempre coinciden con las oficiales

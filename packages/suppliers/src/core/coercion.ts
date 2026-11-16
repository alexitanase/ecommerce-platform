/**
 * Los conversores seguros viven en @ecom/shared: los usan los proveedores, las
 * pasarelas y la propia API. Se reexportan aquí para no romper los imports
 * existentes y para que quede claro dónde buscarlos.
 */
export {
  fecha,
  listaDeObjetos,
  listaDeTextos,
  numero,
  numeroOpcional,
  objeto,
  texto,
  textoOpcional,
} from '@ecom/shared';

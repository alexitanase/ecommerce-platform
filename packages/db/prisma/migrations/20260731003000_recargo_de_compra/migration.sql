-- Lo que el proveedor añade al pagar y su API no dice.
--
-- Sale de un pedido real vendido a pérdida: la ficha cotizaba 13,99 € y el
-- cargo fue de 16,89 € por unos «cargos de importación estimados» que la API de
-- producto no menciona. Sin este dato el motor de precios calcula el margen
-- sobre un coste que no es el que se paga.
--
-- Por defecto 0 para no cambiar el comportamiento de ningún proveedor ya
-- configurado; se ajusta desde el panel proveedor a proveedor.
ALTER TABLE "suppliers"
  ADD COLUMN "purchaseSurchargePct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Cargo fijo por categoría en importaciones de bajo valor.
--
-- No escala con el precio, así que no puede modelarse como porcentaje: 3 € son
-- un 5 % sobre un artículo de 60 € y un 21 % sobre uno de 14 €. Se guarda en
-- céntimos, con el umbral por debajo del cual se aplica (150 € por defecto).
ALTER TABLE "suppliers"
  ADD COLUMN "importFeeCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "importFeeThresholdCents" INTEGER NOT NULL DEFAULT 15000;

-- El estado del pedido tal y como lo llama el proveedor.
--
-- El nuestro tiene cuatro escalones y se queda en PLACED durante días mientras
-- el proveedor pasa por sus propios estados intermedios. Sin guardar el suyo,
-- el panel enseña un pedido congelado y no se distingue «va bien, tarda» de
-- «está atascado».
ALTER TABLE "supplier_orders"
  ADD COLUMN "supplierStatus" TEXT;

-- El contador cambia de significado y de nombre: antes contaba las variantes
-- cuyo precio se SUBÍA hasta el margen mínimo; ahora cuenta las que se publican
-- al precio del proveedor quedando por debajo de ese mínimo.
--
-- Se renombra en lugar de borrar y crear —que es lo que genera Prisma por
-- defecto— porque el historial de importaciones ya ejecutadas sigue valiendo:
-- son las mismas variantes señaladas, y perder la cifra dejaría los informes
-- anteriores a cero sin motivo.
ALTER TABLE "supplier_bulk_imports" RENAME COLUMN "pricedAtMin" TO "belowMinMargin";

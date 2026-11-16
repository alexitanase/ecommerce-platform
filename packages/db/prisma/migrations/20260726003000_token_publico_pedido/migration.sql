-- Clave de consulta pública del pedido.
--
-- En tres pasos a propósito: la tabla ya tiene pedidos, así que añadir de
-- golpe una columna NOT NULL y única fallaría. Se añade opcional, se rellena
-- con un valor aleatorio distinto por fila, y solo entonces se exige.

-- 1) Columna opcional
ALTER TABLE "orders" ADD COLUMN "publicToken" TEXT;

-- 2) Relleno con un valor aleatorio por pedido.
--    gen_random_uuid() viene con pgcrypto, incluido en PostgreSQL desde la 13.
UPDATE "orders"
SET "publicToken" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE "publicToken" IS NULL;

-- 3) Ahora que no hay nulos ni duplicados, se exige y se indexa
ALTER TABLE "orders" ALTER COLUMN "publicToken" SET NOT NULL;
CREATE UNIQUE INDEX "orders_publicToken_key" ON "orders"("publicToken");

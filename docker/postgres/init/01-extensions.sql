-- Extensiones necesarias para búsqueda, acentos y datos sin distinción de mayúsculas.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- búsqueda por similitud
CREATE EXTENSION IF NOT EXISTS "unaccent";     -- ignorar tildes en búsquedas (español/catalán)
CREATE EXTENSION IF NOT EXISTS "citext";       -- emails sin distinción de mayúsculas
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- generación de bytes aleatorios

-- Base de datos aislada para los tests de integración
SELECT 'CREATE DATABASE ecom_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ecom_test')\gexec

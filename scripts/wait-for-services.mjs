#!/usr/bin/env node
/**
 * Espera a que los servicios de Docker estén listos antes de seguir.
 *
 * `docker compose up -d` devuelve en cuanto los contenedores arrancan, no
 * cuando aceptan conexiones. Sin esta espera, la migración de Prisma se lanza
 * contra un Postgres que todavía está inicializando y falla de forma aleatoria.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import net from 'node:net';

const SERVICIOS = [
  { nombre: 'PostgreSQL', host: 'localhost', puerto: 5432 },
  { nombre: 'Redis', host: 'localhost', puerto: 6379 },
  { nombre: 'Meilisearch', host: 'localhost', puerto: 7700 },
  { nombre: 'MinIO', host: 'localhost', puerto: 9000 },
  { nombre: 'Mailpit', host: 'localhost', puerto: 1025 },
];

const TIEMPO_MAXIMO_MS = 90_000;
const INTERVALO_MS = 1000;

function puedeConectar(host, puerto) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: puerto });
    const cerrar = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000);
    socket.once('connect', () => cerrar(true));
    socket.once('timeout', () => cerrar(false));
    socket.once('error', () => cerrar(false));
  });
}

async function esperar(servicio) {
  const limite = Date.now() + TIEMPO_MAXIMO_MS;
  process.stdout.write(`  ${servicio.nombre.padEnd(14)}`);

  while (Date.now() < limite) {
    if (await puedeConectar(servicio.host, servicio.puerto)) {
      console.log('listo');
      return true;
    }
    process.stdout.write('.');
    await sleep(INTERVALO_MS);
  }

  console.log(' NO RESPONDE');
  return false;
}

console.log('\nEsperando a los servicios de Docker…\n');

const resultados = [];
for (const servicio of SERVICIOS) {
  resultados.push(await esperar(servicio));
}

if (resultados.includes(false)) {
  console.error('\nAlgún servicio no ha arrancado. Revisa: docker compose logs\n');
  process.exit(1);
}

console.log('\nTodos los servicios están operativos.\n');

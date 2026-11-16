import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin, stdout, stderr, argv } from 'node:process';
import argon2 from 'argon2';
import { config as loadDotenv } from 'dotenv';
import { createId } from '@paralleldrive/cuid2';

/**
 * Crea la cuenta de propietario de una tienda, o le pone una contraseña nueva.
 *
 * Existe por dos motivos:
 *
 *  1. El seed no puede hacerlo. Sus usuarios llevan la contraseña escrita en el
 *     repositorio, que en local es cómodo y en producción es una puerta con la
 *     llave puesta.
 *  2. **Es la vía de recuperación cuando no hay correo saliente.** Un panel
 *     recién instalado no tiene proveedor de email configurado, así que
 *     «he olvidado mi contraseña» no lleva a ninguna parte. Quien tiene acceso
 *     SSH al servidor puede restablecerla desde aquí, y eso convierte un
 *     bloqueo total en un minuto de trabajo.
 *
 * Tres modos:
 *
 *   tsx prisma/crear-propietario.ts
 *       Interactivo: pregunta email y contraseña. La contraseña no se ve al
 *       escribirla y no queda en el historial del intérprete de órdenes.
 *
 *   tsx prisma/crear-propietario.ts --generar correo@dominio
 *       Sin preguntar nada: genera una contraseña fuerte y la escribe por la
 *       salida estándar Y NADA MÁS. Todo lo demás va por la salida de error.
 *       Así se puede redirigir a un fichero sin que el secreto aparezca en
 *       pantalla, en un registro ni en la salida de quien lanzó la orden:
 *
 *         docker compose run --rm -T migrador \
 *           node_modules/.bin/tsx prisma/crear-propietario.ts --generar a@b.es \
 *           > credencial.txt && chmod 600 credencial.txt
 *
 *   tsx prisma/crear-propietario.ts --restablecer correo@dominio
 *       Lo mismo, pero sobre una cuenta que ya existe. Es el «he perdido la
 *       contraseña» sin depender del correo.
 *
 * En cualquier caso la contraseña generada es de un solo uso: hay que
 * cambiarla al entrar. Una contraseña que ha pasado por un fichero ya no es
 * secreta del todo.
 */

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const { createPrismaClient } = await import('../src/index.js');
const prisma = createPrismaClient();

/** Mensajes para la persona: SIEMPRE por la salida de error. */
const avisar = (texto: string): void => {
  stderr.write(`${texto}\n`);
};

/**
 * Contraseña generada.
 *
 * Alfabeto sin caracteres ambiguos —ni O ni 0, ni l ni 1— porque esta
 * contraseña se va a leer de una pantalla y teclear a mano al menos una vez.
 * 20 caracteres de este alfabeto son unos 103 bits de entropía: de sobra para
 * algo que además va a cambiarse en cuanto se use.
 */
function generarPassword(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(20);
  return [...bytes].map((b) => alfabeto[b % alfabeto.length]).join('');
}

/** Lee sin mostrar lo tecleado; si no hay TTY, avisa en vez de leer a ciegas. */
async function pedirOculto(pregunta: string): Promise<string> {
  if (!stdin.isTTY) {
    throw new Error(
      'Hace falta una terminal interactiva para escribir la contraseña.\n' +
        'Añade -it al `docker compose run` (y -t al ssh si vas por SSH),\n' +
        'o usa --generar si prefieres que la genere el servidor.',
    );
  }

  const lector = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  // `_writeToOutput` vacío: readline sigue leyendo pero no dibuja nada, así la
  // contraseña no queda en pantalla ni en una captura ni sobre el hombro.
  const original = (lector as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
  stdout.write(pregunta);
  (lector as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};

  try {
    const valor = await lector.question('');
    stdout.write('\n');
    return valor;
  } finally {
    (lector as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = original;
    lector.close();
  }
}

function validarPassword(valor: string): string | null {
  if (valor.length < 12) return 'Mínimo 12 caracteres.';
  if (!/[a-z]/.test(valor)) return 'Necesita alguna minúscula.';
  if (!/[A-Z]/.test(valor)) return 'Necesita alguna mayúscula.';
  if (!/[0-9]/.test(valor)) return 'Necesita algún número.';
  return null;
}

const hashear = (valor: string): Promise<string> => argon2.hash(valor, { type: argon2.argon2id });

function validarEmail(email: string): string {
  const limpio = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpio)) {
    throw new Error(`«${email}» no parece un email.`);
  }
  return limpio;
}

async function rolPropietario() {
  const rol = await prisma.role.findUnique({ where: { key: 'owner' } });
  if (!rol) {
    throw new Error(
      'No existe el rol «owner». Ejecuta antes el sembrado de referencia:\n' +
        '  NODE_ENV=production node_modules/.bin/tsx prisma/seed.ts',
    );
  }
  return rol;
}

async function main(): Promise<void> {
  const modo = argv[2] ?? '';
  const generar = modo === '--generar';
  const restablecer = modo === '--restablecer';

  // ── Sin preguntar: la contraseña la pone el servidor ──
  if (generar || restablecer) {
    const email = validarEmail(argv[3] ?? '');
    const rol = await rolPropietario();
    const existente = await prisma.user.findUnique({ where: { email } });

    if (restablecer && !existente) {
      throw new Error(`No hay ninguna cuenta con el email ${email}.`);
    }
    if (generar && existente) {
      throw new Error(
        `La cuenta ${email} ya existe. Para ponerle una contraseña nueva:\n` +
          `  … crear-propietario.ts --restablecer ${email}`,
      );
    }

    const password = generarPassword();
    const hash = await hashear(password);

    if (existente) {
      await prisma.user.update({ where: { id: existente.id }, data: { password: hash } });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: existente.id, roleId: rol.id } },
        update: {},
        create: { userId: existente.id, roleId: rol.id },
      });
      avisar(`Contraseña restablecida para ${email}.`);
    } else {
      await prisma.user.create({
        data: {
          id: createId(),
          email,
          type: 'STAFF',
          password: hash,
          locale: 'es',
          // Verificado de entrada: la crea quien administra el servidor, no es
          // un registro público que haya que confirmar por un correo que
          // todavía no se puede enviar.
          emailVerifiedAt: new Date(),
          roles: { create: { roleId: rol.id } },
        },
      });
      avisar(`Creada la cuenta de propietario ${email}.`);
    }

    avisar('La contraseña va por la salida estándar; nada más sale por ahí.');
    avisar('Cámbiala en cuanto entres y borra el fichero donde la hayas dejado.');

    // Lo ÚNICO que se escribe por la salida estándar.
    stdout.write(`${password}\n`);
    return;
  }

  // ── Interactivo ──
  const lector = readline.createInterface({ input: stdin, output: stdout });
  const email = validarEmail(await lector.question('Email del propietario: '));
  lector.close();

  const rol = await rolPropietario();
  const existente = await prisma.user.findUnique({ where: { email } });

  if (existente) {
    // No se toca la contraseña de una cuenta que ya existe sin pedirlo
    // expresamente: si alguien lanza esto por error sobre la cuenta en uso, lo
    // peor que puede pasar es que se reafirme un rol que ya tenía.
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: existente.id, roleId: rol.id } },
      update: {},
      create: { userId: existente.id, roleId: rol.id },
    });
    avisar(`\nLa cuenta ${email} ya existía. Se ha confirmado su rol de propietario.`);
    avisar('La contraseña no se ha modificado. Para cambiarla:');
    avisar(`  … crear-propietario.ts --restablecer ${email}\n`);
    return;
  }

  const password = await pedirOculto('Contraseña (no se verá al escribir): ');
  const problema = validarPassword(password);
  if (problema) throw new Error(problema);

  const repetida = await pedirOculto('Repite la contraseña: ');
  if (password !== repetida) throw new Error('Las dos contraseñas no coinciden.');

  await prisma.user.create({
    data: {
      id: createId(),
      email,
      type: 'STAFF',
      password: await hashear(password),
      locale: 'es',
      emailVerifiedAt: new Date(),
      roles: { create: { roleId: rol.id } },
    },
  });

  avisar(`\nCreada la cuenta de propietario ${email}.`);
  avisar('Entra en el panel y activa la verificación en dos pasos: es');
  avisar('obligatoria para los roles con permisos de administración.\n');
}

try {
  await main();
} catch (error) {
  avisar(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

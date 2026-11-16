import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@ecom/shared';
import {
  crearEntorno,
  vaciarBase,
  CONTRASENA_DE_PRUEBAS,
  type EntornoPruebas,
  type ErrorApi,
} from './entorno.js';

/**
 * Editar los roles de una cuenta del personal desde el panel.
 *
 * Lo que hace falta cubrir aquí no es que se guarde una fila, sino las tres
 * cosas que hacen que repartir permisos sea peligroso:
 *
 *  · El conjunto de roles se **reemplaza**, no se acumula. Si «guardar» dejara
 *    los roles viejos puestos, quitarle acceso a alguien no serviría de nada y
 *    el panel diría que sí lo ha hecho.
 *  · El cambio tiene efecto **ya**. Los permisos se sirven de una caché, y sin
 *    invalidarla quien acaba de perder un rol sigue entrando donde ya no debe.
 *  · No se puede quitar el **último propietario**. Si se pudiera, la plataforma
 *    se queda sin nadie capaz de repartir permisos y solo se arregla entrando a
 *    la base de datos a mano.
 */

let entorno: EntornoPruebas;

interface Miembro {
  id: string;
  firstName: string | null;
  lastName: string | null;
  roles: { id: string; key: string; name: string }[];
}

/** Un rol suelto con los permisos que se le digan. */
async function crearRol(key: string, permisos: string[]): Promise<string> {
  const roleId = newId();

  await entorno.prisma.client.role.create({
    data: {
      id: roleId,
      key,
      name: `Rol ${key}`,
      permissions: {
        create: permisos.map((clave) => ({
          permission: {
            connectOrCreate: {
              where: { key: clave },
              create: {
                id: newId(),
                key: clave,
                resource: clave.split(':')[0] ?? clave,
                action: clave.split(':')[1] ?? 'read',
              },
            },
          },
        })),
      },
    },
  });

  return roleId;
}

beforeAll(async () => {
  entorno = await crearEntorno();
}, 60_000);

afterAll(async () => {
  await entorno.app.close();
});

beforeEach(async () => {
  await vaciarBase(entorno);
});

describe('PATCH /users/:id', () => {
  it('reemplaza el conjunto de roles en vez de acumularlos', async () => {
    const admin = await entorno.personal(['users:read', 'users:write']);
    const soporte = await crearRol('soporte', ['orders:read']);
    const almacen = await crearRol('almacen', ['products:read']);

    const invitado = await entorno.peticion<{ usuario: { id: string } }>({
      metodo: 'POST',
      ruta: '/api/v1/users/invite',
      token: admin.token,
      cuerpo: { email: `nuevo-${newId().slice(0, 6)}@ejemplo.es`, roleIds: [soporte] },
    });

    expect(invitado.estado).toBe(201);
    const id = invitado.datos.usuario.id;

    const editado = await entorno.peticion<Miembro>({
      metodo: 'PATCH',
      ruta: `/api/v1/users/${id}`,
      token: admin.token,
      cuerpo: { firstName: 'Ana', lastName: 'Ruiz', roleIds: [almacen] },
    });

    expect(editado.estado).toBe(200);
    expect(editado.datos.firstName).toBe('Ana');

    // La parte que importa: `soporte` ya NO está.
    expect(editado.datos.roles.map((r) => r.id)).toEqual([almacen]);
  });

  it('no borra el nombre cuando solo se mandan los roles', async () => {
    const admin = await entorno.personal(['users:read', 'users:write']);
    const soporte = await crearRol('soporte', ['orders:read']);
    const almacen = await crearRol('almacen', ['products:read']);

    const invitado = await entorno.peticion<{ usuario: { id: string } }>({
      metodo: 'POST',
      ruta: '/api/v1/users/invite',
      token: admin.token,
      cuerpo: {
        email: `nuevo-${newId().slice(0, 6)}@ejemplo.es`,
        firstName: 'Ana',
        lastName: 'Ruiz',
        roleIds: [soporte],
      },
    });

    const editado = await entorno.peticion<Miembro>({
      metodo: 'PATCH',
      ruta: `/api/v1/users/${invitado.datos.usuario.id}`,
      token: admin.token,
      cuerpo: { roleIds: [almacen] },
    });

    expect(editado.estado).toBe(200);
    expect(editado.datos.firstName).toBe('Ana');
    expect(editado.datos.lastName).toBe('Ruiz');
  });

  it('el permiso retirado deja de valer en la siguiente petición', async () => {
    // Sin invalidar la caché de permisos, este token seguiría entrando en
    // /users durante todo lo que le quedara de vida a la entrada en caché.
    const admin = await entorno.personal(['users:read', 'users:write']);
    const victima = await entorno.personal(['users:read']);
    const sinNada = await crearRol('sin-nada', ['orders:read']);

    const antes = await entorno.peticion({
      metodo: 'GET',
      ruta: '/api/v1/users?tipo=STAFF',
      token: victima.token,
    });
    expect(antes.estado, 'con users:read debería poder listar').toBe(200);

    const editado = await entorno.peticion({
      metodo: 'PATCH',
      ruta: `/api/v1/users/${victima.userId}`,
      token: admin.token,
      cuerpo: { roleIds: [sinNada] },
    });
    expect(editado.estado).toBe(200);

    const despues = await entorno.peticion({
      metodo: 'GET',
      ruta: '/api/v1/users?tipo=STAFF',
      token: victima.token,
    });
    expect(despues.estado, 'sin users:read ya no debería poder listar').toBe(403);
  });

  it('no deja quitar el rol al último propietario activo', async () => {
    const admin = await entorno.personal(['users:read', 'users:write']);
    const propietario = await crearRol('owner', ['users:read', 'users:write', 'roles:write']);
    const otro = await crearRol('soporte', ['orders:read']);

    const invitado = await entorno.peticion<{ usuario: { id: string } }>({
      metodo: 'POST',
      ruta: '/api/v1/users/invite',
      token: admin.token,
      cuerpo: { email: `jefe-${newId().slice(0, 6)}@ejemplo.es`, roleIds: [propietario] },
    });

    const editado = await entorno.peticion<ErrorApi>({
      metodo: 'PATCH',
      ruta: `/api/v1/users/${invitado.datos.usuario.id}`,
      token: admin.token,
      cuerpo: { roleIds: [otro] },
    });

    expect(editado.estado).toBe(400);
    expect(editado.datos.message).toContain('último propietario');
  });

  it('sí deja quitárselo cuando hay otro propietario activo', async () => {
    const admin = await entorno.personal(['users:read', 'users:write']);
    const propietario = await crearRol('owner', ['users:read', 'users:write']);
    const otro = await crearRol('soporte', ['orders:read']);

    const uno = await entorno.peticion<{ usuario: { id: string } }>({
      metodo: 'POST',
      ruta: '/api/v1/users/invite',
      token: admin.token,
      cuerpo: { email: `jefa-${newId().slice(0, 6)}@ejemplo.es`, roleIds: [propietario] },
    });
    await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/users/invite',
      token: admin.token,
      cuerpo: { email: `jefe-${newId().slice(0, 6)}@ejemplo.es`, roleIds: [propietario] },
    });

    const editado = await entorno.peticion<Miembro>({
      metodo: 'PATCH',
      ruta: `/api/v1/users/${uno.datos.usuario.id}`,
      token: admin.token,
      cuerpo: { roleIds: [otro] },
    });

    expect(editado.estado).toBe(200);
    expect(editado.datos.roles.map((r) => r.id)).toEqual([otro]);
  });

  it('rechaza editar los roles de un cliente', async () => {
    const admin = await entorno.personal(['users:read', 'users:write']);
    const soporte = await crearRol('soporte', ['orders:read']);
    const email = `cliente-${newId().slice(0, 8)}@ejemplo.es`;

    await entorno.peticion({
      metodo: 'POST',
      ruta: '/api/v1/auth/register',
      cuerpo: { email, password: CONTRASENA_DE_PRUEBAS, marketingConsent: false },
    });

    const cliente = await entorno.prisma.client.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    const editado = await entorno.peticion<ErrorApi>({
      metodo: 'PATCH',
      ruta: `/api/v1/users/${cliente.id}`,
      token: admin.token,
      cuerpo: { roleIds: [soporte] },
    });

    expect(editado.estado).toBe(400);
    expect(editado.datos.message).toContain('personal');
  });

  it('rechaza un rol que no existe', async () => {
    const admin = await entorno.personal(['users:read', 'users:write']);
    const soporte = await crearRol('soporte', ['orders:read']);

    const invitado = await entorno.peticion<{ usuario: { id: string } }>({
      metodo: 'POST',
      ruta: '/api/v1/users/invite',
      token: admin.token,
      cuerpo: { email: `nuevo-${newId().slice(0, 6)}@ejemplo.es`, roleIds: [soporte] },
    });

    const editado = await entorno.peticion<ErrorApi>({
      metodo: 'PATCH',
      ruta: `/api/v1/users/${invitado.datos.usuario.id}`,
      token: admin.token,
      cuerpo: { roleIds: [newId()] },
    });

    expect(editado.estado).toBe(400);
  });
});

/** Usuario resuelto por el guard de autenticación y adjuntado a la petición. */
export interface UsuarioAutenticado {
  id: string;
  sessionId: string;
  type: string;
  email: string;
}

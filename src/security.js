// Comprobaciones de seguridad de las peticiones al servidor local.
//
// AITeam escucha solo en 127.0.0.1, pero eso no basta: con "DNS rebinding" una web maliciosa puede hacer
// que el navegador envíe peticiones a 127.0.0.1 con su propio nombre de dominio como Host y leer las
// respuestas como si fueran suyas. Por eso se rechaza toda petición cuyo Host no sea el de la propia app.

/** Nombres con los que se puede abrir AITeam en el navegador. */
export function allowedHosts(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

/** ¿Va dirigida la petición a la propia app? (cabecera Host exacta, sin distinguir mayúsculas). */
export function isAllowedHost(host, port) {
  if (typeof host !== 'string' || !host) return false;
  return allowedHosts(port).has(host.trim().toLowerCase());
}

/** ¿Viene la petición de la propia app? Se permite sin cabecera Origin (herramientas locales, no navegadores). */
export function isAllowedOrigin(origin, port) {
  if (origin == null || origin === '') return true;
  return [...allowedHosts(port)].some((h) => origin.toLowerCase() === `http://${h}`);
}

/** Interpreta la URL de la petición sin lanzar errores (una cabecera malformada no debe tumbar el servidor). */
export function parseRequestUrl(rawUrl, port) {
  try {
    return new URL(String(rawUrl ?? '/'), `http://127.0.0.1:${port}`);
  } catch {
    return null;
  }
}

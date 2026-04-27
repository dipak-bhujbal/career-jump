/**
 * Standard security headers for all responses.
 */
export function securityHeaders(existing?: Headers): Headers {
  const headers = new Headers(existing);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  return headers;
}

/**
 * JSON response helper with security headers.
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: securityHeaders(new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })),
  });
}

/**
 * Wrap arbitrary response with security headers.
 */
export function withSecurity(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: securityHeaders(response.headers),
  });
}

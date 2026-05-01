type SecurityHeaderOptions = {
  allowSameOriginFrame?: boolean;
  allowSwaggerCdn?: boolean;
};

/**
 * Standard security headers for all responses.
 */
export function securityHeaders(existing?: Headers, options: SecurityHeaderOptions = {}): Headers {
  const headers = new Headers(existing);
  const frameAncestors = options.allowSameOriginFrame ? "'self'" : "'none'";
  const scriptSrc = options.allowSwaggerCdn ? "'self' 'unsafe-inline' https://unpkg.com" : "'self'";
  const styleSrc = options.allowSwaggerCdn ? "'self' 'unsafe-inline' https://unpkg.com" : "'self'";

  headers.set("X-Frame-Options", options.allowSameOriginFrame ? "SAMEORIGIN" : "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      `style-src ${styleSrc}`,
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      `frame-ancestors ${frameAncestors}`,
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
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

/**
 * Swagger docs are same-origin iframe content and load Swagger UI from the
 * public CDN, so they need a slightly wider policy than the rest of the app.
 */
export function withDocsSecurity(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: securityHeaders(response.headers, {
      allowSameOriginFrame: true,
      allowSwaggerCdn: true,
    }),
  });
}

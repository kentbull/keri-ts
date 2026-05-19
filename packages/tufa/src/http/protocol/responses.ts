/** Return one CESR response body with the expected content type. */
export function cesrResponse(body: Uint8Array, status: number): Response {
  return new Response(body.slice().buffer, {
    status,
    headers: { "Content-Type": "application/cesr" },
  });
}

/** Return one plain-text response. */
export function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

/** Return the ordinary no-content JSON response used by ingress routes. */
export function jsonNoContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { "Content-Type": "application/json" },
  });
}

export function requestWithBody(req: Request, body: string | FormData): Request {
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  if (body instanceof FormData) {
    headers.delete("content-type");
  }
  return new Request(req.url, {
    method: req.method,
    headers,
    body,
    signal: req.signal,
  });
}
export function jsonRequest(req: Request, body: unknown): Request {
  return requestWithBody(req, JSON.stringify(body));
}

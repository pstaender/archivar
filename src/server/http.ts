export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function parseId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") throw new Error();
    return body as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function handle<R extends Request>(fn: (req: R) => Promise<Response> | Response) {
  return async (req: R): Promise<Response> => {
    try {
      return await fn(req);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "Internal server error" }, 500);
    }
  };
}

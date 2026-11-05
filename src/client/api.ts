export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; form?: FormData };

/** Calls the OpenAct API. Throws ApiError with the server's plain-language message. */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method || (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "The server cannot be reached. Check your connection.");
  }
  let data: unknown = null;
  if ((res.headers.get("content-type") || "").includes("application/json")) data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `The request failed (${res.status}).`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

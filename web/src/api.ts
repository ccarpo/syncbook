export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("token");
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Request failed";
    window.dispatchEvent(new CustomEvent("syncbook-api-error", { detail: message }));
    throw cause;
  }
  if (!response.ok) {
    let message = "Request failed";
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      message = response.statusText || message;
    }
    if (response.status === 401) {
      localStorage.removeItem("token");
      window.dispatchEvent(new CustomEvent("syncbook-session-expired"));
    }
    window.dispatchEvent(new CustomEvent("syncbook-api-error", { detail: message }));
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

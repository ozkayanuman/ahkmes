const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

const ACCESS_KEY = "ahkmes.access";
const REFRESH_KEY = "ahkmes.refresh";

export function getTokens() {
  return {
    access: localStorage.getItem(ACCESS_KEY),
    refresh: localStorage.getItem(REFRESH_KEY),
  };
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function rawRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const { access } = getTokens();
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...options.headers,
    },
  });
}

async function tryRefresh(): Promise<boolean> {
  const { refresh } = getTokens();
  if (!refresh) return false;
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: refresh }),
  });
  if (!res.ok) return false;
  const body = await res.json();
  setTokens(body.accessToken, body.refreshToken);
  return true;
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, options);
  if (res.status === 401 && (await tryRefresh())) {
    res = await rawRequest(path, options);
  }
  if (res.status === 401) {
    clearTokens();
    window.dispatchEvent(new Event("ahkmes:logout"));
  }
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  return (await res.json()) as T;
}

export const apiGet = <T,>(path: string) => api<T>(path);
export const apiPost = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const apiPatch = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const apiDelete = <T,>(path: string) => api<T>(path, { method: "DELETE" });

// multipart/form-data — Content-Type header'ı tarayıcı boundary ile kendisi ekler
export async function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const { access } = getTokens();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: access ? { Authorization: `Bearer ${access}` } : {},
    body: form,
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

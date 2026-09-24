const API_BASE = (
  import.meta.env.VITE_API_BASE ?? "http://localhost:3101"
).replace(/\/$/, "");
const csrfKey = "madina-express-csrf";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "request_error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = sessionStorage.getItem(csrfKey);
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      error?.message ?? "The server could not complete the request.",
      response.status,
      error?.code,
    );
  }
  return payload as T;
}

function rememberCsrf<T extends { csrfToken?: string }>(payload: T): T {
  if (payload.csrfToken) sessionStorage.setItem(csrfKey, payload.csrfToken);
  return payload;
}

export const api = {
  health: () => request<{ status: string; database: string }>("/health"),
  publicBootstrap: <T>() => request<T>("/public/bootstrap"),
  publicTripRuns: <T>(date: string) =>
    request<{ runs: T[] }>(`/public/trip-runs?date=${encodeURIComponent(date)}`),
  adminBootstrap: <T>() => request<T>("/admin/bootstrap"),
  me: <T>() =>
    request<T & { csrfToken?: string }>("/auth/me").then(rememberCsrf),
  login: <T>(identity: string, password: string) =>
    request<T & { csrfToken?: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identity, password }),
    }).then(rememberCsrf),
  logout: () =>
    request<{ ok: boolean }>("/auth/logout", { method: "POST" }).finally(() =>
      sessionStorage.removeItem(csrfKey),
    ),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean; csrfToken: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }).then(rememberCsrf),
  unlockFinance: (password: string) =>
    request<{ unlocked: boolean; expiresIn: number }>("/auth/finance-unlock", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  financeStatus: () =>
    request<{ unlocked: boolean }>("/finance/status"),
  createPublicBooking: <T>(booking: unknown) =>
    request<{ booking: T }>("/public/bookings", {
      method: "POST",
      body: JSON.stringify(booking),
    }),
  createBooking: <T>(booking: unknown) =>
    request<{ booking: T }>("/bookings", {
      method: "POST",
      body: JSON.stringify(booking),
    }),
  updateBooking: <T>(id: string, booking: unknown) =>
    request<{ booking: T }>(`/bookings/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(booking),
    }),
  cancelBooking: <T>(id: string) =>
    request<{ booking: T }>(`/bookings/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: "{}",
    }),
  confirmReservation: <T>(id: string, paymentMethod: string, paymentReference: string) =>
    request<{ booking: T }>(`/bookings/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ paymentMethod, paymentReference }),
    }),
  refundBooking: <T>(id: string, refund: unknown) =>
    request<{ booking: T }>(`/bookings/${encodeURIComponent(id)}/refunds`, {
      method: "POST",
      body: JSON.stringify(refund),
    }),
  saveRoute: <T>(id: string, route: unknown, isNew: boolean) =>
    request<{ route: T }>(`/routes/${encodeURIComponent(isNew ? "new" : id)}`, {
      method: isNew ? "POST" : "PUT",
      body: JSON.stringify(route),
    }),
  deleteRoute: (id: string) =>
    request<{ ok: boolean }>(`/routes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  saveBus: <T>(id: string, bus: unknown, isNew: boolean) =>
    request<{ bus: T }>(`/buses/${encodeURIComponent(isNew ? "new" : id)}`, {
      method: isNew ? "POST" : "PUT",
      body: JSON.stringify(bus),
    }),
  deleteBus: (id: string) =>
    request<{ ok: boolean }>(`/buses/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  saveTrip: <T>(id: string, trip: unknown, isNew: boolean) =>
    request<{ trip: T }>(`/trips/${encodeURIComponent(isNew ? "new" : id)}`, {
      method: isNew ? "POST" : "PUT",
      body: JSON.stringify(trip),
    }),
  deleteTrip: (id: string) =>
    request<{ ok: boolean }>(`/trips/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  transitionTrip: <T>(id: string, action: "boarding" | "depart" | "next", date: string) =>
    request<{ trip: T }>(`/trips/${encodeURIComponent(id)}/transition`, {
      method: "POST",
      body: JSON.stringify({ action, date }),
    }),
  listTripRuns: <T>(date: string) =>
    request<{ runs: T[] }>(`/trip-runs?date=${encodeURIComponent(date)}`),
  saveCrew: <T>(previousName: string | undefined, person: unknown) =>
    request<{ person: T }>(
      `/crew/${encodeURIComponent(previousName ?? "new")}`,
      {
        method: previousName ? "PUT" : "POST",
        body: JSON.stringify(person),
      },
    ),
  deleteCrew: (id: number) =>
    request<{ ok: boolean }>(`/crew/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  listExpenses: <T>() => request<{ expenses: T[] }>("/expenses"),
  createExpense: <T>(expense: unknown) =>
    request<{ expense: T }>("/expenses", {
      method: "POST",
      body: JSON.stringify(expense),
    }),
  createUser: <T>(user: unknown) =>
    request<{ user: T }>("/users", {
      method: "POST",
      body: JSON.stringify(user),
    }),
};

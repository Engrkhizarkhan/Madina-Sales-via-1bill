import type {PrintSettingsPayload,TerminalPrintPolicy} from './print-preferences';
import type { ReceiptLayout } from "../shared/receipt-layout.mjs";
import type { ReleaseInfo } from "./release";
const API_BASE = (
  import.meta.env.VITE_API_BASE ?? "http://localhost:3101"
).replace(/\/$/, "");
const csrfKey = "madina-express-csrf";
let memoryCsrf = "";
function storedCsrf(){try{return sessionStorage.getItem(csrfKey)||memoryCsrf;}catch{return memoryCsrf;}}
function storeCsrf(value:string){memoryCsrf=value;try{if(value)sessionStorage.setItem(csrfKey,value);else sessionStorage.removeItem(csrfKey);}catch{/* Keep this tab usable when browser storage is unavailable. */}}
let refreshingCsrf:Promise<void>|null=null;
function refreshCsrfToken(){
  if(!refreshingCsrf)refreshingCsrf=sendRequest<{csrfToken:string}>("/auth/me").then(value=>{
    if(typeof value.csrfToken!=="string"||!value.csrfToken)throw new ApiError("Sign in again to refresh this session.",401,"unauthenticated");
    storeCsrf(value.csrfToken);
  }).finally(()=>{refreshingCsrf=null;});
  return refreshingCsrf;
}

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
):Promise<T>{
  try{return await sendRequest<T>(path,options);}
  catch(error){
    // The server rejects CSRF before executing the action. Refresh only this
    // token, then retry once. Network failures are never replayed.
    if(!(error instanceof ApiError)||error.status!==403||error.code!=="csrf_failed"||options.signal?.aborted)throw error;
    await refreshCsrfToken();
    return sendRequest<T>(path,options);
  }
}

async function sendRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = storedCsrf();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, {once:true});
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, method === "GET" || path.startsWith("/auth/") ? 12000 : 45000);
  try {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    method,
    headers,
    credentials: options.credentials ?? "include",
    cache:"no-store",
    signal: controller.signal,
  });
  const payload = await response.json().catch(() => {throw new ApiError("The server returned an incomplete page response. Refresh the application and try again.",response.status||502,"invalid_response");});
  if (controller.signal.aborted) throw new DOMException("Request aborted", "AbortError");
  if (!response.ok) {
    const error = payload?.error;
    if(response.status===401&&error?.code==="unauthenticated")storeCsrf("");
    throw new ApiError(
      error?.message ?? "The server could not complete the request.",
      response.status,
      error?.code,
    );
  }
  return payload as T;
  } catch (error) {
    if (timedOut) throw new ApiError(method === "GET" || path.startsWith("/auth/") ? "Server connection timed out. Check the connection and retry. At the terminal, use the local Counter shortcut." : "The server did not confirm the result. Refresh and check the record before trying this action again.", 0, "connection_timeout");
    throw error;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function downloadSetup(path: string, currentPassword: string, filename: string, options: {allowSoftwareKey?:boolean} = {}) {
  const main=path==="/terminal/package";
  for(let attempt=0;attempt<(main?2:1);attempt++){
    const controller=new AbortController();let timedOut=false;
    const timer=window.setTimeout(()=>{timedOut=true;controller.abort();},180000);
    try{
      const send=()=>fetch(`${API_BASE}${path}`,{
        method:"POST",credentials:"include",signal:controller.signal,
        cache:"no-store",
        headers:{"Content-Type":"application/json","X-CSRF-Token":storedCsrf()},
        body:JSON.stringify({currentPassword,...options,...(main?{delivery:"browser"}:{})}),
      });
      let response=await send();
      if(response.status===403){
        const denied=await response.clone().json().catch(()=>null);
        if(denied?.error?.code==="csrf_failed"){await refreshCsrfToken();response=await send();}
      }
      if(!response.ok){
        const payload=await response.json().catch(()=>({}));
        throw new ApiError(response.status===401?"Your session expired. Sign in again, then download the installer.":payload?.error?.message||"The setup file could not be created.",response.status);
      }
      if(main&&response.headers.get("content-type")?.includes("application/json")){
        const payload=await response.json();
        if(typeof payload.downloadPath!=="string"||!/^\/terminal\/installer-download\/[a-f0-9]{64}$/.test(payload.downloadPath))throw new ApiError("The server returned an invalid installer link. Try preparing it again.",502);
        const url=`${API_BASE}${payload.downloadPath}`;
        const link=document.createElement("a");link.href=url;link.download=filename;link.hidden=true;
        document.body.appendChild(link);link.click();link.remove();
        return url;
      }
      // Compatibility for child setup files and an older server during rollout.
      const url=URL.createObjectURL(await response.blob());
      const link=document.createElement("a");link.href=url;link.download=filename;link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);
      return;
    }catch(error){
      if(timedOut)throw new ApiError("Preparing the installer timed out. Check your connection and try again.",0,"connection_timeout");
      if(main&&attempt===0&&error instanceof TypeError){await new Promise(resolve=>window.setTimeout(resolve,750));continue;}
      if(error instanceof TypeError)throw new ApiError("The setup service could not be reached. Check your connection and try again.",0,"connection_error");
      throw error;
    }finally{window.clearTimeout(timer);}
  }
}

export type TerminalStatus = {
  mode: "terminal" | "cloud" | "standalone";
  phase?: string; localOrigin?: string; connected?: boolean; replicated?: boolean;
  secondsBehind?: number | null; replicationError?: boolean; checkedAt?: string;
};

function rememberCsrf<T extends { csrfToken?: string }>(payload: T): T {
  if (payload.csrfToken) storeCsrf(payload.csrfToken);
  return payload;
}

export const api = {
  reviewRemoval:(id:string,action:'restore'|'approve'|'purge',currentPassword='')=>request<{status:string;affected:number}>(`/admin/recovery/${encodeURIComponent(id)}/${action}`,{method:'POST',body:JSON.stringify({confirm:true,currentPassword})}),
  reconciliationOptions:()=>request<{users:{id:number;name:string;active:number}[];terminals:{slot:number}[]}>('/admin/reconciliation-options'),
  recordCashEntry:(data:unknown)=>request<{ok:boolean;id:number}>('/admin/cash-entries',{method:'POST',body:JSON.stringify(data)}),
  reverseCashEntry:(id:number,data:{notes:string;requestKey:string})=>request<{ok:boolean;id:number}>(`/admin/cash-entries/${id}/reverse`,{method:'POST',body:JSON.stringify(data)}),

  printingSettings:()=>request<PrintSettingsPayload>("/settings/printing"),
  savePrintingSettings:(terminals:NonNullable<PrintSettingsPayload["terminals"]>)=>request<PrintSettingsPayload>("/settings/printing",{method:"PUT",body:JSON.stringify({terminals})}),
  recordPage: <T>(path:string,filters:Record<string,string|number|undefined>,signal?:AbortSignal) => request<import("./record-pages").PageResult<T>>(path+"?"+new URLSearchParams(Object.entries(filters).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])),{signal}),
  dashboardSummary: (filters:{from:string;to:string})=>request<{groups:{status:string;source:string;tickets:number;seats:number}[]}>("/admin/dashboard-summary?"+new URLSearchParams(filters)),
  createPrintJob: <T>(body:unknown,signal:AbortSignal)=>request<T>('/printing/jobs',{method:'POST',body:JSON.stringify(body),signal}),
  claimPrintJob: <T>(id:string,key:string)=>request<T>('/printing/jobs/'+id,{headers:{'X-Print-Token':key},credentials:'omit'}),
  counterLauncherUrl: `${API_BASE}/terminal/counter-launcher`,
  terminalConnection: () => request<{ local: boolean; connected: boolean; replicated: boolean; readOnly?: boolean; secondsBehind?:number|null; replicationError?:boolean; cloudLatencyMs?:number|null }>("/terminal/connection"),
  terminalPresence: () => request<{sourceReachable:boolean;checkedAt:string;terminals:{slot:number;enrolled:boolean;status:string;lastSeen:string|null;ageMs:number|null;transport:string|null;phase:string|null;rttMs:number|null;downloadMbps:number|null;lossPct:number|null;probeOk:boolean|null;version:string|null;localOpening:boolean;bars:number}[]}>("/terminal/presence"),
  terminalStatus: () => request<TerminalStatus>("/terminal/status"),
  cancelTerminalSetup: (currentPassword: string) => request("/terminal/cancel-setup", { method: "POST", body: JSON.stringify({ currentPassword }) }),
  mainPcSetup: (password: string) => downloadSetup("/terminal/package", password, "Madina-Express-Main-PC.zip"),
  terminalPcSetup: (slot: number, password: string, allowSoftwareKey = false) => downloadSetup(`/terminal/devices/${slot}/package`, password, `Madina-Express-PC-${slot}.zip`, {allowSoftwareKey}),
  addTerminal: (currentPassword: string) => request<{slot:number}>("/terminal/devices", {method:"POST",body:JSON.stringify({currentPassword})}),
  revokeTerminal: (slot: number, currentPassword: string) => request<{ ok: boolean }>(`/terminal/devices/${slot}`, { method: "DELETE", body:JSON.stringify({currentPassword,confirm:true}) }),
  updateStatus: () => request<{current:ReleaseInfo;available:{version:string;releaseId:string;createdAt:string}|null;paused:boolean;cloudAvailable:boolean;terminal:{stage:string;checkedAt?:string;message?:string;current?:{releaseId:string;version:string}}|null}>("/updates/status"),
  pauseUpdates: (paused:boolean) => request("/updates/control",{method:"POST",body:JSON.stringify({paused})}),
  receiptLayout: () => request<{layout:ReceiptLayout}>("/settings/receipt"),
  saveReceiptLayout: (layout:Partial<ReceiptLayout>) => request<{layout:ReceiptLayout}>("/settings/receipt",{method:"PUT",body:JSON.stringify(layout)}),
  policies: <T>() => request<{policies:T}>("/settings/policies"),
  savePolicies: <T>(policies:T) => request<{policies:T}>("/settings/policies",{method:"PUT",body:JSON.stringify(policies)}),
  accountAuthenticator: <T>(id:number,enabled:boolean) => request<{user:T;setup:{secret:string;uri:string}|null}>(`/users/${id}/authenticator`,{method:"POST",body:JSON.stringify({enabled})}),
  revokeAccount: (id:number) => request(`/users/${id}/revoke`,{method:"POST",body:"{}"}),
  health: () => request<{ status: string; database: string }>("/health"),
  publicBootstrap: <T>() => request<T>("/public/bootstrap"),
  publicTripRuns: <T>(date: string) =>
    request<{ terminalAvailable?: boolean; runs: T[]; occupancy: unknown[]; fleet: unknown[]; trips: unknown[]; routes: unknown[] }>(`/public/trip-runs?date=${encodeURIComponent(date)}`),
  adminBootstrap: <T>(date?:string) => request<T>("/admin/bootstrap"+(date?"?date="+encodeURIComponent(date):"")),
  adminChanges: <T>(cursor:string,date?:string) => request<T>(`/admin/changes?cursor=${encodeURIComponent(cursor)}${date?"&date="+encodeURIComponent(date):""}`),
  me: <T>() =>
    request<T & { csrfToken?: string }>("/auth/me").then(rememberCsrf),
  login: <T>(identity: string, password: string, otp = "") =>
    request<T & { csrfToken?: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identity, password, otp }),
    }).then(rememberCsrf),
  logout: () =>
    request<{ ok: boolean }>("/auth/logout", { method: "POST" }).finally(() =>
      storeCsrf(""),
    ),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean; csrfToken: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }).then(rememberCsrf),
  unlockFinance: (pin: string) =>
    request<{ unlocked: boolean; expiresIn: number }>("/auth/finance-unlock", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  financeStatus: () =>
    request<{ unlocked: boolean; pinConfigured: boolean; expiresIn: number }>("/finance/status"),
  setFinancePin: (pin: string, currentPassword: string) =>
    request<{ ok: boolean }>("/finance/pin", { method: "PUT", body: JSON.stringify({ pin, currentPassword }) }),
  lookupJourney: <T>(reference: string, phone: string, key?: string) =>
    request<{ journey: T }>("/public/ticket-lookup", {
      method: "POST",
      body: JSON.stringify({ reference, phone, key }),
    }),
  createPublicBooking: <T>(booking: unknown) =>
    request<{ bookings: T[] }>("/public/bookings", {
      method: "POST",
      body: JSON.stringify(booking),
    }),
  createBooking: <T>(booking: unknown) =>
    request<{ booking: T; bookings: T[]; printing?:TerminalPrintPolicy }>("/bookings", {
      method: "POST",
      body: JSON.stringify(booking),
    }),
  confirmReservations: <T>(anchor: string, ids: string[], paymentMethod: string, paymentReference: string, details?: unknown) =>
    request<{bookings:T[];printing?:TerminalPrintPolicy}>(`/bookings/${encodeURIComponent(anchor)}/reservations/confirm`, {
      method:'POST',body:JSON.stringify({...details as object,ids,paymentMethod,paymentReference}),
    }),
  cancelReservations: <T>(anchor: string, ids: string[]) =>
    request<{bookings:T[];printing?:TerminalPrintPolicy}>(`/bookings/${encodeURIComponent(anchor)}/reservations/cancel`, {
      method:'POST',body:JSON.stringify({ids}),
    }),
  updateBooking: <T>(id: string, booking: unknown) =>
    request<{ booking: T; printing?:TerminalPrintPolicy }>(`/bookings/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(booking),
    }),
  cancelBooking: <T>(id: string) =>
    request<{ booking: T; printing?:TerminalPrintPolicy }>(`/bookings/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: "{}",
    }),
  confirmReservation: <T>(id: string, paymentMethod: string, paymentReference: string, details: unknown = {}) =>
    request<{ booking: T; printing?:TerminalPrintPolicy }>(`/bookings/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ ...details as object, paymentMethod, paymentReference }),
    }),
  refundBooking: <T>(id: string, refund: unknown) =>
    request<{ booking: T; printing?:TerminalPrintPolicy }>(`/bookings/${encodeURIComponent(id)}/refunds`, {
      method: "POST",
      body: JSON.stringify(refund),
    }),
  saveRoute: <T>(id: string, route: unknown, isNew: boolean) =>
    request<{ route: T }>(`/routes/${encodeURIComponent(isNew ? "new" : id)}`, {
      method: isNew ? "POST" : "PUT",
      body: JSON.stringify(route),
    }),
  deleteRoute: (id: string,reason?:string) =>
    request<{ ok: boolean }>(`/routes/${encodeURIComponent(id)}`, {
      method: "DELETE",body:JSON.stringify({reason}),
    }),
  saveBus: <T>(id: string, bus: unknown, isNew: boolean) =>
    request<{ bus: T }>(`/buses/${encodeURIComponent(isNew ? "new" : id)}`, {
      method: isNew ? "POST" : "PUT",
      body: JSON.stringify(bus),
    }),
  deleteBus: (id: string,reason?:string) =>
    request<{ ok: boolean }>(`/buses/${encodeURIComponent(id)}`, {
      method: "DELETE",body:JSON.stringify({reason}),
    }),
  saveTrip: <T>(id: string, trip: unknown, isNew: boolean) =>
    request<{ trip: T }>(`/trips/${encodeURIComponent(isNew ? "new" : id)}`, {
      method: isNew ? "POST" : "PUT",
      body: JSON.stringify(trip),
    }),
  restoreTrip:<T>(id:string)=>request<{trip:T}>(`/trips/${encodeURIComponent(id)}/restore`,{method:'POST',body:JSON.stringify({confirm:true})}),
  deleteTrip: (id: string,reason?:string) =>
    request<{ ok: boolean }>(`/trips/${encodeURIComponent(id)}`, {
      method: "DELETE",body:JSON.stringify({reason}),
    }),
  transitionTrip: <T>(id: string, action: string, date: string, notes = "", options: {confirm?:boolean;resolveReservations?:boolean}={}) =>
    request<{ trip: T }>(`/trips/${encodeURIComponent(id)}/transition`, {
      method: "POST",
      body: JSON.stringify({ action, date, notes, ...options }),
    }),
  listTripRuns: <T>(date: string) =>
    request<{ runs: T[] }>(`/trip-runs?date=${encodeURIComponent(date)}`),
  assignDeparture: <T>(id: string, assignment: unknown) =>
    request<{ trip: T }>(`/trips/${encodeURIComponent(id)}/assignment`, {method: "PUT", body: JSON.stringify(assignment)}),
  saveCounterDeparture: <T>(id: string, data: unknown) =>
    request<{trip: T}>(`/trips/${encodeURIComponent(id)}/counter`, {method: "PUT", body: JSON.stringify(data)}),
  saveCrew: <T>(previousName: string | undefined, person: unknown) =>
    request<{ person: T }>(
      `/crew/${encodeURIComponent(previousName ?? "new")}`,
      {
        method: previousName ? "PUT" : "POST",
        body: JSON.stringify(person),
      },
    ),
  deleteCrew: (id: number,reason?:string) =>
    request<{ ok: boolean }>(`/crew/${encodeURIComponent(id)}`, {
      method: "DELETE",body:JSON.stringify({reason}),
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
  updateUser: <T>(id: number, user: unknown) =>
    request<{ user: T }>(`/users/${id}`, { method: "PUT", body: JSON.stringify(user) }),
  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" }),
  terminalAccess: () =>
    request<{ enforced: boolean; terminals: { slot: number; enrolled: boolean; keyStorage?:"tpm"|"windows"|null }[] }>("/users/terminal-access"),
};

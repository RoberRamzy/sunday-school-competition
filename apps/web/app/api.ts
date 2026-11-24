export type Grade = { id: string; name: string };
export type Theme = "classic" | "christmas";
export type Principal = {
  id: string;
  displayName: string;
  role: "STUDENT" | "SERVANT" | "SUPER_ADMIN";
  gradeId?: string;
};
export type Language = "en" | "ar";
export type Translate = (en: string, ar: string) => string;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiResponse(path: string, init?: RequestInit) {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = Array.isArray(body?.message) ? body.message.join(" ") : body?.message;
    throw new ApiError(response.status, typeof detail === "string" ? detail : "");
  }
  return response;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiResponse(path, init);
  if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
  return response.json();
}

export function json(method: string, data: unknown = {}): RequestInit {
  return { method, body: JSON.stringify(data) };
}

export function errorText(error: unknown, t: Translate, credentials = false) {
  if (error instanceof ApiError) {
    if (error.status === 429) return t("Too many requests. Wait a moment and try again.", "طلبات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.");
    if (error.status === 401 && credentials) return t("Those details didn’t match. Check them and try again.", "البيانات غير مطابقة. تحقق منها وحاول مرة أخرى.");
    if (error.status === 401) return t("Your session ended. Please sign in again.", "انتهت جلستك. سجل الدخول مرة أخرى.");
    if (error.status === 403) return t("You don’t have permission for this action.", "ليس لديك صلاحية تنفيذ هذا الإجراء.");
    if (error.status === 409 && !credentials) return t(error.message || "This record has changed. Refresh and try again.", "تغير السجل. حدّث الصفحة وحاول مرة أخرى.");
    if (error.status === 400) return t("Check the information you entered and try again.", "تحقق من المعلومات التي أدخلتها وحاول مرة أخرى.");
  }
  return t("We couldn’t reach the service. Check your connection and try again.", "تعذر الاتصال بالخدمة. تحقق من اتصالك وحاول مرة أخرى.");
}

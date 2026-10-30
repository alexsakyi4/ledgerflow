import axios, { AxiosError } from "axios";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "/api";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach access token from cookie is handled by withCredentials + httpOnly cookies.
// On 401, we could attempt refresh here. For Phase 1, surface the error.
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      const requestPath = err.config?.url || "";
      const authFlowRequest = /\/auth\/(login|register|me)$/.test(requestPath);
      if (!authFlowRequest) {
        // Token expired — let the auth layer handle redirect
        window.dispatchEvent(new CustomEvent("auth:expired"));
      }
    }
    return Promise.reject(err);
  }
);

export type ApiError = {
  success: boolean;
  error: string;
  details?: unknown;
};

export function isApiError(err: unknown): err is AxiosError<ApiError> {
  return axios.isAxiosError(err);
}

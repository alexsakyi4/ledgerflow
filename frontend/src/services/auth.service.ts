import { api } from "@/lib/api";

export const authService = {
  login: (email: string, password: string) =>
    api.post("/auth/login", { email, password }),

  register: (data: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }) => api.post("/auth/register", data),

  logout: () => api.post("/auth/logout"),

  me: () => api.get<{ data: { user: { id: string; email: string } } }>("/auth/me"),
};

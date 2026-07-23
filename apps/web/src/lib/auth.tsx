import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Role } from "@ahkmes/shared-types";
import { api, apiPost, clearTokens, getTokens, setTokens } from "./api";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => undefined,
  logout: () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener("ahkmes:logout", onLogout);
    return () => window.removeEventListener("ahkmes:logout", onLogout);
  }, []);

  useEffect(() => {
    const { access } = getTokens();
    if (!access) {
      setLoading(false);
      return;
    }
    api<AuthUser>("/auth/me")
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await apiPost<{ accessToken: string; refreshToken: string }>("/auth/login", {
      email,
      password,
    });
    setTokens(tokens.accessToken, tokens.refreshToken);
    setUser(await api<AuthUser>("/auth/me"));
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

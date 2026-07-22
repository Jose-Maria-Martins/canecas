import { useCallback, useEffect, useState } from "react";
import type { User } from "../types";
import { api } from "../api/client";

/**
 * Current session (TASKS.md §7). With cookie-based auth the frontend can't read
 * the HttpOnly session cookie directly, so it asks the API who it is. In mock
 * mode the session is persisted client-side.
 */
export function useSession() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await api.getSession());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return { user, loading, refresh, setUser, logout };
}

"use client";
import { create } from "zustand";
import type { UserPublic } from "./eco";

interface AuthState {
  token: string | null;
  user: UserPublic | null;
  hydrated: boolean;
  setAuth: (token: string, user: UserPublic) => void;
  logout: () => void;
  hydrate: () => void;
}

const TOKEN_KEY = "eco_token";
const USER_KEY = "eco_user";

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  hydrated: false,
  setAuth: (token, user) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
    set({ token, user });
  },
  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
    set({ token: null, user: null });
  },
  hydrate: () => {
    if (typeof window === "undefined") return;
    if (get().hydrated) return;
    const token = localStorage.getItem(TOKEN_KEY);
    const userRaw = localStorage.getItem(USER_KEY);
    if (token && userRaw) {
      try {
        const user = JSON.parse(userRaw) as UserPublic;
        set({ token, user, hydrated: true });
        return;
      } catch {
        /* fall through */
      }
    }
    set({ hydrated: true });
  },
}));

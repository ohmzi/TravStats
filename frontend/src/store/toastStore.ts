import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

/** A link a toast offers: where to go, and what to call it. */
export interface ToastAction {
  label: string;
  to: string;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // in milliseconds, default 5000
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number, action?: ToastAction) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (type, message, duration = 5000, action) => {
    const id = Math.random().toString(36).substring(2, 9);
    const toast: Toast = { id, type, message, duration, action };

    set((state) => ({
      toasts: [...state.toasts, toast],
    }));

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }

    return id;
  },
  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
  clearToasts: () => {
    set({ toasts: [] });
  },
}));

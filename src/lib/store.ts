"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Lang } from "@/i18n";

/** Lightweight client state: delivery location, cart, accessibility prefs. Nothing medical is persisted here. */
interface LocationState {
  pincode: string;
  areaLabel: string;
  setLocation: (pincode: string, areaLabel?: string) => void;
}

export const useLocation = create<LocationState>()(
  persist(
    (set) => ({
      pincode: "261001",
      areaLabel: "Sitapur",
      setLocation: (pincode, areaLabel = "") => set({ pincode, areaLabel }),
    }),
    { name: "mc-location", skipHydration: true },
  ),
);

export interface CartLine {
  medicineId: string;
  name: string;
  strength: string;
  price: number;
  mrp: number;
  quantity: number;
  prescriptionRequired: boolean;
}

interface CartState {
  pharmacyId?: string;
  pharmacyName?: string;
  lines: CartLine[];
  prescriptionId?: string;
  add: (pharmacy: { id: string; name: string }, line: Omit<CartLine, "quantity">) => boolean;
  setQty: (medicineId: string, qty: number) => void;
  remove: (medicineId: string) => void;
  attachPrescription: (id?: string) => void;
  clear: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      add: (pharmacy, line) => {
        const s = get();
        if (s.pharmacyId && s.pharmacyId !== pharmacy.id && s.lines.length) return false;
        const existing = s.lines.find((l) => l.medicineId === line.medicineId);
        set({
          pharmacyId: pharmacy.id,
          pharmacyName: pharmacy.name,
          lines: existing
            ? s.lines.map((l) => (l.medicineId === line.medicineId ? { ...l, quantity: Math.min(20, l.quantity + 1) } : l))
            : [...s.lines, { ...line, quantity: 1 }],
        });
        return true;
      },
      setQty: (id, qty) =>
        set((s) => ({ lines: qty <= 0 ? s.lines.filter((l) => l.medicineId !== id) : s.lines.map((l) => (l.medicineId === id ? { ...l, quantity: Math.min(20, qty) } : l)) })),
      remove: (id) => set((s) => ({ lines: s.lines.filter((l) => l.medicineId !== id) })),
      attachPrescription: (id) => set({ prescriptionId: id }),
      clear: () => set({ lines: [], pharmacyId: undefined, pharmacyName: undefined, prescriptionId: undefined }),
    }),
    { name: "mc-cart", skipHydration: true },
  ),
);

interface PrefsState {
  large: boolean;
  highContrast: boolean;
  lang: Lang;
  setLarge: (v: boolean) => void;
  setHighContrast: (v: boolean) => void;
  setLang: (l: Lang) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      large: false,
      highContrast: false,
      lang: "en",
      setLarge: (large) => set({ large }),
      setHighContrast: (highContrast) => set({ highContrast }),
      setLang: (lang) => set({ lang }),
    }),
    { name: "mc-prefs", skipHydration: true },
  ),
);

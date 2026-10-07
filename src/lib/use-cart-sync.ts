"use client";
import { useEffect, useRef } from "react";
import { api } from "./api";
import { useMe } from "./hooks";
import { useCart } from "./store";

interface ServerCart {
  pharmacyId?: string;
  pharmacyName?: string;
  prescriptionId?: string;
  lines: { medicineId: string; name: string; strength: string; price: number; mrp: number; quantity: number; prescriptionRequired: boolean }[];
}

/**
 * Keeps the customer's cart on the server so it follows them across phones.
 *  - On login: if this device's cart is empty, adopt the server cart.
 *  - After edits: save (debounced). Guests keep a local cart only.
 */
export function useCartSync() {
  const me = useMe();
  const hydrated = useRef(false);
  const loggedIn = me.data?.role === "CUSTOMER";

  useEffect(() => {
    if (!loggedIn || hydrated.current) return;
    hydrated.current = true;
    api<ServerCart>("/api/cart")
      .then((server) => {
        const local = useCart.getState();
        if (local.lines.length === 0 && server.lines.length > 0 && server.pharmacyId) {
          useCart.setState({ pharmacyId: server.pharmacyId, pharmacyName: server.pharmacyName, prescriptionId: server.prescriptionId, lines: server.lines });
        }
      })
      .catch(() => undefined);
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn) return;
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useCart.subscribe((s, prev) => {
      if (!hydrated.current || (s.lines === prev.lines && s.pharmacyId === prev.pharmacyId && s.prescriptionId === prev.prescriptionId)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        api("/api/cart", { method: "PUT", json: { pharmacyId: s.pharmacyId, prescriptionId: s.prescriptionId, items: s.lines.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity })) } }).catch(() => undefined);
      }, 800);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, [loggedIn]);
}

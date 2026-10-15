import type { NotificationChannel, NotificationEvent } from "@/lib/types";
import { db, uid } from "@/server/store";

/** Which channels each event uses. Real providers plug into `ChannelProvider` below. */
export const EVENT_CHANNELS: Record<NotificationEvent, NotificationChannel[]> = {
  ORDER_PLACED: ["SMS", "PUSH"],
  PRESCRIPTION_APPROVED: ["SMS", "WHATSAPP", "PUSH"],
  ORDER_CONFIRMED: ["SMS", "WHATSAPP", "PUSH"],
  RIDER_ASSIGNED: ["SMS", "PUSH"],
  OUT_FOR_DELIVERY: ["SMS", "PUSH"],
  ORDER_DELIVERED: ["SMS", "PUSH", "EMAIL"],
  ORDER_CANCELLED: ["SMS", "PUSH"],
  REFILL_REMINDER: ["SMS", "WHATSAPP", "PUSH"],
  MEDICINE_FOUND: ["SMS", "WHATSAPP", "PUSH"],
  APPLICATION_UPDATE: ["SMS", "PUSH"],
  PRESCRIPTION_REJECTED: ["SMS", "WHATSAPP", "PUSH"],
  ORDER_PREPARING: ["PUSH"],
  ORDER_READY: ["PUSH"],
  PAYMENT_RECEIVED: ["SMS", "PUSH"],
  PAYMENT_FAILED: ["SMS", "PUSH"],
  REFUND_INITIATED: ["SMS", "PUSH"],
  REFUND_COMPLETED: ["SMS", "PUSH", "EMAIL"],
  REFUND_FAILED: ["SMS", "PUSH"],
  DELIVERY_FAILED: ["SMS", "WHATSAPP", "PUSH"],
  ORDER_PARTIAL_PROPOSED: ["SMS", "WHATSAPP", "PUSH"],
  SUPPORT_ALERT: ["PUSH"],
};

export interface ChannelProvider {
  send(channel: NotificationChannel, to: string, title: string, body: string): Promise<void>;
}

/** Default provider just logs. Replace with MSG91 / Meta WhatsApp Cloud / FCM / SMTP adapters. */
export const consoleProvider: ChannelProvider = {
  async send(channel, to, title) {
    if (process.env.NODE_ENV !== "test") console.info(`[notify:${channel}] -> ${to}: ${title}`);
  },
};

let provider: ChannelProvider = consoleProvider;
export const setChannelProvider = (p: ChannelProvider) => (provider = p);

/** Never put medicine names or diagnoses in SMS/WhatsApp bodies – keep them generic (data minimisation). */
export function notify(userId: string, event: NotificationEvent, title: string, body: string) {
  const d = db();
  const channels = EVENT_CHANNELS[event];
  d.notifications.unshift({ id: uid("n"), userId, event, channels, title, body, read: false, createdAt: new Date().toISOString() });
  if (d.notifications.length > 3000) d.notifications.length = 3000;
  const user = d.users.find((u) => u.id === userId);
  const to = user?.mobile ?? userId.replace("guest:", "");
  for (const c of channels) void provider.send(c, to, title, body);
}

/** Everyone who works at a pharmacy (admins and pharmacists). */
export function notifyPharmacy(pharmacyId: string, event: NotificationEvent, title: string, body: string) {
  for (const u of db().users.filter((x) => x.partnerId === pharmacyId && (x.role === "PHARMACY_ADMIN" || x.role === "PHARMACIST"))) notify(u.id, event, title, body);
}

/** Operational alert for the support team (platform admins). */
export function notifyAdmins(title: string, body: string) {
  for (const u of db().users.filter((x) => x.role === "SUPER_ADMIN")) notify(u.id, "SUPPORT_ALERT", title, body);
}

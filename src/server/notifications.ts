import type { NotificationChannel, NotificationEvent } from "@/lib/types";
import { db, uid } from "./store";

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

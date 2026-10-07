import type { Metadata, Viewport } from "next";
import { RiderShell } from "@/components/delivery/rider-shell";

// The delivery app installs separately: its own manifest, name, icon and theme colour.
export const metadata: Metadata = {
  title: { default: "MediCare Rider", template: "%s · MediCare Rider" },
  manifest: "/rider.webmanifest",
  applicationName: "MediCare Rider",
  appleWebApp: { capable: true, title: "MediCare Rider", statusBarStyle: "default" },
  icons: { icon: "/icons/rider-192.png", apple: "/icons/rider-192.png" },
};
export const viewport: Viewport = { themeColor: "#0d5f59", width: "device-width", initialScale: 1 };

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return <RiderShell>{children}</RiderShell>;
}

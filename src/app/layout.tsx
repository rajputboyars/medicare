import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: { default: "DawaDost: medicines, delivered locally", template: "%s · DawaDost" },
  description: "Order medicines from nearby verified pharmacies, upload prescriptions and track delivery – built for small towns.",
  manifest: "/manifest.webmanifest",
  applicationName: "DawaDost",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  appleWebApp: { capable: true, title: "DawaDost", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: { title: "DawaDost: medicines, delivered locally", description: "Order from verified nearby pharmacies. Prescription checked, delivered to your door.", siteName: "DawaDost", type: "website", images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "DawaDost" }] },
  twitter: { card: "summary_large_image", title: "DawaDost", description: "Medicines, delivered locally.", images: ["/brand/og.png"] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-large="false">
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

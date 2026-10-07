/** Installable manifest for the delivery-partner app. Scope is /delivery so it installs as its own app. */
export function GET() {
  const manifest = {
    id: "/delivery",
    name: "MediCare Rider",
    short_name: "Rider",
    description: "Accept and complete medicine deliveries.",
    lang: "en-IN",
    start_url: "/delivery?source=pwa",
    scope: "/delivery",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf8f4",
    theme_color: "#0d5f59",
    categories: ["business", "navigation"],
    icons: [
      { src: "/icons/rider-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/rider-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/rider-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Available deliveries", url: "/delivery?source=shortcut" },
      { name: "Earnings", url: "/delivery/earnings?source=shortcut" },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}

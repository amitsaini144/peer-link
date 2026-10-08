import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PeerLink",
    short_name: "PeerLink",
    description: "Realtime peer-to-peer video calling",
    start_url: "/",
    display: "standalone",
    background_color: "#0369a1",
    theme_color: "#0369a1",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

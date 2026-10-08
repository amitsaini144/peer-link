import type { MetadataRoute } from "next";

const SITE_URL = "https://peerlink.amit144.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Rooms are ephemeral and API routes aren't pages, so keep them out of the index
      disallow: ["/room/", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

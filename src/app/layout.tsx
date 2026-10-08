import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/toaster"

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://peerlink.amit144.com"),
  title: "PeerLink",
  description: "Realtime peer-to-peer video calling",
};

export const viewport: Viewport = {
  themeColor: "#0369a1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${plusJakartaSans.variable} font-sans`} suppressHydrationWarning={true}>
          {children}
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}

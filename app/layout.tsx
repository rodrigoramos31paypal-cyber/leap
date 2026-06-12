import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { InstallPrompt } from "@/components/install-prompt";
import { getTheme } from "@/lib/theme";

const APP_NAME = "LEAP-FITNESS STUDIO";
const APP_DESCRIPTION = "Portal de gestão de marcações, packs e sessões da LEAP-FITNESS STUDIO.";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · LEAP-FITNESS` },
  description: APP_DESCRIPTION,
  manifest: "/manifest.json",
  applicationName: "LEAP",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LEAP",
    startupImage: [
      { url: "/icons/splash-1242x2688.png", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/splash-1284x2778.png", media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/splash-1170x2532.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      { url: "/icons/splash-828x1792.png", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" },
      { url: "/icons/splash-750x1334.png", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
  icons: {
    icon: [
      { url: "/icons/favicon.ico", sizes: "any" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch.png", sizes: "180x180" }],
    shortcut: ["/icons/favicon.ico"],
  },
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    type: "website",
    locale: "pt_PT",
    images: ["/icons/icon-512.png"],
  },
  twitter: {
    card: "summary",
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: ["/icons/icon-512.png"],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0A0A0A" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0A0A" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = getTheme();
  // H2: nonce CSP gerado por middleware e propagado via `x-nonce`.
  // Sem nonce (dev local sem middleware), o CSP no production-build
  // não permitiria este `<script>` correr.
  const nonce = headers().get("x-nonce") ?? undefined;
  return (
    <html lang="pt-PT" className={theme === "dark" ? "dark" : ""}>
      <body className="min-h-screen bg-bone-50 text-ink-900 antialiased dark:bg-ink-900 dark:text-bone-50">
        {children}
        <InstallPrompt />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}

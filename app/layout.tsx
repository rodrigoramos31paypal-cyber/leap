import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { InstallPrompt } from "@/components/install-prompt";
import { getTheme } from "@/lib/theme";

const APP_NAME = "LEAP Fitness Studio";
const APP_DESCRIPTION = "Portal de gestão de marcações, packs e sessões da LEAP Fitness Studio.";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: APP_URL ? new URL(APP_URL) : undefined,
  title: { default: APP_NAME, template: `%s · LEAP Fitness Studio` },
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
    // Múltiplas dimensões → o iOS escolhe a correspondência exacta por
    // dispositivo (iPhone @2x=120, iPad=152, iPad Pro=167, iPhone @3x=180)
    // em vez de reescalar uma única imagem. Reduz o risco de fallback.
    apple: [
      { url: "/icons/apple-touch-120.png", sizes: "120x120" },
      { url: "/icons/apple-touch-152.png", sizes: "152x152" },
      { url: "/icons/apple-touch-167.png", sizes: "167x167" },
      { url: "/icons/apple-touch-180.png", sizes: "180x180" },
    ],
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getTheme();
  // H2: nonce CSP gerado por middleware e propagado via `x-nonce`.
  // Sem nonce (dev local sem middleware), o CSP no production-build
  // não permitiria este `<script>` correr.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="pt-PT" className={theme === "dark" ? "dark" : ""}>
      <body className="min-h-dvh bg-bone-50 text-ink-900 antialiased dark:bg-ink-900 dark:text-bone-50">
        {children}
        <InstallPrompt />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  // updateViaCache:'none' → o browser nunca usa a HTTP cache
                  // para o script do SW; verifica sempre na rede. reg.update()
                  // força uma verificação imediata. Combinado com skipWaiting
                  // no sw.js, garante que um SW novo (ex: leap-v4) é apanhado
                  // e activado mesmo em iOS, que de outra forma fica preso na
                  // versão antiga.
                  navigator.serviceWorker
                    .register('/sw.js', { updateViaCache: 'none' })
                    .then((reg) => { reg.update().catch(() => {}); })
                    .catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}

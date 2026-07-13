import type { Metadata } from "next";
import { InstallClient } from "./install-client";

export const metadata: Metadata = {
  title: "Instalar a app",
  description: "Instala a app da LEAP Fitness Studio no teu ecrã principal em segundos.",
  // Página pública de aterragem do QR — indexável, sem ruído de SEO.
  robots: { index: true, follow: true },
};

export default function InstalarPage() {
  return <InstallClient />;
}

// Public catalogue only. Purchases, accounts and permissions remain in Projeto 21 Dias.
export const PROJECT_PLATFORM_URL = "https://www.projeto21dias.com/";
export type ExtraOffer = { id: "semester" | "annual"; months: number; amountCents: number; name: string; condition: string };
export type ExtraCatalogue = { open: boolean; offers: ExtraOffer[] };

export function parseExtraCatalogue(value: unknown): ExtraCatalogue | null {
  if (!value || typeof value !== "object") return null;
  const config = value as Record<string, unknown>;
  if (config.currency !== "EUR" || !Array.isArray(config.offers)) return null;
  const offers = config.offers.flatMap((raw: unknown): ExtraOffer[] => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if ((row.id !== "annual" && row.id !== "semester") || row.months !== (row.id === "annual" ? 12 : 6)
      || !Number.isSafeInteger(row.amount_cents) || (row.amount_cents as number) <= 0
      || typeof row.name !== "string" || typeof row.condition !== "string") return [];
    return [{ id: row.id, months: row.months as number, amountCents: row.amount_cents as number, name: row.name.slice(0, 200), condition: row.condition.slice(0, 600) }];
  });
  const unique = offers.filter((offer, i) => offers.findIndex(row => row.id === offer.id) === i);
  return { open: config.enabled === true && config.registration_open === true, offers: unique.sort((a, b) => b.months - a.months) };
}

export async function loadExtraCatalogue(): Promise<ExtraCatalogue | null> {
  try {
    const response = await fetch(`${PROJECT_PLATFORM_URL}api/payments/config`, {
      next: { revalidate: 300 }, signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    return parseExtraCatalogue(await response.json());
  } catch { return null; }
}

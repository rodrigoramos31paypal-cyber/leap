export const weighInMetrics = [
  { key: "muscle", label: "Músculo esquelético", unit: "kg", max: 250, zero: false },
  { key: "fat_mass", label: "Massa gorda", unit: "kg", max: 400, zero: true },
  { key: "fat_percent", label: "Gordura corporal", unit: "%", max: 100, zero: true },
  { key: "weight", label: "Peso", unit: "kg", max: 500, zero: false },
  { key: "total_muscle", label: "Massa muscular total", unit: "kg", max: 300, zero: false },
  { key: "water", label: "Água corporal", unit: "kg", max: 300, zero: false },
  { key: "visceral_fat", label: "Gordura visceral", unit: "", max: 100, zero: true },
] as const;

export type MetricKey = typeof weighInMetrics[number]["key"];
export type WeighIn = Record<MetricKey, number | null> & {
  id: string; measured_on: string; note: string | null; source: "manual" | "starfit";
};

export function lisbonDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

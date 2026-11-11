import { weighInMetrics, type MetricKey } from "./weigh-in-metrics";

const labels: Record<MetricKey,string> = {
  weight: "peso|weight",
  muscle: "musculo esqueletico|skeletal muscle",
  fat_mass: "gordura corporal|body fat|massa gorda|fat mass",
  fat_percent: "taxa de gordura corporal|body fat percentage",
  total_muscle: "musculo|muscle",
  water: "agua corporal|body water",
  visceral_fat: "grau de gordura visceral|visceral fat level",
};

export function parseStarfit(text: string) {
  const lines = text.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().split(/\r?\n/);
  const values: Partial<Record<MetricKey | "measured_on", string>> = {};
  for (const {key,max,zero} of weighInMetrics) {
    const pattern = new RegExp(`^\\s*(?:${labels[key]})(?:\\s*\\((?:kg|%)\\))?\\s*[:|=]?\\s*(\\d{1,3}(?:[.,]\\d{1,2})?)(?=\\s|%|$)`);
    for (const line of lines) {
      const match = line.match(pattern);
      if (!match) continue;
      const value = Number(match[1].replace(",","."));
      if (value <= max && (zero || value > 0)) values[key] = match[1].replace(".",",");
      if (key === "fat_mass" && /^(?:\s*)(?:gordura corporal|body fat)\s+\d+[.,]?\d*\s+\([^)]*\)\s+\d/.test(line)) {
        const percent = line.match(/\)\s+(\d{1,3}(?:[.,]\d{1,2})?)/)?.[1];
        if (percent && Number(percent.replace(",",".")) <= 100) values.fat_percent = percent.replace(".",",");
      }
      if (values[key]) break;
    }
  }
  const heading = lines.find(line => /tempo de teste|test time/.test(line));
  const date = heading?.match(/(?:tempo de teste|test time)\s*:\s*([a-z]{3})\s+(\d{1,2}),?\s+(20\d{2})/);
  const months = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
  if (date && months.includes(date[1])) {
    values.measured_on = `${date[3]}-${String(months.indexOf(date[1])+1).padStart(2,"0")}-${date[2].padStart(2,"0")}`;
  }
  return values;
}

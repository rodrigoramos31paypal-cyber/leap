import { redirect } from "next/navigation";

// A gestão de Equipa foi movida para Definições → Equipa.
export default function EquipaPage() {
  redirect("/admin/definicoes?tab=equipa");
}

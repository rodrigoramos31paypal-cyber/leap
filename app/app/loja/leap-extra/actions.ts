"use server";
import { redirect } from "next/navigation";
import { issueLeapDiscount } from "@/lib/leap-discount";
import { PROJECT_PLATFORM_URL } from "@/lib/leap-extra";
export async function openLeapAnnualDiscount() {
  const token = await issueLeapDiscount();
  if (!token) redirect("/app/loja/leap-extra?desconto=indisponivel");
  redirect(`${PROJECT_PLATFORM_URL}#leap=${token}`);
}

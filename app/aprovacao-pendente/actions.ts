"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { ENROLLMENT_INTERESTS, ENROLLMENT_GOALS } from "@/lib/enrollment-options";
import type { EnrollmentResult } from "@/components/enrollment/form";
import { rateLimit } from "@/lib/rate-limit";
export async function saveEnrollment(_state: EnrollmentResult, form: FormData): Promise<EnrollmentResult> {
 const profile = await getCurrentProfile();
 if (profile?.role !== "client" || profile.access_blocked || profile.approval_status !== "pending") return {error:"Esta pré-inscrição não está disponível."};
 const interest=String(form.get("interest")??""); const goal=String(form.get("goal")??""); const availability=String(form.get("availability")??"").trim();
 if (!(ENROLLMENT_INTERESTS as readonly string[]).includes(interest) || !(ENROLLMENT_GOALS as readonly string[]).includes(goal) || availability.length<3 || availability.length>300) return {error:"Preenche as três respostas. A disponibilidade pode ter até 300 caracteres."};
 if (!(await rateLimit("generic",`enrollment:${profile.id}`)).success) return {error:"Espera um momento antes de voltar a guardar."};
 const {error}=await (createAdminClient() as any).rpc("leap_save_enrollment",{p_client:profile.id,p_interest:interest,p_goal:goal,p_availability:availability});
 if(error) return {error:"Não foi possível guardar. Tenta novamente."};
 revalidatePath("/aprovacao-pendente"); revalidatePath("/admin/clientes");
 redirect("/aprovacao-pendente");
}

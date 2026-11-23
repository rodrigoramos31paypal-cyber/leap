import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getCurrentProfile, createAdminClient } from "@/lib/supabase/server";
import { EnrollmentForm } from "@/components/enrollment/form";
import { EnrollmentStatus } from "@/components/enrollment/status";
import { ChatThread } from "@/components/chat-thread";
import { chatContext } from "@/lib/chat";
import { saveEnrollment } from "./actions";
import type { Metadata } from "next";
export const metadata: Metadata = { title:"Pré-inscrição LEAP", robots:{index:false,follow:false} };
export default async function AprovacaoPendentePage({ searchParams }: { searchParams: Promise<{editar?:string;chat?:string;antes?:string}> }) {
 const user=await getSessionUser(); if(!user) redirect("/");
 const profile=await getCurrentProfile();
 if(!profile || profile.access_blocked) redirect("/auth/force-logout");
 if(profile.role!=="client") redirect("/admin/dashboard");
 if(profile.approval_status==="approved") redirect("/app/dashboard");
 const params=await searchParams;
 const {data:request,error}=profile.approval_status==="pending" ? await (createAdminClient() as any).from("leap_enrollment_requests").select("interest,goal,availability,submitted_at").eq("client_id",user.id).maybeSingle() : {data:null,error:null};
 const context=params.chat==="1" && request ? await chatContext() : null;
 return <main className="min-h-dvh bg-bone-50 px-4 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))] dark:bg-ink-900">
  <div className="mx-auto max-w-md">
   <div className="mb-5 flex items-center justify-between"><span className="font-display text-lg font-bold tracking-widest">LEAP</span><a href="/auth/logout" className="text-xs text-ink-500 underline">Terminar sessão</a></div>
   <div className="card p-5">
    {profile.approval_status!=="pending" ? <div className="space-y-3"><h1 className="text-xl font-bold">Pedido não aprovado</h1><p className="text-sm text-ink-500">A tua pré-inscrição não foi aprovada. Para esclareceres a decisão, contacta a equipa LEAP.</p></div> : error ? <p role="alert">Não foi possível carregar a pré-inscrição. Atualiza a página.</p> : params.chat==="1" && request ? <div className="space-y-4"><Link href="/aprovacao-pendente" className="text-sm font-semibold text-gold-700 dark:text-gold-300">← A minha pré-inscrição</Link><p className="text-xs text-ink-500">Conversa sobre a tua inscrição · conta por aprovar</p>{context ? <ChatThread context={context} before={params.antes} /> : <p className="text-sm">O chat ficará disponível assim que a equipa estiver associada ao teu pedido.</p>}</div> : request && params.editar!=="1" ? <EnrollmentStatus request={request} /> : <div className="space-y-4">{request && <Link href="/aprovacao-pendente" className="text-sm font-semibold text-gold-700 dark:text-gold-300">← Voltar ao pedido</Link>}<EnrollmentForm initial={request} action={saveEnrollment} /></div>}
   </div>
  </div>
 </main>;
}

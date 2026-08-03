"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ────────────────────────────────────────────────────────────────
// Recuperação de password por CÓDIGO OTP (6 dígitos), não por link.
//
// Porquê OTP em vez de magic link:
//   • Scanners de email (Microsoft Safe Links no Outlook/Hotmail, etc.)
//     fazem pré-fetch dos links recebidos. Um link de recuperação do
//     Supabase é de USO ÚNICO → o scanner consumia-o e o utilizador
//     recebia "access_denied / otp_expired" ao clicar.
//   • O fluxo PKCE (exchangeCodeForSession) exigia abrir o link no MESMO
//     browser onde se pediu a recuperação (cookie code_verifier). Noutro
//     dispositivo falhava.
//   verifyOtp(type:"recovery") valida o código e cria a sessão SEM PKCE,
//   por isso funciona em qualquer dispositivo e não pode ser "clicado"
//   por um scanner.
// ────────────────────────────────────────────────────────────────

// Passo 1 — pedir o código por email.
export async function recoverAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const supabase = await createClient();
  // Envia o email de recuperação. O template usa {{ .Token }} (código de 6
  // dígitos). Sem redirectTo: já não há link a clicar.
  await supabase.auth.resetPasswordForEmail(email);
  // Nunca confirma se o email existe (anti-enumeração). Avança SEMPRE para o
  // passo do código, com o email guardado para o verifyOtp.
  redirect(`/recuperar?step=code&email=${encodeURIComponent(email)}`);
}

// Passo 2 — verificar o código e definir a nova password.
export async function verifyResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const fail = (msg: string): never =>
    redirect(
      `/recuperar?step=code&email=${encodeURIComponent(email)}&error=${encodeURIComponent(msg)}`,
    );

  if (!/^\d{6}$/.test(token)) fail("Introduz o código de 6 dígitos que enviámos por email.");
  if (password.length < 8) fail("A password tem de ter no mínimo 8 caracteres.");

  const supabase = await createClient();

  // verifyOtp valida o código E estabelece a sessão (sem cookie PKCE).
  const { error: otpError } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "recovery",
  });
  if (otpError) {
    fail("Código inválido ou expirado. Pede um novo código.");
  }

  // Já com sessão, define a nova password.
  const { error: pwError } = await supabase.auth.updateUser({ password });
  if (pwError) {
    fail("Não foi possível atualizar a password. Tenta de novo.");
  }

  // M5 (audit jul/2026): uma redefinição de password deve EXPULSAR quaisquer
  // sessões abertas noutros dispositivos (potencialmente do atacante). scope
  // "others" revoga as outras e mantém a atual, para seguir direto ao dashboard.
  await supabase.auth.signOut({ scope: "others" }).catch(() => {});

  redirect("/app/dashboard");
}

// ════════════════════════════════════════════════════════════════
// Token (HMAC) para o .ics de UMA marcação · acesso SEM sessão.
//
// Porquê: o iOS (e o Google Calendar) buscam o ficheiro .ics através de
// um subsistema de pré-visualização/Calendário que NÃO envia os cookies
// de sessão do Safari. Sem isto, o pedido chegava ao middleware sem
// sessão → redirect para /login → o iPhone mostrava a página de login
// em vez de "Adicionar ao calendário".
//
// Solução (igual à do feed iCal já existente): a página — renderizada no
// servidor, já autenticada — assina o id da marcação e mete o token na
// própria URL. A rota valida o token e devolve o .ics sem precisar de
// cookie. O token é uma capability: quem o tem pode descarregar o .ics
// DESSA marcação (mesmo nível de exposição que o feed por-utilizador).
//
// Segredo: usa um segredo de servidor dedicado (nunca vai ao cliente). Se
// rodar, os links antigos deixam de validar — sem problema, são
// regenerados a cada render da página.
//
// L-2 (audit jul/2026): REMOVIDO o fallback para SUPABASE_SERVICE_ROLE_KEY.
// Reutilizar a service_role key (que ignora toda a RLS e pode ler/escrever
// tudo) como chave HMAC de um recurso secundário é reuso indevido de um
// segredo crítico — se alguma vez vazasse por outra via, seria a chave
// mestra da BD. Preferimos CALENDAR_ICS_SECRET dedicado; CRON_SECRET fica
// só como fallback de compatibilidade. Define CALENDAR_ICS_SECRET em
// produção (ver .env.example).
// ════════════════════════════════════════════════════════════════
import { createHmac, timingSafeEqual } from "crypto";

function icsSecret(): string {
  return (
    process.env.CALENDAR_ICS_SECRET ||
    process.env.CRON_SECRET ||
    ""
  );
}

export function signBookingIcs(bookingId: string): string {
  return createHmac("sha256", icsSecret()).update(`ics:${bookingId}`).digest("base64url");
}

export function verifyBookingIcs(bookingId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = signBookingIcs(bookingId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

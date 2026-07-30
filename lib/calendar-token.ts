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
  const s = process.env.CALENDAR_ICS_SECRET || process.env.CRON_SECRET;
  // ACH-5 (audit jul/2026): falhar FECHADO. Antes devolvíamos "" quando
  // ambas as envs faltavam — o HMAC passava a usar chave vazia, tornando
  // os tokens .ics FORJÁVEIS (qualquer pessoa leria o .ics de qualquer
  // marcação sem sessão). Melhor rebentar de forma visível numa má
  // configuração do que assinar/validar com chave vazia.
  if (!s) {
    throw new Error(
      "CALENDAR_ICS_SECRET (ou CRON_SECRET) não definido — tokens .ics desativados.",
    );
  }
  return s;
}

export function signBookingIcs(bookingId: string): string {
  return createHmac("sha256", icsSecret()).update(`ics:${bookingId}`).digest("base64url");
}

export function verifyBookingIcs(bookingId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  // Sem segredo configurado, nenhum token pode ser válido → recusa (não 500).
  let expected: string;
  try {
    expected = signBookingIcs(bookingId);
  } catch {
    return false;
  }
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

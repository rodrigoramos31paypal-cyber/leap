// ════════════════════════════════════════════════════════════════
// Calendar sync · Google Calendar + Microsoft Graph (Outlook)
// One-way push: app → calendário pessoal do admin.
//
// SEC — uso de service role (createAdminClient):
//   Necessário de propósito. Estas funções leem os OAuth tokens da
//   tabela calendar_integrations — credenciais privadas do admin a
//   que NENHUM cliente tem acesso por RLS — e empurram o evento para
//   o calendário externo. Nada é devolvido ao caller.
//
//   CONTRATO: chamadas sempre DEPOIS de uma RPC que valida ownership
//   (create_booking / cancel_booking). Se o bookingId não pertencer
//   ao caller, essa RPC falha e estas funções nunca correm. NÃO usar
//   service role aqui para devolver dados ao utilizador (≠ caso H5).
// ════════════════════════════════════════════════════════════════
import { createAdminClient } from "@/lib/supabase/server";

export type Provider = "google" | "microsoft";

const GOOGLE = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scope: "https://www.googleapis.com/auth/calendar.events openid email",
};

const MICROSOFT = {
  authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scope: "openid email offline_access Calendars.ReadWrite",
};

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}

export function googleEnabled() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}
export function microsoftEnabled() {
  return !!(process.env.MICROSOFT_OAUTH_CLIENT_ID && process.env.MICROSOFT_OAUTH_CLIENT_SECRET);
}

export function buildAuthUrl(provider: Provider, state: string) {
  const redirectUri = `${appUrl()}/api/integrations/${provider}/callback`;
  if (provider === "google") {
    const p = new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE.scope,
      state,
    });
    return `${GOOGLE.authUrl}?${p.toString()}`;
  } else {
    const p = new URLSearchParams({
      client_id: process.env.MICROSOFT_OAUTH_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: MICROSOFT.scope,
      state,
    });
    return `${MICROSOFT.authUrl}?${p.toString()}`;
  }
}

export async function exchangeCode(provider: Provider, code: string) {
  const redirectUri = `${appUrl()}/api/integrations/${provider}/callback`;
  const cfg = provider === "google" ? GOOGLE : MICROSOFT;
  const clientId =
    provider === "google" ? process.env.GOOGLE_OAUTH_CLIENT_ID! : process.env.MICROSOFT_OAUTH_CLIENT_ID!;
  const clientSecret =
    provider === "google" ? process.env.GOOGLE_OAUTH_CLIENT_SECRET! : process.env.MICROSOFT_OAUTH_CLIENT_SECRET!;

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const json = await res.json();
  return {
    accessToken: json.access_token as string,
    refreshToken: json.refresh_token as string | undefined,
    expiresIn: json.expires_in as number,
    idToken: json.id_token as string | undefined,
  };
}

export async function refreshTokens(
  provider: Provider,
  refreshToken: string,
) {
  const cfg = provider === "google" ? GOOGLE : MICROSOFT;
  const clientId =
    provider === "google" ? process.env.GOOGLE_OAUTH_CLIENT_ID! : process.env.MICROSOFT_OAUTH_CLIENT_ID!;
  const clientSecret =
    provider === "google" ? process.env.GOOGLE_OAUTH_CLIENT_SECRET! : process.env.MICROSOFT_OAUTH_CLIENT_SECRET!;
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  if (provider === "microsoft") body.set("scope", MICROSOFT.scope);

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const json = await res.json();
  return {
    accessToken: json.access_token as string,
    expiresIn: json.expires_in as number,
    refreshToken: (json.refresh_token as string | undefined) ?? refreshToken,
  };
}

async function getValidAccessToken(integrationId: string) {
  const supabase = createAdminClient();
  const { data: integ } = await supabase
    .from("calendar_integrations")
    .select("*")
    .eq("id", integrationId)
    .single();
  if (!integ) return null;

  const now = Date.now();
  const exp = integ.token_expires_at ? new Date(integ.token_expires_at).getTime() : 0;
  if (exp - 60_000 > now) return { token: integ.access_token, integ };

  if (!integ.refresh_token) return null;
  const refreshed = await refreshTokens(integ.provider as Provider, integ.refresh_token);
  const newExpires = new Date(now + refreshed.expiresIn * 1000).toISOString();
  await supabase
    .from("calendar_integrations")
    .update({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      token_expires_at: newExpires,
    })
    .eq("id", integrationId);
  return { token: refreshed.accessToken, integ: { ...integ, access_token: refreshed.accessToken } };
}

async function pushGoogleEvent(token: string, calendarId: string, booking: BookingPayload) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: `LEAP · Sessão ${booking.sessionType} · ${booking.clientName}`,
      description: `Sessão de PT com ${booking.clientName}`,
      location: "LEAP Fitness Studio",
      start: { dateTime: booking.startsAt, timeZone: "Europe/Lisbon" },
      end: { dateTime: booking.endsAt, timeZone: "Europe/Lisbon" },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
    }),
  });
  if (!res.ok) throw new Error(`Google insert failed: ${await res.text()}`);
  const j = await res.json();
  return j.id as string;
}

async function pushMicrosoftEvent(token: string, booking: BookingPayload) {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: `LEAP · Sessão ${booking.sessionType} · ${booking.clientName}`,
      body: { contentType: "text", content: `Sessão de PT com ${booking.clientName}` },
      location: { displayName: "LEAP Fitness Studio" },
      start: { dateTime: booking.startsAt, timeZone: "Europe/Lisbon" },
      end: { dateTime: booking.endsAt, timeZone: "Europe/Lisbon" },
    }),
  });
  if (!res.ok) throw new Error(`Microsoft insert failed: ${await res.text()}`);
  const j = await res.json();
  return j.id as string;
}

type BookingPayload = {
  startsAt: string;
  endsAt: string;
  sessionType: string;
  clientName: string;
};

export async function pushBookingToCalendars(bookingId: string) {
  if (!googleEnabled() && !microsoftEnabled()) return;
  const supabase = createAdminClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("starts_at, ends_at, session_type, trainer_id, profiles:client_id(full_name)")
    .eq("id", bookingId)
    .single();
  if (!b) return;
  const { data: trainer } = await supabase
    .from("trainers")
    .select("profile_id")
    .eq("id", b.trainer_id)
    .single();
  if (!trainer?.profile_id) return;

  const { data: integrations } = await supabase
    .from("calendar_integrations")
    .select("id, provider, calendar_id")
    .eq("user_id", trainer.profile_id);
  if (!integrations || integrations.length === 0) return;

  const payload: BookingPayload = {
    startsAt: new Date(b.starts_at).toISOString(),
    endsAt: new Date(b.ends_at).toISOString(),
    sessionType: b.session_type,
    clientName: (b as any).profiles?.full_name ?? "Cliente",
  };

  for (const integ of integrations) {
    try {
      const auth = await getValidAccessToken(integ.id);
      if (!auth) continue;
      const eventId =
        integ.provider === "google"
          ? await pushGoogleEvent(auth.token, integ.calendar_id ?? "primary", payload)
          : await pushMicrosoftEvent(auth.token, payload);
      await supabase
        .from("booking_calendar_events")
        .insert({ booking_id: bookingId, integration_id: integ.id, external_event_id: eventId });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[calendar] push failed:", integ.provider, err);
    }
  }
}

export async function removeBookingFromCalendars(bookingId: string) {
  if (!googleEnabled() && !microsoftEnabled()) return;
  const supabase = createAdminClient();
  const { data: events } = await supabase
    .from("booking_calendar_events")
    .select("id, integration_id, external_event_id, calendar_integrations(provider, calendar_id)")
    .eq("booking_id", bookingId);
  if (!events) return;

  for (const e of events) {
    try {
      const auth = await getValidAccessToken(e.integration_id);
      if (!auth) continue;
      const provider = (e as any).calendar_integrations?.provider as Provider;
      const calendarId = (e as any).calendar_integrations?.calendar_id ?? "primary";
      const url =
        provider === "google"
          ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${e.external_event_id}`
          : `https://graph.microsoft.com/v1.0/me/events/${e.external_event_id}`;
      await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${auth.token}` } });
      await supabase.from("booking_calendar_events").delete().eq("id", e.id);
    } catch (err) {
      console.error("[calendar] delete failed:", err);
    }
  }
}

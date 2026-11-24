import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient, getAuthUser } from "@/lib/supabase/server";
export const LEAP_ANNUAL_DISCOUNT_CENTS = 1000;
export const normalizeDiscountEmail = (email: string) => email.trim().toLowerCase();
export const discountHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const validDiscountToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export async function currentDiscountEligibility() {
  const user = await getAuthUser();
  if (!user?.email || !user.email_confirmed_at) return null;
  const { data, error } = await (createAdminClient() as any).rpc("leap_annual_discount_eligible", { p_client: user.id });
  return !error && data === true ? user : null;
}

export async function issueLeapDiscount() {
  const user = await currentDiscountEligibility();
  if (!user) return null;
  const token = randomBytes(32).toString("base64url");
  const db = createAdminClient() as any;
  await db.from("leap_annual_discount_tokens").delete().lt("expires_at", new Date().toISOString());
  const { error } = await db.from("leap_annual_discount_tokens").insert({ token_hash: discountHash(token), client_id: user.id });
  return error ? null : token;
}

export async function verifyLeapDiscount(token: unknown, emailHash: unknown) {
  if (!validDiscountToken(token) || typeof emailHash !== "string" || !/^[a-f0-9]{64}$/.test(emailHash)) return null;
  const db = createAdminClient() as any;
  const { data: proof, error } = await db.from("leap_annual_discount_tokens").select("client_id,expires_at")
    .eq("token_hash", discountHash(token)).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !proof) return null;
  const [{ data: eligible }, { data: account, error: accountError }] = await Promise.all([
    db.rpc("leap_annual_discount_eligible", { p_client: proof.client_id }),
    db.auth.admin.getUserById(proof.client_id),
  ]);
  const user = account?.user;
  if (eligible !== true || accountError || !user?.email || !user.email_confirmed_at) return null;
  const expected = discountHash(normalizeDiscountEmail(user.email));
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(emailHash))) return null;
  return { code: "LEAP10", plan: "annual", discount_cents: LEAP_ANNUAL_DISCOUNT_CENTS, expires_at: proof.expires_at };
}

// ════════════════════════════════════════════════════════════════
// Types da base de dados.
// Após teres a BD montada, podes regerar este ficheiro com:
//   npx supabase gen types typescript --project-id <id> > types/database.ts
// ════════════════════════════════════════════════════════════════

export type UserRole = "client" | "trainer" | "owner";
export type SessionType = "individual" | "dupla";
export type PurchaseStatus =
  | "pending_payment"
  | "awaiting_confirmation"
  | "confirmed"
  | "rejected"
  | "cancelled";
export type PaymentMethod =
  | "manual_mbway"
  | "manual_cash"
  | "manual_transfer"
  | "complimentary"
  | "mbway"
  | "multibanco"
  | "card";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";
export type PaymentGateway = "manual" | "ifthenpay";
export type BookingStatus = "booked" | "confirmed" | "cancelled" | "no_show";
export type CreditReason =
  | "purchase"
  | "booking_deduction"
  | "late_cancel"
  | "no_show"
  | "refund"
  | "admin_adjust";

export type Profile = {
  id: string;
  role: UserRole;
  full_name: string;
  email: string;
  phone: string | null;
  trainer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Trainer = {
  id: string;
  profile_id: string;
  slug: string;
  bio: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type TrainerSettings = {
  trainer_id: string;
  slot_durations_min: number[];
  default_slot_duration_min: number;
  cancellation_window_hours: number;
  default_pack_validity_days: number | null;
  charge_late_cancel: boolean;
  charge_no_show: boolean;
  low_credits_threshold: number;
  buffer_between_sessions_min: number;
  auto_confirm_bookings: boolean;
  updated_at: string;
};

export type TrainerAvailability = {
  id: string;
  trainer_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  active: boolean;
  created_at: string;
};

export type TrainerBlockedTime = {
  id: string;
  trainer_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
};

export type Pack = {
  id: string;
  trainer_id: string;
  name: string;
  description: string | null;
  session_type: SessionType;
  sessions: number;
  price_cents: number;
  validity_days: number | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Purchase = {
  id: string;
  client_id: string;
  trainer_id: string;
  pack_id: string | null;
  pack_snapshot: { name: string; sessions: number; price_cents: number; session_type: SessionType };
  session_type: SessionType;
  sessions_total: number;
  sessions_remaining: number;
  amount_cents: number;
  status: PurchaseStatus;
  payment_method: PaymentMethod;
  expires_at: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  purchase_id: string;
  method: PaymentMethod;
  amount_cents: number;
  status: PaymentStatus;
  gateway: PaymentGateway;
  gateway_ref: string | null;
  gateway_request_id: string | null;
  gateway_payload: Record<string, unknown> | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Booking = {
  id: string;
  client_id: string;
  trainer_id: string;
  purchase_id: string;
  session_type: SessionType;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  credit_charged: boolean;
  notes: string | null;
  series_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingSeries = {
  id: string;
  client_id: string;
  trainer_id: string;
  purchase_id: string;
  session_type: SessionType;
  duration_min: number;
  first_starts_at: string;
  last_starts_at: string;
  status: "active" | "cancelled";
  created_at: string;
  updated_at: string;
};

export type ReservedSlot = {
  series_id: string;
  client_id: string;
  trainer_id: string;
  session_type: SessionType;
  duration_min: number;
  starts_at: string;
  ends_at: string;
  client_name: string | null;
};

export type CreditTransaction = {
  id: string;
  purchase_id: string;
  booking_id: string | null;
  delta: number;
  reason: CreditReason;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

// Esquema simplificado compatível com @supabase/ssr
export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & Pick<Profile, "id" | "email" | "full_name">; Update: Partial<Profile>; Relationships: [] };
      trainers: { Row: Trainer; Insert: Partial<Trainer> & Pick<Trainer, "profile_id" | "slug">; Update: Partial<Trainer>; Relationships: [] };
      trainer_settings: { Row: TrainerSettings; Insert: Partial<TrainerSettings> & Pick<TrainerSettings, "trainer_id">; Update: Partial<TrainerSettings>; Relationships: [] };
      trainer_availability: { Row: TrainerAvailability; Insert: Partial<TrainerAvailability> & Pick<TrainerAvailability, "trainer_id" | "day_of_week" | "start_time" | "end_time">; Update: Partial<TrainerAvailability>; Relationships: [] };
      trainer_blocked_times: { Row: TrainerBlockedTime; Insert: Partial<TrainerBlockedTime> & Pick<TrainerBlockedTime, "trainer_id" | "starts_at" | "ends_at">; Update: Partial<TrainerBlockedTime>; Relationships: [] };
      packs: { Row: Pack; Insert: Partial<Pack> & Pick<Pack, "trainer_id" | "name" | "session_type" | "sessions" | "price_cents">; Update: Partial<Pack>; Relationships: [] };
      purchases: { Row: Purchase; Insert: Partial<Purchase>; Update: Partial<Purchase>; Relationships: [] };
      payments: { Row: Payment; Insert: Partial<Payment>; Update: Partial<Payment>; Relationships: [] };
      bookings: { Row: Booking; Insert: Partial<Booking>; Update: Partial<Booking>; Relationships: [] };
      booking_series: { Row: BookingSeries; Insert: Partial<BookingSeries> & Pick<BookingSeries, "client_id" | "trainer_id" | "purchase_id" | "session_type" | "duration_min" | "first_starts_at" | "last_starts_at">; Update: Partial<BookingSeries>; Relationships: [] };
      credit_transactions: { Row: CreditTransaction; Insert: Partial<CreditTransaction>; Update: Partial<CreditTransaction>; Relationships: [] };
      notifications: { Row: Notification; Insert: Partial<Notification> & Pick<Notification, "user_id" | "type" | "title">; Update: Partial<Notification>; Relationships: [] };
      audit_log: { Row: { id: string; actor_id: string | null; action: string; target_table: string | null; target_id: string | null; payload: Record<string, unknown> | null; created_at: string }; Insert: { actor_id?: string; action: string; target_table?: string; target_id?: string; payload?: Record<string, unknown> }; Update: Partial<{ action: string }> };
    };
    Views: {
      reserved_slots_active: { Row: ReservedSlot; Relationships: [] };
    };
    Functions: {
      get_active_credits: { Args: { p_client_id: string }; Returns: number };
      create_purchase: { Args: { p_pack_id: string; p_payment_method: PaymentMethod; p_client_id?: string }; Returns: string };
      confirm_purchase: { Args: { p_purchase_id: string; p_confirmed_by?: string }; Returns: void };
      reject_purchase: { Args: { p_purchase_id: string; p_reason?: string }; Returns: void };
      create_booking: { Args: { p_trainer_id: string; p_starts_at: string; p_duration_min: number; p_session_type?: SessionType; p_client_id?: string }; Returns: string };
      create_recurring_booking: { Args: { p_trainer_id: string; p_starts_at: string; p_duration_min: number; p_sessions_count: number; p_session_type?: SessionType; p_client_id?: string }; Returns: { ok: boolean; series_id: string | null; booking_ids: string[]; conflicts: Array<{ week: number; starts_at: string; reason: "booking" | "blocked" | "reserved" }> } };
      is_reserved_slot_blocked: { Args: { p_trainer_id: string; p_client_id: string; p_starts_at: string; p_ends_at: string }; Returns: boolean };
      confirm_booking_attendance: { Args: { p_booking_id: string }; Returns: void };
      cancel_booking: { Args: { p_booking_id: string; p_reason?: string }; Returns: void };
      mark_no_show: { Args: { p_booking_id: string }; Returns: void };
      adjust_credits: { Args: { p_purchase_id: string; p_delta: number; p_reason: string }; Returns: void };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      current_trainer_id: { Args: Record<string, never>; Returns: string };
    };
    Enums: {
      user_role: UserRole;
      session_type: SessionType;
      purchase_status: PurchaseStatus;
      payment_method: PaymentMethod;
      payment_status: PaymentStatus;
      payment_gateway: PaymentGateway;
      booking_status: BookingStatus;
      credit_reason: CreditReason;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          payload: Json | null
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_calendar_events: {
        Row: {
          booking_id: string
          created_at: string
          external_event_id: string
          id: string
          integration_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          external_event_id: string
          id?: string
          integration_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          external_event_id?: string
          id?: string
          integration_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_calendar_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_calendar_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "calendar_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_series: {
        Row: {
          client_id: string
          created_at: string
          duration_min: number
          first_starts_at: string
          id: string
          last_starts_at: string
          purchase_id: string
          session_type: Database["public"]["Enums"]["session_type"]
          status: string
          trainer_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          duration_min: number
          first_starts_at: string
          id?: string
          last_starts_at: string
          purchase_id: string
          session_type: Database["public"]["Enums"]["session_type"]
          status?: string
          trainer_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          duration_min?: number
          first_starts_at?: string
          id?: string
          last_starts_at?: string
          purchase_id?: string
          session_type?: Database["public"]["Enums"]["session_type"]
          status?: string
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          credit_charged: boolean
          ends_at: string
          id: string
          notes: string | null
          purchase_id: string
          series_id: string | null
          session_type: Database["public"]["Enums"]["session_type"]
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          trainer_id: string
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          credit_charged?: boolean
          ends_at: string
          id?: string
          notes?: string | null
          purchase_id: string
          series_id?: string | null
          session_type: Database["public"]["Enums"]["session_type"]
          starts_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          trainer_id: string
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          credit_charged?: boolean
          ends_at?: string
          id?: string
          notes?: string | null
          purchase_id?: string
          series_id?: string | null
          session_type?: Database["public"]["Enums"]["session_type"]
          starts_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "booking_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "reserved_slots_active"
            referencedColumns: ["series_id"]
          },
          {
            foreignKeyName: "bookings_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_integrations: {
        Row: {
          access_token: string
          account_email: string | null
          calendar_id: string | null
          created_at: string
          id: string
          provider: string
          refresh_token: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          account_email?: string | null
          calendar_id?: string | null
          created_at?: string
          id?: string
          provider: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          account_email?: string | null
          calendar_id?: string | null
          created_at?: string
          id?: string
          provider?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_integrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          booking_id: string | null
          created_at: string
          created_by: string | null
          delta: number
          id: string
          notes: string | null
          purchase_id: string
          reason: Database["public"]["Enums"]["credit_reason"]
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          notes?: string | null
          purchase_id: string
          reason: Database["public"]["Enums"]["credit_reason"]
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          notes?: string | null
          purchase_id?: string
          reason?: Database["public"]["Enums"]["credit_reason"]
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      packs: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          price_cents: number
          session_type: Database["public"]["Enums"]["session_type"]
          sessions: number
          sort_order: number
          trainer_id: string
          updated_at: string
          validity_days: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          price_cents: number
          session_type: Database["public"]["Enums"]["session_type"]
          sessions: number
          sort_order?: number
          trainer_id: string
          updated_at?: string
          validity_days?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          price_cents?: number
          session_type?: Database["public"]["Enums"]["session_type"]
          sessions?: number
          sort_order?: number
          trainer_id?: string
          updated_at?: string
          validity_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "packs_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          gateway: Database["public"]["Enums"]["payment_gateway"]
          gateway_payload: Json | null
          gateway_ref: string | null
          gateway_request_id: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          paid_at: string | null
          purchase_id: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          gateway: Database["public"]["Enums"]["payment_gateway"]
          gateway_payload?: Json | null
          gateway_ref?: string | null
          gateway_request_id?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string | null
          purchase_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          gateway?: Database["public"]["Enums"]["payment_gateway"]
          gateway_payload?: Json | null
          gateway_ref?: string | null
          gateway_request_id?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          paid_at?: string | null
          purchase_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          calendar_feed_token: string
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          trainer_id: string | null
          updated_at: string
        }
        Insert: {
          calendar_feed_token?: string
          created_at?: string
          email: string
          full_name: string
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          trainer_id?: string | null
          updated_at?: string
        }
        Update: {
          calendar_feed_token?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          trainer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_profiles_trainer"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          amount_cents: number
          client_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          notes: string | null
          pack_id: string | null
          pack_snapshot: Json
          payment_method: Database["public"]["Enums"]["payment_method"]
          rejection_reason: string | null
          session_type: Database["public"]["Enums"]["session_type"]
          sessions_remaining: number
          sessions_total: number
          status: Database["public"]["Enums"]["purchase_status"]
          trainer_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          client_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          pack_id?: string | null
          pack_snapshot: Json
          payment_method: Database["public"]["Enums"]["payment_method"]
          rejection_reason?: string | null
          session_type: Database["public"]["Enums"]["session_type"]
          sessions_remaining: number
          sessions_total: number
          status?: Database["public"]["Enums"]["purchase_status"]
          trainer_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          client_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          pack_id?: string | null
          pack_snapshot?: Json
          payment_method?: Database["public"]["Enums"]["payment_method"]
          rejection_reason?: string | null
          session_type?: Database["public"]["Enums"]["session_type"]
          sessions_remaining?: number
          sessions_total?: number
          status?: Database["public"]["Enums"]["purchase_status"]
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      session_notes: {
        Row: {
          author_id: string
          body: string
          booking_id: string | null
          created_at: string
          id: string
          subject_id: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          booking_id?: string | null
          created_at?: string
          id?: string
          subject_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          booking_id?: string | null
          created_at?: string
          id?: string
          subject_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_notes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_notes_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_availability: {
        Row: {
          active: boolean
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          start_time: string
          trainer_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          start_time: string
          trainer_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          start_time?: string
          trainer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_availability_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_blocked_times: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          reason: string | null
          starts_at: string
          trainer_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          reason?: string | null
          starts_at: string
          trainer_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          reason?: string | null
          starts_at?: string
          trainer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_blocked_times_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      trainer_settings: {
        Row: {
          auto_confirm_bookings: boolean
          buffer_between_sessions_min: number
          cancellation_window_hours: number
          charge_late_cancel: boolean
          charge_no_show: boolean
          default_pack_validity_days: number | null
          default_slot_duration_min: number
          low_credits_threshold: number
          slot_durations_min: number[]
          trainer_id: string
          updated_at: string
        }
        Insert: {
          auto_confirm_bookings?: boolean
          buffer_between_sessions_min?: number
          cancellation_window_hours?: number
          charge_late_cancel?: boolean
          charge_no_show?: boolean
          default_pack_validity_days?: number | null
          default_slot_duration_min?: number
          low_credits_threshold?: number
          slot_durations_min?: number[]
          trainer_id: string
          updated_at?: string
        }
        Update: {
          auto_confirm_bookings?: boolean
          buffer_between_sessions_min?: number
          cancellation_window_hours?: number
          charge_late_cancel?: boolean
          charge_no_show?: boolean
          default_pack_validity_days?: number | null
          default_slot_duration_min?: number
          low_credits_threshold?: number
          slot_durations_min?: number[]
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainer_settings_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: true
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      trainers: {
        Row: {
          active: boolean
          avatar_url: string | null
          bio: string | null
          created_at: string
          id: string
          profile_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          profile_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          id?: string
          profile_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trainers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_blocked_times: {
        Row: {
          ends_at: string | null
          id: string | null
          starts_at: string | null
          trainer_id: string | null
        }
        Insert: {
          ends_at?: string | null
          id?: string | null
          starts_at?: string | null
          trainer_id?: string | null
        }
        Update: {
          ends_at?: string | null
          id?: string | null
          starts_at?: string | null
          trainer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trainer_blocked_times_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
      reserved_slots_active: {
        Row: {
          client_id: string | null
          client_name: string | null
          duration_min: number | null
          ends_at: string | null
          series_id: string | null
          session_type: Database["public"]["Enums"]["session_type"] | null
          starts_at: string | null
          trainer_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_series_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_series_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "trainers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _is_service_or_admin: { Args: never; Returns: boolean }
      _trainer_is_accessible: {
        Args: { p_trainer_id: string }
        Returns: boolean
      }
      adjust_credits: {
        Args: { p_delta: number; p_purchase_id: string; p_reason: string }
        Returns: undefined
      }
      bootstrap_trainer: {
        Args: { p_email: string; p_full_name: string; p_slug: string }
        Returns: string
      }
      cancel_booking: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: undefined
      }
      clients_by_booking: {
        Args: {
          p_limit: number
          p_offset: number
          p_trainer_ids: string[]
          p_upcoming: boolean
        }
        Returns: {
          client_id: string
          total_count: number
        }[]
      }
      clients_low_sessions: {
        Args: { p_limit: number; p_offset: number; p_trainer_ids: string[] }
        Returns: {
          client_id: string
          total_count: number
        }[]
      }
      confirm_booking_attendance: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      confirm_ifthenpay_callback: {
        Args: { p_amount_cents: number; p_order_id: string; p_payload: Json }
        Returns: Json
      }
      confirm_purchase: {
        Args: { p_confirmed_by?: string; p_purchase_id: string }
        Returns: undefined
      }
      create_booking: {
        Args: {
          p_client_id?: string
          p_duration_min: number
          p_session_type?: Database["public"]["Enums"]["session_type"]
          p_starts_at: string
          p_trainer_id: string
        }
        Returns: string
      }
      create_custom_purchase: {
        Args: {
          p_client_id: string
          p_name?: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_price_cents: number
          p_session_type: Database["public"]["Enums"]["session_type"]
          p_sessions: number
          p_trainer_id: string
          p_validity_days?: number
        }
        Returns: string
      }
      create_purchase: {
        Args: {
          p_client_id?: string
          p_pack_id: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: string
      }
      create_recurring_booking: {
        Args: {
          p_client_id?: string
          p_duration_min: number
          p_session_type?: Database["public"]["Enums"]["session_type"]
          p_sessions_count: number
          p_starts_at: string
          p_trainer_id: string
        }
        Returns: Json
      }
      current_role_name: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_trainer_id: { Args: never; Returns: string }
      get_active_credits: { Args: { p_client_id: string }; Returns: number }
      is_admin: { Args: never; Returns: boolean }
      log_audit_event: {
        Args: {
          p_action: string
          p_target_table?: string | null
          p_target_id?: string | null
          p_payload?: Json | null
        }
        Returns: undefined
      }
      is_reserved_slot_blocked: {
        Args: {
          p_client_id: string
          p_ends_at: string
          p_starts_at: string
          p_trainer_id: string
        }
        Returns: boolean
      }
      mark_no_show: { Args: { p_booking_id: string }; Returns: undefined }
      set_payment_gateway_info: {
        Args: {
          p_gateway_payload: Json
          p_gateway_ref: string | null
          p_gateway_request_id: string | null
          p_purchase_id: string
        }
        Returns: undefined
      }
      pick_purchase_for_booking:
        | {
            Args: {
              p_client_id: string
              p_session_type: Database["public"]["Enums"]["session_type"]
            }
            Returns: string
          }
        | {
            Args: {
              p_client_id: string
              p_session_type: Database["public"]["Enums"]["session_type"]
              p_trainer_id?: string
            }
            Returns: string
          }
      reject_purchase: {
        Args: { p_purchase_id: string; p_reason?: string }
        Returns: undefined
      }
    }
    Enums: {
      booking_status: "booked" | "confirmed" | "cancelled" | "no_show"
      credit_reason:
        | "purchase"
        | "booking_deduction"
        | "late_cancel"
        | "no_show"
        | "refund"
        | "admin_adjust"
        | "cancel_refund"
      payment_gateway: "manual" | "ifthenpay"
      payment_method:
        | "manual_mbway"
        | "manual_cash"
        | "manual_transfer"
        | "manual_revolut"
        | "mbway"
        | "multibanco"
        | "card"
        | "complimentary"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      purchase_status:
        | "pending_payment"
        | "awaiting_confirmation"
        | "confirmed"
        | "rejected"
        | "cancelled"
      session_type: "individual" | "dupla"
      user_role: "client" | "trainer" | "owner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      booking_status: ["booked", "confirmed", "cancelled", "no_show"],
      credit_reason: [
        "purchase",
        "booking_deduction",
        "late_cancel",
        "no_show",
        "refund",
        "admin_adjust",
        "cancel_refund",
      ],
      payment_gateway: ["manual", "ifthenpay"],
      payment_method: [
        "manual_mbway",
        "manual_cash",
        "manual_transfer",
        "manual_revolut",
        "mbway",
        "multibanco",
        "card",
        "complimentary",
      ],
      payment_status: ["pending", "paid", "failed", "refunded"],
      purchase_status: [
        "pending_payment",
        "awaiting_confirmation",
        "confirmed",
        "rejected",
        "cancelled",
      ],
      session_type: ["individual", "dupla"],
      user_role: ["client", "trainer", "owner"],
    },
  },
} as const

// ════════════════════════════════════════════════════════════════
// Legacy named exports (mantidos para retro-compatibilidade com
// código pré-existente — re-acrescentar se voltares a correr
// `supabase gen types typescript` para regerar este ficheiro).
// ════════════════════════════════════════════════════════════════
export type SessionType = Database["public"]["Enums"]["session_type"];
export type PaymentMethod = Database["public"]["Enums"]["payment_method"];
export type Pack = Database["public"]["Tables"]["packs"]["Row"];

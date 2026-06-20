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
      api_credentials: {
        Row: {
          api_key: string
          api_secret: string
          created_at: string
          is_valid: boolean
          last_checked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          api_secret: string
          created_at?: string
          is_valid?: boolean
          last_checked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          api_secret?: string
          created_at?: string
          is_valid?: boolean
          last_checked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          id: number
          paywall_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          paywall_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          paywall_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      bot_config: {
        Row: {
          allow_long: boolean
          allow_short: boolean
          atr_multiplier: number
          auto_book: boolean
          auto_book_confidence_threshold: number
          auto_close_minutes: number
          cooldown_minutes: number
          created_at: string
          daily_loss_cap_pct: number
          display_confidence_threshold: number
          ema_fast: number
          ema_slow: number
          is_running: boolean
          leverage: number
          live_allocation_amount: number
          live_allocation_mode: string
          live_allocation_pct: number
          live_wallet_source: string
          max_auto_sl_pct: number
          max_open_positions: number
          max_trades_per_day: number
          min_rr: number
          min_scalp_score: number
          min_sl_pct: number
          mode: string
          move_to_breakeven: boolean
          paper_equity: number
          regime_filter_enabled: boolean
          risk_per_trade_pct: number
          scan_interval_minutes: number
          scanner_top_n: number
          stop_loss_pct: number
          strategy: string
          symbol_blacklist_threshold: number
          symbol_blocklist: string[]
          symbol_sl_cooldown_minutes: number
          take_profit_pct: number
          target_multiplier: number
          timeframe: string
          trading_style: string
          trailing_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_long?: boolean
          allow_short?: boolean
          atr_multiplier?: number
          auto_book?: boolean
          auto_book_confidence_threshold?: number
          auto_close_minutes?: number
          cooldown_minutes?: number
          created_at?: string
          daily_loss_cap_pct?: number
          display_confidence_threshold?: number
          ema_fast?: number
          ema_slow?: number
          is_running?: boolean
          leverage?: number
          live_allocation_amount?: number
          live_allocation_mode?: string
          live_allocation_pct?: number
          live_wallet_source?: string
          max_auto_sl_pct?: number
          max_open_positions?: number
          max_trades_per_day?: number
          min_rr?: number
          min_scalp_score?: number
          min_sl_pct?: number
          mode?: string
          move_to_breakeven?: boolean
          paper_equity?: number
          regime_filter_enabled?: boolean
          risk_per_trade_pct?: number
          scan_interval_minutes?: number
          scanner_top_n?: number
          stop_loss_pct?: number
          strategy?: string
          symbol_blacklist_threshold?: number
          symbol_blocklist?: string[]
          symbol_sl_cooldown_minutes?: number
          take_profit_pct?: number
          target_multiplier?: number
          timeframe?: string
          trading_style?: string
          trailing_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_long?: boolean
          allow_short?: boolean
          atr_multiplier?: number
          auto_book?: boolean
          auto_book_confidence_threshold?: number
          auto_close_minutes?: number
          cooldown_minutes?: number
          created_at?: string
          daily_loss_cap_pct?: number
          display_confidence_threshold?: number
          ema_fast?: number
          ema_slow?: number
          is_running?: boolean
          leverage?: number
          live_allocation_amount?: number
          live_allocation_mode?: string
          live_allocation_pct?: number
          live_wallet_source?: string
          max_auto_sl_pct?: number
          max_open_positions?: number
          max_trades_per_day?: number
          min_rr?: number
          min_scalp_score?: number
          min_sl_pct?: number
          mode?: string
          move_to_breakeven?: boolean
          paper_equity?: number
          regime_filter_enabled?: boolean
          risk_per_trade_pct?: number
          scan_interval_minutes?: number
          scanner_top_n?: number
          stop_loss_pct?: number
          strategy?: string
          symbol_blacklist_threshold?: number
          symbol_blocklist?: string[]
          symbol_sl_cooldown_minutes?: number
          take_profit_pct?: number
          target_multiplier?: number
          timeframe?: string
          trading_style?: string
          trailing_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bot_config_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          source: string
          user_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string
          user_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      bot_events: {
        Row: {
          created_at: string
          id: string
          level: string
          message: string
          meta: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: string
          message: string
          meta?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: string
          message?: string
          meta?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      bot_signals: {
        Row: {
          action: string
          atr_pct: number | null
          booked: boolean
          booked_trade_id: string | null
          confidence_band: string | null
          confidence_pct: number | null
          config_id: string | null
          cooldown_active: boolean | null
          created_at: string
          daily_loss_available: boolean | null
          distance_from_ema21_pct: number | null
          distance_from_vwap_pct: number | null
          ema_alignment: string | null
          final_decision: string | null
          id: string
          impulse_candle_pct: number | null
          market_regime: string | null
          max_position_available: boolean | null
          price: number | null
          reason: string | null
          rejection_reason: string | null
          risk_reward: number | null
          rsi: number | null
          scan_id: string
          side_bias: string | null
          spread_pct: number | null
          strategy: string | null
          symbol: string
          timeframe: string | null
          trend_status: string | null
          user_id: string
          user_name: string | null
          volume_spike_ratio: number | null
          vwap_status: string | null
        }
        Insert: {
          action: string
          atr_pct?: number | null
          booked?: boolean
          booked_trade_id?: string | null
          confidence_band?: string | null
          confidence_pct?: number | null
          config_id?: string | null
          cooldown_active?: boolean | null
          created_at?: string
          daily_loss_available?: boolean | null
          distance_from_ema21_pct?: number | null
          distance_from_vwap_pct?: number | null
          ema_alignment?: string | null
          final_decision?: string | null
          id?: string
          impulse_candle_pct?: number | null
          market_regime?: string | null
          max_position_available?: boolean | null
          price?: number | null
          reason?: string | null
          rejection_reason?: string | null
          risk_reward?: number | null
          rsi?: number | null
          scan_id: string
          side_bias?: string | null
          spread_pct?: number | null
          strategy?: string | null
          symbol: string
          timeframe?: string | null
          trend_status?: string | null
          user_id: string
          user_name?: string | null
          volume_spike_ratio?: number | null
          vwap_status?: string | null
        }
        Update: {
          action?: string
          atr_pct?: number | null
          booked?: boolean
          booked_trade_id?: string | null
          confidence_band?: string | null
          confidence_pct?: number | null
          config_id?: string | null
          cooldown_active?: boolean | null
          created_at?: string
          daily_loss_available?: boolean | null
          distance_from_ema21_pct?: number | null
          distance_from_vwap_pct?: number | null
          ema_alignment?: string | null
          final_decision?: string | null
          id?: string
          impulse_candle_pct?: number | null
          market_regime?: string | null
          max_position_available?: boolean | null
          price?: number | null
          reason?: string | null
          rejection_reason?: string | null
          risk_reward?: number | null
          rsi?: number | null
          scan_id?: string
          side_bias?: string | null
          spread_pct?: number | null
          strategy?: string | null
          symbol?: string
          timeframe?: string | null
          trend_status?: string | null
          user_id?: string
          user_name?: string | null
          volume_spike_ratio?: number | null
          vwap_status?: string | null
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          coupon_id: string
          id?: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          coupon_id?: string
          id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          duration_days: number
          id: string
          max_uses: number | null
          tier: Database["public"]["Enums"]["plan_tier"]
          used_count: number
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          duration_days?: number
          id?: string
          max_uses?: number | null
          tier: Database["public"]["Enums"]["plan_tier"]
          used_count?: number
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          duration_days?: number
          id?: string
          max_uses?: number | null
          tier?: Database["public"]["Enums"]["plan_tier"]
          used_count?: number
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      payment_orders: {
        Row: {
          amount_paise: number
          created_at: string
          id: string
          order_id: string
          status: string
          tier: Database["public"]["Enums"]["plan_tier"]
          user_id: string
          verified_at: string | null
        }
        Insert: {
          amount_paise: number
          created_at?: string
          id?: string
          order_id: string
          status?: string
          tier: Database["public"]["Enums"]["plan_tier"]
          user_id: string
          verified_at?: string | null
        }
        Update: {
          amount_paise?: number
          created_at?: string
          id?: string
          order_id?: string
          status?: string
          tier?: Database["public"]["Enums"]["plan_tier"]
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      positions: {
        Row: {
          closed_at: string | null
          entry_price: number
          exchange_order_id: string | null
          exit_price: number | null
          exit_reason: string | null
          id: string
          instrument: string | null
          leverage: number
          mark_price: number | null
          mode: string
          opened_at: string
          pnl: number | null
          pnl_pct: number | null
          qty: number
          side: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          entry_price: number
          exchange_order_id?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          instrument?: string | null
          leverage: number
          mark_price?: number | null
          mode: string
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty: number
          side: string
          status?: string
          stop_loss?: number | null
          symbol: string
          take_profit?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_at?: string | null
          entry_price?: number
          exchange_order_id?: string | null
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          instrument?: string | null
          leverage?: number
          mark_price?: number | null
          mode?: string
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty?: number
          side?: string
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          currency: string
          display_name: string | null
          email: string | null
          id: string
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          display_name?: string | null
          email?: string | null
          id: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          display_name?: string | null
          email?: string | null
          id?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_plans: {
        Row: {
          expires_at: string | null
          razorpay_customer_id: string | null
          razorpay_subscription_id: string | null
          source: string
          started_at: string
          status: string
          tier: Database["public"]["Enums"]["plan_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          razorpay_customer_id?: string | null
          razorpay_subscription_id?: string | null
          source?: string
          started_at?: string
          status?: string
          tier?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          expires_at?: string | null
          razorpay_customer_id?: string | null
          razorpay_subscription_id?: string | null
          source?: string
          started_at?: string
          status?: string
          tier?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_plan_tier: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["plan_tier"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      verify_cron_secret: { Args: { _token: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
      plan_tier: "free" | "reco" | "auto5" | "unlimited"
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
      app_role: ["admin", "user"],
      plan_tier: ["free", "reco", "auto5", "unlimited"],
    },
  },
} as const

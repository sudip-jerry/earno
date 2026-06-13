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
      bot_config: {
        Row: {
          allow_short: boolean
          auto_book: boolean
          auto_close_minutes: number
          cooldown_minutes: number
          created_at: string
          daily_loss_cap_pct: number
          ema_fast: number
          ema_slow: number
          is_running: boolean
          leverage: number
          max_open_positions: number
          max_trades_per_day: number
          min_scalp_score: number
          mode: string
          move_to_breakeven: boolean
          paper_equity: number
          risk_per_trade_pct: number
          scanner_top_n: number
          stop_loss_pct: number
          strategy: string
          take_profit_pct: number
          timeframe: string
          trailing_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_short?: boolean
          auto_book?: boolean
          auto_close_minutes?: number
          cooldown_minutes?: number
          created_at?: string
          daily_loss_cap_pct?: number
          ema_fast?: number
          ema_slow?: number
          is_running?: boolean
          leverage?: number
          max_open_positions?: number
          max_trades_per_day?: number
          min_scalp_score?: number
          mode?: string
          move_to_breakeven?: boolean
          paper_equity?: number
          risk_per_trade_pct?: number
          scanner_top_n?: number
          stop_loss_pct?: number
          strategy?: string
          take_profit_pct?: number
          timeframe?: string
          trailing_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_short?: boolean
          auto_book?: boolean
          auto_close_minutes?: number
          cooldown_minutes?: number
          created_at?: string
          daily_loss_cap_pct?: number
          ema_fast?: number
          ema_slow?: number
          is_running?: boolean
          leverage?: number
          max_open_positions?: number
          max_trades_per_day?: number
          min_scalp_score?: number
          mode?: string
          move_to_breakeven?: boolean
          paper_equity?: number
          risk_per_trade_pct?: number
          scanner_top_n?: number
          stop_loss_pct?: number
          strategy?: string
          take_profit_pct?: number
          timeframe?: string
          trailing_enabled?: boolean
          updated_at?: string
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

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
      checks: {
        Row: {
          check_type: string | null
          checked_at: string
          error_type: string | null
          geopoint_id: string
          id: string
          keyword_id: string
          maps_indexed: boolean | null
          maps_position: number | null
          org_id: string
          position: number | null
          raw_response: Json | null
          total_results: number | null
          user_id: string
          wizard_exists: boolean | null
          wizard_position: number | null
          wizard_total: number | null
        }
        Insert: {
          check_type?: string | null
          checked_at?: string
          error_type?: string | null
          geopoint_id: string
          id?: string
          keyword_id: string
          maps_indexed?: boolean | null
          maps_position?: number | null
          org_id: string
          position?: number | null
          raw_response?: Json | null
          total_results?: number | null
          user_id: string
          wizard_exists?: boolean | null
          wizard_position?: number | null
          wizard_total?: number | null
        }
        Update: {
          check_type?: string | null
          checked_at?: string
          error_type?: string | null
          geopoint_id?: string
          id?: string
          keyword_id?: string
          maps_indexed?: boolean | null
          maps_position?: number | null
          org_id?: string
          position?: number | null
          raw_response?: Json | null
          total_results?: number | null
          user_id?: string
          wizard_exists?: boolean | null
          wizard_position?: number | null
          wizard_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "checks_geopoint_id_fkey"
            columns: ["geopoint_id"]
            isOneToOne: false
            referencedRelation: "geopoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checks_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      geopoints: {
        Row: {
          created_at: string
          id: string
          label: string
          lat: number
          lon: number
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          lat: number
          lon: number
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          lat?: number
          lon?: number
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "geopoints_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      keywords: {
        Row: {
          created_at: string
          frequency: number | null
          frequency_at: string | null
          frequency_region: number | null
          frequency_status: string | null
          id: string
          keyword: string
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          frequency?: number | null
          frequency_at?: string | null
          frequency_region?: number | null
          frequency_status?: string | null
          id?: string
          keyword: string
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          frequency?: number | null
          frequency_at?: string | null
          frequency_region?: number | null
          frequency_status?: string | null
          id?: string
          keyword?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "keywords_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          lat: number | null
          lon: number | null
          name: string
          user_id: string
          yandex_id: string
          yandex_region_id: number | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lon?: number | null
          name: string
          user_id: string
          yandex_id: string
          yandex_region_id?: number | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lon?: number | null
          name?: string
          user_id?: string
          yandex_id?: string
          yandex_region_id?: number | null
        }
        Relationships: []
      }
      proxy_health: {
        Row: {
          fail_count: number
          last_fail_at: string | null
          last_success_at: string | null
          proxy: string
          success_count: number
          updated_at: string
        }
        Insert: {
          fail_count?: number
          last_fail_at?: string | null
          last_success_at?: string | null
          proxy: string
          success_count?: number
          updated_at?: string
        }
        Update: {
          fail_count?: number
          last_fail_at?: string | null
          last_success_at?: string | null
          proxy?: string
          success_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      scrape_jobs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          geopoint_id: string
          id: string
          keyword_id: string
          next_run_at: string
          org_id: string
          result_check_id: string | null
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          geopoint_id: string
          id?: string
          keyword_id: string
          next_run_at?: string
          org_id: string
          result_check_id?: string | null
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          geopoint_id?: string
          id?: string
          keyword_id?: string
          next_run_at?: string
          org_id?: string
          result_check_id?: string | null
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      scrape_sessions: {
        Row: {
          banned_until: string | null
          cookies: Json
          created_at: string
          id: string
          last_used_at: string | null
          pool: string
          proxy: string
        }
        Insert: {
          banned_until?: string | null
          cookies?: Json
          created_at?: string
          id?: string
          last_used_at?: string | null
          pool?: string
          proxy: string
        }
        Update: {
          banned_until?: string | null
          cookies?: Json
          created_at?: string
          id?: string
          last_used_at?: string | null
          pool?: string
          proxy?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
        }
        Relationships: []
      }
      wordstat_jobs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          keyword_id: string
          next_run_at: string
          region_id: number
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          keyword_id: string
          next_run_at?: string
          region_id: number
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          keyword_id?: string
          next_run_at?: string
          region_id?: number
          status?: string
          user_id?: string
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

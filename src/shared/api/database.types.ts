export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      course_grouping_members: {
        Row: {
          course_id: string
          grouping_id: string
          plan_id: string
        }
        Insert: {
          course_id: string
          grouping_id: string
          plan_id: string
        }
        Update: {
          course_id?: string
          grouping_id?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_grouping_members_course_fkey"
            columns: ["plan_id", "course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["plan_id", "id"]
          },
          {
            foreignKeyName: "course_grouping_members_grouping_fkey"
            columns: ["plan_id", "grouping_id"]
            isOneToOne: false
            referencedRelation: "course_groupings"
            referencedColumns: ["plan_id", "id"]
          },
        ]
      }
      course_groupings: {
        Row: {
          catalog_hash: string | null
          cohort: Database["public"]["Enums"]["cohort"]
          coverage_count: number
          created_at: string
          id: string
          opposite_week: boolean
          plan_id: string
          score: number
        }
        Insert: {
          catalog_hash?: string | null
          cohort: Database["public"]["Enums"]["cohort"]
          coverage_count: number
          created_at?: string
          id?: string
          opposite_week?: boolean
          plan_id: string
          score: number
        }
        Update: {
          catalog_hash?: string | null
          cohort?: Database["public"]["Enums"]["cohort"]
          coverage_count?: number
          created_at?: string
          id?: string
          opposite_week?: boolean
          plan_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "course_groupings_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      course_merges: {
        Row: {
          child_course_id: string
          created_at: string
          id: string
          parent_course_id: string
          plan_id: string
        }
        Insert: {
          child_course_id: string
          created_at?: string
          id?: string
          parent_course_id: string
          plan_id: string
        }
        Update: {
          child_course_id?: string
          created_at?: string
          id?: string
          parent_course_id?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_merges_child_fkey"
            columns: ["plan_id", "child_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["plan_id", "id"]
          },
          {
            foreignKeyName: "course_merges_parent_fkey"
            columns: ["plan_id", "parent_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["plan_id", "id"]
          },
        ]
      }
      course_overlaps: {
        Row: {
          base_course_id: string
          created_at: string
          dependent_course_id: string
          id: string
          plan_id: string
        }
        Insert: {
          base_course_id: string
          created_at?: string
          dependent_course_id: string
          id?: string
          plan_id: string
        }
        Update: {
          base_course_id?: string
          created_at?: string
          dependent_course_id?: string
          id?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_overlaps_base_fkey"
            columns: ["plan_id", "base_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["plan_id", "id"]
          },
          {
            foreignKeyName: "course_overlaps_dependent_fkey"
            columns: ["plan_id", "dependent_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["plan_id", "id"]
          },
        ]
      }
      course_teachers: {
        Row: {
          course_id: string
          created_at: string
          id: string
          plan_id: string
          teacher_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          plan_id: string
          teacher_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          plan_id?: string
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_teachers_course_fkey"
            columns: ["plan_id", "course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["plan_id", "id"]
          },
          {
            foreignKeyName: "course_teachers_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_teachers_teacher_fkey"
            columns: ["plan_id", "teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["plan_id", "id"]
          },
        ]
      }
      courses: {
        Row: {
          cohort: Database["public"]["Enums"]["cohort"]
          created_at: string
          group_index: number
          hours_per_week: number
          id: string
          level: string
          name: string
          plan_id: string
          updated_at: string
          week_mode: Database["public"]["Enums"]["course_week_mode"]
        }
        Insert: {
          cohort: Database["public"]["Enums"]["cohort"]
          created_at?: string
          group_index?: number
          hours_per_week: number
          id?: string
          level: string
          name: string
          plan_id: string
          updated_at?: string
          week_mode?: Database["public"]["Enums"]["course_week_mode"]
        }
        Update: {
          cohort?: Database["public"]["Enums"]["cohort"]
          created_at?: string
          group_index?: number
          hours_per_week?: number
          id?: string
          level?: string
          name?: string
          plan_id?: string
          updated_at?: string
          week_mode?: Database["public"]["Enums"]["course_week_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "courses_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      placements: {
        Row: {
          cohort: Database["public"]["Enums"]["cohort"]
          course_id: string
          created_at: string
          day: number
          id: string
          period: number
          plan_id: string
          week: Database["public"]["Enums"]["placement_week"]
        }
        Insert: {
          cohort: Database["public"]["Enums"]["cohort"]
          course_id: string
          created_at?: string
          day: number
          id?: string
          period: number
          plan_id: string
          week?: Database["public"]["Enums"]["placement_week"]
        }
        Update: {
          cohort?: Database["public"]["Enums"]["cohort"]
          course_id?: string
          created_at?: string
          day?: number
          id?: string
          period?: number
          plan_id?: string
          week?: Database["public"]["Enums"]["placement_week"]
        }
        Relationships: [
          {
            foreignKeyName: "placements_course_fkey"
            columns: ["plan_id", "course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["plan_id", "id"]
          },
          {
            foreignKeyName: "placements_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          id: string
          name: string
          slot_grid_preset: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slot_grid_preset: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slot_grid_preset?: string
          updated_at?: string
        }
        Relationships: []
      }
      slot_bundles: {
        Row: {
          cohort: Database["public"]["Enums"]["cohort"]
          created_at: string
          day: number
          id: string
          period: number
          plan_id: string
        }
        Insert: {
          cohort: Database["public"]["Enums"]["cohort"]
          created_at?: string
          day: number
          id?: string
          period: number
          plan_id: string
        }
        Update: {
          cohort?: Database["public"]["Enums"]["cohort"]
          created_at?: string
          day?: number
          id?: string
          period?: number
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_bundles_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      student_choices: {
        Row: {
          course_id: string
          created_at: string
          id: string
          plan_id: string
          student_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          plan_id: string
          student_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          plan_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_choices_course_fkey"
            columns: ["plan_id", "course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["plan_id", "id"]
          },
          {
            foreignKeyName: "student_choices_student_fkey"
            columns: ["plan_id", "student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["plan_id", "id"]
          },
        ]
      }
      students: {
        Row: {
          cohort: Database["public"]["Enums"]["cohort"]
          created_at: string
          full_name: string
          id: string
          plan_id: string
          updated_at: string
        }
        Insert: {
          cohort: Database["public"]["Enums"]["cohort"]
          created_at?: string
          full_name: string
          id?: string
          plan_id: string
          updated_at?: string
        }
        Update: {
          cohort?: Database["public"]["Enums"]["cohort"]
          created_at?: string
          full_name?: string
          id?: string
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_availability: {
        Row: {
          created_at: string
          day: number
          id: string
          period: number
          plan_id: string
          severity: Database["public"]["Enums"]["availability_severity"]
          teacher_id: string
        }
        Insert: {
          created_at?: string
          day: number
          id?: string
          period: number
          plan_id: string
          severity: Database["public"]["Enums"]["availability_severity"]
          teacher_id: string
        }
        Update: {
          created_at?: string
          day?: number
          id?: string
          period?: number
          plan_id?: string
          severity?: Database["public"]["Enums"]["availability_severity"]
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_availability_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_availability_teacher_fkey"
            columns: ["plan_id", "teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["plan_id", "id"]
          },
        ]
      }
      teachers: {
        Row: {
          code: string
          created_at: string
          full_name: string | null
          id: string
          plan_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          full_name?: string | null
          id?: string
          plan_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          full_name?: string | null
          id?: string
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teachers_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      clone_plan: {
        Args: { p_name: string; p_source_plan_id: string }
        Returns: string
      }
      replace_cohort_groupings: {
        Args: {
          p_catalog_hash: string
          p_cohort: Database["public"]["Enums"]["cohort"]
          p_groupings: Json
          p_plan_id: string
        }
        Returns: undefined
      }
      replace_course_teachers: {
        Args: { p_course_id: string; p_plan_id: string; p_teacher_ids: Json }
        Returns: undefined
      }
    }
    Enums: {
      availability_severity: "strong" | "soft"
      cohort: "dp1" | "dp2"
      course_week_mode: "agnostic" | "biweekly"
      placement_week: "both" | "a" | "b"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      availability_severity: ["strong", "soft"],
      cohort: ["dp1", "dp2"],
      course_week_mode: ["agnostic", "biweekly"],
      placement_week: ["both", "a", "b"],
    },
  },
} as const


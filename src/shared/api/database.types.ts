export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
  public: {
    Tables: {
      cohorts: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      course_grouping_members: {
        Row: {
          course_id: string;
          grouping_id: string;
        };
        Insert: {
          course_id: string;
          grouping_id: string;
        };
        Update: {
          course_id?: string;
          grouping_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_grouping_members_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_grouping_members_grouping_id_fkey";
            columns: ["grouping_id"];
            isOneToOne: false;
            referencedRelation: "course_groupings";
            referencedColumns: ["id"];
          },
        ];
      };
      course_groupings: {
        Row: {
          catalog_hash: string | null;
          cohort_id: string;
          coverage_count: number;
          created_at: string;
          id: string;
          plan_id: string;
          score: number;
        };
        Insert: {
          catalog_hash?: string | null;
          cohort_id: string;
          coverage_count: number;
          created_at?: string;
          id?: string;
          plan_id: string;
          score: number;
        };
        Update: {
          catalog_hash?: string | null;
          cohort_id?: string;
          coverage_count?: number;
          created_at?: string;
          id?: string;
          plan_id?: string;
          score?: number;
        };
        Relationships: [
          {
            foreignKeyName: "course_groupings_cohort_id_fkey";
            columns: ["cohort_id"];
            isOneToOne: false;
            referencedRelation: "cohorts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_groupings_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      course_merges: {
        Row: {
          child_course_id: string;
          created_at: string;
          id: string;
          parent_course_id: string;
        };
        Insert: {
          child_course_id: string;
          created_at?: string;
          id?: string;
          parent_course_id: string;
        };
        Update: {
          child_course_id?: string;
          created_at?: string;
          id?: string;
          parent_course_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_merges_child_course_id_fkey";
            columns: ["child_course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_merges_parent_course_id_fkey";
            columns: ["parent_course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      course_overlaps: {
        Row: {
          base_course_id: string;
          created_at: string;
          dependent_course_id: string;
          id: string;
        };
        Insert: {
          base_course_id: string;
          created_at?: string;
          dependent_course_id: string;
          id?: string;
        };
        Update: {
          base_course_id?: string;
          created_at?: string;
          dependent_course_id?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_overlaps_base_course_id_fkey";
            columns: ["base_course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_overlaps_dependent_course_id_fkey";
            columns: ["dependent_course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      courses: {
        Row: {
          cohort_id: string;
          created_at: string;
          group_index: number;
          hours_per_week: number;
          id: string;
          level: string;
          name: string;
          teacher_id: string | null;
          updated_at: string;
        };
        Insert: {
          cohort_id: string;
          created_at?: string;
          group_index?: number;
          hours_per_week: number;
          id?: string;
          level: string;
          name: string;
          teacher_id?: string | null;
          updated_at?: string;
        };
        Update: {
          cohort_id?: string;
          created_at?: string;
          group_index?: number;
          hours_per_week?: number;
          id?: string;
          level?: string;
          name?: string;
          teacher_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "courses_cohort_id_fkey";
            columns: ["cohort_id"];
            isOneToOne: false;
            referencedRelation: "cohorts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "courses_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "teachers";
            referencedColumns: ["id"];
          },
        ];
      };
      placements: {
        Row: {
          cohort_id: string;
          course_id: string;
          created_at: string;
          day: number;
          id: string;
          period: number;
          variant_id: string;
        };
        Insert: {
          cohort_id: string;
          course_id: string;
          created_at?: string;
          day: number;
          id?: string;
          period: number;
          variant_id: string;
        };
        Update: {
          cohort_id?: string;
          course_id?: string;
          created_at?: string;
          day?: number;
          id?: string;
          period?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "placements_cohort_id_fkey";
            columns: ["cohort_id"];
            isOneToOne: false;
            referencedRelation: "cohorts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "placements_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "placements_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "plan_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_variants: {
        Row: {
          created_at: string;
          id: string;
          is_final: boolean;
          name: string;
          plan_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_final?: boolean;
          name: string;
          plan_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_final?: boolean;
          name?: string;
          plan_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_variants_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          slot_grid_preset: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          slot_grid_preset: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          slot_grid_preset?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      student_choices: {
        Row: {
          course_id: string;
          created_at: string;
          id: string;
          student_id: string;
        };
        Insert: {
          course_id: string;
          created_at?: string;
          id?: string;
          student_id: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_choices_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_choices_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      students: {
        Row: {
          cohort_id: string;
          created_at: string;
          full_name: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          cohort_id: string;
          created_at?: string;
          full_name: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          cohort_id?: string;
          created_at?: string;
          full_name?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "students_cohort_id_fkey";
            columns: ["cohort_id"];
            isOneToOne: false;
            referencedRelation: "cohorts";
            referencedColumns: ["id"];
          },
        ];
      };
      teachers: {
        Row: {
          code: string;
          created_at: string;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      replace_cohort_groupings: {
        Args: {
          p_catalog_hash: string;
          p_cohort_id: string;
          p_groupings: Json;
          p_plan_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;

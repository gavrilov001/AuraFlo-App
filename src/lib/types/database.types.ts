/**
 * Hand-authored to match `supabase_initial_schema.sql` exactly.
 * The SQL file is the source of truth. If the schema changes, update this file
 * (or regenerate with `supabase gen types typescript`) to match — do not change
 * the database to match this file.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// --- Enums (public schema) ---------------------------------------------------

export type WorkspaceRole = "owner" | "admin" | "member" | "assistant";
export type FocusHorizon = "short" | "medium" | "long";
export type FocusStatus = "active" | "paused" | "completed" | "archived";
export type CaptureSource = "manual" | "voice" | "quo" | "import";
export type CaptureStatus = "inbox" | "processed" | "discarded" | "archived";
export type TaskStatus =
  | "open"
  | "in_progress"
  | "waiting"
  | "completed"
  | "cancelled";
export type TaskBucket = "today" | "scheduled" | "delegated" | "someday";
export type DailyPlanStatus = "draft" | "active" | "completed";
export type DailyWorkflowStep = "capture_review" | "prioritize" | "ready";

// --- Database --------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          timezone: string;
          onboarding_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          owner_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          owner_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          owner_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
          joined_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: WorkspaceRole;
          joined_at?: string;
        };
        Update: {
          workspace_id?: string;
          user_id?: string;
          role?: WorkspaceRole;
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          id: string;
          workspace_id: string;
          created_by: string | null;
          name: string;
          color: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          created_by?: string | null;
          name: string;
          color?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          created_by?: string | null;
          name?: string;
          color?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      focus_items: {
        Row: {
          id: string;
          workspace_id: string;
          created_by: string | null;
          title: string;
          description: string | null;
          horizon: FocusHorizon;
          status: FocusStatus;
          target_date: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          created_by?: string | null;
          title: string;
          description?: string | null;
          horizon: FocusHorizon;
          status?: FocusStatus;
          target_date?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          created_by?: string | null;
          title?: string;
          description?: string | null;
          horizon?: FocusHorizon;
          status?: FocusStatus;
          target_date?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "focus_items_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      captures: {
        Row: {
          id: string;
          workspace_id: string;
          created_by: string | null;
          content: string;
          notes: string | null;
          source: CaptureSource;
          source_external_id: string | null;
          status: CaptureStatus;
          category_id: string | null;
          captured_at: string;
          processed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          created_by?: string | null;
          content: string;
          notes?: string | null;
          source?: CaptureSource;
          source_external_id?: string | null;
          status?: CaptureStatus;
          category_id?: string | null;
          captured_at?: string;
          processed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          created_by?: string | null;
          content?: string;
          notes?: string | null;
          source?: CaptureSource;
          source_external_id?: string | null;
          status?: CaptureStatus;
          category_id?: string | null;
          captured_at?: string;
          processed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "captures_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "captures_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          created_by: string | null;
          source_capture_id: string | null;
          focus_item_id: string | null;
          category_id: string | null;
          title: string;
          notes: string | null;
          status: TaskStatus;
          bucket: TaskBucket;
          priority: number;
          scheduled_for: string | null;
          due_at: string | null;
          assignee_user_id: string | null;
          delegate_name: string | null;
          delegate_email: string | null;
          delegated_at: string | null;
          completed_at: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          created_by?: string | null;
          source_capture_id?: string | null;
          focus_item_id?: string | null;
          category_id?: string | null;
          title: string;
          notes?: string | null;
          status?: TaskStatus;
          bucket: TaskBucket;
          priority?: number;
          scheduled_for?: string | null;
          due_at?: string | null;
          assignee_user_id?: string | null;
          delegate_name?: string | null;
          delegate_email?: string | null;
          delegated_at?: string | null;
          completed_at?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          created_by?: string | null;
          source_capture_id?: string | null;
          focus_item_id?: string | null;
          category_id?: string | null;
          title?: string;
          notes?: string | null;
          status?: TaskStatus;
          bucket?: TaskBucket;
          priority?: number;
          scheduled_for?: string | null;
          due_at?: string | null;
          assignee_user_id?: string | null;
          delegate_name?: string | null;
          delegate_email?: string | null;
          delegated_at?: string | null;
          completed_at?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      daily_plans: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          plan_date: string;
          status: DailyPlanStatus;
          workflow_step: DailyWorkflowStep;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          user_id: string;
          plan_date: string;
          status?: DailyPlanStatus;
          workflow_step?: DailyWorkflowStep;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          user_id?: string;
          plan_date?: string;
          status?: DailyPlanStatus;
          workflow_step?: DailyWorkflowStep;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      daily_plan_items: {
        Row: {
          id: string;
          daily_plan_id: string;
          task_id: string;
          sort_order: number;
          is_top_three: boolean;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          daily_plan_id: string;
          task_id: string;
          sort_order?: number;
          is_top_three?: boolean;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          daily_plan_id?: string;
          task_id?: string;
          sort_order?: number;
          is_top_three?: boolean;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      is_workspace_member: {
        Args: { target_workspace_id: string };
        Returns: boolean;
      };
      has_workspace_role: {
        Args: {
          target_workspace_id: string;
          allowed_roles: WorkspaceRole[];
        };
        Returns: boolean;
      };
      is_workspace_owner: {
        Args: { target_workspace_id: string; target_user_id: string };
        Returns: boolean;
      };
      can_access_daily_plan: {
        Args: { target_daily_plan_id: string };
        Returns: boolean;
      };
      owns_daily_plan: {
        Args: { target_daily_plan_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      focus_horizon: FocusHorizon;
      focus_status: FocusStatus;
      capture_source: CaptureSource;
      capture_status: CaptureStatus;
      task_status: TaskStatus;
      task_bucket: TaskBucket;
      daily_plan_status: DailyPlanStatus;
      daily_workflow_step: DailyWorkflowStep;
    };
    CompositeTypes: Record<never, never>;
  };
}

// --- Convenience row aliases ----------------------------------------------

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"];
export type WorkspaceMember =
  Database["public"]["Tables"]["workspace_members"]["Row"];
export type Category = Database["public"]["Tables"]["categories"]["Row"];
export type FocusItem = Database["public"]["Tables"]["focus_items"]["Row"];
export type Capture = Database["public"]["Tables"]["captures"]["Row"];
export type Task = Database["public"]["Tables"]["tasks"]["Row"];

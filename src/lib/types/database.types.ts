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
export type CaptureSource = "manual" | "voice" | "quo" | "import" | "email";
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
// Added by supabase/migrations/20261026120000_email_to_dreamcatcher.sql
export type SenderEmailStatus = "pending" | "verified";

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
          // Added by supabase/migrations/20261026120000_email_to_dreamcatcher.sql
          inbound_alias: string;
          primary_email_verified_email: string | null;
          primary_email_verified_at: string | null;
          primary_email_verification_token_hash: string | null;
          primary_email_verification_expires_at: string | null;
          primary_email_verification_last_sent_at: string | null;
          primary_email_verification_send_count_24h: number;
          sender_email_add_last_at: string | null;
          sender_email_add_count_1h: number;
          // Added by supabase/migrations/20261101000000_dream_catcher_handles.sql
          dream_handle: string;
          dream_capture_pending_last_at: string | null;
          dream_capture_pending_count_1h: number;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
          inbound_alias?: string;
          primary_email_verified_email?: string | null;
          primary_email_verified_at?: string | null;
          primary_email_verification_token_hash?: string | null;
          primary_email_verification_expires_at?: string | null;
          primary_email_verification_last_sent_at?: string | null;
          primary_email_verification_send_count_24h?: number;
          sender_email_add_last_at?: string | null;
          sender_email_add_count_1h?: number;
          dream_handle?: string;
          dream_capture_pending_last_at?: string | null;
          dream_capture_pending_count_1h?: number;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          timezone?: string;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
          inbound_alias?: string;
          primary_email_verified_email?: string | null;
          primary_email_verified_at?: string | null;
          primary_email_verification_token_hash?: string | null;
          primary_email_verification_expires_at?: string | null;
          primary_email_verification_last_sent_at?: string | null;
          primary_email_verification_send_count_24h?: number;
          sender_email_add_last_at?: string | null;
          sender_email_add_count_1h?: number;
          dream_handle?: string;
          dream_capture_pending_last_at?: string | null;
          dream_capture_pending_count_1h?: number;
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
          processed_in_daily_plan_id: string | null;
          archived_at: string | null;
          discarded_at: string | null;
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
          processed_in_daily_plan_id?: string | null;
          archived_at?: string | null;
          discarded_at?: string | null;
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
          processed_in_daily_plan_id?: string | null;
          archived_at?: string | null;
          discarded_at?: string | null;
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
          {
            foreignKeyName: "captures_processed_in_daily_plan_id_fkey";
            columns: ["processed_in_daily_plan_id"];
            isOneToOne: false;
            referencedRelation: "daily_plans";
            referencedColumns: ["id"];
          },
          {
            // reverse of tasks.source_capture_id (unique) — to-one
            foreignKeyName: "tasks_source_capture_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "tasks";
            referencedColumns: ["source_capture_id"];
          },
        ];
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          created_by: string | null;
          source_capture_id: string | null;
          origin_daily_plan_id: string | null;
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
          origin_daily_plan_id?: string | null;
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
          origin_daily_plan_id?: string | null;
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
        Relationships: [
          {
            foreignKeyName: "tasks_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_source_capture_id_fkey";
            columns: ["source_capture_id"];
            isOneToOne: true;
            referencedRelation: "captures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_origin_daily_plan_id_fkey";
            columns: ["origin_daily_plan_id"];
            isOneToOne: false;
            referencedRelation: "daily_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_focus_item_id_fkey";
            columns: ["focus_item_id"];
            isOneToOne: false;
            referencedRelation: "focus_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "daily_plans_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "daily_plan_items_daily_plan_id_fkey";
            columns: ["daily_plan_id"];
            isOneToOne: false;
            referencedRelation: "daily_plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "daily_plan_items_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      // Added by supabase/migrations/20261026120000_email_to_dreamcatcher.sql
      user_sender_emails: {
        Row: {
          id: string;
          user_id: string;
          email: string;
          email_normalized: string;
          status: SenderEmailStatus;
          verification_token_hash: string | null;
          verification_expires_at: string | null;
          verification_last_sent_at: string | null;
          verification_send_count_24h: number;
          verified_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          email: string;
          status?: SenderEmailStatus;
          verification_token_hash?: string | null;
          verification_expires_at?: string | null;
          verification_last_sent_at?: string | null;
          verification_send_count_24h?: number;
          verified_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          email?: string;
          status?: SenderEmailStatus;
          verification_token_hash?: string | null;
          verification_expires_at?: string | null;
          verification_last_sent_at?: string | null;
          verification_send_count_24h?: number;
          verified_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_sender_emails_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
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
      // Added by supabase/migrations/20260902120000_start_my_day.sql
      start_my_day_process_capture: {
        Args: {
          p_capture_id: string;
          p_daily_plan_id: string;
          p_decision: string;
          p_scheduled_for?: string | null;
          p_due_at?: string | null;
          p_notes?: string | null;
          p_focus_item_id?: string | null;
          p_delegate_name?: string | null;
          p_delegate_email?: string | null;
          p_add_to_today?: boolean;
        };
        Returns: Json;
      };
      start_my_day_undo_capture: {
        Args: {
          p_capture_id: string;
          p_daily_plan_id: string;
          p_force?: boolean;
        };
        Returns: Json;
      };
      // Added by supabase/migrations/20260903120000_start_my_day_today.sql
      start_my_day_batch_later: {
        Args: { p_daily_plan_id: string; p_capture_ids: string[] };
        Returns: Json;
      };
      start_my_day_batch_discard: {
        Args: { p_daily_plan_id: string; p_capture_ids: string[] };
        Returns: Json;
      };
      start_my_day_batch_undo: {
        Args: {
          p_daily_plan_id: string;
          p_capture_ids: string[];
          p_kind: string;
        };
        Returns: Json;
      };
      today_set_task_done: {
        Args: {
          p_daily_plan_id: string;
          p_task_id: string;
          p_done: boolean;
        };
        Returns: Json;
      };
      // Added by supabase/migrations/20260904120000_reset_daily_plan.sql
      reset_current_daily_plan: {
        Args: { p_reopen_completed?: boolean };
        Returns: Json;
      };
      reset_workspace_daily_plan: {
        Args: {
          p_workspace_id: string;
          p_reopen_completed?: boolean;
        };
        Returns: Json;
      };
      // Added by supabase/migrations/20260905120000_reorder_daily_plan_items.sql
      reorder_daily_plan_items: {
        Args: { p_daily_plan_id: string; p_item_ids: string[] };
        Returns: Json;
      };
      // Added by supabase/migrations/20260906120000_batch_process_captures.sql
      start_my_day_process_captures: {
        Args: {
          p_daily_plan_id: string;
          p_capture_ids: string[];
          p_decision: string;
          p_scheduled_for?: string | null;
          p_due_at?: string | null;
          p_notes?: string | null;
          p_focus_item_id?: string | null;
          p_delegate_name?: string | null;
          p_delegate_email?: string | null;
          p_add_to_today?: boolean;
        };
        Returns: Json;
      };
      start_my_day_undo_captures: {
        Args: {
          p_daily_plan_id: string;
          p_capture_ids: string[];
          p_decision: string;
        };
        Returns: Json;
      };
      // Added by supabase/migrations/20260907120000_all_tasks.sql
      tasks_create: {
        Args: {
          p_workspace_id: string;
          p_title: string;
          p_bucket: string;
          p_notes?: string | null;
          p_category_id?: string | null;
          p_focus_item_id?: string | null;
          p_scheduled_for?: string | null;
          p_due_at?: string | null;
          p_delegate_name?: string | null;
          p_delegate_email?: string | null;
          p_priority?: number;
          p_reopen_plan?: boolean;
        };
        Returns: Json;
      };
      tasks_move_to_destination: {
        Args: {
          p_task_id: string;
          p_bucket: string;
          p_scheduled_for?: string | null;
          p_due_at?: string | null;
          p_delegate_name?: string | null;
          p_delegate_email?: string | null;
          p_reopen_plan?: boolean;
        };
        Returns: Json;
      };
      tasks_set_status: {
        Args: { p_task_id: string; p_op: string };
        Returns: Json;
      };
      tasks_set_top_three: {
        Args: { p_task_id: string; p_value: boolean };
        Returns: Json;
      };
      tasks_reorder: {
        Args: { p_task_ids: string[] };
        Returns: Json;
      };
      // Added by supabase/migrations/20260908120000_capture_lifecycle.sql
      capture_restore: {
        Args: { p_capture_id: string };
        Returns: Json;
      };
      // Added by supabase/migrations/20260909120000_workspace_cleanup.sql
      workspace_delete_all_tasks: {
        Args: { p_workspace_id: string; p_today: string };
        Returns: Json;
      };
      workspace_clear_processed_captures: {
        Args: { p_workspace_id: string };
        Returns: Json;
      };
      // Added by supabase/migrations/20261026120000_email_to_dreamcatcher.sql
      inbound_alias_regenerate: {
        Args: Record<string, never>;
        Returns: Json;
      };
      // service_role only — see the migration's comments on
      // primary_email_request_verification/sender_email_add/sender_email_resend
      // for why these take an explicit p_user_id instead of auth.uid() and
      // must never be granted to `authenticated`.
      primary_email_request_verification: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      primary_email_verify: {
        Args: { p_token: string };
        Returns: Json;
      };
      sender_email_add: {
        Args: { p_user_id: string; p_email: string };
        Returns: Json;
      };
      sender_email_resend: {
        Args: { p_user_id: string; p_id: string };
        Returns: Json;
      };
      sender_email_remove: {
        Args: { p_id: string };
        Returns: Json;
      };
      sender_email_verify: {
        Args: { p_token: string };
        Returns: Json;
      };
      // Added by supabase/migrations/20261101000000_dream_catcher_handles.sql
      // service_role only — called from the webhook's admin client, same
      // trust boundary as sender_email_add/sender_email_resend above.
      dream_capture_submit: {
        Args: {
          p_user_id: string;
          p_sender_email: string;
          p_source_external_id: string | null;
          p_content: string;
        };
        Returns: Json;
      };
      dream_capture_confirm: {
        Args: { p_token: string };
        Returns: Json;
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
      sender_email_status: SenderEmailStatus;
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
export type DailyPlan = Database["public"]["Tables"]["daily_plans"]["Row"];
export type DailyPlanItem =
  Database["public"]["Tables"]["daily_plan_items"]["Row"];
export type UserSenderEmail =
  Database["public"]["Tables"]["user_sender_emails"]["Row"];
/**
 * The subset of user_sender_emails safe to serialize into a client
 * component. Excludes verification_token_hash/expires_at/send-count columns
 * — a sha256 hash can't be reversed into the raw token, but there's no
 * reason to ship rate-limit/token-lifecycle internals to the browser at
 * all. Settings' page.tsx selects exactly these columns, never `*`.
 */
export type SenderEmailSummary = Pick<
  UserSenderEmail,
  "id" | "email" | "status" | "created_at"
>;

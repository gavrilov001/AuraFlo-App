# Phase 1 integrity verification procedure

This procedure is intentionally not executed by the repository checks. Run it against a disposable local Supabase database or a dedicated staging project after applying migrations in order. Do not run destructive cases against production data.

## Migration order

1. `supabase_initial_schema.sql`
2. Migrations in timestamp order through `20260908120000_capture_lifecycle.sql`
3. `20260909120000_workspace_cleanup.sql`
4. `20261001120000_phase1_integrity.sql`

Use separate authenticated Supabase clients for an owner, an admin, an ordinary member, an anonymous client, and two users/workspaces where needed.

## Authorization checks

- As an anonymous client, call both cleanup RPCs and `reset_workspace_daily_plan`; each must fail with an authentication/authorization error.
- As an ordinary member, call `workspace_clear_processed_captures(workspace_id)` and `workspace_delete_all_tasks(workspace_id, local_date)`; each must fail with SQLSTATE `42501`.
- As an owner and as an admin, call both cleanup RPCs in a disposable workspace; each must succeed and return JSON containing a numeric `deleted` value.
- As a member of Workspace A, call `reset_workspace_daily_plan(workspace_b_id, true)`; it must fail with SQLSTATE `42501` and leave Workspace B unchanged.

## Reset isolation checks

1. Create one current-date plan in Workspace A and one current-date plan in Workspace B for the same authenticated user.
2. Call `reset_workspace_daily_plan(workspace_a_id, true)`.
3. Assert that only Workspace A's plan, plan items, session-created tasks, and session-processed captures are changed.
4. Assert that Workspace B's plan and related rows remain unchanged.
5. Call `reset_current_daily_plan(true)` while both plans exist; it must fail with message `workspace_required` and must not reset either plan.
6. Remove one of the plans and call the compatibility wrapper; it must reset the remaining workspace-specific plan.
7. Repeat a successful reset call; it must return `status = 'no_plan'` and zero counts.

## Task workspace checks

1. Create tasks and daily plans in two workspaces for the same user.
2. Call `tasks_move_to_destination` for a Workspace A task while Workspace B also has a current plan.
3. Assert that only Workspace A plan items are detached/created.
4. Call `tasks_set_status` for the Workspace A task and assert that only Workspace A daily-plan items change.
5. Assert that Workspace B plan items and completion timestamps remain unchanged.

## Existing invariant checks

- Attempt to insert a daily-plan item linking a task and plan from different workspaces; the `validate_daily_plan_item()` trigger must reject it.
- Attempt to mark a fourth item as Top Priority; the trigger/RPC must reject it.
- Repeat cleanup, reset, move, and status requests; each must either be idempotent or return a safe validation error, never a partial state.

## Catalog checks

After applying the migrations, verify these function identities exist exactly once:

- `workspace_clear_processed_captures(uuid)`
- `workspace_delete_all_tasks(uuid,date)`
- `reset_workspace_daily_plan(uuid,boolean)`
- `reset_current_daily_plan(boolean)`
- `tasks_move_to_destination(uuid,text,date,timestamptz,text,text,boolean)`
- `tasks_set_status(uuid,text)`

For each function, verify `prosecdef = true`, `search_path` is empty, `anon` has no execute privilege, and `authenticated` has execute privilege. Inspect `pg_get_functiondef()` to confirm `auth.uid()` and workspace predicates are present.

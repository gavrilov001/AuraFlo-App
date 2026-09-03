import type { Metadata } from "next";

import { requireWorkspaceContext } from "@/lib/auth/context";
import { listCategories } from "@/lib/data/categories";
import { listActiveFocusItems } from "@/lib/data/start-day";
import { listTasks } from "@/lib/data/tasks";
import { listTasksSchema } from "@/lib/validation/tasks";
import { TasksWorkspace } from "./TasksWorkspace";

export const metadata: Metadata = { title: "All Tasks" };

export default async function AllTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = listTasksSchema.parse({
    view: pick(raw.view),
    q: pick(raw.q),
    category: pick(raw.category),
    focus: pick(raw.focus),
    sort: pick(raw.sort),
    page: pick(raw.page),
    showCancelled: pick(raw.showCancelled),
  });

  const { user, workspace, profile } = await requireWorkspaceContext();
  const timezone = profile.timezone;

  const [result, categories, focusItems] = await Promise.all([
    listTasks(workspace.id, user.id, timezone, params),
    listCategories(workspace.id),
    listActiveFocusItems(workspace.id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6">
      <TasksWorkspace
        result={result}
        params={params}
        categories={categories}
        focusItems={focusItems}
        timezone={timezone}
      />
    </div>
  );
}

function pick(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

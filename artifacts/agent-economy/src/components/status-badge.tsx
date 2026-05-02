import { Badge } from "@/components/ui/badge";
import { TaskStatus, AgentStatus } from "@workspace/api-client-react";

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline", className?: string }> = {
    open: { label: "Open", variant: "default" },
    assigned: { label: "Assigned", variant: "secondary" },
    in_progress: { label: "In Progress", variant: "secondary", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
    submitted: { label: "Submitted", variant: "secondary", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    complete: { label: "Complete", variant: "secondary", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    disputed: { label: "Disputed", variant: "destructive" },
    cancelled: { label: "Cancelled", variant: "outline" },
  };

  const config = map[status] || { label: status, variant: "outline" };

  return (
    <Badge variant={config.variant} className={config.className} data-testid={`status-badge-task-${status}`}>
      {config.label}
    </Badge>
  );
}

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const map: Record<AgentStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline", className?: string }> = {
    active: { label: "Active", variant: "secondary", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    inactive: { label: "Inactive", variant: "outline" },
  };

  const config = map[status] || { label: status, variant: "outline" };

  return (
    <Badge variant={config.variant} className={config.className} data-testid={`status-badge-agent-${status}`}>
      {config.label}
    </Badge>
  );
}

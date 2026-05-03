import { PublicLayout } from "@/components/layout";
import { useListTasks, useListCapabilities, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { formatCurrency, formatDate } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { CapabilityBadges } from "@/components/capability-badges";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskStatusBadge } from "@/components/status-badge";
import type { TaskStatus } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PlusCircle, X } from "lucide-react";

export default function TasksList() {
  const [search, setSearch] = useState("");
  const [capabilityId, setCapabilityId] = useState<number | undefined>();
  const [status, setStatus] = useState<TaskStatus | "all">("all");
  const [minPayment, setMinPayment] = useState<string>("");
  const [maxPayment, setMaxPayment] = useState<string>("");
  const [deadlineBefore, setDeadlineBefore] = useState<string>("");

  const { data: me } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });

  const { data: tasks, isLoading } = useListTasks({
    search: search || undefined,
    capabilityId,
    status: status !== "all" ? status : undefined,
    minPayment: minPayment ? Number(minPayment) : undefined,
    maxPayment: maxPayment ? Number(maxPayment) : undefined,
    deadlineBefore: deadlineBefore ? new Date(deadlineBefore).toISOString() : undefined,
  });

  const { data: capabilities } = useListCapabilities();

  const hasActiveFilters =
    Boolean(search) || Boolean(capabilityId) || status !== "all" ||
    Boolean(minPayment) || Boolean(maxPayment) || Boolean(deadlineBefore);

  function clearFilters() {
    setSearch("");
    setCapabilityId(undefined);
    setStatus("all");
    setMinPayment("");
    setMaxPayment("");
    setDeadlineBefore("");
  }

  return (
    <PublicLayout>
      <div className="container mx-auto p-4 md:p-8 max-w-6xl space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Task Market</h1>
            <p className="text-muted-foreground">Browse open tasks for your agents to execute.</p>
          </div>
          {me && (
            <Button asChild>
              <Link href="/tasks/new">
                <PlusCircle className="mr-2 h-4 w-4" />
                Post a Task
              </Link>
            </Button>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <Input
                placeholder="Search tasks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-tasks"
              />
            </div>
            <div className="space-y-2">
              <Label>Capability Required</Label>
              <Select
                value={capabilityId ? String(capabilityId) : "all"}
                onValueChange={(v) => setCapabilityId(v === "all" ? undefined : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All capabilities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All capabilities</SelectItem>
                  {capabilities?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus | "all")}>
                <SelectTrigger data-testid="select-status-filter">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                  <SelectItem value="disputed">Disputed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-2">
              <Label>Min Payment ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={minPayment}
                onChange={(e) => setMinPayment(e.target.value)}
                data-testid="input-min-payment"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Payment ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="No limit"
                value={maxPayment}
                onChange={(e) => setMaxPayment(e.target.value)}
                data-testid="input-max-payment"
              />
            </div>
            <div className="space-y-2">
              <Label>Deadline Before</Label>
              <Input
                type="datetime-local"
                value={deadlineBefore}
                onChange={(e) => setDeadlineBefore(e.target.value)}
                data-testid="input-deadline-before"
              />
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="self-end text-muted-foreground hover:text-foreground"
              >
                <X className="mr-1 h-4 w-4" />
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : !tasks || tasks.length === 0 ? (
          <div className="text-center py-16 bg-muted/20 border border-border rounded-lg border-dashed">
            <p className="text-lg font-medium">No tasks found</p>
            <p className="text-muted-foreground text-sm mt-1">
              {hasActiveFilters ? "Try adjusting your filters." : "Be the first to post a task."}
            </p>
            {me && !hasActiveFilters && (
              <Button asChild className="mt-4">
                <Link href="/tasks/new">Post a Task</Link>
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} found
            </p>
            <div className="grid grid-cols-1 gap-4">
              {tasks.map((task) => (
                <Card key={task.id} className="hover:border-primary/50 transition-colors">
                  <Link href={`/tasks/${task.id}`}>
                    <CardContent className="p-5 cursor-pointer flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                      <div className="space-y-3 flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <TaskStatusBadge status={task.status} />
                          <h3 className="font-semibold text-lg truncate" data-testid={`text-task-title-${task.id}`}>{task.title}</h3>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 max-w-3xl">
                          {task.description}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>Posted by: <span className="font-medium text-foreground">{task.postedByDisplayName || "Unknown"}</span></span>
                          <span>•</span>
                          <span>Created: {formatDate(task.createdAt)}</span>
                          {task.deadline && (
                            <>
                              <span>•</span>
                              <span className="text-amber-600 dark:text-amber-400">Deadline: {formatDate(task.deadline)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-start md:items-end gap-3 shrink-0">
                        <div className="text-2xl font-bold text-primary">{formatCurrency(task.paymentAmount)}</div>
                        <CapabilityBadges capabilities={task.capabilityRequirements} />
                      </div>
                    </CardContent>
                  </Link>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </PublicLayout>
  );
}

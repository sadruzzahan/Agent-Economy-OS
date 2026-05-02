import { PublicLayout } from "@/components/layout";
import { useListTasks, useListCapabilities } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { formatCurrency, formatDate } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { CapabilityBadges } from "@/components/capability-badges";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskStatusBadge } from "@/components/status-badge";
import { Label } from "@/components/ui/label";

export default function TasksList() {
  const [search, setSearch] = useState("");
  const [capabilityId, setCapabilityId] = useState<number | undefined>();
  const [status, setStatus] = useState<string>("all");
  
  const { data: tasks, isLoading } = useListTasks({ 
    search: search || undefined, 
    capabilityId,
    status: status !== "all" ? status as any : undefined
  });
  
  const { data: capabilities } = useListCapabilities();

  return (
    <PublicLayout>
      <div className="container mx-auto p-4 md:p-8 max-w-6xl space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Task Market</h1>
            <p className="text-muted-foreground">Browse open tasks for your agents to execute.</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
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
                {capabilities?.map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
              </SelectContent>
            </Select>
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
            <p className="text-muted-foreground text-sm mt-1">Try adjusting your filters.</p>
          </div>
        ) : (
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
        )}
      </div>
    </PublicLayout>
  );
}

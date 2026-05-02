import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useListTasks, type Task } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { formatCurrency, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskStatusBadge } from "@/components/status-badge";
import { Briefcase, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function MyTasks() {
  return (
    <Protected>
      <SignedInLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My Tasks</h1>
            <p className="text-muted-foreground">Manage tasks you've posted and tasks assigned to your agents.</p>
          </div>

          <Tabs defaultValue="posted" className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="posted" data-testid="tab-posted-by-me">Posted by me</TabsTrigger>
              <TabsTrigger value="assigned" data-testid="tab-assigned-to-agents">Assigned to my agents</TabsTrigger>
            </TabsList>
            
            <TabsContent value="posted" className="mt-6">
              <PostedTasksList />
            </TabsContent>
            
            <TabsContent value="assigned" className="mt-6">
              <AssignedTasksList />
            </TabsContent>
          </Tabs>
        </div>
      </SignedInLayout>
    </Protected>
  );
}

function PostedTasksList() {
  const { data: tasks, isLoading } = useListTasks({ postedByMe: true });

  if (isLoading) return <TaskSkeletonList />;
  
  if (!tasks || tasks.length === 0) {
    return (
      <div className="text-center py-16 bg-muted/20 border border-border rounded-lg border-dashed">
        <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-medium">No tasks posted</h3>
        <p className="text-muted-foreground text-sm mt-1 mb-4">You haven't requested any work from the agent network yet.</p>
        <Button asChild>
          <Link href="/tasks/new">Post a Task</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {tasks.map(task => <TaskRow key={task.id} task={task} />)}
    </div>
  );
}

function AssignedTasksList() {
  const { data: tasks, isLoading } = useListTasks({ assignedToMyAgents: true });

  if (isLoading) return <TaskSkeletonList />;
  
  if (!tasks || tasks.length === 0) {
    return (
      <div className="text-center py-16 bg-muted/20 border border-border rounded-lg border-dashed">
        <h3 className="text-lg font-medium">No assigned tasks</h3>
        <p className="text-muted-foreground text-sm mt-1 mb-4">None of your agents have been assigned to tasks yet.</p>
        <Button asChild variant="outline">
          <Link href="/tasks">Browse Task Market</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {tasks.map(task => <TaskRow key={task.id} task={task} showAssignedAgent />)}
    </div>
  );
}

function TaskRow({ task, showAssignedAgent = false }: { task: Task, showAssignedAgent?: boolean }) {
  return (
    <Card className="hover:border-primary/50 transition-colors">
      <Link href={`/tasks/${task.id}`}>
        <CardContent className="p-4 sm:p-6 cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <TaskStatusBadge status={task.status} />
              <span className="font-medium text-lg truncate block" data-testid={`text-task-title-${task.id}`}>{task.title}</span>
            </div>
            <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{formatDate(task.createdAt)}</span>
              {showAssignedAgent && task.assignedAgentName && (
                <>
                  <span className="text-border">•</span>
                  <span className="text-primary font-medium flex items-center gap-1">
                    Agent: {task.assignedAgentName}
                  </span>
                </>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4 w-full sm:w-auto shrink-0 border-t sm:border-t-0 pt-4 sm:pt-0 mt-2 sm:mt-0">
            <div className="text-xl font-bold text-foreground">{formatCurrency(task.paymentAmount)}</div>
            <Button variant="ghost" size="icon" className="hidden sm:flex ml-2">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}

function TaskSkeletonList() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

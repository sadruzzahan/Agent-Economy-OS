import { PublicLayout } from "@/components/layout";
import { Protected } from "@/components/protected-route";
import { useParams, Link } from "wouter";
import { 
  useGetTask, useGetMe, useListAgents, 
  useAssignTask, useStartTask, useSubmitTaskResult, 
  useVerifyTask, useDisputeTask 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatDate } from "@/lib/format";
import { TaskStatusBadge } from "@/components/status-badge";
import { CapabilityBadges } from "@/components/capability-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { getGetTaskQueryKey, getListTasksQueryKey, getGetMeQueryKey, getListAgentsQueryKey } from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";
import { formatReputation } from "@/lib/format";

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const taskId = parseInt(id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: task, isLoading: isLoadingTask } = useGetTask(taskId, { query: { enabled: !!taskId, queryKey: getGetTaskQueryKey(taskId) } });
  const { data: me } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });
  const { data: myAgents } = useListAgents({ ownedByMe: true }, { query: { enabled: !!me, queryKey: getListAgentsQueryKey({ ownedByMe: true }) } });

  const assignTask = useAssignTask();
  const startTask = useStartTask();
  const submitResult = useSubmitTaskResult();
  const verifyTask = useVerifyTask();
  const disputeTask = useDisputeTask();

  const isPoster = me && task && me.id === task.postedByUserId;
  const isAssignedAgentOwner = me && task && myAgents && myAgents.some(a => a.id === task.assignedAgentId);

  // Assignment Dialog Logic
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  
  const eligibleAgents = myAgents?.filter(agent => 
    task?.capabilityRequirements.some(req => 
      agent.capabilities.some(ac => ac.capabilityId === req.capabilityId)
    )
  );

  const handleAssign = () => {
    if (!selectedAgentId) return;
    assignTask.mutate(
      { taskId, data: { agentId: parseInt(selectedAgentId, 10) } },
      {
        onSuccess: () => {
          toast({ title: "Task assigned successfully" });
          setAssignOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
        },
        onError: (err) => toast({ title: "Assignment failed", description: err.data?.error, variant: "destructive" })
      }
    );
  };

  const handleStart = () => {
    startTask.mutate(
      { taskId },
      {
        onSuccess: () => {
          toast({ title: "Task started" });
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
        },
        onError: (err) => toast({ title: "Failed to start", description: err.data?.error, variant: "destructive" })
      }
    );
  };

  if (isLoadingTask) {
    return (
      <PublicLayout>
        <div className="container mx-auto p-4 md:p-8 max-w-4xl space-y-6">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PublicLayout>
    );
  }

  if (!task) return <PublicLayout><div className="p-8 text-center">Task not found.</div></PublicLayout>;

  return (
    <PublicLayout>
      <div className="container mx-auto p-4 md:p-8 max-w-5xl space-y-8">
        
        {/* Header Header */}
        <div className="flex flex-col md:flex-row justify-between gap-6 items-start">
          <div className="space-y-4 flex-1">
            <div className="flex items-center gap-3">
              <TaskStatusBadge status={task.status} />
              <span className="text-muted-foreground text-sm font-medium tracking-wide uppercase">Task #{task.id}</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">{task.title}</h1>
            <p className="text-lg text-muted-foreground max-w-3xl">{task.description}</p>
          </div>
          
          <Card className="shrink-0 w-full md:w-64 bg-card border-primary/20 shadow-md">
            <CardContent className="p-6 space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Payment</p>
                <p className="text-3xl font-bold text-primary">{formatCurrency(task.paymentAmount)}</p>
              </div>
              <div className="pt-4 border-t border-border space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Posted by</span>
                  <span className="font-medium truncate ml-2">{task.postedByDisplayName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deadline</span>
                  <span className="font-medium">{task.deadline ? formatDate(task.deadline) : "None"}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action Bar (Role Gated) */}
        {me && (
          <div className="bg-muted/30 border border-border rounded-lg p-4 flex flex-wrap gap-4 items-center justify-between">
            <div className="text-sm font-medium">
              {isPoster && <span className="text-blue-600 bg-blue-100 dark:bg-blue-900/30 px-2 py-1 rounded">You posted this task</span>}
              {isAssignedAgentOwner && <span className="text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded ml-2">Your agent is assigned</span>}
            </div>
            
            <div className="flex gap-2">
              {/* ASSIGN (Open, and user has eligible agents) */}
              {task.status === "open" && eligibleAgents && eligibleAgents.length > 0 && (
                <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-assign-agent">Assign Agent</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Assign Task</DialogTitle>
                      <DialogDescription>Select one of your eligible agents to execute this task.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleAgents.map(a => (
                            <SelectItem key={a.id} value={String(a.id)}>{a.name} ({formatReputation(a.reputationScore)})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <DialogFooter>
                      <Button disabled={!selectedAgentId || assignTask.isPending} onClick={handleAssign}>
                        {assignTask.isPending ? "Assigning..." : "Assign & Accept"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {/* START (Assigned to my agent) */}
              {task.status === "assigned" && isAssignedAgentOwner && (
                <Button onClick={handleStart} disabled={startTask.isPending} data-testid="button-start-task">
                  {startTask.isPending ? "Starting..." : "Start Execution"}
                </Button>
              )}

              {/* SUBMIT RESULT (In Progress by my agent) */}
              {task.status === "in_progress" && isAssignedAgentOwner && (
                <SubmitResultDialog taskId={taskId} />
              )}

              {/* VERIFY / DISPUTE (Submitted, I am poster) */}
              {task.status === "submitted" && isPoster && (
                <>
                  <DisputeDialog taskId={taskId} />
                  <VerifyDialog taskId={taskId} />
                </>
              )}
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-8">
            <Card>
              <CardHeader>
                <CardTitle>Technical Specs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-medium text-sm mb-2 text-muted-foreground uppercase tracking-wider">Required Capabilities</h3>
                  <CapabilityBadges capabilities={task.capabilityRequirements} />
                </div>
                
                <div>
                  <h3 className="font-medium text-sm mb-2 text-muted-foreground uppercase tracking-wider">Success Criteria</h3>
                  <ul className="list-disc pl-5 space-y-1 text-sm">
                    {task.successCriteria.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>

                <JSONViewer title="Input Data" data={task.inputData} />
                <JSONViewer title="Expected Output Schema" data={task.outputSchema} />
                
                {(task.status === "submitted" || task.status === "complete" || task.status === "disputed") && (
                  <div className="pt-6 border-t border-border">
                    <h2 className="text-xl font-bold mb-4 text-foreground">Execution Result</h2>
                    <JSONViewer title="Output Data" data={task.result} defaultOpen />
                    {task.resultNotes && (
                      <div className="mt-4 p-4 bg-muted/50 rounded-md">
                        <p className="text-sm font-medium mb-1">Agent Notes:</p>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.resultNotes}</p>
                      </div>
                    )}
                  </div>
                )}
                
                {task.disputeReason && (
                  <div className="mt-4 p-4 bg-destructive/10 text-destructive border border-destructive/20 rounded-md flex gap-3">
                    <AlertCircle className="shrink-0 h-5 w-5" />
                    <div>
                      <p className="text-sm font-bold">Dispute Reason:</p>
                      <p className="text-sm">{task.disputeReason}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-8">
            {/* Status Timeline */}
            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {task.statusLog.map((log, i) => (
                    <div key={log.id} className="flex gap-4 relative">
                      {i !== task.statusLog.length - 1 && (
                        <div className="absolute top-6 left-[11px] bottom-[-16px] w-[2px] bg-border" />
                      )}
                      <div className="shrink-0 mt-1">
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center border-2 border-background shadow-sm z-10 relative">
                          {i === 0 ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Clock className="h-3 w-3 text-muted-foreground" />}
                        </div>
                      </div>
                      <div className="pb-2">
                        <div className="font-medium text-sm capitalize">{log.status.replace('_', ' ')}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(log.createdAt)} {log.actorDisplayName ? `by ${log.actorDisplayName}` : ''}
                        </div>
                        {log.note && <div className="text-xs italic mt-1 text-muted-foreground">"{log.note}"</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Assigned Agent Profile Snippet */}
            {task.assignedAgentId && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Assigned Agent</CardTitle>
                </CardHeader>
                <CardContent>
                  <Link href={`/agents/${task.assignedAgentId}`} className="flex items-center gap-3 hover:bg-muted/50 p-2 -m-2 rounded-md transition-colors group">
                    <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold">
                      {task.assignedAgentName?.charAt(0) || "A"}
                    </div>
                    <div>
                      <div className="font-semibold group-hover:underline text-foreground">{task.assignedAgentName}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">View Profile <ArrowRight className="h-3 w-3" /></div>
                    </div>
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

// Subcomponents

function JSONViewer({ title, data, defaultOpen = false }: { title: string, data: any, defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!data) return null;
  
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-border rounded-md overflow-hidden">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-muted/30 hover:bg-muted/50 transition-colors">
        <span className="font-medium text-sm">{title}</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="p-4 bg-zinc-950 text-zinc-50 text-xs overflow-x-auto max-h-[300px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SubmitResultDialog({ taskId }: { taskId: number }) {
  const [open, setOpen] = useState(false);
  const submitResult = useSubmitTaskResult();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const formSchema = z.object({
    resultStr: z.string().refine(val => {
      try { JSON.parse(val); return true; } catch { return false; }
    }, "Must be valid JSON"),
    notes: z.string().optional()
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { resultStr: "{\n  \n}", notes: "" }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    submitResult.mutate(
      { taskId, data: { result: JSON.parse(data.resultStr), notes: data.notes || null } },
      {
        onSuccess: () => {
          toast({ title: "Result submitted for verification" });
          setOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
        },
        onError: (err) => toast({ title: "Submission failed", description: err.data?.error, variant: "destructive" })
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-amber-600 hover:bg-amber-700 text-white" data-testid="button-submit-result">Submit Result</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Submit Task Result</DialogTitle>
          <DialogDescription>Provide the output JSON according to the task's schema.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="resultStr" render={({ field }) => (
              <FormItem>
                <FormLabel>Result JSON</FormLabel>
                <FormControl><Textarea className="font-mono text-xs min-h-[200px]" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Execution Notes (Optional)</FormLabel>
                <FormControl><Textarea placeholder="Explain how the task was completed..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={submitResult.isPending}>
                {submitResult.isPending ? "Submitting..." : "Submit to Poster"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ taskId }: { taskId: number }) {
  const [open, setOpen] = useState(false);
  const verifyTask = useVerifyTask();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const formSchema = z.object({
    rating: z.coerce.number().min(1).max(5),
    reviewText: z.string().optional()
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { rating: 5, reviewText: "" }
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    verifyTask.mutate(
      { taskId, data },
      {
        onSuccess: () => {
          toast({ title: "Task verified and funds released" });
          setOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
        },
        onError: (err) => toast({ title: "Verification failed", description: err.data?.error, variant: "destructive" })
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-green-600 hover:bg-green-700 text-white" data-testid="button-verify-task">Verify & Release Escrow</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify Result & Pay</DialogTitle>
          <DialogDescription>Approving this result will release the escrowed funds to the agent's wallet.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">
            <FormField control={form.control} name="rating" render={({ field }) => (
              <FormItem>
                <FormLabel>Agent Rating</FormLabel>
                <FormControl>
                  <RadioGroup onValueChange={field.onChange} defaultValue={String(field.value)} className="flex gap-4">
                    {[1, 2, 3, 4, 5].map(v => (
                      <div key={v} className="flex items-center space-x-2">
                        <RadioGroupItem value={String(v)} id={`r${v}`} />
                        <Label htmlFor={`r${v}`}>{v} ★</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="reviewText" render={({ field }) => (
              <FormItem>
                <FormLabel>Public Review (Optional)</FormLabel>
                <FormControl><Textarea placeholder="Great job..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="submit" disabled={verifyTask.isPending} className="w-full bg-green-600 hover:bg-green-700 text-white">
                {verifyTask.isPending ? "Processing..." : "Approve & Transfer Funds"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DisputeDialog({ taskId }: { taskId: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const disputeTask = useDisputeTask();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDispute = () => {
    if (!reason) return;
    disputeTask.mutate(
      { taskId, data: { reason } },
      {
        onSuccess: () => {
          toast({ title: "Task disputed" });
          setOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetTaskQueryKey(taskId) });
        },
        onError: (err) => toast({ title: "Dispute failed", description: err.data?.error, variant: "destructive" })
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" data-testid="button-dispute-task">Dispute Result</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispute Result</DialogTitle>
          <DialogDescription>If the agent failed to meet the success criteria, explain why. Escrowed funds will remain locked.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Dispute Reason</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Result does not match schema..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={handleDispute} disabled={!reason || disputeTask.isPending}>
            {disputeTask.isPending ? "Submitting..." : "Submit Dispute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

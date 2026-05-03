import { PublicLayout } from "@/components/layout";
import { useParams } from "wouter";
import {
  useGetAgent,
  useGetAgentReputationHistory,
  useListAgentReviews,
  useGetAgentActivity,
  useGetMe,
  useRotateAgentKey,
  getGetAgentQueryKey,
  getGetAgentReputationHistoryQueryKey,
  getListAgentReviewsQueryKey,
  getGetAgentActivityQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CapabilityBadges } from "@/components/capability-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, formatReputation, formatDate } from "@/lib/format";
import { AgentStatusBadge } from "@/components/status-badge";
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Sparkles, Activity, Star, KeyRound, Copy, Check, AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

function ScoreBar({
  label,
  value,
  max,
  barClass,
}: {
  label: string;
  value: number;
  max: number;
  barClass: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {value.toFixed(1)}<span className="text-muted-foreground">/{max}</span>
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return "text-green-600 dark:text-green-400";
  if (status >= 400 && status < 500) return "text-amber-600 dark:text-amber-400";
  if (status >= 500) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function methodColor(method: string): string {
  if (method === "GET") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  if (method === "POST") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
  if (method === "DELETE") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  return "bg-muted text-muted-foreground";
}

function RuntimeActivityTab({ agentId }: { agentId: number }) {
  const { data: logs, isLoading } = useGetAgentActivity(
    agentId,
    { limit: 50 },
    { query: { enabled: !!agentId, queryKey: getGetAgentActivityQueryKey(agentId) } },
  );

  if (isLoading) {
    return (
      <div className="space-y-2 pt-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center text-muted-foreground border border-dashed rounded-lg mt-4">
        <Activity className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No runtime API activity yet.</p>
        <p className="text-xs mt-1">Activity will appear here once this agent calls the runtime API.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground">Method</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground">Endpoint</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {logs.map((log) => (
            <tr key={log.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5">
                <span className={`inline-block text-xs font-mono font-bold px-1.5 py-0.5 rounded ${methodColor(log.method)}`}>
                  {log.method}
                </span>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-foreground/80 max-w-xs truncate">
                {log.endpoint}
              </td>
              <td className={`px-4 py-2.5 font-mono font-semibold ${statusColor(log.responseStatus)}`}>
                {log.responseStatus}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                {new Date(log.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RotateKeyCard({
  agentId,
  agentName,
}: {
  agentId: number;
  agentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [nameEcho, setNameEcho] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const mutation = useRotateAgentKey({
    mutation: {
      onSuccess: (data) => {
        setNewKey(data.apiKey);
        setConfirmed(false);
      },
      onError: (err) => {
        toast({
          title: "Could not rotate key",
          description:
            err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  function reset() {
    setOpen(false);
    setNewKey(null);
    setConfirmed(false);
    setNameEcho("");
    setCopied(false);
    mutation.reset();
  }

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the key and copy it manually.",
        variant: "destructive",
      });
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            API key
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Rotate this agent's API key if you suspect it has been leaked.
            The previous key will stop working immediately.
          </p>
          <Button
            variant="outline"
            size="sm"
            data-testid="button-rotate-api-key"
            onClick={() => setOpen(true)}
          >
            Rotate API key
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
        <DialogContent>
          {newKey ? (
            <>
              <DialogHeader>
                <DialogTitle>New API key issued</DialogTitle>
                <DialogDescription>
                  Copy this now — it will not be shown again. The previous
                  key has been revoked.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border bg-muted p-3 font-mono text-xs break-all select-all">
                {newKey}
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={copyKey}
                  data-testid="button-copy-new-key"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-1" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" /> Copy key
                    </>
                  )}
                </Button>
                <Button onClick={reset} data-testid="button-close-key-dialog">
                  I've saved it
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Rotate this agent's API key?
                </DialogTitle>
                <DialogDescription>
                  The current key will stop working immediately. Any running
                  agents will need to be reconfigured with the new key. This
                  action is logged in the audit trail.
                </DialogDescription>
              </DialogHeader>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1"
                  data-testid="checkbox-confirm-rotate"
                />
                <span>
                  I understand the previous key will be revoked and cannot
                  be recovered.
                </span>
              </label>
              <div className="space-y-2 text-sm">
                <label
                  htmlFor="rotate-confirm-name"
                  className="block text-muted-foreground"
                >
                  Type the agent's name{" "}
                  <span className="font-mono font-medium text-foreground">
                    {agentName}
                  </span>{" "}
                  to confirm:
                </label>
                <input
                  id="rotate-confirm-name"
                  type="text"
                  value={nameEcho}
                  onChange={(e) => setNameEcho(e.target.value)}
                  placeholder={agentName}
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                  data-testid="input-confirm-agent-name"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={reset}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    !confirmed ||
                    nameEcho !== agentName ||
                    mutation.isPending
                  }
                  onClick={() =>
                    mutation.mutate({
                      agentId,
                      data: { confirmAgentName: nameEcho },
                    })
                  }
                  data-testid="button-confirm-rotate"
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Rotating...
                    </>
                  ) : (
                    "Rotate key"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AgentProfile() {
  const { id } = useParams<{ id: string }>();
  const agentId = parseInt(id || "0", 10);

  const { data: agent, isLoading: isLoadingAgent } = useGetAgent(agentId, { query: { enabled: !!agentId, queryKey: getGetAgentQueryKey(agentId) } });
  const { data: history, isLoading: isLoadingHistory } = useGetAgentReputationHistory(agentId, { query: { enabled: !!agentId, queryKey: getGetAgentReputationHistoryQueryKey(agentId) } });
  const { data: reviews, isLoading: isLoadingReviews } = useListAgentReviews(agentId, undefined, { query: { enabled: !!agentId, queryKey: getListAgentReviewsQueryKey(agentId) } });
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const isOwner = !!me && !!agent && me.id === agent.ownerUserId;

  if (isLoadingAgent) {
    return (
      <PublicLayout>
        <div className="container mx-auto p-4 md:p-8 max-w-4xl space-y-8">
          <Skeleton className="h-48 w-full rounded-xl" />
          <div className="grid md:grid-cols-3 gap-8">
            <div className="md:col-span-2 space-y-8">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </PublicLayout>
    );
  }

  if (!agent) {
    return (
      <PublicLayout>
        <div className="container mx-auto p-8 text-center">
          Agent not found.
        </div>
      </PublicLayout>
    );
  }

  const isNewAgent = agent.tasksCompleted < 3;

  return (
    <PublicLayout>
      <div className="container mx-auto p-4 md:p-8 max-w-5xl space-y-8">
        
        {/* Hero Section */}
        <div className="bg-card border border-border rounded-xl p-8 shadow-sm flex flex-col md:flex-row gap-8 items-start relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-32 -mt-32 pointer-events-none" />
          
          <Avatar className="h-32 w-32 border-4 border-background shadow-md">
            <AvatarImage src={agent.avatarUrl || undefined} />
            <AvatarFallback className="text-4xl">{agent.name.charAt(0)}</AvatarFallback>
          </Avatar>
          
          <div className="flex-1 space-y-4 z-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-4xl font-bold text-foreground" data-testid="text-agent-name">{agent.name}</h1>
                <p className="text-lg text-muted-foreground font-medium">@{agent.handle}</p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {isNewAgent && (
                  <Badge variant="secondary" className="gap-1.5 text-sm px-3 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800">
                    <Sparkles className="h-3.5 w-3.5" />
                    New Agent
                  </Badge>
                )}
                <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-4 py-2 rounded-lg flex items-center gap-2">
                  <span className="text-xl font-bold">{formatReputation(agent.reputationScore)}</span>
                  <span className="text-sm uppercase tracking-wide">Rep</span>
                </div>
                <AgentStatusBadge status={agent.status} />
              </div>
            </div>
            
            <p className="text-lg max-w-2xl">{agent.description}</p>
            
            <div className="pt-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Verified Capabilities</h3>
              <CapabilityBadges capabilities={agent.capabilities} className="gap-2" />
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-0">
            {/* Tabs for Reputation + Reviews + Runtime Activity */}
            <Tabs defaultValue="reputation">
              <TabsList className="grid grid-cols-3 w-full mb-6">
                <TabsTrigger value="reputation" className="gap-2">
                  <span>Reputation</span>
                </TabsTrigger>
                <TabsTrigger value="reviews" className="gap-2">
                  <Star className="h-3.5 w-3.5" />
                  Reviews
                </TabsTrigger>
                <TabsTrigger value="runtime" className="gap-2">
                  <Activity className="h-3.5 w-3.5" />
                  Runtime Activity
                </TabsTrigger>
              </TabsList>

              <TabsContent value="reputation">
                <Card>
                  <CardHeader>
                    <CardTitle>Reputation History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoadingHistory ? (
                      <Skeleton className="h-64 w-full" />
                    ) : !history || history.length === 0 ? (
                      <div className="h-64 flex items-center justify-center text-muted-foreground border border-dashed rounded-md">
                        Not enough data
                      </div>
                    ) : (
                      <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={history} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                            <XAxis 
                              dataKey="date" 
                              tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={12}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis 
                              domain={[0, 100]} 
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={12}
                              tickLine={false}
                              axisLine={false}
                            />
                            <RechartsTooltip 
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                              labelFormatter={(val) => new Date(val).toLocaleDateString()}
                              formatter={(val: number) => [val.toFixed(1), "Score"]}
                            />
                            <Line 
                              type="monotone" 
                              dataKey="score" 
                              stroke="hsl(var(--primary))" 
                              strokeWidth={3}
                              dot={false}
                              activeDot={{ r: 6, fill: "hsl(var(--primary))" }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="reviews">
                <Card>
                  <CardHeader>
                    <CardTitle>Recent Reviews</CardTitle>
                    <p className="text-xs text-muted-foreground">Showing latest 10 reviews</p>
                  </CardHeader>
                  <CardContent>
                    {isLoadingReviews ? (
                      <div className="space-y-4">
                        {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                      </div>
                    ) : !reviews || reviews.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">No reviews yet.</div>
                    ) : (
                      <div className="space-y-6">
                        {reviews.map(review => (
                          <div key={review.id} className="border-b border-border last:border-0 pb-6 last:pb-0">
                            <div className="flex justify-between items-start mb-2">
                              <div className="font-medium text-sm">
                                {review.taskTitle}
                              </div>
                              <div className="flex items-center text-amber-500">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <span key={i} className={i < review.rating ? "" : "text-muted"}>★</span>
                                ))}
                              </div>
                            </div>
                            {review.text && (
                              <p className="text-sm mt-2 text-foreground/90 italic">"{review.text}"</p>
                            )}
                            <div className="text-xs text-muted-foreground mt-3 flex justify-between">
                              <span>By {review.reviewerDisplayName || "Unknown"}</span>
                              <span>{formatDate(review.createdAt)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="runtime">
                <Card>
                  <CardHeader>
                    <CardTitle>Runtime API Activity</CardTitle>
                    <p className="text-xs text-muted-foreground">Last 50 API calls made by this agent via the runtime API</p>
                  </CardHeader>
                  <CardContent>
                    <RuntimeActivityTab agentId={agentId} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6">
            {/* Stats */}
            <Card>
              <CardHeader>
                <CardTitle>Performance Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Total Earned</div>
                  <div className="text-3xl font-bold text-primary">{formatCurrency(agent.totalEarned)}</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 bg-muted/50 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Available</div>
                    <div className="text-xl font-semibold text-green-600">{formatCurrency(agent.walletBalance)}</div>
                  </div>
                  <div className="space-y-1 bg-muted/50 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">In Escrow</div>
                    <div className="text-xl font-semibold text-amber-600">{formatCurrency(agent.walletEscrowed)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1 bg-muted/50 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Completed</div>
                    <div className="text-2xl font-semibold">{agent.tasksCompleted}</div>
                  </div>
                  <div className="space-y-1 bg-muted/50 p-3 rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">Disputed</div>
                    <div className="text-2xl font-semibold text-red-500">{agent.disputeCount}</div>
                  </div>
                </div>

                {/* Score Breakdown */}
                <div className="pt-2 border-t border-border space-y-3">
                  <div className="text-sm font-semibold">Score Breakdown</div>
                  <ScoreBar
                    label="Completion Rate"
                    value={agent.scoreBreakdown.completionRate}
                    max={40}
                    barClass="bg-green-500"
                  />
                  <ScoreBar
                    label="Avg Rating"
                    value={agent.scoreBreakdown.avgRating}
                    max={35}
                    barClass="bg-blue-500"
                  />
                  <ScoreBar
                    label="Reliability"
                    value={agent.scoreBreakdown.nonDisputeRate}
                    max={15}
                    barClass="bg-purple-500"
                  />
                  <ScoreBar
                    label="Volume Bonus"
                    value={agent.scoreBreakdown.volumeBonus}
                    max={10}
                    barClass="bg-amber-500"
                  />
                </div>

                <div className="pt-2 border-t border-border">
                  <div className="text-sm flex justify-between">
                    <span className="text-muted-foreground">Owner</span>
                    <span className="font-medium">{agent.ownerDisplayName || "Unknown"}</span>
                  </div>
                  <div className="text-sm flex justify-between mt-2">
                    <span className="text-muted-foreground">Joined</span>
                    <span className="font-medium">{formatDate(agent.createdAt)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {isOwner && (
              <RotateKeyCard agentId={agentId} agentName={agent.name} />
            )}
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

import { PublicLayout } from "@/components/layout";
import { useParams } from "wouter";
import { useGetAgent, useGetAgentReputationHistory, useListAgentReviews, getGetAgentQueryKey, getGetAgentReputationHistoryQueryKey, getListAgentReviewsQueryKey } from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CapabilityBadges } from "@/components/capability-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatReputation, formatDate } from "@/lib/format";
import { AgentStatusBadge } from "@/components/status-badge";
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export default function AgentProfile() {
  const { id } = useParams<{ id: string }>();
  const agentId = parseInt(id || "0", 10);

  const { data: agent, isLoading: isLoadingAgent } = useGetAgent(agentId, { query: { enabled: !!agentId, queryKey: getGetAgentQueryKey(agentId) } });
  const { data: history, isLoading: isLoadingHistory } = useGetAgentReputationHistory(agentId, { query: { enabled: !!agentId, queryKey: getGetAgentReputationHistoryQueryKey(agentId) } });
  const { data: reviews, isLoading: isLoadingReviews } = useListAgentReviews(agentId, { query: { enabled: !!agentId, queryKey: getListAgentReviewsQueryKey(agentId) } });

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
              <div className="flex items-center gap-3">
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
          <div className="md:col-span-2 space-y-8">
            {/* Reputation Chart */}
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

            {/* Reviews */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Reviews</CardTitle>
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
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">In Progress</div>
                    <div className="text-2xl font-semibold">{agent.tasksInProgress}</div>
                  </div>
                </div>
                <div className="pt-4 border-t border-border">
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
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

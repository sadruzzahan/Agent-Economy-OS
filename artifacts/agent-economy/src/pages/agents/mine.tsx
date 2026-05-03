import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import { useListAgents } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { PlusCircle, MoreHorizontal, Sparkles } from "lucide-react";
import { formatCurrency, formatReputation, formatDate } from "@/lib/format";
import { AgentStatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function MyAgents() {
  const { data: agents, isLoading } = useListAgents({ ownedByMe: true });

  const newAgents = agents?.filter((a) => a.tasksCompleted < 3) ?? [];

  return (
    <Protected>
      <SignedInLayout>
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">My Agents</h1>
              <p className="text-muted-foreground">Manage your AI agents and track their performance.</p>
            </div>
            <Button asChild>
              <Link href="/agents/new">
                <PlusCircle className="mr-2 h-4 w-4" />
                New Agent
              </Link>
            </Button>
          </div>

          {!isLoading && newAgents.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4">
              <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  {newAgents.length === 1
                    ? `${newAgents[0].name} is just getting started`
                    : `${newAgents.length} agents are just getting started`}
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                  Agents with fewer than 3 completed tasks show a "New" badge to task posters.
                  Assign them tasks to build their reputation score.{" "}
                  <Link href="/tasks" className="underline font-medium hover:text-blue-900 dark:hover:text-blue-200">
                    Browse available tasks
                  </Link>
                </p>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Reputation</TableHead>
                  <TableHead className="text-right">Tasks (Active/Done)</TableHead>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Wallet</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [...Array(3)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-8 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))
                ) : !agents || agents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center space-y-3">
                        <div className="text-muted-foreground">You don't have any agents yet.</div>
                        <Button asChild variant="outline">
                          <Link href="/agents/new">Create your first agent</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  agents.map((agent) => (
                    <TableRow key={agent.id}>
                      <TableCell className="font-medium">
                        <Link href={`/agents/${agent.id}`} className="hover:underline text-primary" data-testid={`link-agent-${agent.id}`}>
                          {agent.name}
                        </Link>
                        <div className="text-xs text-muted-foreground font-normal">@{agent.handle}</div>
                      </TableCell>
                      <TableCell><AgentStatusBadge status={agent.status} /></TableCell>
                      <TableCell className="text-right">{formatReputation(agent.reputationScore)}</TableCell>
                      <TableCell className="text-right text-sm">
                        <span className="text-amber-600">{agent.tasksInProgress}</span> / <span className="text-green-600">{agent.tasksCompleted}</span>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(agent.totalEarned)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(agent.walletBalance)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(agent.lastActiveAt)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/agents/${agent.id}`}>View Profile</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/agents/${agent.id}/edit`} data-testid={`link-edit-agent-${agent.id}`}>Edit Agent</Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </SignedInLayout>
    </Protected>
  );
}

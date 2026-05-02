import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetDashboardSummary, useGetDashboardActivity, useGetPlatformStats } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Activity, PlusCircle, Briefcase, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  return (
    <Protected>
      <SignedInLayout>
        <div className="space-y-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link href="/agents/new">
                  <PlusCircle className="mr-2 h-4 w-4" />
                  New Agent
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/tasks/new">
                  <Briefcase className="mr-2 h-4 w-4" />
                  Post Task
                </Link>
              </Button>
              <Button asChild>
                <Link href="/wallet">
                  <Wallet className="mr-2 h-4 w-4" />
                  Top Up
                </Link>
              </Button>
            </div>
          </div>

          <DashboardKPIs />
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="col-span-1 lg:col-span-2">
              <RecentActivity />
            </div>
            <div>
              <PlatformStatsPanel />
            </div>
          </div>
        </div>
      </SignedInLayout>
    </Protected>
  );
}

function DashboardKPIs() {
  const { data, isLoading } = useGetDashboardSummary();

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-6 w-1/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const kpis = [
    { label: "My Agents", value: data.totalAgents, testid: "kpi-total-agents" },
    { label: "Active Agents", value: data.activeAgents, testid: "kpi-active-agents" },
    { label: "Tasks In Progress", value: data.tasksInProgress, testid: "kpi-tasks-progress" },
    { label: "Tasks Completed", value: data.tasksCompleted, testid: "kpi-tasks-completed" },
    { label: "Total Earned", value: formatCurrency(data.totalEarned), testid: "kpi-total-earned" },
    { label: "Total Spent", value: formatCurrency(data.totalSpent), testid: "kpi-total-spent" },
    { label: "Posting Balance", value: formatCurrency(data.postingBalance), testid: "kpi-posting-balance" },
    { label: "Escrowed", value: formatCurrency(data.totalEscrowed), testid: "kpi-total-escrowed" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, idx) => (
        <Card key={idx}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid={kpi.testid}>{kpi.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RecentActivity() {
  const { data, isLoading } = useGetDashboardActivity({ limit: 10 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No recent activity.
          </div>
        ) : (
          <div className="space-y-4">
            {data.map((item) => (
              <div key={item.id} className="flex items-start justify-between border-b border-border pb-4 last:border-0 last:pb-0">
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(item.createdAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlatformStatsPanel() {
  const { data, isLoading } = useGetPlatformStats();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Capabilities</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : !data || !data.topCapabilities ? (
          <div className="text-sm text-muted-foreground">No stats available</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {data.topCapabilities.map((tc) => (
                <div key={tc.capability.id} className="flex items-center justify-between">
                  <Badge variant="secondary" className="font-normal">{tc.capability.name}</Badge>
                  <span className="text-sm font-medium">{tc.agentCount} agents</span>
                </div>
              ))}
            </div>
            <div className="pt-4 border-t border-border space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Active Agents</span>
                <span className="font-medium">{data.totalActiveAgents}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tasks Completed</span>
                <span className="font-medium">{data.totalTasksCompleted}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

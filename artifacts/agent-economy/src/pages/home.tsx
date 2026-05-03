import { Redirect } from "wouter";
import { Show } from "@clerk/react";
import { PublicLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useGetPlatformStats } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Briefcase, Wallet } from "lucide-react";

import { getBasePath } from "@/lib/env";
const basePath = getBasePath();

function LandingPage() {
  const { data: stats, isLoading } = useGetPlatformStats();

  return (
    <PublicLayout>
      <div className="flex flex-col">
        {/* Hero Section */}
        <section className="py-20 md:py-32 px-4 border-b border-border bg-gradient-to-b from-background to-muted/20">
          <div className="container mx-auto max-w-5xl text-center space-y-8">
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground" data-testid="text-hero-title">
              The operating system for the AI agent economy
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto" data-testid="text-hero-subtitle">
              A financial-infrastructure UI for a marketplace where AI agents are first-class economic actors with wallets, capabilities, and reputation.
            </p>
            <div className="flex items-center justify-center gap-4 pt-4">
              <Button size="lg" asChild data-testid="button-hero-signup">
                <a href={`${basePath}/sign-up`}>Get Started</a>
              </Button>
              <Button size="lg" variant="outline" asChild data-testid="button-hero-browse">
                <a href={`${basePath}/agents`}>Browse Agents</a>
              </Button>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-12 border-b border-border bg-card">
          <div className="container mx-auto max-w-5xl px-4">
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="space-y-2 text-center">
                    <Skeleton className="h-10 w-24 mx-auto" />
                    <Skeleton className="h-4 w-32 mx-auto" />
                  </div>
                ))}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                <div data-testid="stat-agents">
                  <div className="text-4xl font-bold text-foreground">{stats.totalAgents}</div>
                  <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider mt-1">Agents</div>
                </div>
                <div data-testid="stat-tasks">
                  <div className="text-4xl font-bold text-foreground">{stats.totalTasksCompleted}</div>
                  <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider mt-1">Tasks Completed</div>
                </div>
                <div data-testid="stat-volume">
                  <div className="text-4xl font-bold text-primary">{formatCurrency(stats.totalVolume)}</div>
                  <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider mt-1">Total Volume</div>
                </div>
                <div data-testid="stat-active">
                  <div className="text-4xl font-bold text-foreground">{stats.totalActiveAgents}</div>
                  <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider mt-1">Active Agents</div>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Pillars Section */}
        <section className="py-24 px-4">
          <div className="container mx-auto max-w-5xl">
            <div className="grid md:grid-cols-3 gap-8">
              <Card className="bg-card border-border shadow-sm" data-testid="card-pillar-identity">
                <CardContent className="pt-8 text-center space-y-4">
                  <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                    <Bot className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold">Identity & Capabilities</h3>
                  <p className="text-muted-foreground">
                    Register agents with verifiable capabilities. Build reputation through successful task execution.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card border-border shadow-sm" data-testid="card-pillar-market">
                <CardContent className="pt-8 text-center space-y-4">
                  <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                    <Briefcase className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold">Task Market</h3>
                  <p className="text-muted-foreground">
                    Post tasks with specific capability requirements and success criteria. Agents compete to deliver.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card border-border shadow-sm" data-testid="card-pillar-wallet">
                <CardContent className="pt-8 text-center space-y-4">
                  <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                    <Wallet className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold">Wallet & Reputation</h3>
                  <p className="text-muted-foreground">
                    Native wallets for every agent. Secure escrow payments and automated settlement upon verification.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </div>
    </PublicLayout>
  );
}

export default function Home() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

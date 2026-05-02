import { PublicLayout } from "@/components/layout";
import { useListAgents, useListCapabilities } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { formatReputation } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { CapabilityBadges } from "@/components/capability-badges";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

export default function AgentsList() {
  const [search, setSearch] = useState("");
  const [capabilityId, setCapabilityId] = useState<number | undefined>();
  const [minReputation, setMinReputation] = useState<number>(0);

  const { data: agents, isLoading } = useListAgents({ 
    search: search || undefined, 
    capabilityId, 
    minReputation: minReputation > 0 ? minReputation : undefined 
  });
  
  const { data: capabilities } = useListCapabilities();

  return (
    <PublicLayout>
      <div className="container mx-auto p-4 md:p-8 max-w-6xl space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Browse Agents</h1>
            <p className="text-muted-foreground">Find capable AI agents for your tasks.</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Search</Label>
            <Input 
              placeholder="Search by name or handle..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-agents"
            />
          </div>
          <div className="space-y-2">
            <Label>Capability</Label>
            <Select 
              value={capabilityId ? String(capabilityId) : "all"} 
              onValueChange={(v) => setCapabilityId(v === "all" ? undefined : Number(v))}
            >
              <SelectTrigger data-testid="select-capability-filter">
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
            <div className="flex justify-between">
              <Label>Min Reputation</Label>
              <span className="text-sm font-medium">{minReputation > 0 ? minReputation : "Any"}</span>
            </div>
            <Slider
              value={[minReputation]}
              max={100}
              step={5}
              onValueChange={([val]) => setMinReputation(val)}
              className="py-2"
              data-testid="slider-min-reputation"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded-full" />
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-24" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  </div>
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !agents || agents.length === 0 ? (
          <div className="text-center py-16 bg-muted/20 border border-border rounded-lg border-dashed">
            <p className="text-lg font-medium">No agents found</p>
            <p className="text-muted-foreground text-sm mt-1">Try adjusting your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => (
              <Card key={agent.id} className="hover:shadow-md transition-shadow">
                <Link href={`/agents/${agent.id}`}>
                  <CardContent className="p-6 cursor-pointer space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={agent.avatarUrl || undefined} />
                          <AvatarFallback>{agent.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-semibold" data-testid={`text-agent-name-${agent.id}`}>{agent.name}</h3>
                          <p className="text-sm text-muted-foreground">@{agent.handle}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1 font-medium">
                          <span className="text-amber-500">★</span> 
                          <span>{formatReputation(agent.reputationScore)}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{agent.tasksCompleted} tasks</span>
                      </div>
                    </div>
                    <p className="text-sm line-clamp-2 text-muted-foreground min-h-[2.5rem]">
                      {agent.description}
                    </p>
                    <CapabilityBadges capabilities={agent.capabilities.slice(0, 3)} />
                    {agent.capabilities.length > 3 && (
                      <span className="text-xs text-muted-foreground ml-1">+{agent.capabilities.length - 3} more</span>
                    )}
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

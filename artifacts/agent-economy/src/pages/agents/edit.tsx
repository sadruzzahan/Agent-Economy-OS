import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import { useParams, useLocation } from "wouter";
import { useGetAgent, useUpdateAgent, useListCapabilities, getListAgentsQueryKey, getGetAgentQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const formSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  description: z.string().max(500),
  status: z.enum(["active", "inactive"]),
  capabilityIds: z.array(z.number()),
});

type FormValues = z.infer<typeof formSchema>;

export default function EditAgent() {
  const { id } = useParams<{ id: string }>();
  const agentId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: agent, isLoading: isLoadingAgent } = useGetAgent(agentId, {
    query: { enabled: !!agentId, queryKey: getGetAgentQueryKey(agentId) },
  });
  const { data: capabilities } = useListCapabilities();
  const updateAgent = useUpdateAgent();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      status: "active",
      capabilityIds: [],
    },
  });

  useEffect(() => {
    if (agent) {
      form.reset({
        name: agent.name,
        description: agent.description,
        status: (agent.status === "inactive" ? "inactive" : "active") as "active" | "inactive",
        capabilityIds: agent.capabilities.map((c) => c.capabilityId),
      });
    }
  }, [agent, form]);

  const onSubmit = (data: FormValues) => {
    updateAgent.mutate(
      { agentId, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({ title: "Agent updated", description: "Changes saved successfully." });
          setLocation(`/agents/${agentId}`);
        },
        onError: (err) => {
          toast({
            title: "Update failed",
            description: err.data?.error || "An unexpected error occurred.",
            variant: "destructive",
          });
        },
      },
    );
  };

  if (isLoadingAgent) {
    return (
      <Protected>
        <SignedInLayout>
          <div className="max-w-2xl mx-auto space-y-6">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-96 w-full" />
          </div>
        </SignedInLayout>
      </Protected>
    );
  }

  if (!agent) {
    return (
      <Protected>
        <SignedInLayout>
          <div className="text-center py-8 text-muted-foreground">Agent not found.</div>
        </SignedInLayout>
      </Protected>
    );
  }

  return (
    <Protected>
      <SignedInLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Edit Agent</h1>
            <p className="text-muted-foreground">Update {agent.name}'s profile and capabilities.</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Agent Profile</CardTitle>
              <CardDescription>Changes are reflected immediately in the public directory.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Agent Name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. DataProcessor-X" {...field} data-testid="input-agent-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="What does this agent do?"
                            className="resize-none h-24"
                            {...field}
                            data-testid="input-agent-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger data-testid="select-agent-status">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="capabilityIds"
                    render={() => (
                      <FormItem>
                        <div className="mb-4">
                          <FormLabel>Capabilities</FormLabel>
                          <FormDescription>
                            Select the skills this agent possesses.
                          </FormDescription>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-border p-4 rounded-md bg-muted/20">
                          {capabilities?.map((capability) => (
                            <FormField
                              key={capability.id}
                              control={form.control}
                              name="capabilityIds"
                              render={({ field }) => (
                                <FormItem
                                  key={capability.id}
                                  className="flex flex-row items-start space-x-3 space-y-0"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(capability.id)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...field.value, capability.id])
                                          : field.onChange(
                                              field.value?.filter((v) => v !== capability.id),
                                            );
                                      }}
                                      data-testid={`checkbox-capability-${capability.slug}`}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal cursor-pointer">
                                    {capability.name}
                                  </FormLabel>
                                </FormItem>
                              )}
                            />
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-between pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setLocation(`/agents/${agentId}`)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={updateAgent.isPending}
                      data-testid="button-save-agent"
                    >
                      {updateAgent.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </SignedInLayout>
    </Protected>
  );
}

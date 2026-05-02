import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useCreateAgent, useListCapabilities } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { useLocation } from "wouter";
import { Copy, Check } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  description: z.string().max(500),
  capabilityIds: z.array(z.number()).min(1, "Select at least one capability"),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewAgent() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: capabilities } = useListCapabilities();
  const createAgent = useCreateAgent();
  
  const [createdAgentId, setCreatedAgentId] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      capabilityIds: [],
    },
  });

  const onSubmit = (data: FormValues) => {
    createAgent.mutate({ data }, {
      onSuccess: (res) => {
        setApiKey(res.apiKey);
        setCreatedAgentId(res.agent.id);
      },
      onError: (err) => {
        toast({
          title: "Error creating agent",
          description: err.data?.error || "An unexpected error occurred.",
          variant: "destructive",
        });
      }
    });
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Protected>
      <SignedInLayout>
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Register New Agent</h1>
            <p className="text-muted-foreground">Create an identity for your AI agent and declare its capabilities.</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Agent Profile</CardTitle>
              <CardDescription>Public details visible in the agent directory.</CardDescription>
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
                            placeholder="What does this agent do? (Optional)" 
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
                    name="capabilityIds"
                    render={() => (
                      <FormItem>
                        <div className="mb-4">
                          <FormLabel>Capabilities</FormLabel>
                          <FormDescription>
                            Select the skills this agent possesses. This determines which tasks it can be assigned to.
                          </FormDescription>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-border p-4 rounded-md bg-muted/20">
                          {capabilities?.map((capability) => (
                            <FormField
                              key={capability.id}
                              control={form.control}
                              name="capabilityIds"
                              render={({ field }) => {
                                return (
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
                                                field.value?.filter(
                                                  (value) => value !== capability.id
                                                )
                                              )
                                        }}
                                        data-testid={`checkbox-capability-${capability.slug}`}
                                      />
                                    </FormControl>
                                    <div className="space-y-1 leading-none">
                                      <FormLabel className="font-normal cursor-pointer">
                                        {capability.name}
                                      </FormLabel>
                                    </div>
                                  </FormItem>
                                )
                              }}
                            />
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end pt-4">
                    <Button 
                      type="submit" 
                      disabled={createAgent.isPending}
                      data-testid="button-submit-agent"
                    >
                      {createAgent.isPending ? "Creating..." : "Register Agent"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        <Dialog open={!!apiKey} onOpenChange={() => {}}>
          <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Agent Registered Successfully</DialogTitle>
              <DialogDescription className="text-destructive font-medium">
                Save this API key now. It will never be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Your agent needs this API key to authenticate with the Agent Economy OS and execute tasks.
              </p>
              <div className="flex items-center gap-2 p-3 bg-muted rounded-md font-mono text-sm break-all">
                <span className="flex-1">{apiKey}</span>
                <Button size="icon" variant="outline" onClick={copyToClipboard} className="shrink-0" data-testid="button-copy-key">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setLocation(`/agents/${createdAgentId}`)} className="w-full" data-testid="button-goto-agent">
                I've saved my key — go to agent profile
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SignedInLayout>
    </Protected>
  );
}

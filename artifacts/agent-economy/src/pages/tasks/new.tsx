import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useCreateTask, useListCapabilities, useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocation } from "wouter";
import { formatCurrency } from "@/lib/format";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const formSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  description: z.string().min(10, "Provide a better description"),
  capabilityIds: z.array(z.number()).min(1, "Select at least one required capability"),
  paymentAmount: z.coerce.number().min(1, "Payment must be greater than 0"),
  deadline: z.string().optional().nullable(),
  successCriteriaText: z.string().min(5, "Define success criteria"),
  inputDataStr: z.string().refine((val) => {
    if (!val) return true;
    try { JSON.parse(val); return true; } catch { return false; }
  }, "Must be valid JSON"),
  outputSchemaStr: z.string().refine((val) => {
    if (!val) return true;
    try { JSON.parse(val); return true; } catch { return false; }
  }, "Must be valid JSON")
});

type FormValues = z.infer<typeof formSchema>;

export default function NewTask() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: capabilities } = useListCapabilities();
  const { data: me } = useGetMe();
  const createTask = useCreateTask();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      capabilityIds: [],
      paymentAmount: 10,
      deadline: "",
      successCriteriaText: "- Standard quality\n- Delivered on time",
      inputDataStr: "{\n  \n}",
      outputSchemaStr: "{\n  \n}",
    },
  });

  const paymentAmount = form.watch("paymentAmount");
  const isOverBudget = me && Number(paymentAmount) > me.postingBalance;

  const onSubmit = (data: FormValues) => {
    if (isOverBudget) return;

    const reqData = {
      title: data.title,
      description: data.description,
      capabilityIds: data.capabilityIds,
      paymentAmount: data.paymentAmount,
      deadline: data.deadline || null,
      successCriteria: data.successCriteriaText.split('\n').map(s => s.trim()).filter(Boolean),
      inputData: data.inputDataStr ? JSON.parse(data.inputDataStr) : {},
      outputSchema: data.outputSchemaStr ? JSON.parse(data.outputSchemaStr) : {},
    };

    createTask.mutate({ data: reqData }, {
      onSuccess: (task) => {
        toast({ title: "Task created successfully" });
        setLocation(`/tasks/${task.id}`);
      },
      onError: (err) => {
        toast({
          title: "Failed to create task",
          description: err.data?.error || "An unexpected error occurred",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Protected>
      <SignedInLayout>
        <div className="max-w-3xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Post a Task</h1>
            <p className="text-muted-foreground">Create a new work request for the agent market.</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <Card>
                <CardHeader>
                  <CardTitle>Basic Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Task Title</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Scrape Top 100 Real Estate Listings" {...field} />
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
                            placeholder="Detailed description of what needs to be done..." 
                            className="min-h-[100px]" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="paymentAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payment Amount (USD)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="1" {...field} />
                          </FormControl>
                          <FormDescription>
                            Funds will be escrowed immediately.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="deadline"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Deadline (Optional)</FormLabel>
                          <FormControl>
                            <Input type="datetime-local" {...field} value={field.value || ''} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Requirements</CardTitle>
                  <CardDescription>What skills does the agent need?</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="capabilityIds"
                    render={() => (
                      <FormItem>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border border-border p-4 rounded-md bg-muted/20">
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
                                            : field.onChange(field.value?.filter((val) => val !== capability.id))
                                        }}
                                      />
                                    </FormControl>
                                    <FormLabel className="font-normal cursor-pointer text-sm">
                                      {capability.name}
                                    </FormLabel>
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Technical Specs</CardTitle>
                  <CardDescription>Machine-readable context for the agent.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="successCriteriaText"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Success Criteria (One per line)</FormLabel>
                        <FormControl>
                          <Textarea className="font-mono text-sm" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="inputDataStr"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Input Data (JSON)</FormLabel>
                          <FormControl>
                            <Textarea className="font-mono text-xs min-h-[150px]" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="outputSchemaStr"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expected Output Schema (JSON)</FormLabel>
                          <FormControl>
                            <Textarea className="font-mono text-xs min-h-[150px]" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {me && (
                <Alert variant={isOverBudget ? "destructive" : "default"} className={isOverBudget ? "" : "bg-muted"}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Wallet Check</AlertTitle>
                  <AlertDescription>
                    Your posting balance is {formatCurrency(me.postingBalance)}. 
                    {isOverBudget ? (
                      <span className="font-bold ml-1">You do not have enough funds to post this task. Top up your wallet first.</span>
                    ) : (
                      <span className="ml-1">This task will lock {formatCurrency(Number(paymentAmount) || 0)} in escrow.</span>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end pb-8">
                <Button 
                  type="submit" 
                  size="lg" 
                  disabled={createTask.isPending || isOverBudget}
                  data-testid="button-submit-task"
                >
                  {createTask.isPending ? "Posting..." : "Post Task & Escrow Funds"}
                </Button>
              </div>

            </form>
          </Form>
        </div>
      </SignedInLayout>
    </Protected>
  );
}

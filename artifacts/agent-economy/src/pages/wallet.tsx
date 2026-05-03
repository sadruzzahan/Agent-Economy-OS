import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import { useListMyWallets, useListWalletTransactions, useTopUpBalance, useGetMe, getGetMeQueryKey, getListMyWalletsQueryKey, getListWalletTransactionsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownRight, ArrowUpRight, Lock } from "lucide-react";

export default function Wallet() {
  const { data: wallets, isLoading: isLoadingWallets } = useListMyWallets();
  const [selectedWalletId, setSelectedWalletId] = useState<string>("all");
  
  const { data: transactions, isLoading: isLoadingTx } = useListWalletTransactions(
    selectedWalletId !== "all" ? { walletId: parseInt(selectedWalletId, 10) } : {}
  );

  return (
    <Protected>
      <SignedInLayout>
        <div className="space-y-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Wallets</h1>
              <p className="text-muted-foreground">Manage your posting balance and view agent earnings.</p>
            </div>
            <TopUpDialog />
          </div>

          {/* KPI Cards */}
          {isLoadingWallets ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : wallets ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="pt-6">
                  <div className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">User Posting Balance</div>
                  <div className="text-4xl font-bold text-primary" data-testid="text-posting-balance">
                    {formatCurrency(wallets.userWallet.balance)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Available for posting new tasks</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">Total Agent Earnings</div>
                  <div className="text-4xl font-bold text-foreground">
                    {formatCurrency(wallets.totalBalance - wallets.userWallet.balance)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Liquid balance across all agents</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Lock className="h-4 w-4 text-amber-500" />
                    <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Escrowed</div>
                  </div>
                  <div className="text-4xl font-bold text-amber-600 dark:text-amber-500">
                    {formatCurrency(wallets.totalEscrowed)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Funds locked in active tasks</p>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="grid lg:grid-cols-4 gap-8">
            {/* Agent Wallets Sidebar */}
            <div className="lg:col-span-1 space-y-4">
              <h3 className="font-semibold text-lg">Agent Wallets</h3>
              {isLoadingWallets ? (
                <div className="space-y-3">
                  {[1, 2].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
              ) : !wallets?.agentWallets.length ? (
                <div className="text-sm text-muted-foreground italic bg-muted/30 p-4 rounded-md border border-border">
                  No agents created yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {wallets.agentWallets.map(w => (
                    <Card key={w.id} className="bg-card shadow-sm cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedWalletId(String(w.id))}>
                      <CardContent className="p-4 flex justify-between items-center">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{w.agentName}</p>
                          <p className="text-xs text-muted-foreground mt-1">Earned: {formatCurrency(w.totalEarned)}</p>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <p className="font-bold text-green-600">{formatCurrency(w.balance)}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Transactions Table */}
            <div className="lg:col-span-3 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-lg">Transaction History</h3>
                <div className="w-48">
                  <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filter by wallet" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Wallets</SelectItem>
                      {wallets?.userWallet && <SelectItem value={String(wallets.userWallet.id)}>My Account</SelectItem>}
                      {wallets?.agentWallets.map(w => (
                        <SelectItem key={w.id} value={String(w.id)}>Agent: {w.agentName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Wallet</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingTx ? (
                      [...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        </TableRow>
                      ))
                    ) : !transactions || transactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No transactions found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      transactions.map((tx) => {
                        // Direction logic
                        const isPositive = ['top_up', 'credit', 'escrow_release', 'escrow_return'].includes(tx.type);
                        const isEscrow = ['escrow_lock', 'escrow_release'].includes(tx.type);
                        
                        return (
                          <TableRow key={tx.id}>
                            <TableCell>
                              <Badge variant="outline" className={`capitalize ${isEscrow ? 'border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-400' : ''}`}>
                                {tx.type.replace('_', ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {tx.kind === 'user' ? (
                                <span className="font-medium">User Account</span>
                              ) : (
                                <span className="text-primary font-medium">{tx.agentName}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm">{tx.description}</span>
                              {tx.relatedTaskId && (
                                <Link href={`/tasks/${tx.relatedTaskId}`} className="block text-xs text-primary hover:underline mt-1">
                                  Task: {tx.relatedTaskTitle || `#${tx.relatedTaskId}`}
                                </Link>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              <span className={`flex items-center justify-end gap-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                {formatCurrency(tx.amount)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {formatCurrency(tx.balanceAfter)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDate(tx.createdAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </Card>
            </div>
          </div>
        </div>
      </SignedInLayout>
    </Protected>
  );
}

function TopUpDialog() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("100");
  const topUp = useTopUpBalance();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleTopUp = () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return;

    topUp.mutate(
      { data: { amount: val } },
      {
        onSuccess: () => {
          toast({ title: "Balance topped up successfully" });
          setOpen(false);
          queryClient.invalidateQueries({ queryKey: getListMyWalletsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
        },
        onError: (err) => toast({ title: "Failed to top up", description: err.data?.error, variant: "destructive" })
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" data-testid="button-open-topup">Deposit Funds</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Top Up Balance</DialogTitle>
          <DialogDescription>
            Simulate depositing USD into your posting wallet to fund tasks.
          </DialogDescription>
        </DialogHeader>
        <div className="py-6 space-y-4">
          <div className="space-y-2">
            <Label>Amount (USD)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input 
                type="number" 
                min="1" 
                step="10" 
                value={amount} 
                onChange={(e) => setAmount(e.target.value)} 
                className="pl-7 text-lg font-medium"
                data-testid="input-topup-amount"
              />
            </div>
          </div>
          <div className="flex gap-2">
            {[50, 100, 500, 1000].map(val => (
              <Button key={val} type="button" variant="outline" className="flex-1" onClick={() => setAmount(String(val))}>
                ${val}
              </Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleTopUp} disabled={topUp.isPending} className="w-full" data-testid="button-submit-topup">
            {topUp.isPending ? "Processing..." : `Deposit $${amount}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

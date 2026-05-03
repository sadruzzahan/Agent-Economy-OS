import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import {
  useListMyWallets,
  useListWalletTransactions,
  useCreateCheckoutSession,
  useRequestPayout,
  useStartConnectOnboarding,
  useGetConnectStatus,
  getListMyWalletsQueryKey,
  getGetMeQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import type { Wallet as WalletDto, WalletTransaction } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowDownRight,
  ArrowUpRight,
  Lock,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { isStripeStubMode } from "@/lib/env";

/** Transaction types that increase wallet balance for display purposes. */
const POSITIVE_TX_TYPES = new Set([
  "top_up",
  "credit",
  "escrow_release",
  "escrow_return",
  "refund",
]);
const ESCROW_TX_TYPES = new Set(["escrow_lock", "escrow_release"]);

export default function Wallet() {
  const { data: wallets, isLoading: isLoadingWallets } = useListMyWallets();
  const [selectedWalletId, setSelectedWalletId] = useState<string>("all");

  const { data: transactions, isLoading: isLoadingTx } =
    useListWalletTransactions(
      selectedWalletId !== "all"
        ? { walletId: parseInt(selectedWalletId, 10) }
        : {},
    );

  return (
    <Protected>
      <SignedInLayout>
        <div className="space-y-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Wallets</h1>
              <p className="text-muted-foreground">
                Top up via Stripe Checkout, then withdraw agent earnings to
                your connected bank account.
              </p>
              {isStripeStubMode() && <StubModeBadge />}
            </div>
            <CheckoutButton />
          </div>

          <ConnectStatusCard />

          {isLoadingWallets ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : wallets ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="pt-6">
                  <div className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    User Posting Balance
                  </div>
                  <div
                    className="text-4xl font-bold text-primary"
                    data-testid="text-posting-balance"
                  >
                    {formatCurrency(wallets.userWallet?.balance ?? 0)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Available for posting new tasks
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                    Total Agent Earnings
                  </div>
                  <div className="text-4xl font-bold text-foreground">
                    {formatCurrency(
                      wallets.totalBalance - (wallets.userWallet?.balance ?? 0),
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Liquid balance across all agents
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Lock className="h-4 w-4 text-amber-500" />
                    <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                      Total Escrowed
                    </div>
                  </div>
                  <div className="text-4xl font-bold text-amber-600 dark:text-amber-500">
                    {formatCurrency(wallets.totalEscrowed)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Funds locked in active tasks
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="grid lg:grid-cols-4 gap-8">
            <div className="lg:col-span-1 space-y-4">
              <h3 className="font-semibold text-lg">Agent Wallets</h3>
              {isLoadingWallets ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : !wallets?.agentWallets.length ? (
                <div className="text-sm text-muted-foreground italic bg-muted/30 p-4 rounded-md border border-border">
                  No agents created yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {wallets.agentWallets.map((w) => (
                    <AgentWalletCard
                      key={w.id}
                      wallet={w}
                      onSelect={() => setSelectedWalletId(String(w.id))}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-3 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-lg">Transaction History</h3>
                <div className="w-48">
                  <Select
                    value={selectedWalletId}
                    onValueChange={setSelectedWalletId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Filter by wallet" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Wallets</SelectItem>
                      {wallets?.userWallet && (
                        <SelectItem value={String(wallets.userWallet.id)}>
                          My Account
                        </SelectItem>
                      )}
                      {wallets?.agentWallets.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          Agent: {w.agentName}
                        </SelectItem>
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
                          <TableCell>
                            <Skeleton className="h-6 w-20" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-48" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-16 ml-auto" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-16 ml-auto" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : !transactions || transactions.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No transactions found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      transactions.map((tx) => (
                        <TransactionRow key={tx.id} tx={tx} />
                      ))
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

function StubModeBadge() {
  return (
    <Badge
      variant="outline"
      className="mt-2 border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
      data-testid="badge-stripe-stub"
    >
      <AlertTriangle className="h-3 w-3 mr-1" /> Stripe stub mode — no real
      money is being moved.
    </Badge>
  );
}

function TransactionRow({ tx }: { tx: WalletTransaction }) {
  const isPositive = POSITIVE_TX_TYPES.has(tx.type);
  const isEscrow = ESCROW_TX_TYPES.has(tx.type);

  return (
    <TableRow data-testid={`row-tx-${tx.id}`}>
      <TableCell>
        <Badge
          variant="outline"
          className={`capitalize ${
            isEscrow
              ? "border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-400"
              : ""
          }`}
        >
          {tx.type.replace(/_/g, " ")}
        </Badge>
        {tx.externalStatus && (
          <div className="text-[10px] uppercase text-muted-foreground mt-1">
            {tx.externalStatus}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {tx.kind === "user" ? (
          <span className="font-medium">User Account</span>
        ) : (
          <span className="text-primary font-medium">{tx.agentName}</span>
        )}
      </TableCell>
      <TableCell>
        <span className="text-sm">{tx.description}</span>
        {tx.relatedTaskId && (
          <Link
            href={`/tasks/${tx.relatedTaskId}`}
            className="block text-xs text-primary hover:underline mt-1"
          >
            Task: {tx.relatedTaskTitle || `#${tx.relatedTaskId}`}
          </Link>
        )}
      </TableCell>
      <TableCell className="text-right font-medium">
        <span
          className={`flex items-center justify-end gap-1 ${
            isPositive ? "text-green-600" : "text-red-600"
          }`}
        >
          {isPositive ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : (
            <ArrowDownRight className="h-3 w-3" />
          )}
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
}

function AgentWalletCard({
  wallet,
  onSelect,
}: {
  wallet: WalletDto;
  onSelect: () => void;
}) {
  return (
    <Card
      className="bg-card shadow-sm hover:border-primary/50 transition-colors"
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex justify-between items-center">
          <div className="min-w-0 flex-1 cursor-pointer">
            <p className="font-medium text-sm truncate">{wallet.agentName}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Earned: {formatCurrency(wallet.totalEarned)}
            </p>
          </div>
          <div className="text-right shrink-0 ml-4">
            <p className="font-bold text-green-600">
              {formatCurrency(wallet.balance)}
            </p>
          </div>
        </div>
        <PayoutDialog wallet={wallet} />
      </CardContent>
    </Card>
  );
}

function CheckoutButton() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("100");
  const checkout = useCreateCheckoutSession();
  const { toast } = useToast();

  const handleCheckout = () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      toast({ title: "Enter a valid USD amount", variant: "destructive" });
      return;
    }
    checkout.mutate(
      { data: { amount: val } },
      {
        onSuccess: (data) => {
          // Stripe-hosted Checkout — full-page redirect, do NOT open
          // in a popup (gets blocked) and do NOT trust this for the
          // actual credit; the webhook is the source of truth.
          window.location.href = data.url;
        },
        onError: (err) =>
          toast({
            title: "Failed to start checkout",
            description: (err as { data?: { error?: string } }).data?.error,
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" data-testid="button-open-topup">
          Add funds
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Top up via Stripe</DialogTitle>
          <DialogDescription>
            You'll be redirected to a secure Stripe Checkout page to complete
            payment. Your wallet credits as soon as Stripe confirms the
            payment.
          </DialogDescription>
        </DialogHeader>
        <div className="py-6 space-y-4">
          <div className="space-y-2">
            <Label>Amount (USD)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
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
            {[50, 100, 500, 1000].map((val) => (
              <Button
                key={val}
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setAmount(String(val))}
              >
                ${val}
              </Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleCheckout}
            disabled={checkout.isPending}
            className="w-full"
            data-testid="button-submit-topup"
          >
            {checkout.isPending ? "Redirecting…" : `Continue to Stripe — $${amount}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayoutDialog({ wallet }: { wallet: WalletDto }) {
  const [open, setOpen] = useState(false);
  const max = Number(wallet.balance) || 0;
  const [amount, setAmount] = useState(String(max));
  const payout = useRequestPayout();
  const { data: connectStatus } = useGetConnectStatus();
  const { toast } = useToast();
  const qc = useQueryClient();

  const canPayout = Boolean(connectStatus?.payoutsEnabled);

  const handlePayout = () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      toast({ title: "Enter a valid USD amount", variant: "destructive" });
      return;
    }
    if (val > max) {
      toast({
        title: "Amount exceeds available balance",
        variant: "destructive",
      });
      return;
    }
    payout.mutate(
      { data: { walletId: wallet.id, amount: val } },
      {
        onSuccess: (data) => {
          toast({
            title: "Payout requested",
            description: `Stripe payout ${data.payoutId} (${data.status})${data.stub ? " — stub mode" : ""}`,
          });
          setOpen(false);
          qc.invalidateQueries({ queryKey: getListMyWalletsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
          qc.invalidateQueries({
            queryKey: getListWalletTransactionsQueryKey(),
          });
        },
        onError: (err) =>
          toast({
            title: "Payout failed",
            description: (err as { data?: { error?: string } }).data?.error,
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="w-full mt-2 text-xs"
          disabled={max <= 0}
          onClick={(e) => e.stopPropagation()}
          data-testid={`button-payout-${wallet.id}`}
        >
          Withdraw to bank
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Withdraw from {wallet.agentName}</DialogTitle>
          <DialogDescription>
            {canPayout
              ? "Funds are sent to the bank account linked through Stripe Connect."
              : "You must finish Stripe Connect onboarding before you can receive payouts."}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <div className="space-y-2">
            <Label>Amount (USD, max {formatCurrency(max)})</Label>
            <Input
              type="number"
              min="1"
              max={max}
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid={`input-payout-amount-${wallet.id}`}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handlePayout}
            disabled={payout.isPending || !canPayout}
            className="w-full"
            data-testid={`button-submit-payout-${wallet.id}`}
          >
            {payout.isPending ? "Submitting…" : "Request payout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectStatusCard() {
  const { data: status, isLoading } = useGetConnectStatus();
  const onboard = useStartConnectOnboarding();
  const { toast } = useToast();

  if (isLoading || !status) return null;

  const startOnboarding = () => {
    onboard.mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.onboardingUrl;
      },
      onError: (err) =>
        toast({
          title: "Failed to start onboarding",
          description: (err as { data?: { error?: string } }).data?.error,
          variant: "destructive",
        }),
    });
  };

  if (status.status === "verified") {
    return (
      <Card className="border-green-200 bg-green-50 dark:bg-green-950/30">
        <CardContent className="py-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <div className="flex-1">
            <p className="font-medium text-sm">
              Stripe Connect: payouts enabled
            </p>
            <p className="text-xs text-muted-foreground">
              Account {status.accountId}
              {status.stub ? " (stub)" : ""}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/30">
      <CardContent className="py-4 flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600" />
        <div className="flex-1">
          <p className="font-medium text-sm">
            Stripe Connect status:{" "}
            <span className="capitalize">{status.status}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {status.requirementsCurrentlyDue.length > 0
              ? `Outstanding: ${status.requirementsCurrentlyDue.join(", ")}`
              : "Finish onboarding to receive agent earnings as real bank payouts."}
          </p>
        </div>
        <Button
          size="sm"
          onClick={startOnboarding}
          disabled={onboard.isPending}
          data-testid="button-connect-onboard"
        >
          {onboard.isPending ? "Loading…" : "Continue setup"}
          <ExternalLink className="h-3 w-3 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}

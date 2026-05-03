import { useEffect } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryKey,
  getListMyWalletsQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

/**
 * Stripe redirects the user back here after a successful Checkout
 * session. The actual wallet credit happens in the webhook, NOT on
 * this page — but webhooks usually arrive within a second or two, so
 * we aggressively invalidate the wallet/me queries and let polling
 * refetch the new balance. Worst case, the user reloads.
 */
export default function WalletSuccess() {
  const qc = useQueryClient();

  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      qc.invalidateQueries({ queryKey: getListMyWalletsQueryKey() });
      qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
    };
    refresh();
    // Webhook delivery isn't strictly synchronous; a couple of polls
    // covers the typical Stripe-test-mode latency.
    const t1 = setTimeout(refresh, 1500);
    const t2 = setTimeout(refresh, 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [qc]);

  return (
    <Protected>
      <SignedInLayout>
        <div className="max-w-lg mx-auto pt-16">
          <Card>
            <CardContent className="pt-8 text-center space-y-4">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
              <h1 className="text-2xl font-bold">Payment received</h1>
              <p className="text-muted-foreground">
                Your top-up is being credited to your wallet. It usually
                appears within a few seconds.
              </p>
              <div className="flex gap-3 justify-center pt-4">
                <Link href="/wallet">
                  <Button data-testid="button-back-to-wallet">
                    Back to wallet
                  </Button>
                </Link>
                <Link href="/tasks/new">
                  <Button variant="outline">Post a task</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </SignedInLayout>
    </Protected>
  );
}

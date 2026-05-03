import { Link } from "wouter";
import { Protected } from "@/components/protected-route";
import { SignedInLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle } from "lucide-react";

export default function WalletCancel() {
  return (
    <Protected>
      <SignedInLayout>
        <div className="max-w-lg mx-auto pt-16">
          <Card>
            <CardContent className="pt-8 text-center space-y-4">
              <XCircle className="h-16 w-16 text-muted-foreground mx-auto" />
              <h1 className="text-2xl font-bold">Checkout cancelled</h1>
              <p className="text-muted-foreground">
                No payment was made. You can try again any time.
              </p>
              <div className="flex gap-3 justify-center pt-4">
                <Link href="/wallet">
                  <Button data-testid="button-back-to-wallet">
                    Back to wallet
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </SignedInLayout>
    </Protected>
  );
}

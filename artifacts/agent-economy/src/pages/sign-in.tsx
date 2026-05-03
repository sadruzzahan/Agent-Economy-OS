import { SignIn } from "@clerk/react";
import { PublicLayout } from "@/components/layout";

import { getBasePath } from "@/lib/env";
const basePath = getBasePath();

export default function SignInPage() {
  return (
    <PublicLayout>
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-4">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </PublicLayout>
  );
}

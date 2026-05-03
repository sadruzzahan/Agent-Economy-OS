import { SignUp } from "@clerk/react";
import { PublicLayout } from "@/components/layout";

import { getBasePath } from "@/lib/env";
const basePath = getBasePath();

export default function SignUpPage() {
  return (
    <PublicLayout>
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-4">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </PublicLayout>
  );
}

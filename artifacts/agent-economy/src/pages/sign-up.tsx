import { SignUp } from "@clerk/react";
import { PublicLayout } from "@/components/layout";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignUpPage() {
  return (
    <PublicLayout>
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-4">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </PublicLayout>
  );
}

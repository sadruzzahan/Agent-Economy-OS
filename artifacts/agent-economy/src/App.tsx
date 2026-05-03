import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, useClerk } from "@clerk/react";
import { shadesOfPurple } from "@clerk/themes";
import { useEffect } from "react";
import { publishableKeyFromHost } from "@/lib/clerk";
import { getClerkPublishableKey, getClerkProxyUrl } from "@/lib/env";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import Home from "@/pages/home";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import Dashboard from "@/pages/dashboard";
import AgentsList from "@/pages/agents/index";
import MyAgents from "@/pages/agents/mine";
import NewAgent from "@/pages/agents/new";
import AgentProfile from "@/pages/agents/[id]";
import EditAgent from "@/pages/agents/edit";
import TasksList from "@/pages/tasks/index";
import NewTask from "@/pages/tasks/new";
import MyTasks from "@/pages/tasks/mine";
import TaskDetail from "@/pages/tasks/[id]";
import Wallet from "@/pages/wallet";
import Leaderboard from "@/pages/leaderboard";
import DocsPage from "@/pages/docs";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ClerkQueryClientCacheInvalidator() {
  const clerk = useClerk();
  const qc = useQueryClient();
  
  useEffect(() => {
    return clerk.addListener((state) => {
      if (!state.user) {
        qc.clear();
      }
    });
  }, [clerk, qc]);

  return null;
}

import { getBasePath } from "@/lib/env";
const basePath = getBasePath();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/agents" component={AgentsList} />
      <Route path="/agents/mine" component={MyAgents} />
      <Route path="/agents/new" component={NewAgent} />
      <Route path="/agents/:id/edit" component={EditAgent} />
      <Route path="/agents/:id" component={AgentProfile} />
      <Route path="/tasks" component={TasksList} />
      <Route path="/tasks/new" component={NewTask} />
      <Route path="/tasks/mine" component={MyTasks} />
      <Route path="/tasks/:id" component={TaskDetail} />
      <Route path="/wallet" component={Wallet} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/docs" component={DocsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRouting({ children }: { children: React.ReactNode }) {
  const clerkPubKey = publishableKeyFromHost(window.location.hostname, getClerkPublishableKey());
  const [location, setLocation] = useLocation();

  const stripBase = (path: string) => path.replace(new RegExp(`^${basePath}`), "") || "/";
  
  const routerPush = (to: string) => {
    setLocation(stripBase(to), { replace: false });
  };
  const routerReplace = (to: string) => {
    setLocation(stripBase(to), { replace: true });
  };

  return (
    <ClerkProvider 
      publishableKey={clerkPubKey}
      proxyUrl={getClerkProxyUrl()}
      routerPush={routerPush}
      routerReplace={routerReplace}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      appearance={{
        layout: {
          logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
          logoPlacement: "inside",
        },
        elements: {
          cardBox: "w-[440px] max-w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-lg",
          card: "!bg-transparent !shadow-none !border-0 !rounded-none",
          headerTitle: "text-2xl font-bold text-zinc-900 dark:text-zinc-50",
          headerSubtitle: "text-sm text-zinc-500 dark:text-zinc-400",
          socialButtonsBlockButtonText: "text-sm font-medium text-zinc-900 dark:text-zinc-50",
          formFieldLabel: "text-sm font-medium text-zinc-900 dark:text-zinc-50",
          footerActionLink: "text-sm font-medium text-zinc-900 dark:text-zinc-50 hover:underline",
          footerActionText: "text-sm text-zinc-500 dark:text-zinc-400",
          dividerText: "text-sm text-zinc-500 dark:text-zinc-400",
          identityPreviewEditButton: "text-sm font-medium text-zinc-900 dark:text-zinc-50 hover:underline",
          formButtonPrimary: "bg-zinc-900 hover:bg-zinc-800 text-zinc-50 dark:bg-zinc-50 dark:hover:bg-zinc-200 dark:text-zinc-900 font-medium py-2 px-4 rounded-md",
          formFieldInput: "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-50 rounded-md px-3 py-2",
          footerAction: "!bg-transparent !shadow-none !border-0 !rounded-none",
          dividerLine: "bg-zinc-200 dark:bg-zinc-800",
          alert: "bg-red-50 text-red-900 border border-red-200 dark:bg-red-900/20 dark:text-red-200 dark:border-red-900/50 rounded-md",
          otpCodeFieldInput: "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-50 rounded-md",
          logoBox: "flex justify-center mb-4",
          logoImage: "h-8 w-auto",
          socialButtonsBlockButton: "border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded-md py-2 px-4 flex items-center justify-center gap-2 transition-colors",
          formFieldRow: "mb-4",
          main: "gap-6",
          alertText: "text-sm",
          formFieldSuccessText: "text-sm text-green-600 dark:text-green-400"
        },
        variables: {
          colorPrimary: "hsl(var(--primary))",
          colorForeground: "hsl(var(--foreground))",
          colorMutedForeground: "hsl(var(--muted-foreground))",
          colorBackground: "hsl(var(--background))",
          colorInput: "hsl(var(--input))",
          colorInputForeground: "hsl(var(--foreground))",
          colorNeutral: "hsl(var(--border))",
          colorDanger: "hsl(var(--destructive))",
          fontFamily: "var(--font-sans)",
          borderRadius: "0.375rem"
        }
      }}
      localization={{
        signIn: {
          start: {
            title: "Sign in to Agent Economy",
            subtitle: "Manage your fleet and tasks",
          }
        },
        signUp: {
          start: {
            title: "Join Agent Economy",
            subtitle: "Create your account to start participating",
          }
        }
      }}
    >
      {children}
    </ClerkProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ClerkProviderWithRouting>
            <ClerkQueryClientCacheInvalidator />
            <Router />
          </ClerkProviderWithRouting>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

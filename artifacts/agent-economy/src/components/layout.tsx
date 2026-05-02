import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  Bot,
  PlusCircle,
  Briefcase,
  ListTodo,
  FilePlus2,
  Wallet,
  Trophy,
  LogOut,
} from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LayoutProps {
  children: React.ReactNode;
}

export function PublicLayout({ children }: LayoutProps) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src={`${basePath}/logo.svg`} alt="Logo" className="h-6 w-6" />
            <span className="font-bold text-foreground">Agent Economy OS</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Button variant="ghost" asChild>
              <a href={`${basePath}/sign-in`}>Sign in</a>
            </Button>
            <Button asChild>
              <a href={`${basePath}/sign-up`}>Sign up</a>
            </Button>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Browse Agents", icon: Users },
  { href: "/agents/mine", label: "My Agents", icon: Bot },
  { href: "/agents/new", label: "New Agent", icon: PlusCircle },
  { href: "/tasks", label: "Task Market", icon: Briefcase },
  { href: "/tasks/mine", label: "My Tasks", icon: ListTodo },
  { href: "/tasks/new", label: "New Task", icon: FilePlus2 },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
];

export function SignedInLayout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();

  return (
    <div className="flex min-h-[100dvh] bg-background">
      <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex">
        <div className="h-14 flex items-center px-4 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-2">
            <img src={`${basePath}/logo.svg`} alt="Logo" className="h-6 w-6" />
            <span className="font-bold text-foreground truncate">Agent Economy OS</span>
          </Link>
        </div>
        
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-2">
            {navItems.map((item) => {
              const isActive = location === item.href || location.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-3 px-2 py-6 h-auto hover:bg-muted"
                data-testid="user-menu-trigger"
              >
                <Avatar className="h-8 w-8 border border-border">
                  <AvatarImage src={user?.imageUrl} />
                  <AvatarFallback>{user?.firstName?.charAt(0) || "U"}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start truncate">
                  <span className="text-sm font-medium leading-none truncate w-full">
                    {user?.fullName || "User"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate w-full">
                    {user?.primaryEmailAddress?.emailAddress}
                  </span>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => signOut()}
                className="text-destructive cursor-pointer"
                data-testid="user-menu-signout"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

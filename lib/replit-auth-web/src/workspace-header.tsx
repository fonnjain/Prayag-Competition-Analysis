import { useState } from "react";
import { useAuth } from "./auth-context";

type IconProps = { className?: string; strokeWidth?: number };
type HeaderIcon = (props: IconProps) => React.JSX.Element;

function IconFrame({
  children,
  className,
  strokeWidth = 2,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const HomeIcon: HeaderIcon = (props) => (
  <IconFrame {...props}>
    <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />
  </IconFrame>
);

const ProductIcon: HeaderIcon = (props) => (
  <IconFrame {...props}>
    <path d="m12 3 8 4.5-8 4.5-8-4.5Z" />
    <path d="M4 12.5 12 17l8-4.5M4 17l8 4.5 8-4.5" />
  </IconFrame>
);

const AnalysisIcon: HeaderIcon = (props) => (
  <IconFrame {...props}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </IconFrame>
);

const SearchIcon: HeaderIcon = (props) => (
  <IconFrame {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </IconFrame>
);

const UsersIcon: HeaderIcon = (props) => (
  <IconFrame {...props}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20c.6-3.5 2.5-5.5 6-5.5s5.4 2 6 5.5M16 5.5a3 3 0 0 1 0 5M18 14.5c2.1.6 3 2.3 3.4 4.5" />
  </IconFrame>
);

const HexagonIcon: HeaderIcon = (props) => (
  <IconFrame {...props}>
    <path d="m7 3 5-2 5 2 4 5v8l-4 5-5 2-5-2-4-5V8Z" />
  </IconFrame>
);

const LogOutIcon: HeaderIcon = (props) => (
  <IconFrame {...props}>
    <path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 16l4-4-4-4M18 12H8" />
  </IconFrame>
);

const MenuIcon: HeaderIcon = (props) => (
  <IconFrame {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </IconFrame>
);

const CloseIcon: HeaderIcon = (props) => (
  <IconFrame {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </IconFrame>
);

export type WorkspaceApp =
  | "home"
  | "product-database"
  | "competition-analysis"
  | "price-finder"
  | "admin";

type WorkspaceLink = {
  app: WorkspaceApp;
  href: string;
  label: string;
  icon: HeaderIcon;
  adminOnly?: boolean;
  restrictedAllowed: boolean;
};

const WORKSPACE_LINKS: WorkspaceLink[] = [
  { app: "home", href: "/", label: "Home", icon: HomeIcon, restrictedAllowed: false },
  {
    app: "product-database",
    href: "/product-db/",
    label: "Product Database",
    icon: ProductIcon,
    restrictedAllowed: false,
  },
  {
    app: "competition-analysis",
    href: "/analysis/",
    label: "Competition Analysis",
    icon: AnalysisIcon,
    restrictedAllowed: false,
  },
  {
    app: "price-finder",
    href: "/price-finder/",
    label: "Price Finder",
    icon: SearchIcon,
    restrictedAllowed: true,
  },
  {
    app: "admin",
    href: "/admin",
    label: "Admin",
    icon: UsersIcon,
    adminOnly: true,
    restrictedAllowed: false,
  },
];

export function WorkspaceHeader({ activeApp }: { activeApp: WorkspaceApp }) {
  const { user, logout, isAuthenticated, isLoading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = user?.role === "admin";
  const isRestrictedAccount = user?.role === "counter" || user?.role === "user";
  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "User";
  const visibleLinks = isLoading
    ? []
    : WORKSPACE_LINKS.filter(
        (link) =>
          (!link.adminOnly || isAdmin) && (!isRestrictedAccount || link.restrictedAllowed),
      );

  const navigation = (mobile = false) => (
    <nav
      id={mobile ? "workspace-mobile-navigation" : undefined}
      className={
        mobile
          ? "flex flex-col gap-1 border-t bg-card px-4 pb-3 pt-2 md:hidden"
          : "hidden items-center gap-1 md:flex"
      }
      aria-label="Workspace navigation"
    >
      {visibleLinks.map((link) => {
        const Icon = link.icon;
        const active = link.app === activeApp;

        return (
          <a
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            onClick={() => mobile && setMenuOpen(false)}
            className={[
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] focus-visible:ring-offset-1",
              active
                ? "bg-[#0f766e]/10 text-[#0f766e]"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
            {link.label}
          </a>
        );
      })}
    </nav>
  );

  return (
    <header className="sticky top-0 z-50 border-b bg-card text-card-foreground shadow-sm">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between px-4">
        <a
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
          aria-label="Prayag workspace home"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0f766e] shadow-sm">
            <HexagonIcon className="h-4 w-4 text-white" strokeWidth={2} />
          </span>
          <span className="leading-none">
            <span className="block text-sm font-bold text-foreground">Prayag</span>
            <span className="block text-[10px] text-muted-foreground">
              Pricing workspace
            </span>
          </span>
        </a>

        {navigation()}

        <div className="flex items-center gap-2">
          {isAuthenticated && (
            <>
              <span className="hidden text-sm text-muted-foreground sm:block">
                {userName}
              </span>
              <button
                type="button"
                onClick={logout}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
              >
                <LogOutIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </>
          )}
          <button
            type="button"
            className="flex items-center justify-center rounded-md p-1.5 text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] md:hidden"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls="workspace-mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && navigation(true)}
    </header>
  );
}
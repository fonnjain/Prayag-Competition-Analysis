import React, { useState } from "react";
import { useLocation, Link } from "wouter";
import {
  Hexagon,
  Home,
  LogOut,
  Menu,
  Users,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useAuth, WorkspaceHeader, useWorkspaceNavigation } from "@workspace/replit-auth-web";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const appLinks = useWorkspaceNavigation("home");
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const isAdmin = user?.role === "admin";
  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "User";

  const HOME_NAV = [
    { path: "/", label: "Home", icon: Home },
    ...(isAdmin ? [{ path: "/admin", label: "User Management", icon: Users }] : []),
  ];

  function SidebarContent({ onNavClick, mobile = false }: { onNavClick?: () => void; mobile?: boolean }) {
    const collapsed = !mobile && isCollapsed;
    
    return (
      <div className="flex flex-col h-full">
        {/* Brand */}
        <div className={cn("flex items-center h-14 border-b shrink-0", collapsed ? "justify-center px-0" : "gap-2.5 px-4")}>
          <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center shadow-sm shrink-0">
            <Hexagon className="w-4 h-4 text-white" strokeWidth={2} />
          </div>
          {!collapsed && (
            <div className="leading-none min-w-0">
              <span className="font-bold text-sm text-foreground">Prayag</span>
              <span className="text-[10px] text-muted-foreground block">
                Operations Hub
              </span>
            </div>
          )}
        </div>

        {/* Context label */}
        <div className="px-4 pt-4 pb-2">
          {!collapsed && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
              Workspace
            </p>
          )}
        </div>

        {/* In-app nav */}
        <nav className="px-3 flex flex-col gap-0.5 flex-1" aria-label="Home navigation">
          {HOME_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;
            const content = (
              <Link
                key={item.path}
                href={item.path}
                onClick={onNavClick}
                className={cn(
                  "flex items-center rounded-md text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  collapsed ? "justify-center py-2 px-0" : "gap-2.5 px-3 py-2 font-medium",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                aria-label={collapsed ? item.label : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.path} delayDuration={0}>
                  <TooltipTrigger asChild>{content}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={14}>{item.label}</TooltipContent>
                </Tooltip>
              );
            }
            return content;
          })}
        </nav>

        {/* App switcher */}
        <div className="px-3 pb-3 pt-2 border-t mt-2">
          {!collapsed && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1.5">
              Switch app
            </p>
          )}
          {appLinks.map((app) => {
            const Icon = app.icon;
            const content = (
              <a
                key={app.href}
                href={app.href}
                aria-current={app.active ? "page" : undefined}
                onClick={onNavClick}
                className={cn(
                  "flex items-center rounded-md text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary w-full",
                  collapsed ? "justify-center py-1.5 px-0" : "gap-2 px-3 py-1.5",
                  app.active
                    ? "text-primary font-medium bg-primary/5"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                aria-label={collapsed ? app.label : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{app.label}</span>}
                {!collapsed && app.active && (
                  <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide bg-primary/10 text-primary rounded px-1.5 py-0.5">
                    Active
                  </span>
                )}
              </a>
            );

            if (collapsed) {
              return (
                <Tooltip key={app.href} delayDuration={0}>
                  <TooltipTrigger asChild>{content}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={14}>{app.label}</TooltipContent>
                </Tooltip>
              );
            }
            return content;
          })}
        </div>

        {/* Collapse button */}
        {!mobile && (
          <div className="px-3 pb-3">
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={cn(
                "flex items-center rounded-md text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary w-full text-muted-foreground hover:text-foreground hover:bg-accent",
                collapsed ? "justify-center py-2 px-0" : "gap-2 px-3 py-2 font-medium"
              )}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeftOpen className="w-4 h-4 shrink-0" /> : <PanelLeftClose className="w-4 h-4 shrink-0" />}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        )}

        {/* User / logout */}
        <div className={cn("px-3 pb-3 pt-2 border-t flex items-center", collapsed ? "justify-center flex-col gap-2" : "gap-2")}>
          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 select-none">
            {userName.slice(0, 1).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{userName}</p>
            </div>
          )}
          <button
            onClick={logout}
            title={collapsed ? "Log out" : undefined}
            aria-label="Log out"
            className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <WorkspaceHeader activeApp="home" />
      <div className="flex min-h-[calc(100vh-3.5rem)] flex-1 overflow-hidden">
        {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
        <aside className={cn(
          "hidden md:flex flex-col border-r bg-card shrink-0 overflow-y-auto transition-all duration-300",
          isCollapsed ? "w-16" : "w-56"
        )}>
          <SidebarContent />
        </aside>

        {/* ── Mobile drawer backdrop ───────────────────────────────────────────── */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            aria-hidden="true"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* ── Mobile drawer ────────────────────────────────────────────────────── */}
        <aside
          id="mobile-nav-drawer"
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-64 bg-card border-r shadow-xl flex flex-col md:hidden transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
          aria-label="Navigation drawer"
        >
          <div className="flex items-center justify-between px-4 h-14 border-b shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
                <Hexagon className="w-3.5 h-3.5 text-white" strokeWidth={2} />
              </div>
              <span className="font-bold text-sm">Prayag</span>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarContent onNavClick={() => setMobileOpen(false)} mobile={true} />
          </div>
        </aside>

        {/* ── Main content area ────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Top bar for mobile */}
          <header className="md:hidden border-b bg-card flex items-center gap-3 px-4 h-14 shrink-0">
            <button
              className="flex items-center justify-center rounded-md p-1.5 text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-drawer"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-foreground truncate">
              {location === "/admin" ? "User Management" : "Home"}
            </span>
          </header>

          {/* Scrollable page content */}
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
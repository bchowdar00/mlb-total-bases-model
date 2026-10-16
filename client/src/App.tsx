import { Switch, Route, Router, Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";

import ProjectionsPage from "./pages/Projections";
import ResultsPage      from "./pages/Results";
import MethodologyPage  from "./pages/Methodology";

/* ── Vantage Edge V-Diamond mark ── */
function VMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      width={size}
      height={size}
      fill="none"
      aria-label="Vantage Edge"
      className={className}
    >
      {/* Outer V — champagne gold */}
      <path
        d="M3 7 L14 21 L25 7 L21.5 7 L14 17.5 L6.5 7 Z"
        fill="#C8A84B"
      />
      {/* Inner notch — creates the precision cut */}
      <path
        d="M9.5 7 L14 13.8 L18.5 7 L16 7 L14 10.5 L12 7 Z"
        fill="#0F1014"
      />
    </svg>
  );
}

function Nav() {
  const [loc] = useHashLocation();

  const links = [
    { href: "/",            label: "Projections" },
    { href: "/results",     label: "Results"     },
    { href: "/methodology", label: "Methodology" },
  ];

  return (
    <nav className="ve-nav-rule sticky top-0 z-50 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-5 flex items-center justify-between h-[52px]">

        {/* Wordmark */}
        <Link href="/" className="flex items-center gap-2.5 select-none">
          <VMark size={26} />
          <div className="flex items-baseline gap-1.5">
            <span className="font-bold text-sm tracking-tight text-foreground"
                  style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.025em" }}>
              VANTAGE
            </span>
            <span className="font-bold text-sm tracking-tight"
                  style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.025em", color: "var(--ve-gold)" }}>
              EDGE
            </span>
          </div>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-0.5">
          {links.map(({ href, label }) => {
            const active = href === "/" ? loc === "/" : loc.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`relative px-3.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                  active
                    ? "text-[var(--ve-gold)] bg-[var(--ve-gold-ghost)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
                style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}
              >
                {/* Active underline */}
                {active && (
                  <span
                    className="absolute bottom-0 left-3 right-3 h-[1.5px] rounded-full"
                    style={{ background: "var(--ve-gold-warm)" }}
                  />
                )}
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
      <VMark size={48} className="opacity-20" />
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">Page not found</p>
        <p className="text-xs text-muted-foreground mt-1">This page doesn't exist.</p>
      </div>
      <Link
        href="/"
        className="text-xs font-medium hover:underline"
        style={{ color: "var(--ve-gold)" }}
      >
        Back to projections →
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <div className="min-h-screen bg-background">
          <Nav />
          <main className="max-w-7xl mx-auto px-5 py-6">
            <Switch>
              <Route path="/"            component={ProjectionsPage} />
              <Route path="/results"     component={ResultsPage}     />
              <Route path="/methodology" component={MethodologyPage} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

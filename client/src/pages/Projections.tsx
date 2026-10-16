import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, AlertCircle, Clock, Target } from "lucide-react";
import { useGameSchedule, type GameInfo } from "@/lib/useLiveGame";

type Projection = {
  id: number;
  playerName: string;
  team: string;
  tbLine: number;
  probUnder: number;
  tier: string;
  slg2025: number | null;
  iso2025: number | null;
  kPct: number | null;
  bbPct: number | null;
  parkFactor: number | null;
  keySignals: string[];
  isDemo?: number | null;  // 1 = sample row inserted via /api/seed
};

/* ── Tier styling ────────────────────────────────────────────────── */
function tierStyle(tier: string) {
  switch (tier) {
    case "Elite":      return { bg: "rgba(200,168,75,0.09)",  text: "#C8A84B", border: "rgba(200,168,75,0.28)" };
    case "Very High":  return { bg: "rgba(37,99,235,0.09)",   text: "#6B9EF8", border: "rgba(37,99,235,0.28)"  };
    case "High":       return { bg: "rgba(22,166,121,0.09)",  text: "#16A679", border: "rgba(22,166,121,0.28)" };
    default:           return { bg: "rgba(158,163,175,0.09)", text: "#9EA3AF", border: "rgba(158,163,175,0.28)" };
  }
}

function tierLabel(tier: string) {
  return `◆ ${tier.toUpperCase()}`;
}

function scoreBarColor(score: number): string {
  if (score >= 0.80) return "linear-gradient(90deg, #B8973E, #C8A84B)";
  if (score >= 0.75) return "linear-gradient(90deg, #2563EB, #6B9EF8)";
  if (score >= 0.70) return "linear-gradient(90deg, #16A679, #34D399)";
  return "#404550";
}

/* ── Projection card ─────────────────────────────────────────────── */
function ProjectionCard({ p, rank }: { p: Projection; rank: number }) {
  const pct = Math.round(p.probUnder * 100);
  const ts  = tierStyle(p.tier);

  return (
    <div className="ve-card relative overflow-hidden" data-testid={`projection-card-${p.id}`}>
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{
          background: p.tier === "Elite" ? "var(--ve-gold-warm)"
            : p.tier === "Very High" ? "#2563EB"
            : p.tier === "High" ? "#16A679"
            : "var(--ve-steel)"
        }}
      />
      <div className="px-4 py-3.5 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="tabnum flex-shrink-0 text-xs font-semibold w-6 text-center"
              style={{ color: "var(--ve-smoke)", fontFamily: "'Space Grotesk', monospace" }}
            >
              #{rank}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm text-foreground truncate"
                   style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.01em" }}>
                  {p.playerName}
                </p>
                <span
                  className="text-[0.6rem] px-1.5 py-0.5 rounded font-bold tracking-wide flex-shrink-0 border"
                  style={{
                    background: ts.bg, color: ts.text, borderColor: ts.border,
                    fontFamily: "'Space Grotesk', monospace", letterSpacing: "0.06em",
                  }}
                >
                  {tierLabel(p.tier)}
                </span>
                {p.isDemo === 1 && (
                  <span
                    className="text-[0.55rem] px-1.5 py-0.5 rounded font-bold tracking-wide flex-shrink-0 border"
                    style={{
                      background: "rgba(200,168,75,0.12)", color: "var(--ve-gold)", borderColor: "var(--ve-gold)",
                      fontFamily: "'Space Grotesk', monospace", letterSpacing: "0.06em",
                    }}
                  >
                    DEMO
                  </span>
                )}
              </div>
              {p.team && (
                <div className="mt-0.5" style={{ fontSize: "0.65rem", color: "var(--ve-iron)" }}>
                  {p.team}
                </div>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 text-right">
            <div
              className="text-xl font-black tabnum leading-none"
              style={{
                color: pct >= 80 ? "var(--ve-gold)" : pct >= 75 ? "#6B9EF8" : "#16A679",
                fontFamily: "'Space Grotesk', monospace", letterSpacing: "-0.02em",
              }}
            >
              {pct}
            </div>
            <div className="text-[0.65rem] mt-0.5" style={{ color: "var(--ve-smoke)" }}>
              quiet-game score
            </div>
          </div>
        </div>

        <div className="mt-2.5 mb-2.5">
          <div className="w-full rounded-full h-[3px]" style={{ background: "var(--ve-steel)" }}>
            <div
              className="h-[3px] rounded-full transition-all"
              style={{ width: `${pct}%`, background: scoreBarColor(p.probUnder) }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {p.slg2025 != null && <span className="stat-chip">SLG <b>{p.slg2025.toFixed(3)}</b></span>}
          {p.iso2025 != null && <span className="stat-chip">ISO <b>{p.iso2025.toFixed(3)}</b></span>}
          {p.kPct != null && <span className="stat-chip">K% <b>{(p.kPct * 100).toFixed(1)}%</b></span>}
          {p.bbPct != null && <span className="stat-chip">BB% <b>{(p.bbPct * 100).toFixed(1)}%</b></span>}
          {p.parkFactor != null && p.parkFactor !== 1 && (
            <span className="stat-chip">PF <b>{p.parkFactor.toFixed(2)}</b></span>
          )}
        </div>

        {p.keySignals?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {p.keySignals.slice(0, 3).map((s, i) => (
              <span
                key={i}
                className="text-[0.65rem] px-1.5 py-0.5 rounded"
                style={{
                  background: "var(--ve-graphite)", color: "var(--ve-smoke)",
                  border: "1px solid var(--ve-steel)", fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="ve-card p-3.5">
      <p className="ve-label mb-1.5">{label}</p>
      <p
        className="tabnum text-xl font-black leading-none"
        style={{
          color: accent ? "var(--ve-gold)" : "var(--foreground)",
          fontFamily: "'Space Grotesk', monospace", letterSpacing: "-0.02em",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function SectionHeader({ label, color, count }: { label: string; color: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="h-[1.5px] w-5 rounded" style={{ background: color }} />
      <span
        className="text-xs font-bold tracking-widest"
        style={{ color, fontFamily: "'Space Grotesk', monospace", letterSpacing: "0.1em" }}
      >
        {label}
      </span>
      <span
        className="text-[0.6rem] px-1.5 py-0.5 rounded tabnum font-semibold"
        style={{ background: `${color}14`, color, fontFamily: "'Space Grotesk', monospace" }}
      >
        {count}
      </span>
      <div className="h-[1px] flex-1" style={{ background: `${color}22` }} />
    </div>
  );
}

/* ── Live MLB scoreboard ─────────────────────────────────────────── */
function Scoreboard() {
  const today = new Date().toISOString().split("T")[0];
  const { data } = useGameSchedule(today);
  const games: GameInfo[] = data?.games || [];
  if (!games.length) return null;

  return (
    <section>
      <SectionHeader label="Today's MLB Games" color="#6C7280" count={games.length} />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {games.map((g) => {
          const live = g.abstractGameState === "Live";
          const final = g.abstractGameState === "Final";
          return (
            <div key={g.gamePk} className="ve-card px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">{g.awayAbbr}</span>
                <span className="tabnum text-xs" style={{ color: "var(--ve-smoke)" }}>{g.awayScore ?? "–"}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-xs font-semibold text-foreground">{g.homeAbbr}</span>
                <span className="tabnum text-xs" style={{ color: "var(--ve-smoke)" }}>{g.homeScore ?? "–"}</span>
              </div>
              <div className="mt-1 text-[0.6rem]" style={{ color: live ? "var(--ve-loss)" : "var(--ve-iron)" }}>
                {live ? `LIVE · ${g.inningState ?? ""} ${g.inning ?? ""}`.trim() : final ? "FINAL" : g.status}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function ProjectionsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/predictions"],
    queryFn: () => apiRequest("GET", "/api/predictions").then((r) => r.json()),
    refetchInterval: 10 * 60 * 1000,
  });

  const refresh = useMutation({
    mutationFn: () => apiRequest("POST", "/api/refresh").then((r) => r.json()),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["/api/predictions"] });
      toast({
        title: res.error ? "Refresh issue" : "Projections recomputed.",
        description: res.error || `${res.predictionsCount} batters projected`,
      });
    },
    onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
  });

  const projections: Projection[] = data?.predictions || [];
  // Totals count real projections only; seeded demo rows are listed with a DEMO label.
  const real  = projections.filter((p) => p.isDemo !== 1);
  const hasDemo = real.length < projections.length;
  const elite = projections.filter((p) => p.tier === "Elite");
  const vhigh = projections.filter((p) => p.tier === "Very High");
  const high  = projections.filter((p) => p.tier === "High");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-5 w-[2px] rounded" style={{ background: "var(--ve-gold-warm)" }} />
            <h1
              className="text-lg font-black tracking-tight"
              style={{ fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.025em" }}
            >
              Total Bases Projections
            </h1>
          </div>
          <p className="text-xs ml-3.5" style={{ color: "var(--ve-smoke)" }}>
            Rule-based quiet-game score by batter · {data?.season ?? 2025} season profile · higher = more likely a quiet game (1 or fewer total bases)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.refreshedAt && (
            <span className="text-[0.65rem] flex items-center gap-1" style={{ color: "var(--ve-iron)" }}>
              <Clock className="w-3 h-3" />
              {new Date(data.refreshedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            data-testid="button-refresh"
            className="gap-1.5 h-7 text-xs border-[var(--ve-steel)] hover:border-[var(--ve-gold)] hover:text-[var(--ve-gold)]"
          >
            <RefreshCw className={`w-3 h-3 ${refresh.isPending ? "animate-spin" : ""}`} />
            {refresh.isPending ? "Recomputing…" : "Recompute"}
          </Button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Batters Projected" value={real.length} />
          <KpiCard label="Elite (≥80)"  value={real.filter((p) => p.tier === "Elite").length} accent />
          <KpiCard label="Very High (≥75)" value={real.filter((p) => p.tier === "Very High").length} />
          <KpiCard label="Season" value={data.season ?? "—"} />
        </div>
      )}

      {hasDemo && (
        <div className="flex items-center gap-2 rounded-md px-3.5 py-2.5"
             style={{ background: "rgba(200,168,75,0.10)", border: "1px solid rgba(200,168,75,0.35)" }}>
          <span className="text-[0.6rem] px-1.5 py-0.5 rounded font-bold border"
                style={{ color: "var(--ve-gold)", borderColor: "var(--ve-gold)", letterSpacing: "0.08em" }}>
            DEMO DATA
          </span>
          <span className="text-xs" style={{ color: "var(--ve-smoke)" }}>
            Rows marked DEMO were inserted via the seed route for demonstration. They are not computed projections and are left out of the totals above.
          </span>
        </div>
      )}

      <Scoreboard />

      {error && (
        <div className="ve-card p-4 flex items-center gap-2" style={{ borderColor: "var(--ve-loss)" }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--ve-loss)" }} />
          <span className="text-sm">Failed to load projections. Click Recompute to try again.</span>
        </div>
      )}

      {isLoading && (
        <div className="grid gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" style={{ background: "var(--ve-graphite)" }} />
          ))}
        </div>
      )}

      {!isLoading && !error && projections.length === 0 && (
        <div className="ve-card p-10 flex flex-col items-center text-center gap-3">
          <Target className="w-8 h-8 opacity-20" style={{ color: "var(--ve-gold)" }} />
          <div>
            <p className="font-semibold text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              No projections yet.
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--ve-smoke)" }}>
              The season dataset may be missing. Run <code>scripts/fetch_data.py</code>, then Recompute.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 mt-1" onClick={() => refresh.mutate()}>
            <RefreshCw className="w-3 h-3" /> Recompute
          </Button>
        </div>
      )}

      {elite.length > 0 && (
        <section>
          <SectionHeader label="Elite" color="#C8A84B" count={elite.length} />
          <div className="grid gap-2.5">
            {elite.map((p, i) => <ProjectionCard key={p.id} p={p} rank={i + 1} />)}
          </div>
        </section>
      )}

      {vhigh.length > 0 && (
        <section>
          <SectionHeader label="Very High" color="#6B9EF8" count={vhigh.length} />
          <div className="grid gap-2.5">
            {vhigh.map((p, i) => <ProjectionCard key={p.id} p={p} rank={elite.length + i + 1} />)}
          </div>
        </section>
      )}

      {high.length > 0 && (
        <section>
          <SectionHeader label="High" color="#16A679" count={high.length} />
          <div className="grid gap-2.5">
            {high.map((p, i) => (
              <ProjectionCard key={p.id} p={p} rank={elite.length + vhigh.length + i + 1} />
            ))}
          </div>
        </section>
      )}

      <p className="text-[0.65rem] text-center pb-4" style={{ color: "var(--ve-iron)" }}>
        Scores are a transparent heuristic ranking from season stats — not a prediction of any outcome or a calibrated probability.
      </p>
    </div>
  );
}

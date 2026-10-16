import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Target, Zap, Calendar, ChevronDown, ChevronUp } from "lucide-react";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const VE = {
  carbon:    "#0F1014",
  graphite:  "#181A20",
  steel:     "#252830",
  gold:      "#C8A84B",
  goldGhost: "rgba(200,168,75,0.07)",
  goldHover: "rgba(200,168,75,0.25)",
  chalk:     "#D4D8E0",
  smoke:     "#6C7280",
  iron:      "#404550",
  emerald:   "#16A679",
  red:       "#DC3545",
  blue:      "#2563EB",
} as const;

const cardBase: React.CSSProperties = {
  background: VE.graphite,
  border: `1px solid ${VE.steel}`,
  borderRadius: 6,
  transition: "border-color 0.2s",
};

const labelStyle: React.CSSProperties = {
  fontFamily: "'Space Grotesk', monospace",
  fontVariantNumeric: "tabular-nums",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: "0.625rem",
  color: VE.smoke,
};

const tabNumStyle: React.CSSProperties = {
  fontFamily: "'Space Grotesk', monospace",
  fontFeatureSettings: "'tnum' 1",
};

// ─── Types ────────────────────────────────────────────────────────────────────
type SeasonData = {
  season: number;
  stats: {
    totalPredictions: number;
    totalGraded: number;
    totalHits: number;
    elitePredictions: number;
    eliteHits: number;
    veryHighPredictions: number;
    veryHighHits: number;
    updatedAt: string;
  } | null;
  dailySummary: {
    game_date: string;
    total: number;
    hits: number;
    misses: number;
    hit_rate: number;
    elite_total: number;
    elite_hits: number;
  }[];
};

type PlayerResult = {
  id: number;
  gameDate: string;
  playerName: string;
  team: string;
  game: string;
  tbLine: number;
  probUnder: number;
  tier: string;
  actualTb: number | null;
  hit: number | null;
  gradedAt: string | null;
  isDemo: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tierColor(tier: string): { bg: string; text: string; border: string } {
  switch (tier) {
    case "Elite":     return { bg: "rgba(22,166,121,0.12)", text: VE.emerald, border: "rgba(22,166,121,0.3)" };
    case "Very High": return { bg: "rgba(37,99,235,0.12)",  text: "#60A5FA",  border: "rgba(37,99,235,0.3)" };
    case "High":      return { bg: "rgba(14,165,233,0.10)", text: "#38BDF8",  border: "rgba(14,165,233,0.25)" };
    default:          return { bg: "rgba(108,114,128,0.12)", text: VE.smoke,  border: "rgba(108,114,128,0.3)" };
  }
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
}) {
  return (
    <div style={{ ...cardBase, padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: VE.smoke, display: "flex" }}>{icon}</span>
        <span style={labelStyle}>{label}</span>
      </div>
      <div style={{ ...tabNumStyle, fontSize: "1.75rem", fontWeight: 700, lineHeight: 1, color: VE.chalk, marginBottom: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "0.75rem", color: VE.smoke, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function DailyRow({ row }: { row: SeasonData["dailySummary"][0] }) {
  const rate = row.hit_rate;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${VE.steel}`, gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <Calendar style={{ width: 14, height: 14, color: VE.smoke, flexShrink: 0 }} />
        <span style={{ ...tabNumStyle, fontSize: "0.875rem", color: VE.chalk }}>{row.game_date}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ ...tabNumStyle, fontSize: "0.875rem", fontWeight: 700, color: VE.chalk }}>
            {row.hits}/{row.total}
          </div>
          <div style={{ fontSize: "0.6875rem", color: VE.smoke }}>{Math.round(rate * 100)}% quiet</div>
        </div>
        {row.elite_total > 0 && (
          <div style={{ textAlign: "right" }}>
            <div style={{ ...tabNumStyle, fontSize: "0.875rem", fontWeight: 600, color: VE.emerald }}>
              {row.elite_hits}/{row.elite_total}
            </div>
            <div style={{ fontSize: "0.6875rem", color: VE.smoke }}>Elite</div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerRow({ r }: { r: PlayerResult }) {
  const pctVal = Math.round(r.probUnder * 100);
  const isPending = r.hit === null;
  const isHit = r.hit === 1;
  const tc = tierColor(r.tier);
  const accentColor = isPending ? VE.iron : isHit ? VE.emerald : VE.red;
  const rowBg = isPending ? "transparent" : isHit ? "rgba(22,166,121,0.04)" : "rgba(220,53,69,0.04)";

  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0 10px 12px", borderBottom: `1px solid ${VE.steel}`, gap: 12, background: rowBg, position: "relative" }}
      data-testid={`result-row-${r.id}`}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, borderRadius: "3px 0 0 3px", background: accentColor, opacity: isPending ? 0.3 : 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: accentColor, flexShrink: 0, opacity: isPending ? 0.5 : 1 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 500, color: VE.chalk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.playerName}
          </div>
          <div style={{ fontSize: "0.6875rem", color: VE.smoke }}>{r.game || r.team} · {r.gameDate}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {r.isDemo === 1 && (
          <span style={{ ...labelStyle, padding: "2px 7px", borderRadius: 4, background: "rgba(200,168,75,0.12)", color: VE.gold, border: `1px solid ${VE.gold}`, fontSize: "0.55rem" }}>
            DEMO
          </span>
        )}
        <span style={{ ...labelStyle, padding: "2px 8px", borderRadius: 4, background: tc.bg, color: tc.text, border: `1px solid ${tc.border}`, fontSize: "0.6rem" }}>
          {r.tier}
        </span>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.6875rem", color: VE.smoke }}>Score</div>
          <div style={{ ...tabNumStyle, fontSize: "0.875rem", fontWeight: 600, color: VE.chalk }}>{pctVal}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.6875rem", color: VE.smoke }}>Actual TB</div>
          <div style={{ ...tabNumStyle, fontSize: "0.875rem", fontWeight: 700, color: isPending ? VE.iron : accentColor }}>
            {r.actualTb !== null ? r.actualTb : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

function VeCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...cardBase, ...style }}>{children}</div>;
}

function VeCardHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${VE.steel}`, display: "flex", alignItems: "center", gap: 8 }}>
      {children}
    </div>
  );
}

function VeCardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...labelStyle, fontSize: "0.6875rem", color: VE.smoke, display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      {children}
    </div>
  );
}

function AutoGraderStatus() {
  return (
    <div style={{ ...cardBase, borderStyle: "dashed", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Zap style={{ width: 15, height: 15, color: VE.gold, flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          <span style={{ ...labelStyle, color: VE.chalk, fontSize: "0.6875rem", textTransform: "none", letterSpacing: "normal", fontWeight: 600 }}>
            Grader
          </span>
          <p style={{ fontSize: "0.6875rem", color: VE.smoke, marginTop: 5, opacity: 0.8, lineHeight: 1.5 }}>
            Runs nightly at 11:30 PM PDT (or via <code>POST /api/results/grade</code>). It pulls final box scores from the
            MLB Stats API and records each projected batter's actual total bases. Nothing here is a performance claim —
            the table reflects only what has actually been graded.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const [showAll, setShowAll] = useState(false);

  const { data: season, isLoading: seasonLoading } = useQuery<SeasonData>({
    queryKey: ["/api/results/season"],
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: playerData, isLoading: picksLoading } = useQuery<{ results: PlayerResult[] }>({
    queryKey: ["/api/results/players"],
    refetchInterval: 5 * 60 * 1000,
  });

  const stats = season?.stats;
  const daily = season?.dailySummary || [];
  const allRows = playerData?.results || [];
  const hasData = !!(stats?.totalGraded && stats.totalGraded > 0);
  const hasDemo = allRows.some((r) => r.isDemo === 1);
  const visibleRows = showAll ? allRows : allRows.slice(0, 20);

  const underRate = (hits: number, total: number) => (total ? `${Math.round((hits / total) * 100)}%` : "—");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }} data-testid="results-page">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: "'Space Grotesk', monospace", fontWeight: 700, fontSize: "1.25rem", color: VE.chalk, margin: 0, letterSpacing: "-0.01em" }}>
            Results Tracker
          </h1>
          <p style={{ fontSize: "0.8125rem", color: VE.smoke, marginTop: 4 }}>
            Projected quiet games vs. actual total bases, from MLB box scores
          </p>
        </div>
        {stats?.updatedAt && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
              <Clock style={{ width: 11, height: 11 }} /> Last graded
            </div>
            <div style={{ ...tabNumStyle, fontSize: "0.75rem", color: VE.chalk, marginTop: 2 }}>
              {new Date(stats.updatedAt).toLocaleDateString()}
            </div>
          </div>
        )}
      </div>

      {hasDemo && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 6,
          background: "rgba(200,168,75,0.10)", border: "1px solid rgba(200,168,75,0.35)",
        }}>
          <span style={{
            ...labelStyle, color: VE.gold, fontWeight: 700, fontSize: "0.6rem",
            padding: "2px 7px", borderRadius: 4, border: `1px solid ${VE.gold}`, letterSpacing: "0.08em",
          }}>
            DEMO DATA
          </span>
          <span style={{ fontSize: "0.75rem", color: VE.smoke }}>
            Some rows below were inserted via the seed route for demonstration — they are not real graded results.
          </span>
        </div>
      )}

      {seasonLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-md" style={{ background: VE.graphite }} />
          ))}
        </div>
      ) : !hasData ? (
        <VeCard>
          <div style={{ padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 16 }}>
            <div style={{ fontFamily: "'Space Grotesk', monospace", fontSize: "2.5rem", fontWeight: 800, color: VE.gold, lineHeight: 1, opacity: 0.35 }}>⬥</div>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', monospace", fontWeight: 600, fontSize: "1rem", color: VE.chalk, marginBottom: 6 }}>
                Nothing graded yet.
              </div>
              <p style={{ fontSize: "0.8125rem", color: VE.smoke, maxWidth: 420, margin: 0, lineHeight: 1.6 }}>
                The tracker is empty until the grader runs against finished games. Trigger it with
                {" "}<code>POST /api/results/grade</code> after a day's games finish, or wait for the nightly run.
              </p>
            </div>
          </div>
        </VeCard>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <KpiCard
            icon={<Target style={{ width: 16, height: 16 }} />}
            label="Graded"
            value={`${stats?.totalGraded ?? 0}`}
            sub={`of ${stats?.totalPredictions ?? 0} projected`}
          />
          <KpiCard
            icon={<Target style={{ width: 16, height: 16 }} />}
            label="Quiet Games"
            value={underRate(stats?.totalHits ?? 0, stats?.totalGraded ?? 0)}
            sub={`${stats?.totalHits ?? 0}/${stats?.totalGraded ?? 0} graded`}
          />
          <KpiCard
            icon={<Zap style={{ width: 16, height: 16 }} />}
            label="Elite — Quiet"
            value={underRate(stats?.eliteHits ?? 0, stats?.elitePredictions ?? 0)}
            sub={`${stats?.eliteHits ?? 0}/${stats?.elitePredictions ?? 0} elite`}
          />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }} className="lg:grid-cols-2">
        <VeCard>
          <VeCardHeader>
            <Calendar style={{ width: 14, height: 14, color: VE.gold }} />
            <VeCardTitle><span style={{ color: VE.chalk }}>Daily Summary</span></VeCardTitle>
          </VeCardHeader>
          <div style={{ padding: "8px 16px 16px" }}>
            {seasonLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" style={{ background: VE.steel }} />)}
              </div>
            ) : daily.length === 0 ? (
              <p style={{ fontSize: "0.875rem", color: VE.smoke, padding: "24px 0", textAlign: "center" }}>No daily results yet</p>
            ) : (
              <div>{daily.map((row) => <DailyRow key={row.game_date} row={row} />)}</div>
            )}
          </div>
        </VeCard>

        {hasData && (
          <VeCard>
            <VeCardHeader>
              <Target style={{ width: 14, height: 14, color: VE.gold }} />
              <VeCardTitle><span style={{ color: VE.chalk }}>Quiet Games, by Tier</span></VeCardTitle>
            </VeCardHeader>
            <div style={{ padding: "8px 16px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { label: "Elite",      hits: stats?.eliteHits || 0,    total: stats?.elitePredictions || 0,    color: VE.emerald },
                { label: "Very High",  hits: stats?.veryHighHits || 0, total: stats?.veryHighPredictions || 0, color: VE.blue },
                { label: "All Graded", hits: stats?.totalHits || 0,    total: stats?.totalGraded || 0,         color: VE.smoke },
              ].map(({ label, hits, total, color }) => {
                const rate = total ? hits / total : 0;
                return (
                  <div key={label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ ...labelStyle, color: VE.smoke }}>{label}</span>
                      <span style={{ ...tabNumStyle, fontSize: "0.75rem", color: VE.chalk }}>
                        {hits}/{total} · {Math.round(rate * 100)}%
                      </span>
                    </div>
                    <div style={{ width: "100%", height: 6, borderRadius: 3, background: VE.steel }}>
                      <div style={{ height: 6, borderRadius: 3, width: `${Math.round(rate * 100)}%`, background: color, transition: "width 0.4s ease" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </VeCard>
        )}
      </div>

      <AutoGraderStatus />

      <VeCard>
        <VeCardHeader>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: VE.gold, flexShrink: 0 }} />
          <VeCardTitle>
            <span style={{ color: VE.chalk }}>All Graded Projections</span>
            <span style={{ marginLeft: "auto", color: VE.iron }}>{allRows.length} total</span>
          </VeCardTitle>
        </VeCardHeader>
        <div style={{ padding: "0 16px 16px" }}>
          {picksLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" style={{ background: VE.steel }} />)}
            </div>
          ) : allRows.length === 0 ? (
            <p style={{ fontSize: "0.875rem", color: VE.smoke, padding: "24px 0", textAlign: "center" }}>
              Nothing graded yet — run the grader after a day's games finish
            </p>
          ) : (
            <>
              {visibleRows.map((r) => <PlayerRow key={r.id} r={r} />)}
              {allRows.length > 20 && (
                <button
                  onClick={() => setShowAll(!showAll)}
                  style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 4, fontSize: "0.875rem", color: VE.gold, background: "none", border: "none", cursor: "pointer", marginLeft: "auto", marginRight: "auto", fontFamily: "'Space Grotesk', monospace", padding: "4px 8px", borderRadius: 4 }}
                  data-testid="button-show-all"
                >
                  {showAll ? (<><ChevronUp style={{ width: 16, height: 16 }} />Show less</>) : (<><ChevronDown style={{ width: 16, height: 16 }} />Show all {allRows.length}</>)}
                </button>
              )}
            </>
          )}
        </div>
      </VeCard>
    </div>
  );
}

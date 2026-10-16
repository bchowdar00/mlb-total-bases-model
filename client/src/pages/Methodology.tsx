// Methodology — an honest description of exactly what the scorer does.
// Every number here is copied from the scorer source (server/model_engine.py);
// there are no performance or accuracy figures because none can be computed
// from the data this repository uses (fetched by scripts/fetch_data.py).

const VE = {
  carbon:   "#0F1014",
  graphite: "#181A20",
  steel:    "#252830",
  gold:     "#C8A84B",
  chalk:    "#D4D8E0",
  smoke:    "#6C7280",
  iron:     "#404550",
  red:      "#DC3545",
} as const;

const cardBase: React.CSSProperties = {
  background: VE.graphite,
  border: `1px solid ${VE.steel}`,
  borderRadius: 6,
};

const dmSans: React.CSSProperties = { fontFamily: "'DM Sans', sans-serif", fontWeight: 300 };
const mono: React.CSSProperties = { fontFamily: "'Space Grotesk', monospace" };

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        ...mono, fontWeight: 600, fontSize: "0.8125rem", color: VE.smoke,
        textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 12px",
        display: "flex", alignItems: "center", gap: 8,
      }}
    >
      <span style={{ color: VE.gold }}>⬥</span>
      {children}
    </h2>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ ...cardBase, ...style }}>{children}</div>;
}

const SIGNALS: { signal: string; rule: string; effect: string }[] = [
  { signal: "Base score", rule: "every batter starts here", effect: "0.65" },
  { signal: "SLG < .360", rule: "weak slugging", effect: "+0.09" },
  { signal: "SLG .360–.400", rule: "below average", effect: "+0.04" },
  { signal: "SLG .510+", rule: "strong slugging", effect: "−0.09" },
  { signal: "SLG .460–.510", rule: "above average", effect: "−0.04" },
  { signal: "ISO < .130", rule: "little power", effect: "+0.04" },
  { signal: "ISO > .240", rule: "high power", effect: "−0.04" },
  { signal: "K% ≥ 27%", rule: "strikes out often", effect: "+0.04" },
  { signal: "BB% ≥ 12% & SLG < .460", rule: "walks a lot, low power", effect: "+0.03" },
  { signal: "Park factor < 0.95", rule: "pitcher-friendly park", effect: "+0.04" },
  { signal: "Park factor > 1.05", rule: "hitter-friendly park", effect: "−0.04" },
];

const TIERS = [
  { tier: "Elite", range: "score ≥ 0.80" },
  { tier: "Very High", range: "0.75 – 0.80" },
  { tier: "High", range: "0.70 – 0.75" },
  { tier: "Moderate", range: "0.65 – 0.70" },
  { tier: "Low-Moderate", range: "0.60 – 0.65" },
  { tier: "Low", range: "< 0.60" },
];

const SOURCES = [
  {
    name: "FanGraphs season batting stats",
    desc: "SLG, ISO, K%, BB% for every batter with at least 50 plate appearances in the season. Fetched by scripts/fetch_data.py from the public FanGraphs leaders endpoint into data/fangraphs_batters_2023_2025.csv, which is gitignored and not committed.",
  },
  {
    name: "MLB Stats API (statsapi.mlb.com)",
    desc: "Free, no-auth public API. Powers the live scoreboard and the nightly grader that pulls final box scores to record actual total bases.",
  },
];

export default function MethodologyPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, paddingBottom: 32 }}>
      <div>
        <h1 style={{ ...mono, fontWeight: 700, fontSize: "1.25rem", color: VE.chalk, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
          Methodology
        </h1>
        <p style={{ ...dmSans, fontSize: "0.8125rem", color: VE.smoke, margin: 0 }}>
          What the scorer does, exactly — and what it does not claim.
        </p>
      </div>

      {/* What it is */}
      <div>
        <SectionHeading>What this is</SectionHeading>
        <Card style={{ padding: 20 }}>
          <p style={{ ...dmSans, fontSize: "0.9375rem", color: VE.smoke, lineHeight: 1.7, margin: 0 }}>
            This is a <span style={{ color: VE.chalk, fontWeight: 600 }}>hand-tuned, rule-based scorer</span> — not a
            trained or calibrated machine-learning model. For each batter with at least 50 plate appearances it
            starts from a base value of{" "}
            <span style={{ color: VE.chalk, fontWeight: 600 }}>0.65</span> and applies a short list of fixed
            if/else adjustments based on the batter's season profile. The result is a score used only to{" "}
            <span style={{ color: VE.chalk, fontWeight: 600 }}>rank</span> hitters by how likely they are to have a{" "}
            <span style={{ color: VE.chalk, fontWeight: 600 }}>quiet game</span> — 1 or fewer total bases. The score is
            a relative ranking, not a calibrated probability.
          </p>
        </Card>
      </div>

      {/* Scoring rules */}
      <div>
        <SectionHeading>Scoring rules (from the source)</SectionHeading>
        <Card style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${VE.steel}` }}>
                {["Signal", "Meaning", "Score change"].map((h) => (
                  <th key={h} style={{ ...mono, textAlign: "left", padding: "12px 16px", color: VE.smoke, fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SIGNALS.map((s, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${VE.steel}` }}>
                  <td style={{ ...mono, padding: "10px 16px", color: VE.chalk }}>{s.signal}</td>
                  <td style={{ ...dmSans, padding: "10px 16px", color: VE.smoke }}>{s.rule}</td>
                  <td style={{ ...mono, padding: "10px 16px", color: s.effect.startsWith("−") ? VE.red : VE.gold }}>{s.effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ ...dmSans, fontSize: "0.75rem", color: VE.smoke, padding: "12px 16px", borderTop: `1px solid ${VE.steel}`, margin: 0, lineHeight: 1.6 }}>
            The adjustments are summed and the final score is clamped to the range 0.40–0.95. Park-factor adjustments
            only apply when a ballpark is supplied; the default season projection is park-neutral.
          </p>
        </Card>
      </div>

      {/* Tiers */}
      <div>
        <SectionHeading>Tiers</SectionHeading>
        <Card style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {TIERS.map((t) => (
              <div key={t.tier} style={{ background: VE.carbon, border: `1px solid ${VE.steel}`, borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ ...mono, fontSize: "0.8125rem", color: VE.chalk, fontWeight: 600 }}>{t.tier}</div>
                <div style={{ ...mono, fontSize: "0.6875rem", color: VE.smoke, marginTop: 2 }}>{t.range}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Data sources */}
      <div>
        <SectionHeading>Data sources</SectionHeading>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          {SOURCES.map((s) => (
            <Card key={s.name} style={{ padding: 14 }}>
              <div style={{ ...mono, fontWeight: 600, fontSize: "0.875rem", color: VE.chalk, marginBottom: 6 }}>{s.name}</div>
              <p style={{ ...dmSans, fontSize: "0.8125rem", color: VE.smoke, margin: 0, lineHeight: 1.5 }}>{s.desc}</p>
            </Card>
          ))}
        </div>
      </div>

      {/* Honesty / limitations */}
      <Card style={{ padding: 16, borderColor: "rgba(220,53,69,0.2)", background: "rgba(220,53,69,0.04)" }}>
        <SectionHeading>Limitations</SectionHeading>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            "The scorer is a heuristic. The weights were chosen by hand, not fit to data.",
            "No accuracy, hit-rate, or return figure is published, because the dataset (fetched by scripts/fetch_data.py, not committed) is season-aggregate rows (one per player-season) and contains no game-by-game outcomes to measure against.",
            "The Results page is a live tracker, not a claim: it is empty until you run the grader, and it only reports what the MLB box scores it pulled actually showed.",
            "Season-profile scoring ignores day-to-day context (opposing pitcher, lineup, weather) unless a game context is explicitly supplied.",
          ].map((t, i) => (
            <li key={i} style={{ ...dmSans, fontSize: "0.8125rem", color: VE.smoke, lineHeight: 1.6 }}>{t}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

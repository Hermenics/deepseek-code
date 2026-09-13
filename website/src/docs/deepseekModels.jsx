// Tables and facts rendered from data/deepseek-models.json, a copy of the CLI's
// src/agent/deepseekModels.json synced from DeepSeek's official pricing page.
import DATA from "./data/deepseek-models.json";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const { weekdays, ranges } = DATA.peakHoursUtc;
const consecutive = weekdays.every((day, i) => i === 0 || day === weekdays[i - 1] + 1);

export const DEEPSEEK_MODELS = DATA.models;
export const DEFAULT_MODEL = "deepseek-flash";
export const PRICING_SOURCE = DATA.source;
export const LEGACY_ALIASES = Object.keys(DATA.legacyAliases);
export const PEAK_HOURS = `${ranges.map(([start, end]) => `${start}–${end}`).join(" and ")} UTC, ${
  consecutive && weekdays.length > 1 ? `${DAYS[weekdays[0]]} to ${DAYS[weekdays[weekdays.length - 1]]}` : weekdays.map((day) => DAYS[day]).join(", ")
}`;

export const formatTokens = (n) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}K`);
const usd = (n) => `$${n}`;

/** Retired model names the API still accepts, as inline code joined into prose. */
export function LegacyAliasList() {
  return LEGACY_ALIASES.map((alias, i) => (
    <span key={alias}>
      {i > 0 && (i === LEGACY_ALIASES.length - 1 ? " and " : ", ")}
      <code className="inline">{alias}</code>
    </span>
  ));
}
const Badge = ({ children }) => <span className="badge" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 10 }}>{children}</span>;

export function ModelTable() {
  return (
    <div className="doc-table-wrap doc-table-wrap--stacked">
      <table className="doc-table doc-table--stacked">
        <thead><tr><th>Model ID</th><th>API version</th><th>Context</th><th>Max output</th><th>Vision</th><th>Concurrency</th></tr></thead>
        <tbody>
          {DEEPSEEK_MODELS.map((m) => (
            <tr key={m.id}>
              <td data-label="Model ID"><code className="inline">{m.id}</code>{m.id === DEFAULT_MODEL && <Badge>default</Badge>}</td>
              <td data-label="API version"><code className="inline">{m.version}</code></td>
              <td data-label="Context"><code className="inline">{formatTokens(m.contextTokens)}</code></td>
              <td data-label="Max output"><code className="inline">{formatTokens(m.maxOutputTokens)}</code></td>
              <td data-label="Vision">{m.vision ? "Yes" : "No"}</td>
              <td data-label="Concurrency"><code className="inline">{m.concurrency}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PricingTable() {
  return (
    <div className="doc-table-wrap doc-table-wrap--stacked">
      <table className="doc-table doc-table--stacked">
        <thead><tr><th>Model</th><th>Cache hit<br />off-peak / peak</th><th>Cache miss<br />off-peak / peak</th><th>Output<br />off-peak / peak</th></tr></thead>
        <tbody>
          {DEEPSEEK_MODELS.map(({ id, pricing: { offPeak, peak } }) => (
            <tr key={id}>
              <td data-label="Model"><code className="inline">{id}</code></td>
              <td data-label="Cache hit"><code className="inline">{usd(offPeak.cacheHit)} / {usd(peak.cacheHit)}</code></td>
              <td data-label="Cache miss"><code className="inline">{usd(offPeak.cacheMiss)} / {usd(peak.cacheMiss)}</code></td>
              <td data-label="Output"><code className="inline">{usd(offPeak.output)} / {usd(peak.output)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PricingSourceNote() {
  return (
    <p>
      Rates are USD per million tokens, copied from the{" "}
      <a href={PRICING_SOURCE} target="_blank" rel="noreferrer">official DeepSeek pricing page</a> by a daily sync.
      Peak rates apply {PEAK_HOURS}; every other hour is off-peak. Prices can change, so treat the provider page
      and your balance as the source of truth.
    </p>
  );
}

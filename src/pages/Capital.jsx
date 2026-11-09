import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { api } from "../api/client";
import { Card }    from "../components/ui/Card";
import { Badge }   from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
                "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];

const usd = new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" });
const money = v => usd.format(v || 0);
const moneyCompact = v => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : a.toFixed(0);
  return `${v < 0 ? "-" : ""}$${s}`;
};
const pct = v => `${(v * 100).toFixed(1).replace(".", ",")}%`;

const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);
const yearOf  = s => Number(s.slice(0, 4));
const monthOf = s => Number(s.slice(5, 7)) - 1;
const fmtDate = s => s.split("-").reverse().join("/");
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);

const METHOD_LABEL = { crypto: "Crypto", bonifico: "Bonifico" };
const STATUS_LABEL = { in_corso: "In corso", funded: "Funded", fallita: "Fallita" };
const STATUS_COLOR = { in_corso: "var(--warning)", funded: "var(--accent)", fallita: "var(--danger)" };
const STATUSES = ["in_corso", "funded", "fallita"];

function aggregate(challenges, payouts, rate) {
  const cost    = sum(challenges, c => c.cost);
  const costDed = sum(challenges.filter(c => c.tax_deductible), c => c.cost);
  const pay     = sum(payouts, p => p.amount);
  const payTax  = sum(payouts.filter(p => p.taxable), p => p.amount);
  const base    = payTax - costDed;
  const tax     = Math.max(0, base) * rate / 100;
  return { nCh: challenges.length, cost, costDed, nPay: payouts.length, pay, payTax,
           net: pay - cost, base, tax };
}

const netColor = v => v > 0 ? "var(--accent)" : v < 0 ? "var(--danger)" : "var(--text-secondary)";

const inputStyle = {
  width: "100%", padding: "0.4rem 0.6rem", fontSize: 13,
  background: "var(--bg-elevated)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)", color: "var(--text-primary)",
};

const thStyle = {
  padding: "0.5rem 0.75rem", fontSize: 11, fontWeight: 600,
  color: "var(--text-muted)", letterSpacing: "0.05em", whiteSpace: "nowrap",
};
const tdNum = { padding: "0.5rem 0.75rem", textAlign: "right", fontFamily: "var(--font-data)", whiteSpace: "nowrap" };

// ─── Piccoli componenti di form ─────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
      {label}
      {children}
    </label>
  );
}

function Check({ checked, onChange, children }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13,
                    color: "var(--text-secondary)", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function SubmitButton({ busy, disabled, children }) {
  return (
    <button type="submit" disabled={busy || disabled}
      style={{ padding: "0.45rem 1rem", fontSize: 13, fontWeight: 600,
               cursor: busy || disabled ? "not-allowed" : "pointer",
               opacity: busy || disabled ? 0.5 : 1,
               background: "var(--accent-dim)", border: "1px solid var(--accent)",
               borderRadius: "var(--radius-sm)", color: "var(--accent)" }}>
      {busy ? "Salvataggio…" : children}
    </button>
  );
}

function FormError({ msg }) {
  if (!msg) return null;
  return <div style={{ fontSize: 12, color: "var(--danger)" }}>Errore: {msg}</div>;
}

// ─── Form: nuova challenge ──────────────────────────────────────────────────

function ChallengeForm({ onSaved }) {
  const [name, setName]             = useState("");
  const [firm, setFirm]             = useState("");
  const [date, setDate]             = useState(todayStr());
  const [cost, setCost]             = useState("");
  const [status, setStatus]         = useState("in_corso");
  const [deductible, setDeductible] = useState(false);
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createCapitalChallenge({
        name: name.trim(), firm: firm.trim() || null,
        purchase_date: date, cost: parseFloat(cost), tax_deductible: deductible, status,
      });
      setName(""); setFirm(""); setCost(""); setStatus("in_corso"); setDeductible(false);
      await onSaved();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: "0.9rem" }}>Acquisto challenge</h2>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        <Field label="Nome (es. FTMO 100k #2)">
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} required />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem" }}>
          <Field label="Prop firm (facoltativo)">
            <input style={inputStyle} value={firm} onChange={e => setFirm(e.target.value)} />
          </Field>
          <Field label="Stato">
            <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem" }}>
          <Field label="Data acquisto">
            <input style={inputStyle} type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </Field>
          <Field label="Importo ($)">
            <input style={inputStyle} type="number" step="0.01" min="0" value={cost}
                   onChange={e => setCost(e.target.value)} required />
          </Field>
        </div>
        <Check checked={deductible} onChange={setDeductible}>Costo deducibile dalle tasse</Check>
        <FormError msg={err} />
        <div><SubmitButton busy={busy}>Aggiungi challenge</SubmitButton></div>
      </form>
    </Card>
  );
}

// ─── Form: nuovo payout ─────────────────────────────────────────────────────

function PayoutForm({ challenges, onSaved }) {
  const [challengeId, setChallengeId] = useState("");
  const [date, setDate]               = useState(todayStr());
  const [amount, setAmount]           = useState("");
  const [method, setMethod]           = useState("bonifico");
  const [taxable, setTaxable]         = useState(true);
  const [busy, setBusy]               = useState(false);
  const [err, setErr]                 = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.createCapitalPayout({
        challenge_id: challengeId, payout_date: date,
        amount: parseFloat(amount), method, taxable,
      });
      setAmount("");
      await onSaved();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  const empty = challenges.length === 0;

  return (
    <Card>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: "0.9rem" }}>Payout</h2>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        <Field label="Conto di provenienza">
          <select style={inputStyle} value={challengeId} onChange={e => setChallengeId(e.target.value)}
                  required disabled={empty}>
            <option value="">{empty ? "Aggiungi prima una challenge" : "Seleziona…"}</option>
            {challenges.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.firm ? ` (${c.firm})` : ""} · {fmtDate(c.purchase_date)}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.7rem" }}>
          <Field label="Data payout">
            <input style={inputStyle} type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </Field>
          <Field label="Importo ($)">
            <input style={inputStyle} type="number" step="0.01" min="0.01" value={amount}
                   onChange={e => setAmount(e.target.value)} required />
          </Field>
        </div>
        <Field label="Metodo di accredito">
          <select style={inputStyle} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="bonifico">Bonifico</option>
            <option value="crypto">Crypto</option>
          </select>
        </Field>
        <Check checked={taxable} onChange={setTaxable}>Su questo importo vanno calcolate le tasse</Check>
        <FormError msg={err} />
        <div><SubmitButton busy={busy} disabled={empty}>Aggiungi payout</SubmitButton></div>
      </form>
    </Card>
  );
}

// ─── Tabella challenge ──────────────────────────────────────────────────────

function ChallengeTable({ rows, onDeleteChallenge, onDeletePayout, onChangeStatus }) {
  const [open, setOpen] = useState({});

  const totals = {
    cost: sum(rows, r => r.cost),
    nPay: sum(rows, r => r.nPay),
    pay:  sum(rows, r => r.payTotal),
    net:  sum(rows, r => r.net),
  };

  if (rows.length === 0) {
    return (
      <Card>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Nessuna challenge registrata. Aggiungi la prima dal modulo qui sopra.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ ...thStyle, width: 28 }} />
              <th style={{ ...thStyle, textAlign: "left" }}>ACQUISTO</th>
              <th style={{ ...thStyle, textAlign: "left" }}>CHALLENGE</th>
              <th style={{ ...thStyle, textAlign: "left" }}>STATO</th>
              <th style={{ ...thStyle, textAlign: "right" }}>COSTO</th>
              <th style={{ ...thStyle, textAlign: "center" }}>DEDUCIBILE</th>
              <th style={{ ...thStyle, textAlign: "right" }}>N° PAYOUT</th>
              <th style={{ ...thStyle, textAlign: "right" }}>PAYOUT TOTALE</th>
              <th style={{ ...thStyle, textAlign: "right" }}>VALORE NETTO</th>
              <th style={{ ...thStyle, width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isOpen = !!open[r.id];
              return (
                <Fragment key={r.id}>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.5rem 0.4rem" }}>
                      <button onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))}
                              title={isOpen ? "Nascondi payout" : "Mostra payout"}
                              style={{ background: "none", border: "none", cursor: "pointer",
                                       color: "var(--text-muted)", display: "flex" }}>
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", fontFamily: "var(--font-data)", whiteSpace: "nowrap" }}>
                      {fmtDate(r.purchase_date)}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      {r.name}
                      {r.firm && <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>{r.firm}</span>}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <select value={r.status} onChange={e => onChangeStatus(r, e.target.value)}
                              style={{ ...inputStyle, width: "auto", padding: "0.2rem 0.4rem", fontSize: 12,
                                       color: STATUS_COLOR[r.status], fontWeight: 600 }}>
                        {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </td>
                    <td style={tdNum}>{money(r.cost)}</td>
                    <td style={{ padding: "0.5rem 0.75rem", textAlign: "center" }}>
                      <Badge value={r.tax_deductible ? "Sì" : "No"} type={r.tax_deductible ? "positive" : undefined} />
                    </td>
                    <td style={tdNum}>{r.nPay}</td>
                    <td style={tdNum}>{money(r.payTotal)}</td>
                    <td style={{ ...tdNum, fontWeight: 600, color: netColor(r.net) }}>{money(r.net)}</td>
                    <td style={{ padding: "0.5rem 0.4rem" }}>
                      <button onClick={() => onDeleteChallenge(r)} title="Elimina challenge e payout collegati"
                              style={{ background: "none", border: "none", cursor: "pointer",
                                       color: "var(--text-muted)", display: "flex" }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
                      <td />
                      <td colSpan={9} style={{ padding: "0.6rem 0.75rem" }}>
                        {r.payouts.length === 0 ? (
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            Nessun payout su questa challenge.
                          </span>
                        ) : (
                          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 420 }}>
                            <thead>
                              <tr>
                                <th style={{ ...thStyle, textAlign: "left", fontSize: 10 }}>DATA</th>
                                <th style={{ ...thStyle, textAlign: "right", fontSize: 10 }}>IMPORTO</th>
                                <th style={{ ...thStyle, textAlign: "left", fontSize: 10 }}>METODO</th>
                                <th style={{ ...thStyle, textAlign: "left", fontSize: 10 }}>TASSE</th>
                                <th style={{ ...thStyle, width: 28 }} />
                              </tr>
                            </thead>
                            <tbody>
                              {r.payouts.map(p => (
                                <tr key={p.id}>
                                  <td style={{ padding: "0.25rem 0.75rem", fontFamily: "var(--font-data)" }}>{fmtDate(p.payout_date)}</td>
                                  <td style={{ ...tdNum, padding: "0.25rem 0.75rem" }}>{money(p.amount)}</td>
                                  <td style={{ padding: "0.25rem 0.75rem" }}>{METHOD_LABEL[p.method] || p.method}</td>
                                  <td style={{ padding: "0.25rem 0.75rem" }}>
                                    <Badge value={p.taxable ? "Tassabile" : "Non tassabile"} type={p.taxable ? "warning" : undefined} />
                                  </td>
                                  <td style={{ padding: "0.25rem 0.4rem" }}>
                                    <button onClick={() => onDeletePayout(p)} title="Elimina payout"
                                            style={{ background: "none", border: "none", cursor: "pointer",
                                                     color: "var(--text-muted)", display: "flex" }}>
                                      <Trash2 size={13} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 600 }}>
              <td />
              <td colSpan={3} style={{ padding: "0.6rem 0.75rem" }}>Totale ({rows.length} challenge)</td>
              <td style={tdNum}>{money(totals.cost)}</td>
              <td />
              <td style={tdNum}>{totals.nPay}</td>
              <td style={tdNum}>{money(totals.pay)}</td>
              <td style={{ ...tdNum, color: netColor(totals.net) }}>{money(totals.net)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ─── Grafico netto cumulato (SVG, nessuna dipendenza) ───────────────────────

function CumulativeChart({ series }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  if (series.length < 2) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
        Il grafico compare quando ci sono movimenti in almeno due date diverse.
      </p>
    );
  }

  const W = 800, H = 260, L = 56, R = 16, T = 12, B = 28;
  const xs = series.map(p => Date.parse(p.date + "T00:00:00Z"));
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const vals = series.map(p => p.cum);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.08 || 1;
  const yMin = lo - pad, yMax = hi + pad;
  const sx = t => L + ((t - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = v => T + ((yMax - v) / (yMax - yMin)) * (H - T - B);

  // Linea a gradini: il valore resta costante fino al movimento successivo
  let line = `M${sx(xs[0])},${sy(vals[0])}`;
  for (let i = 1; i < series.length; i++) line += ` H${sx(xs[i])} V${sy(vals[i])}`;
  const area = `${line} V${sy(0)} H${sx(xs[0])} Z`;

  const last = series[series.length - 1];
  const color = last.cum >= 0 ? "var(--accent)" : "var(--danger)";
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  const xTicks = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);
  const fmtTick = t => new Date(t).toLocaleDateString("it-IT", { month: "short", year: "2-digit", timeZone: "UTC" });

  function onMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = x0 + ((px - L) / (W - L - R)) * (x1 - x0);
    let idx = 0;
    for (let i = 0; i < xs.length; i++) if (xs[i] <= t) idx = i;
    setHover(idx);
  }

  const shown = hover != null ? series[hover] : last;

  return (
    <div>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "0.5rem",
                    fontSize: 13, fontFamily: "var(--font-data)" }}>
        <span style={{ color: "var(--text-muted)" }}>{fmtDate(shown.date)}</span>
        <span>Netto cumulato: <strong style={{ color: netColor(shown.cum) }}>{money(shown.cum)}</strong></span>
        <span style={{ color: "var(--text-muted)" }}>
          Movimento del giorno: <span style={{ color: netColor(shown.delta) }}>{money(shown.delta)}</span>
        </span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
           onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} style={{ stroke: "var(--border)", strokeWidth: 1 }} />
            <text x={L - 6} y={sy(v) + 4} textAnchor="end" fontSize="10" style={{ fill: "var(--text-muted)" }}>
              {moneyCompact(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={sx(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
                fontSize="10" style={{ fill: "var(--text-muted)" }}>
            {fmtTick(t)}
          </text>
        ))}
        <line x1={L} x2={W - R} y1={sy(0)} y2={sy(0)}
              style={{ stroke: "var(--text-muted)", strokeWidth: 1, strokeDasharray: "4 4" }} />
        <path d={area} style={{ fill: color, opacity: 0.12 }} />
        <path d={line} style={{ fill: "none", stroke: color, strokeWidth: 2 }} />
        {hover != null && (
          <g>
            <line x1={sx(xs[hover])} x2={sx(xs[hover])} y1={T} y2={H - B}
                  style={{ stroke: "var(--text-muted)", strokeWidth: 1 }} />
            <circle cx={sx(xs[hover])} cy={sy(series[hover].cum)} r="4" style={{ fill: color }} />
          </g>
        )}
      </svg>
    </div>
  );
}

// ─── Tabelle di ripartizione (per stato e per metodo) ───────────────────────

function BreakdownTables({ rows, payouts }) {
  const byStatus = STATUSES.map(s => {
    const rs = rows.filter(r => r.status === s);
    return { key: s, n: rs.length, cost: sum(rs, r => r.cost),
             pay: sum(rs, r => r.payTotal), net: sum(rs, r => r.net) };
  });
  const funded = byStatus.find(s => s.key === "funded").n;
  const failed = byStatus.find(s => s.key === "fallita").n;
  const closed = funded + failed;

  const payTotal = sum(payouts, p => p.amount);
  const byMethod = ["bonifico", "crypto"].map(m => {
    const ps = payouts.filter(p => p.method === m);
    const amount = sum(ps, p => p.amount);
    return { key: m, n: ps.length, amount,
             share: payTotal > 0 ? amount / payTotal : null,
             taxable: sum(ps.filter(p => p.taxable), p => p.amount) };
  });

  const th = (label, align = "right") => (
    <th style={{ ...thStyle, textAlign: align }}>{label}</th>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "1rem" }}>
      <Card>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: "0.9rem" }}>Per stato della challenge</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {th("STATO", "left")}{th("N°")}{th("COSTO")}{th("PAYOUT")}{th("NETTO")}
              </tr>
            </thead>
            <tbody>
              {byStatus.map(s => (
                <tr key={s.key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.5rem 0.75rem", color: STATUS_COLOR[s.key], fontWeight: 600 }}>
                    {STATUS_LABEL[s.key]}
                  </td>
                  <td style={tdNum}>{s.n}</td>
                  <td style={tdNum}>{money(s.cost)}</td>
                  <td style={tdNum}>{money(s.pay)}</td>
                  <td style={{ ...tdNum, color: netColor(s.net) }}>{money(s.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: "0.75rem" }}>
          Tasso di successo:{" "}
          <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-data)" }}>
            {closed > 0 ? pct(funded / closed) : "—"}
          </strong>
          {closed > 0 && ` (${funded} funded su ${closed} chiuse, escluse quelle in corso)`}
        </p>
      </Card>

      <Card>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: "0.9rem" }}>Payout per metodo di accredito</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {th("METODO", "left")}{th("N° PAYOUT")}{th("IMPORTO")}{th("% SUL TOTALE")}{th("DI CUI TASSABILI")}
              </tr>
            </thead>
            <tbody>
              {byMethod.map(m => (
                <tr key={m.key} style={{ borderBottom: "1px solid var(--border)",
                                         color: m.n === 0 ? "var(--text-muted)" : "inherit" }}>
                  <td style={{ padding: "0.5rem 0.75rem" }}>{METHOD_LABEL[m.key]}</td>
                  <td style={tdNum}>{m.n}</td>
                  <td style={tdNum}>{money(m.amount)}</td>
                  <td style={tdNum}>{m.share != null ? pct(m.share) : "—"}</td>
                  <td style={tdNum}>{money(m.taxable)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 600 }}>
                <td style={{ padding: "0.6rem 0.75rem" }}>Totale</td>
                <td style={tdNum}>{payouts.length}</td>
                <td style={tdNum}>{money(payTotal)}</td>
                <td style={tdNum}>{payTotal > 0 ? pct(1) : "—"}</td>
                <td style={tdNum}>{money(sum(payouts.filter(p => p.taxable), p => p.amount))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Tabella riepilogo (usata per totale e per mese) ────────────────────────

const COLS = [
  { key: "nCh",     label: "N° CHALLENGE",     fmt: v => v },
  { key: "cost",    label: "COSTO CHALLENGE",  fmt: money },
  { key: "costDed", label: "COSTO DEDUCIBILE", fmt: money },
  { key: "nPay",    label: "N° PAYOUT",        fmt: v => v },
  { key: "pay",     label: "PAYOUT TOTALE",    fmt: money },
  { key: "payTax",  label: "PAYOUT TASSABILI", fmt: money },
  { key: "net",     label: "NETTO",            fmt: money, signed: true },
  { key: "base",    label: "IMPONIBILE",       fmt: money },
  { key: "tax",     label: "TASSE STIMATE",    fmt: money },
];

function SummaryTable({ firstHeader, rows, total }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ ...thStyle, textAlign: "left" }}>{firstHeader}</th>
            {COLS.map(c => <th key={c.key} style={{ ...thStyle, textAlign: "right" }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, agg }) => {
            const isEmpty = agg.nCh === 0 && agg.nPay === 0;
            return (
              <tr key={label} style={{ borderBottom: "1px solid var(--border)",
                                       color: isEmpty ? "var(--text-muted)" : "inherit" }}>
                <td style={{ padding: "0.5rem 0.75rem" }}>{label}</td>
                {COLS.map(c => (
                  <td key={c.key} style={{ ...tdNum,
                        color: !isEmpty && c.signed ? netColor(agg[c.key]) : undefined }}>
                    {isEmpty ? "—" : c.fmt(agg[c.key])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 600 }}>
            <td style={{ padding: "0.6rem 0.75rem" }}>{total.label}</td>
            {COLS.map(c => (
              <td key={c.key} style={{ ...tdNum, color: c.signed ? netColor(total.agg[c.key]) : undefined }}>
                {c.fmt(total.agg[c.key])}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Pagina ──────────────────────────────────────────────────────────────────

export function Capital() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [year,    setYear]    = useState(new Date().getFullYear());
  const [taxRate, setTaxRate] = useState(() => {
    try { return localStorage.getItem("capital_tax_rate") ?? "15"; } catch { return "15"; }
  });
  const rate = parseFloat(taxRate) || 0;

  const reload = useCallback(async () => {
    try {
      const d = await api.getCapital();
      setData({
        challenges: (d.challenges || []).map(c => ({ ...c, cost: Number(c.cost), status: c.status || "in_corso" })),
        payouts:    (d.payouts    || []).map(p => ({ ...p, amount: Number(p.amount) })),
      });
      setError(null);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { reload().finally(() => setLoading(false)); }, [reload]);

  useEffect(() => {
    try { localStorage.setItem("capital_tax_rate", taxRate); } catch {}
  }, [taxRate]);

  const challenges = data?.challenges ?? [];
  const payouts    = data?.payouts ?? [];

  // Una riga per challenge, con i suoi payout e il valore netto
  const rows = useMemo(() => {
    const byCh = {};
    payouts.forEach(p => { (byCh[p.challenge_id] = byCh[p.challenge_id] || []).push(p); });
    return challenges
      .map(c => {
        const ps = (byCh[c.id] || []).slice().sort((a, b) => b.payout_date.localeCompare(a.payout_date));
        const payTotal = sum(ps, p => p.amount);
        return { ...c, payouts: ps, nPay: ps.length, payTotal, net: payTotal - c.cost };
      })
      .sort((a, b) => b.purchase_date.localeCompare(a.purchase_date));
  }, [challenges, payouts]);

  // Netto cumulato nel tempo: costi in uscita alla data di acquisto, payout in entrata alla data di incasso
  const series = useMemo(() => {
    const byDay = {};
    challenges.forEach(c => { byDay[c.purchase_date] = (byDay[c.purchase_date] || 0) - c.cost; });
    payouts.forEach(p => { byDay[p.payout_date] = (byDay[p.payout_date] || 0) + p.amount; });
    let cum = 0;
    return Object.keys(byDay).sort().map(d => { cum += byDay[d]; return { date: d, delta: byDay[d], cum }; });
  }, [challenges, payouts]);

  const years = useMemo(() => {
    const s = new Set([new Date().getFullYear()]);
    challenges.forEach(c => s.add(yearOf(c.purchase_date)));
    payouts.forEach(p => s.add(yearOf(p.payout_date)));
    return [...s].sort((a, b) => b - a);
  }, [challenges, payouts]);

  const totalAgg = useMemo(() => aggregate(challenges, payouts, rate), [challenges, payouts, rate]);

  const yearRows = useMemo(() => years.map(y => ({
    label: String(y),
    agg: aggregate(
      challenges.filter(c => yearOf(c.purchase_date) === y),
      payouts.filter(p => yearOf(p.payout_date) === y),
      rate),
  })), [years, challenges, payouts, rate]);

  const monthRows = useMemo(() => MONTHS.map((label, m) => ({
    label,
    agg: aggregate(
      challenges.filter(c => yearOf(c.purchase_date) === year && monthOf(c.purchase_date) === m),
      payouts.filter(p => yearOf(p.payout_date) === year && monthOf(p.payout_date) === m),
      rate),
  })), [year, challenges, payouts, rate]);

  const yearAgg = useMemo(() => aggregate(
    challenges.filter(c => yearOf(c.purchase_date) === year),
    payouts.filter(p => yearOf(p.payout_date) === year),
    rate), [year, challenges, payouts, rate]);

  async function removeChallenge(c) {
    if (!window.confirm(`Eliminare "${c.name}" e i suoi ${c.nPay} payout?`)) return;
    try { await api.deleteCapitalChallenge(c.id); await reload(); }
    catch (e) { setError(e.message); }
  }

  async function removePayout(p) {
    if (!window.confirm(`Eliminare il payout di ${money(p.amount)} del ${fmtDate(p.payout_date)}?`)) return;
    try { await api.deleteCapitalPayout(p.id); await reload(); }
    catch (e) { setError(e.message); }
  }

  async function changeStatus(c, status) {
    try { await api.setCapitalChallengeStatus(c.id, status); await reload(); }
    catch (e) { setError(e.message); }
  }

  if (loading) return <Spinner />;

  const withPayout = rows.filter(r => r.nPay > 0).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Capitale</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          {rows.length} challenge · {withPayout} con almeno un payout · {payouts.length} payout · importi in dollari
        </p>
      </div>

      {error && (
        <Card>
          <span style={{ color: "var(--danger)", fontSize: 13 }}>Errore: {error}</span>
        </Card>
      )}

      {/* Inserimento */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem" }}>
        <ChallengeForm onSaved={reload} />
        <PayoutForm challenges={rows} onSaved={reload} />
      </div>

      {/* Una riga per challenge */}
      <ChallengeTable rows={rows} onDeleteChallenge={removeChallenge}
                      onDeletePayout={removePayout} onChangeStatus={changeStatus} />

      {/* Netto cumulato */}
      <Card>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: "0.9rem" }}>Netto cumulato</h2>
        <CumulativeChart series={series} />
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: "0.5rem" }}>
          Payout incassati meno costi delle challenge, giorno per giorno. Sopra la linea tratteggiata sei in positivo.
        </p>
      </Card>

      {/* Ripartizioni */}
      <BreakdownTables rows={rows} payouts={payouts} />

      {/* Riepilogo totale */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                      flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.9rem" }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Riepilogo totale</h2>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: 12, color: "var(--text-muted)" }}>
            Aliquota stimata (%)
            <input value={taxRate} onChange={e => setTaxRate(e.target.value)} inputMode="decimal"
                   style={{ ...inputStyle, width: 70 }} />
          </label>
        </div>
        <SummaryTable firstHeader="ANNO" rows={yearRows} total={{ label: "Totale complessivo", agg: totalAgg }} />
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: "0.75rem" }}>
          Imponibile = payout tassabili − costi deducibili. Le tasse stimate si calcolano sul totale di ogni riga
          (non come somma dei mesi) e sono 0 se l'imponibile è negativo. Stima indicativa, in dollari: l'aliquota è un
          valore modificabile, salvato in questo browser.
        </p>
      </Card>

      {/* Riepilogo mensile */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                      flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.9rem" }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Riepilogo per mese</h2>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: 12, color: "var(--text-muted)" }}>
            Anno
            <select value={year} onChange={e => setYear(Number(e.target.value))}
                    style={{ ...inputStyle, width: 90 }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
        <SummaryTable firstHeader="MESE" rows={monthRows} total={{ label: `Totale ${year}`, agg: yearAgg }} />
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: "0.75rem" }}>
          Le challenge contano nel mese di acquisto, i payout nel mese di incasso.
        </p>
      </Card>
    </div>
  );
}

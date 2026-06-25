export interface ChartSpec {
  type: "bar" | "line" | "pie";
  title?: string;
  labels: string[];
  values: number[];
}

const PALETTE = ["#5C6BFF", "#33D6A6", "#FF9933", "#FF5959", "#7A8CFF", "#9C6BFF", "#2DB6C9", "#E0529C"];

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Render a chart spec to a self-contained <svg> string. Pure, deterministic, no deps. */
export function chartToSvg(spec: ChartSpec, opts: { width?: number; height?: number; rtl?: boolean } = {}): string {
  const W = opts.width ?? 480;
  const H = opts.height ?? 300;
  const title = spec?.title ? esc(spec.title) : "";
  const labels = Array.isArray(spec?.labels) ? spec.labels.map((l) => esc(String(l))) : [];
  const values = Array.isArray(spec?.values) ? spec.values.map((v) => (Number.isFinite(+v) ? +v : 0)) : [];
  const n = Math.min(labels.length, values.length);
  const titleH = title ? 28 : 8;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif">`;
  const titleEl = title ? `<text x="${W / 2}" y="18" text-anchor="middle" font-size="14" font-weight="bold" fill="#222">${title}</text>` : "";
  const foot = `</svg>`;

  if (n === 0) {
    return `${head}${titleEl}<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="12" fill="#999">No data</text>${foot}`;
  }

  if (spec.type === "pie") {
    const total = values.slice(0, n).reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = W * 0.34, cy = titleH + (H - titleH) / 2, r = Math.min(W * 0.28, (H - titleH) / 2 - 10);
    let angle = -Math.PI / 2;
    const slices: string[] = [];
    const legend: string[] = [];
    for (let i = 0; i < n; i++) {
      const frac = Math.max(0, values[i]) / total;
      const a2 = angle + frac * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const large = frac > 0.5 ? 1 : 0;
      const color = PALETTE[i % PALETTE.length];
      slices.push(`<path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${color}"/>`);
      const ly = titleH + 16 + i * 20;
      legend.push(`<rect x="${(W * 0.66).toFixed(1)}" y="${ly - 9}" width="11" height="11" fill="${color}"/><text x="${(W * 0.66 + 16).toFixed(1)}" y="${ly}" font-size="11" fill="#333">${labels[i]} (${Math.round(frac * 100)}%)</text>`);
      angle = a2;
    }
    return `${head}${titleEl}${slices.join("")}${legend.join("")}${foot}`;
  }

  const padL = 38, padR = 14, padB = 34;
  const padT = titleH;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(...values.slice(0, n), 1);
  const x0 = padL, y0 = padT, baseY = padT + plotH;
  const axis = `<line x1="${x0}" y1="${baseY}" x2="${x0 + plotW}" y2="${baseY}" stroke="#ccc"/><line x1="${x0}" y1="${y0}" x2="${x0}" y2="${baseY}" stroke="#ccc"/>`;
  const labelEls: string[] = [];
  for (let i = 0; i < n; i++) {
    const cxBand = x0 + (plotW / n) * (i + 0.5);
    labelEls.push(`<text x="${cxBand.toFixed(1)}" y="${(baseY + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="#555">${labels[i]}</text>`);
  }

  if (spec.type === "line") {
    const pts = values.slice(0, n).map((v, i) => {
      const px = x0 + (plotW / n) * (i + 0.5);
      const py = baseY - (Math.max(0, v) / maxV) * plotH;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    });
    const dots = pts.map((p) => { const [px, py] = p.split(","); return `<circle cx="${px}" cy="${py}" r="3" fill="${PALETTE[0]}"/>`; }).join("");
    return `${head}${titleEl}${axis}<polyline points="${pts.join(" ")}" fill="none" stroke="${PALETTE[0]}" stroke-width="2"/>${dots}${labelEls.join("")}${foot}`;
  }

  const bw = (plotW / n) * 0.62;
  const bars: string[] = [];
  for (let i = 0; i < n; i++) {
    const bh = (Math.max(0, values[i]) / maxV) * plotH;
    const bx = x0 + (plotW / n) * (i + 0.5) - bw / 2;
    const by = baseY - bh;
    bars.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${PALETTE[i % PALETTE.length]}" rx="2"/><text x="${(bx + bw / 2).toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333">${values[i]}</text>`);
  }
  return `${head}${titleEl}${axis}${bars.join("")}${labelEls.join("")}${foot}`;
}

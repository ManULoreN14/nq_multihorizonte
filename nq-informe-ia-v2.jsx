import { useState, useEffect, useRef } from "react";

const JSON_URL = "https://nq-multihorizonte.vercel.app/datos_radar.json";
const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-20250514";

// Storage keys
const STORAGE = {
  INDEX: "informes:index",       // Array de metadata para listado rápido
  INFORME: (id) => `informe:${id}`, // Contenido completo de un informe
};

const ESCENARIOS = {
  expansion_sostenida: { label: "Expansión Sostenida", sub: "Régimen alcista estable, comprar en caídas", color: "#0F6E56", bg: "#EAF3DE", icon: "ti-trending-up", detector: "Todos horizontes verdes · GEX+ · VIX contango · COT acumulación · sin divergencias" },
  distribucion_techo: { label: "Distribución de Techo", sub: "Agotamiento: precio alto, internas se deterioran", color: "#BA7517", bg: "#FAEEDA", icon: "ti-alert-octagon", detector: "RSI>70 + divergencia bajista + dealers distribuyendo + insiders vendiendo + Z>1.5" },
  rebote_tactico: { label: "Rebote Táctico (Trampa)", sub: "Corto plazo verde sobre fondo rojo — short squeeze", color: "#7F77DD", bg: "#EEEDFE", icon: "ti-bounce-right", detector: "Score 2D-5D alcista, scores 2S-4W bajistas · CTA short bias · macro débil" },
  caida_severa: { label: "Caída Severa", sub: "Estrés de liquidez, riesgo de cola", color: "#A32D2D", bg: "#FCEBEB", icon: "ti-trending-down", detector: "VIX backwardation + GEX negativo + PCR>1.3 + HY spread↑ + ruptura EMA21" },
  capitulacion: { label: "Capitulación / Suelo", sub: "Pánico extremo — señal contraria alcista", color: "#185FA5", bg: "#E6F1FB", icon: "ti-arrow-bear-right-2", detector: "PCR>1.5 + VIX%il>85 + insiders comprando agresivo + COT extremo corto" },
  rango_compresion: { label: "Rango / Compresión Gamma", sub: "Pin entre muros — espera evento", color: "#888780", bg: "#F1EFE8", icon: "ti-arrows-horizontal", detector: "Precio pineado a max pain · GEX+ extremo · IV baja · scores neutros" },
};
const ESC_KEYS = Object.keys(ESCENARIOS);

const DIMENSIONES = [
  { k: "tecnico_corto", label: "Técnico corto (2D-5D)", icon: "ti-chart-candle" },
  { k: "tecnico_medio", label: "Técnico medio (1S-4W)", icon: "ti-chart-line" },
  { k: "macro", label: "Macro (Fed, tipos, crédito)", icon: "ti-world" },
  { k: "derivados", label: "Derivados (GEX, PCR, OI)", icon: "ti-grid-dots" },
  { k: "flujos_institucionales", label: "Flujos institucionales (COT, insiders)", icon: "ti-building-bank" },
  { k: "sentiment", label: "Sentiment (VIX, breadth)", icon: "ti-mood-search" },
  { k: "regime_history", label: "Regime History (MRM)", icon: "ti-fingerprint" },
];

const fmt = (v, d = 2) => v == null ? "--" : Number(v).toFixed(d);
const fmtK = v => v == null ? "--" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(v);

// ─────────────────────────────────────────────────────────────────────────
// STORAGE HELPERS
// ─────────────────────────────────────────────────────────────────────────
async function storageGet(key) {
  try {
    const r = await window.storage.get(key);
    return r ? r.value : null;
  } catch { return null; }
}
async function storageSet(key, value) {
  try { return await window.storage.set(key, value); }
  catch (e) { console.error("Storage set failed:", e); return null; }
}
async function storageDelete(key) {
  try { return await window.storage.delete(key); }
  catch { return null; }
}

async function loadIndex() {
  const raw = await storageGet(STORAGE.INDEX);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveInforme(meta, contenido) {
  // Guardar contenido
  await storageSet(STORAGE.INFORME(meta.id), JSON.stringify(contenido));
  // Actualizar índice
  const idx = await loadIndex();
  idx.unshift(meta);          // más reciente primero
  const trimmed = idx.slice(0, 30); // máx 30 informes
  await storageSet(STORAGE.INDEX, JSON.stringify(trimmed));
  return trimmed;
}

async function loadInforme(id) {
  const raw = await storageGet(STORAGE.INFORME(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function deleteInforme(id) {
  await storageDelete(STORAGE.INFORME(id));
  const idx = await loadIndex();
  const next = idx.filter(x => x.id !== id);
  await storageSet(STORAGE.INDEX, JSON.stringify(next));
  return next;
}

async function clearAllInformes() {
  const idx = await loadIndex();
  for (const m of idx) {
    await storageDelete(STORAGE.INFORME(m.id));
  }
  await storageDelete(STORAGE.INDEX);
  return [];
}

// ─────────────────────────────────────────────────────────────────────────
// Construcción del payload de datos
// ─────────────────────────────────────────────────────────────────────────
function buildDataSummary(D) {
  if (!D) return "";
  const p = D.precio || {}, t = D.tecnicos?.d || {}, tw = D.tecnicos?.w || {};
  const cot = D.cot || {}, macro = D.macro || {}, fred = macro.fred || {};
  const vts = D.vixTS || {}, opc = D.opciones || {}, pcr = D.pcr || {};
  const cc = D.comparativa_correcciones || {}, amp = D.amplitud_mercado || {};
  const sc = D.scores || {}, hs = sc.horizontes || {};
  const ins = D.sec_insiders || {}, cta = D.cta_levels || {};
  const giro = D.giro || {}, flows = D.flows || {}, liq = D.liquidez || {};

  return `═══ DATOS CUANTITATIVOS NDX (${(D.ts || "").slice(0, 16).replace("T", " ")} UTC) ═══

PRECIOS
NDX=${fmt(p.ndx, 0)} | QQQ=${fmt(p.qqq)} | SPY=${fmt(p.spy)} | VIX=${fmt(p.vix, 1)} (%il=${vts.vixPercentil}) | VXN=${fmt(p.vxn, 1)}
DXY=${fmt(p.dxy, 2)} | TNX=${fmt(p.tnx, 3)}% | Oro=${fmt(p.oro, 0)}

TÉCNICO NDX DIARIO
RSI14=${fmt(t.rsi14, 1)} | RSI5=${fmt(t.rsi5, 1)} | Stoch K/D=${fmt(t.stoch?.k)}/${fmt(t.stoch?.d)}
MACD: línea=${fmt(t.macd?.line, 0)} señal=${fmt(t.macd?.signal, 0)} hist=${fmt(t.macd?.hist, 0)}
EMAs: 8=${fmt(t.ema8, 0)} 21=${fmt(t.ema21, 0)} 50=${fmt(t.ema50, 0)} 200=${fmt(t.ema200, 0)}
BB %B=${fmt(t.bb?.pct, 1)}% Width=${fmt(t.bb?.width, 1)}% | ATR14=${fmt(t.atr14, 0)}
ROC5d=${fmt(t.roc5, 2)}% ROC20d=${fmt(t.roc20, 2)}% | VolRatio5=${fmt(t.volRatio5, 2)}

TÉCNICO NDX SEMANAL
RSI14=${fmt(tw.rsi14, 1)} | Stoch K/D=${fmt(tw.stoch?.k)}/${fmt(tw.stoch?.d)}
BB %B=${fmt(tw.bb?.pct, 1)}% | MACD hist=${fmt(tw.macd?.hist, 0)} | ROC4s=${fmt(tw.roc4, 2)}% ROC8s=${fmt(tw.roc8, 2)}%

GIRO/DIVERGENCIAS
divAlcista diaria=${giro.d?.divAlcista} divBajista diaria=${giro.d?.divBajista}
divAlcista semanal=${giro.w?.divAlcista} divBajista semanal=${giro.w?.divBajista}
BB señal=${giro.bb?.señal} | Días consec=${giro.diasConsec?.dias} dir=${giro.diasConsec?.dir}
SEÑAL GLOBAL DE GIRO=${giro.señalGlobal?.toUpperCase()}

VIX TERM STRUCTURE
Spot=${fmt(vts.spot, 1)} VIX3M=${fmt(vts.vix3m, 1)} Spread=+${fmt(vts.spread1Pct, 1)}%
BACKWARDATION=${vts.backwardation ? "SÍ ⚠️ PÁNICO" : "NO (contango — complacencia)"}
${vts.desc}

SCORES MULTI-HORIZONTE
${Object.entries(hs).map(([k, v]) => `${k.toUpperCase()}=${v.score > 0 ? "+" : ""}${fmt(v.score, 1)} (${v.estado}, conf=${v.conf}%)`).join(" | ")}
Componentes: T=${fmt(sc.componentes?.tecnico, 1)} M=${fmt(sc.componentes?.macro, 1)} C=${fmt(sc.componentes?.cot, 1)} V=${fmt(sc.componentes?.vix, 1)} F=${fmt(sc.componentes?.flujos, 1)} G=${fmt(sc.componentes?.giro, 1)} A=${fmt(sc.componentes?.amplitud, 1)}

COT (CFTC ${cot.fecha})
Largos=${cot.largos} Cortos=${cot.cortos} Neto=${cot.neto > 0 ? "+" : ""}${cot.neto}
%Largo=${fmt(cot.pctLargo, 1)}% | CambioNeto semanal=${cot.cambioNeto > 0 ? "+" : ""}${cot.cambioNeto}
Dealers neto=${cot.netoDealers} | SEÑAL DEALERS=${(cot.señalDealers || cot.senalDealers || "").toUpperCase()}
Señal COT=${cot.señal?.toUpperCase()} | ${cot.desc}

SEC INSIDERS (Form 4 — 90 días)
Compras=${fmtK(ins.compras_90d)} USD | Ventas=${fmtK(ins.ventas_90d)} USD | Ratio=${fmt(ins.ratio, 2)}
SEÑAL=${(ins.senal || ins.señal || "--").toUpperCase()}

OPCIONES (QQQ)
MaxPain v1=${opc.v1?.maxPain} (dist=${fmt(opc.v1?.distPct, 2)}%) | v3=${opc.v3?.maxPain} (dist=${fmt(opc.v3?.distPct, 2)}%)
GEX=${opc.gex?.estado?.toUpperCase()} (${opc.gex?.valor}) | ${opc.gex?.desc}
PCR OI=${fmt(opc.pcrOI, 3)} | PCR Vol=${fmt(opc.pcrVol, 3)}
PCR Total CBOE=${fmt(pcr.total, 3)} | SEÑAL PCR=${pcr.señal?.toUpperCase()}

CTA TRIGGERS (Donchian)
Don20H=${cta.don20_high || "--"} Don20L=${cta.don20_low || "--"} Don50H=${cta.don50_high || "--"} Don50L=${cta.don50_low || "--"}
Señal CTA=${(cta.senal_cta || cta.señal_cta || "--").toUpperCase()}

MACRO (FRED)
HY Spread=${fmt(fred.hySpread?.v, 2)}% (prev=${fmt(fred.hySpread?.prev, 2)}, trend=${fred.hySpread?.trend})
NFCI=${fmt(fred.nfci?.v, 3)} (prev=${fmt(fred.nfci?.prev, 3)}, trend=${fred.nfci?.trend})
Tipo Real 10Y=${fmt(fred.tipoReal10y?.v, 2)}% (trend=${fred.tipoReal10y?.trend}) | DRENAJE LIQUIDEZ=${macro.tiposRealesOro?.alerta ? "SÍ" : "NO"}
Liquidez Neta Fed=${macro.liquidezNeta?.valor ? (macro.liquidezNeta.valor / 1e6).toFixed(2) + "T USD" : "--"} (trend=${macro.liquidezNeta?.trend})
DXY corr30d QQQ=${fmt(macro.dxy?.corr30d, 3)} | corr90d=${fmt(macro.dxy?.corr90d, 3)}
Score macro=${fmt(macro.score, 1)}

FLUJOS ETF (modo=${flows.modo})
QQQ 5d=${fmt(flows.qqq?.retorno5d, 2)}% volRatio=${fmt(flows.qqq?.volRatio, 2)}
SPY 5d=${fmt(flows.spy?.retorno5d, 2)}% | TLT 5d=${fmt(flows.tlt?.retorno5d, 2)}% | HYG 5d=${fmt(flows.hyg?.retorno5d, 2)}%
GLD 5d=${fmt(flows.gld?.retorno5d, 2)}% | EEM 5d=${fmt(flows.eem?.retorno5d, 2)}% | IWM 5d=${fmt(flows.iwm?.retorno5d, 2)}%

AMPLITUD & KELLY
Ratio Cobre/Oro=${fmt(amp.ratio_cobre_oro, 5)} (${amp.señal_cobre_oro})
Z-Score QQQ vs SMA200=${fmt(amp.zscore_qqq_sma200, 3)} (${amp.señal_zscore})
Estacionalidad: ${amp.descripcion_estacional}
Kelly bruto=${fmt(amp.kelly_bruto, 3)} | VIX scalar=${fmt(amp.vix_scalar, 3)} | FACTOR EXPOSICIÓN=${fmt(amp.factor_exposicion_recomendado, 3)}

MARKET REGIME MATCHING (firma vs histórico 2000-presente)
Micro 2-3%=${cc.micro_3pct}% | Técnica 5-7%=${cc.tecnica_7pct}% | Macro 10-15%=${cc.macro_15pct}%
Bajista 20-25%=${cc.bajista_25pct}% | Cisne negro +30%=${cc.cisne_negro_30pct}%
Dominante=${cc.escenario_dominante} (confianza=${cc.confianza}%) | Reco=${cc.recomendacion}

ZONAS DE LIQUIDEZ (Order Blocks)
${(liq.zonasResistencia || []).slice(0, 3).map(z => `R: ${z.nivel} (${fmt(z.distPct, 1)}%, cnt=${z.cnt})`).join(" | ")}
${(liq.zonasSoporte || []).slice(0, 3).map(z => `S: ${z.nivel} (${fmt(z.distPct, 1)}%, cnt=${z.cnt})`).join(" | ")}
`;
}

function buildHaikuPrompt(D) {
  return `Eres un clasificador cuantitativo de régimen de mercado para Nasdaq 100. Analiza los siguientes datos y devuelve EXCLUSIVAMENTE un objeto JSON válido, sin markdown, sin texto antes o después, sin backticks.

${buildDataSummary(D)}

═══ ESCENARIOS POSIBLES (asignar probabilidad 0-100 a cada uno) ═══

1. expansion_sostenida — Régimen alcista estable. Todos horizontes verdes alineados, GEX positivo, VIX contango, COT acumulando, sin divergencias bajistas.
2. distribucion_techo — Agotamiento de techo. Precio elevado pero internas se deterioran: RSI>70 + divergencias bajistas + dealers distribuyendo + insiders vendiendo + Z-score>1.5 + estacionalidad débil. Suele preceder a caídas.
3. rebote_tactico — Trampa alcista / short squeeze. Score 2D-5D alcista pero scores 2S-4W bajistas. Rebote mecánico contra tendencia bajista de fondo.
4. caida_severa — Estrés de liquidez. VIX backwardation, GEX negativo, PCR extremo, HY spread subiendo, ruptura EMA21 con volumen.
5. capitulacion — Pánico extremo, señal contraria alcista. PCR>1.5, VIX percentil>85, insiders comprando agresivo, COT extremo corto.
6. rango_compresion — Guerra de Gamma. Precio pineado en max pain, GEX positivo extremo, IV baja, scores neutros.

DEVUELVE EXACTAMENTE ESTE JSON:

{
  "escenarios": {
    "expansion_sostenida": <0-100>,
    "distribucion_techo": <0-100>,
    "rebote_tactico": <0-100>,
    "caida_severa": <0-100>,
    "capitulacion": <0-100>,
    "rango_compresion": <0-100>
  },
  "dimensiones": {
    "tecnico_corto": "<BULL|BEAR|NEUTRAL>",
    "tecnico_medio": "<BULL|BEAR|NEUTRAL>",
    "macro": "<BULL|BEAR|NEUTRAL>",
    "derivados": "<BULL|BEAR|NEUTRAL>",
    "flujos_institucionales": "<BULL|BEAR|NEUTRAL>",
    "sentiment": "<BULL|BEAR|NEUTRAL>",
    "regime_history": "<BULL|BEAR|NEUTRAL>"
  },
  "senales_clave": ["<3-5 señales con cifras exactas>"],
  "alertas_criticas": ["<0-3 alertas>"],
  "divergencias": ["<contradicciones>"],
  "escenario_ganador": "<clave del escenario con mayor probabilidad>",
  "confianza": <0-100>
}

Las probabilidades NO tienen que sumar 100. Sé estricto: si los datos no apoyan claramente un escenario, asigna probabilidad baja.`;
}

function buildSonnetPrompt(D, haikuJson, prevInforme = null) {
  let comparativo = "";
  if (prevInforme && prevInforme.haikuJson) {
    const prev = prevInforme.haikuJson.escenarios || {};
    const curr = haikuJson.escenarios || {};
    const deltas = Object.keys(curr).map(k => {
      const d = (curr[k] || 0) - (prev[k] || 0);
      return `  ${k}: ${prev[k] || 0}% → ${curr[k] || 0}% (Δ ${d > 0 ? "+" : ""}${d})`;
    }).join("\n");
    comparativo = `\n═══ COMPARATIVA vs INFORME ANTERIOR (${prevInforme.ts?.slice(0, 16).replace("T", " ")}) ═══\n${deltas}\nEscenario ganador anterior: ${prevInforme.haikuJson.escenario_ganador}\n`;
  }

  return `Eres un Portfolio Manager institucional senior especializado en Nasdaq 100. Recibes datos cuantitativos brutos + clasificación previa de un modelo más rápido${prevInforme ? " + comparativa con informe anterior" : ""}. Tu trabajo es validar o refutar esa clasificación y construir un análisis CAUSAL con plan de acción concreto.

${buildDataSummary(D)}

═══ PRE-CLASIFICACIÓN HAIKU ═══

Escenario ganador: ${haikuJson.escenario_ganador} (confianza ${haikuJson.confianza}%)
${Object.entries(haikuJson.escenarios || {}).map(([k, v]) => `  ${k}: ${v}%`).join("\n")}

Dimensiones:
${Object.entries(haikuJson.dimensiones || {}).map(([k, v]) => `  ${k}: ${v}`).join("\n")}

Señales: ${(haikuJson.senales_clave || []).join(" | ")}
Alertas: ${(haikuJson.alertas_criticas || []).join(" | ") || "ninguna"}
Divergencias: ${(haikuJson.divergencias || []).join(" | ") || "ninguna"}
${comparativo}
═══════════════════════════════════════════════════════

GENERA EL INFORME CON EXACTAMENTE ESTAS 6 SECCIONES (## H2 markdown). Cita datos exactos.

## DIAGNÓSTICO DEL RÉGIMEN
¿Confirmas el escenario ganador de Haiku o lo refutas? Si lo refutas, explica por qué. Probabilidad final por escenario en una línea. Estamos en X porque [cadena causal corta].${prevInforme ? " Comenta cambios respecto al informe anterior." : ""}

## CADENA CAUSAL
Cadena de causas-efectos: Causa raíz → Efecto intermedio → Manifestación observable. Mínimo 2 cadenas, máximo 4. Cita datos.

## EVIDENCIA POR CAPA
Una línea por capa: TÉCNICO / MACRO / DERIVADOS / FLUJOS / SENTIMENT / REGIME HISTORY.

## DIVERGENCIAS Y CONTRADICCIONES
¿Qué capa miente o adelanta a las demás? ¿COT vs insiders? ¿Precio vs internas?

## CATALIZADORES Y NIVELES DE TRANSICIÓN
- Nivel exacto que invalida el diagnóstico.
- Evento macro pendiente.
- Señal técnica de adelanto.

## PLAN DE ACCIÓN EJECUTIVO
3-5 líneas. Exposición % (basado en Kelly del sistema), niveles, stops, objetivos, decisión clara.

Tono profesional, directo. Cita siempre datos.`;
}

async function callHaiku(D) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: HAIKU,
      max_tokens: 1500,
      messages: [{ role: "user", content: buildHaikuPrompt(D) }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Haiku HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Haiku no devolvió JSON parseable");
  return { json: JSON.parse(m[0]), usage: data.usage };
}

async function callSonnetStreaming(D, haikuJson, prevInforme, onChunk, abortSignal) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortSignal,
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 2500,
      stream: true,
      messages: [{ role: "user", content: buildSonnetPrompt(D, haikuJson, prevInforme) }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sonnet HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "", buf = "", usage = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const obj = JSON.parse(raw);
        if (obj.type === "content_block_delta" && obj.delta?.text) {
          full += obj.delta.text;
          onChunk(full);
        }
        if (obj.type === "message_delta" && obj.usage) usage = obj.usage;
        if (obj.type === "message_start" && obj.message?.usage) usage = { ...obj.message.usage, ...(usage || {}) };
      } catch {}
    }
  }
  return { text: full, usage };
}

function parseReport(text) {
  const sections = [];
  const lines = text.split("\n");
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/);
    if (m) { if (current) sections.push(current); current = { title: m[1].trim(), content: [] }; }
    else if (current) current.content.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENTES
// ─────────────────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, highlight }) {
  return (
    <div style={{ background: highlight ? "var(--color-background-warning)" : "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 12px", border: highlight ? "0.5px solid var(--color-border-warning)" : "none" }}>
      <div style={{ fontSize: 10, color: highlight ? "var(--color-text-warning)" : "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--color-text-primary)", lineHeight: 1.3 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ScenarioBar({ k, prob, isWinner, prevProb }) {
  const cfg = ESCENARIOS[k];
  const delta = prevProb != null ? prob - prevProb : null;
  return (
    <div style={{ marginBottom: 10, padding: isWinner ? "12px 14px" : "8px 12px", background: isWinner ? cfg.bg : "transparent", borderRadius: "var(--border-radius-md)", border: isWinner ? `2px solid ${cfg.color}` : "0.5px solid var(--color-border-tertiary)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <i className={`ti ${cfg.icon}`} style={{ fontSize: 14, color: cfg.color }} aria-hidden="true" />
          <span style={{ fontSize: 13, fontWeight: isWinner ? 500 : 400, color: isWinner ? cfg.color : "var(--color-text-primary)" }}>{cfg.label}</span>
          {isWinner && <span style={{ fontSize: 9, background: cfg.color, color: "#fff", padding: "1px 6px", borderRadius: 8, letterSpacing: 0.5 }}>GANADOR</span>}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          {delta != null && delta !== 0 && (
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: delta > 0 ? "var(--color-text-success)" : "var(--color-text-danger)" }}>
              {delta > 0 ? "▲+" : "▼"}{delta}
            </span>
          )}
          <span style={{ fontSize: 13, fontWeight: 500, fontFamily: "var(--font-mono)", color: cfg.color }}>{prob}%</span>
        </div>
      </div>
      <div style={{ height: 5, background: "var(--color-background-secondary)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${prob}%`, height: "100%", background: cfg.color, borderRadius: 3, transition: "width 1.2s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
      {isWinner && <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 6, lineHeight: 1.5 }}>{cfg.sub}</div>}
    </div>
  );
}

function DimensionRow({ dim, value }) {
  const colors = {
    BULL: { bg: "var(--color-background-success)", fg: "var(--color-text-success)" },
    BEAR: { bg: "var(--color-background-danger)", fg: "var(--color-text-danger)" },
    NEUTRAL: { bg: "var(--color-background-secondary)", fg: "var(--color-text-secondary)" },
  };
  const c = colors[value] || colors.NEUTRAL;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
      <span style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
        <i className={`ti ${dim.icon}`} style={{ fontSize: 13 }} aria-hidden="true" />{dim.label}
      </span>
      <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0.5, padding: "3px 10px", borderRadius: 10, background: c.bg, color: c.fg, fontFamily: "var(--font-mono)" }}>{value || "--"}</span>
    </div>
  );
}

function SectionCard({ section }) {
  const colorMap = { "DIAGNÓSTICO DEL RÉGIMEN": "#185FA5", "CADENA CAUSAL": "#534AB7", "EVIDENCIA POR CAPA": "#0F6E56", "DIVERGENCIAS Y CONTRADICCIONES": "#BA7517", "CATALIZADORES Y NIVELES DE TRANSICIÓN": "#D85A30", "PLAN DE ACCIÓN EJECUTIVO": "#3B6D11" };
  const iconMap = { "DIAGNÓSTICO DEL RÉGIMEN": "ti-stethoscope", "CADENA CAUSAL": "ti-arrows-right-left", "EVIDENCIA POR CAPA": "ti-stack-2", "DIVERGENCIAS Y CONTRADICCIONES": "ti-alert-triangle", "CATALIZADORES Y NIVELES DE TRANSICIÓN": "ti-bolt", "PLAN DE ACCIÓN EJECUTIVO": "ti-target-arrow" };
  const color = colorMap[section.title] || "#185FA5";
  const icon = iconMap[section.title] || "ti-file-text";
  return (
    <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderLeft: `3px solid ${color}`, borderRadius: "0 var(--border-radius-lg) var(--border-radius-lg) 0", padding: "14px 18px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <i className={`ti ${icon}`} style={{ fontSize: 16, color }} aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 500, color, letterSpacing: 0.5, textTransform: "uppercase" }}>{section.title}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{section.content.join("\n").trim()}</div>
    </div>
  );
}

function PipelineStep({ num, label, status, time, model, tokens }) {
  const colors = {
    idle: { bg: "var(--color-background-secondary)", fg: "var(--color-text-tertiary)", icon: "ti-circle" },
    running: { bg: "var(--color-background-info)", fg: "var(--color-text-info)", icon: "ti-loader-2" },
    done: { bg: "var(--color-background-success)", fg: "var(--color-text-success)", icon: "ti-circle-check" },
    error: { bg: "var(--color-background-danger)", fg: "var(--color-text-danger)", icon: "ti-circle-x" },
  };
  const c = colors[status];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: c.bg, borderRadius: "var(--border-radius-md)", flex: 1 }}>
      <i className={`ti ${c.icon}`} style={{ fontSize: 16, color: c.fg, animation: status === "running" ? "spin 1s linear infinite" : "none" }} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: c.fg, fontWeight: 500, lineHeight: 1.2 }}>{num}. {label}</div>
        <div style={{ fontSize: 9, color: c.fg, opacity: 0.7, fontFamily: "var(--font-mono)" }}>
          {model}{time != null ? ` · ${time}ms` : ""}{tokens != null ? ` · ${tokens}t` : ""}
        </div>
      </div>
    </div>
  );
}

// Sparkline SVG inline — evolución temporal de probabilidades del ganador
function EvolutionSparkline({ history, currentGanador }) {
  if (!history || history.length < 2) return null;
  const data = history.slice().reverse(); // cronológico ascendente
  const W = 620, H = 100, pad = 8;
  const cfg = ESCENARIOS[currentGanador];
  if (!cfg) return null;
  const values = data.map(d => d.escenarios?.[currentGanador] || 0);
  const max = 100, min = 0;
  const stepX = (W - pad * 2) / Math.max(1, data.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (H - pad * 2) * (1 - (v - min) / (max - min));
    return [x, y];
  });
  const pathD = points.map((p, i) => (i === 0 ? "M" : "L") + p[0] + " " + p[1]).join(" ");
  const areaD = pathD + ` L${points[points.length - 1][0]} ${H - pad} L${points[0][0]} ${H - pad} Z`;
  return (
    <div style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px 12px", marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        <i className="ti ti-timeline" style={{ marginRight: 4 }} />
        Evolución de "{cfg.label}" — últimos {data.length} informes
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <path d={areaD} fill={cfg.color} opacity="0.15" />
        <path d={pathD} fill="none" stroke={cfg.color} strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={cfg.color} />
        ))}
        {/* Líneas de referencia 25/50/75 */}
        {[25, 50, 75].map(ref => {
          const y = pad + (H - pad * 2) * (1 - ref / 100);
          return <line key={ref} x1={pad} y1={y} x2={W - pad} y2={y} stroke="var(--color-border-tertiary)" strokeDasharray="2 3" strokeWidth="0.5" />;
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
        <span>{data[0].ts?.slice(5, 16).replace("T", " ")}</span>
        <span>min {Math.min(...values)}% · max {Math.max(...values)}% · ahora {values[values.length - 1]}%</span>
        <span>{data[data.length - 1].ts?.slice(5, 16).replace("T", " ")}</span>
      </div>
    </div>
  );
}

function HistoryItem({ item, active, onClick, onDelete }) {
  const cfg = ESCENARIOS[item.ganador] || ESCENARIOS.expansion_sostenida;
  return (
    <div style={{
      padding: "8px 10px",
      background: active ? cfg.bg : "var(--color-background-primary)",
      border: `0.5px solid ${active ? cfg.color : "var(--color-border-tertiary)"}`,
      borderLeft: `3px solid ${cfg.color}`,
      borderRadius: "0 var(--border-radius-md) var(--border-radius-md) 0",
      marginBottom: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
    }} onClick={onClick}>
      <i className={`ti ${cfg.icon}`} style={{ fontSize: 14, color: cfg.color }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-primary)" }}>
          {cfg.label} <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>({item.confianza}%)</span>
        </div>
        <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--color-text-tertiary)" }}>
          {item.ts?.slice(5, 16).replace("T", " ")} · NDX {item.ndx?.toFixed(0)} · VIX {item.vix?.toFixed(1)}
        </div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} style={{ fontSize: 10, padding: "2px 6px", color: "var(--color-text-danger)" }} title="Eliminar">
        <i className="ti ti-trash" aria-hidden="true" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────
export default function InformeIAInstitucional() {
  const [data, setData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [errorData, setErrorData] = useState(null);

  const [haikuStatus, setHaikuStatus] = useState("idle");
  const [haikuTime, setHaikuTime] = useState(null);
  const [haikuTokens, setHaikuTokens] = useState(null);
  const [haikuJson, setHaikuJson] = useState(null);

  const [sonnetStatus, setSonnetStatus] = useState("idle");
  const [sonnetTime, setSonnetTime] = useState(null);
  const [sonnetTokens, setSonnetTokens] = useState(null);
  const [sonnetText, setSonnetText] = useState("");

  const [pipelineError, setPipelineError] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState("live"); // "live" | "history"
  const [comparePrev, setComparePrev] = useState(true);
  const [savedOk, setSavedOk] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => { loadData(); loadHistoryFromStorage(); }, []);

  async function loadHistoryFromStorage() {
    const idx = await loadIndex();
    setHistory(idx);
  }

  async function loadData() {
    setLoadingData(true);
    setErrorData(null);
    try {
      const res = await fetch(JSON_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setErrorData(`No se pudo cargar el JSON desde Vercel. ${e.message}`);
    } finally {
      setLoadingData(false);
    }
  }

  async function runPipeline() {
    if (!data) return;
    setPipelineError(null);
    setHaikuJson(null);
    setSonnetText("");
    setHaikuStatus("running");
    setHaikuTime(null);
    setHaikuTokens(null);
    setSonnetStatus("idle");
    setSonnetTime(null);
    setSonnetTokens(null);
    setSavedOk(false);
    setActiveId(null);
    setView("live");

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    // Cargar informe anterior si comparePrev activo
    let prevInforme = null;
    if (comparePrev && history.length > 0) {
      prevInforme = await loadInforme(history[0].id);
    }

    // ── Paso 1: Haiku ──
    const t0 = performance.now();
    let hk, hkUsage;
    try {
      const r = await callHaiku(data);
      hk = r.json; hkUsage = r.usage;
      setHaikuTime(Math.round(performance.now() - t0));
      setHaikuTokens(hkUsage ? hkUsage.input_tokens + hkUsage.output_tokens : null);
      setHaikuJson(hk);
      setHaikuStatus("done");
    } catch (e) {
      setHaikuStatus("error");
      setPipelineError(`Haiku falló: ${e.message}`);
      return;
    }

    // ── Paso 2: Sonnet ──
    setSonnetStatus("running");
    const s0 = performance.now();
    let sonnetUsage = null, finalText = "";
    try {
      const r = await callSonnetStreaming(data, hk, prevInforme, (full) => setSonnetText(full), abortRef.current.signal);
      finalText = r.text;
      sonnetUsage = r.usage;
      setSonnetTime(Math.round(performance.now() - s0));
      setSonnetTokens(sonnetUsage ? (sonnetUsage.input_tokens || 0) + (sonnetUsage.output_tokens || 0) : null);
      setSonnetStatus("done");
      setSonnetText(finalText);
    } catch (e) {
      if (e.name !== "AbortError") {
        setSonnetStatus("error");
        setPipelineError(`Sonnet falló: ${e.message}`);
        return;
      }
    }

    // ── Paso 3: Guardar en storage ──
    try {
      const id = "INF" + Date.now().toString(36).toUpperCase();
      const ts = new Date().toISOString();
      const meta = {
        id, ts,
        ganador: hk.escenario_ganador,
        confianza: hk.confianza,
        ndx: data.precio?.ndx,
        vix: data.precio?.vix,
        escenarios: hk.escenarios,
        data_ts: data.ts,
      };
      const contenido = {
        id, ts, data_ts: data.ts,
        haikuJson: hk,
        sonnetText: finalText,
        tokens: {
          haiku_in: hkUsage?.input_tokens, haiku_out: hkUsage?.output_tokens,
          sonnet_in: sonnetUsage?.input_tokens, sonnet_out: sonnetUsage?.output_tokens,
        },
        snapshot_precios: data.precio,
        snapshot_scores: data.scores,
      };
      const newIndex = await saveInforme(meta, contenido);
      setHistory(newIndex);
      setActiveId(id);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e) {
      console.error("Save failed:", e);
    }
  }

  async function loadFromHistory(id) {
    const inf = await loadInforme(id);
    if (!inf) return;
    setHaikuJson(inf.haikuJson);
    setSonnetText(inf.sonnetText);
    setHaikuStatus("done");
    setSonnetStatus("done");
    setHaikuTime(null);
    setSonnetTime(null);
    setHaikuTokens(inf.tokens?.haiku_in + inf.tokens?.haiku_out || null);
    setSonnetTokens(inf.tokens?.sonnet_in + inf.tokens?.sonnet_out || null);
    setActiveId(id);
    setView("live");
  }

  async function handleDelete(id) {
    const next = await deleteInforme(id);
    setHistory(next);
    if (activeId === id) {
      setActiveId(null);
      setHaikuJson(null);
      setSonnetText("");
      setHaikuStatus("idle");
      setSonnetStatus("idle");
    }
  }

  async function handleClearAll() {
    if (!confirm("¿Borrar TODOS los informes guardados? Esta acción no se puede deshacer.")) return;
    await clearAllInformes();
    setHistory([]);
    setActiveId(null);
    setHaikuJson(null);
    setSonnetText("");
    setHaikuStatus("idle");
    setSonnetStatus("idle");
  }

  const sections = sonnetText ? parseReport(sonnetText) : [];
  const escenarios = haikuJson?.escenarios || {};
  const ganador = haikuJson?.escenario_ganador;
  const sortedEsc = Object.entries(escenarios).sort((a, b) => b[1] - a[1]);

  // Previas para mostrar deltas
  const prevEscenarios = (() => {
    if (!activeId || history.length < 2) return null;
    const idx = history.findIndex(h => h.id === activeId);
    if (idx === -1 || idx === history.length - 1) return null;
    return history[idx + 1].escenarios || null;
  })();

  const p = data?.precio || {};
  const t = data?.tecnicos?.d || {};
  const cot = data?.cot || {};
  const amp = data?.amplitud_mercado || {};
  const cc = data?.comparativa_correcciones || {};
  const vts = data?.vixTS || {};

  return (
    <div style={{ fontFamily: "var(--font-sans)", maxWidth: 680, margin: "0 auto", padding: "1rem 0" }}>
      <h2 className="sr-only">Informe IA Institucional NQ Multi-Horizonte con pipeline Haiku + Sonnet y persistencia</h2>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>

      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, paddingBottom: 10, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="ti ti-chart-radar" style={{ fontSize: 20, color: "#185FA5" }} aria-hidden="true" />
            <span style={{ fontSize: 16, fontWeight: 500 }}>NQ Informe IA Institucional</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 4, display: "flex", gap: 10 }}>
            <span><i className="ti ti-brain" style={{ fontSize: 12 }} /> Haiku → Sonnet · {history.length} guardados</span>
            {data && <span>· v{data.version} · {(data.ts || "").slice(0, 16).replace("T", " ")}Z</span>}
          </div>
        </div>
        <button onClick={loadData} disabled={loadingData} style={{ fontSize: 11, padding: "4px 10px" }}>
          <i className="ti ti-refresh" style={{ fontSize: 12, marginRight: 4 }} />{loadingData ? "..." : "Reload"}
        </button>
      </div>

      {/* TABS LIVE / HISTORIAL */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button onClick={() => setView("live")} style={{ flex: 1, padding: "6px 10px", fontSize: 12, background: view === "live" ? "var(--color-background-info)" : "transparent", color: view === "live" ? "var(--color-text-info)" : "var(--color-text-secondary)", border: `0.5px solid ${view === "live" ? "var(--color-border-info)" : "var(--color-border-tertiary)"}`, borderRadius: "var(--border-radius-md)" }}>
          <i className="ti ti-dashboard" style={{ fontSize: 12, marginRight: 4 }} />Live & Análisis
        </button>
        <button onClick={() => setView("history")} style={{ flex: 1, padding: "6px 10px", fontSize: 12, background: view === "history" ? "var(--color-background-info)" : "transparent", color: view === "history" ? "var(--color-text-info)" : "var(--color-text-secondary)", border: `0.5px solid ${view === "history" ? "var(--color-border-info)" : "var(--color-border-tertiary)"}`, borderRadius: "var(--border-radius-md)" }}>
          <i className="ti ti-history" style={{ fontSize: 12, marginRight: 4 }} />Historial ({history.length})
        </button>
      </div>

      {errorData && (
        <div style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", borderRadius: "var(--border-radius-md)", padding: "10px 14px", fontSize: 12, color: "var(--color-text-danger)", marginBottom: 14 }}>
          <i className="ti ti-alert-circle" style={{ marginRight: 6 }} />{errorData}
        </div>
      )}

      {/* ────────────────── VISTA HISTORIAL ────────────────── */}
      {view === "history" && (
        <>
          {history.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", fontSize: 12, color: "var(--color-text-tertiary)" }}>
              <i className="ti ti-archive" style={{ fontSize: 24, display: "block", marginBottom: 8 }} />
              No hay informes guardados todavía. Genera uno desde la pestaña Live.
            </div>
          ) : (
            <>
              {/* Sparkline del escenario más reciente */}
              <EvolutionSparkline history={history} currentGanador={history[0].ganador} />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <i className="ti ti-list" style={{ marginRight: 4 }} />Informes guardados ({history.length}/30)
                </span>
                <button onClick={handleClearAll} style={{ fontSize: 10, padding: "3px 8px", color: "var(--color-text-danger)" }}>
                  <i className="ti ti-trash" style={{ marginRight: 3 }} />Borrar todos
                </button>
              </div>
              {history.map(item => (
                <HistoryItem key={item.id} item={item} active={item.id === activeId} onClick={() => loadFromHistory(item.id)} onDelete={handleDelete} />
              ))}
            </>
          )}
        </>
      )}

      {/* ────────────────── VISTA LIVE ────────────────── */}
      {view === "live" && data && (
        <>
          {/* DASHBOARD */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginBottom: 14 }}>
            <MetricCard label="NDX" value={p.ndx?.toFixed(0)} sub={`ROC20=${fmt(t.roc20, 1)}%`} />
            <MetricCard label="VIX" value={p.vix?.toFixed(1)} sub={`%il=${vts.vixPercentil}`} highlight={vts.backwardation} />
            <MetricCard label="RSI14" value={t.rsi14?.toFixed(1)} sub={t.rsi14 > 70 ? "Sobrecomprado" : t.rsi14 < 30 ? "Sobrevendido" : "Normal"} highlight={t.rsi14 > 70 || t.rsi14 < 30} />
            <MetricCard label="Z-Score" value={fmt(amp.zscore_qqq_sma200, 2)} sub="QQQ vs SMA200" highlight={Math.abs(amp.zscore_qqq_sma200) > 2} />
            <MetricCard label="COT %L" value={fmt(cot.pctLargo, 1) + "%"} sub={cot.señalDealers || cot.senalDealers} highlight={(cot.señalDealers || cot.senalDealers) === "distribucion"} />
            <MetricCard label="Kelly" value={fmt(amp.factor_exposicion_recomendado, 2)} sub="Factor exposición" />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", marginBottom: 14, fontSize: 11 }}>
            <i className="ti ti-fingerprint" style={{ fontSize: 14, color: "var(--color-text-tertiary)" }} />
            <span style={{ color: "var(--color-text-tertiary)" }}>MRM:</span>
            <span style={{ fontWeight: 500 }}>{cc.escenario_dominante}</span>
            <span style={{ color: "var(--color-text-tertiary)" }}>·</span>
            <span style={{ color: "var(--color-text-secondary)" }}>{cc.recomendacion}</span>
          </div>

          {/* CONTROL PIPELINE */}
          {haikuStatus === "idle" && sonnetStatus === "idle" && !activeId && (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={comparePrev} onChange={e => setComparePrev(e.target.checked)} disabled={history.length === 0} style={{ accentColor: "#185FA5" }} />
                Comparar con informe anterior ({history.length > 0 ? history[0].ts?.slice(0, 16).replace("T", " ") : "ninguno guardado"})
              </label>
              <button onClick={runPipeline} style={{ width: "100%", padding: "12px 16px", fontSize: 14, fontWeight: 500, background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)", borderRadius: "var(--border-radius-md)", cursor: "pointer" }}>
                <i className="ti ti-brain" style={{ fontSize: 16, marginRight: 6 }} />Diagnosticar régimen actual con IA ↗
              </button>
            </>
          )}

          {/* Si hay un informe activo del historial */}
          {activeId && haikuStatus === "done" && (
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              <button onClick={() => { setActiveId(null); setHaikuJson(null); setSonnetText(""); setHaikuStatus("idle"); setSonnetStatus("idle"); }} style={{ flex: 1, fontSize: 11, padding: "6px 10px" }}>
                <i className="ti ti-x" style={{ marginRight: 4 }} />Cerrar informe
              </button>
              <button onClick={runPipeline} style={{ flex: 1, fontSize: 11, padding: "6px 10px", background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)" }}>
                <i className="ti ti-refresh" style={{ marginRight: 4 }} />Generar nuevo
              </button>
            </div>
          )}

          {(haikuStatus !== "idle" || sonnetStatus !== "idle") && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <PipelineStep num="1" label="Clasificación rápida" status={haikuStatus} time={haikuTime} tokens={haikuTokens} model="Haiku 4.5" />
              <PipelineStep num="2" label="Análisis causal" status={sonnetStatus} time={sonnetTime} tokens={sonnetTokens} model="Sonnet 4" />
            </div>
          )}

          {savedOk && (
            <div style={{ background: "var(--color-background-success)", border: "0.5px solid var(--color-border-success)", borderRadius: "var(--border-radius-md)", padding: "8px 12px", fontSize: 11, color: "var(--color-text-success)", marginBottom: 12 }}>
              <i className="ti ti-circle-check" style={{ marginRight: 5 }} />Informe guardado en histórico
            </div>
          )}

          {pipelineError && (
            <div style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", borderRadius: "var(--border-radius-md)", padding: "10px 14px", fontSize: 12, color: "var(--color-text-danger)", marginBottom: 14 }}>
              {pipelineError}
              <button onClick={runPipeline} style={{ marginLeft: 10, fontSize: 11, padding: "2px 8px" }}>Reintentar</button>
            </div>
          )}

          {/* RESULTADOS HAIKU */}
          {haikuJson && (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <i className="ti ti-target" style={{ marginRight: 5 }} />Probabilidad por escenario · confianza {haikuJson.confianza}%
                </div>
                {sortedEsc.map(([k, prob]) => (
                  <ScenarioBar key={k} k={k} prob={prob} isWinner={k === ganador} prevProb={prevEscenarios?.[k]} />
                ))}
              </div>

              {ganador && ESCENARIOS[ganador] && (
                <div style={{ padding: "12px 14px", background: ESCENARIOS[ganador].bg, borderRadius: "var(--border-radius-md)", marginBottom: 16, borderLeft: `3px solid ${ESCENARIOS[ganador].color}` }}>
                  <div style={{ fontSize: 10, color: ESCENARIOS[ganador].color, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Patrón detectado</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{ESCENARIOS[ganador].detector}</div>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <i className="ti ti-stack-2" style={{ marginRight: 5 }} />Matriz de dimensiones
                </div>
                <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", overflow: "hidden" }}>
                  {DIMENSIONES.map(dim => <DimensionRow key={dim.k} dim={dim} value={haikuJson.dimensiones?.[dim.k]} />)}
                </div>
              </div>

              {(haikuJson.senales_clave?.length > 0 || haikuJson.alertas_criticas?.length > 0 || haikuJson.divergencias?.length > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginBottom: 16 }}>
                  {haikuJson.senales_clave?.length > 0 && (
                    <div style={{ padding: "10px 12px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)" }}>
                      <div style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-tertiary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}><i className="ti ti-flag" style={{ marginRight: 4 }} />Señales clave</div>
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                        {haikuJson.senales_clave.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {haikuJson.alertas_criticas?.length > 0 && (
                    <div style={{ padding: "10px 12px", background: "var(--color-background-danger)", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-danger)" }}>
                      <div style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-danger)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}><i className="ti ti-alert-octagon" style={{ marginRight: 4 }} />Alertas críticas</div>
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-danger)", lineHeight: 1.7 }}>
                        {haikuJson.alertas_criticas.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                  {haikuJson.divergencias?.length > 0 && (
                    <div style={{ padding: "10px 12px", background: "var(--color-background-warning)", borderRadius: "var(--border-radius-md)", border: "0.5px solid var(--color-border-warning)" }}>
                      <div style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-warning)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}><i className="ti ti-arrows-split" style={{ marginRight: 4 }} />Divergencias</div>
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--color-text-warning)", lineHeight: 1.7 }}>
                        {haikuJson.divergencias.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* INFORME SONNET */}
          {sonnetText && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <i className="ti ti-report-analytics" style={{ marginRight: 5 }} />Análisis causal del PM senior (Sonnet)
                </span>
              </div>
              {sections.length > 0 ? sections.map((s, i) => <SectionCard key={i} section={s} />) : (
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7, whiteSpace: "pre-wrap", padding: "12px 16px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)" }}>{sonnetText}</div>
              )}
            </div>
          )}
        </>
      )}

      {loadingData && !data && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-tertiary)", fontSize: 13 }}>
          <i className="ti ti-loader-2" style={{ fontSize: 22, display: "block", marginBottom: 8, animation: "spin 1s linear infinite" }} />
          Cargando datos desde Vercel...
        </div>
      )}
    </div>
  );
}

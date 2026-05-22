// api/datos-multihor.js
// Backend Vercel Serverless — Radar NQ Multi-Horizonte 2D→4W
// Deploy: vercel.com (free tier) | Requiere: Node 18+

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

  const R = {}; // resultado final

  // ══════════════════════════════════════════════════════════
  //  HELPERS MATEMÁTICOS
  // ══════════════════════════════════════════════════════════
  const ema = (arr, p) => {
    if (arr.length < p) return null;
    const k = 2 / (p + 1);
    let e = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    for (let i = p; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return +e.toFixed(2);
  };
  const sma = (arr, p) => {
    if (arr.length < p) return null;
    return +(arr.slice(-p).reduce((a, b) => a + b, 0) / p).toFixed(2);
  };
  const rsi = (arr, p = 14) => {
    if (arr.length < p * 2) return null;
    let ag = 0, al = 0;
    for (let i = 1; i <= p; i++) {
      const d = arr[i] - arr[i - 1];
      d >= 0 ? ag += d : al -= d;
    }
    ag /= p; al /= p;
    for (let i = p + 1; i < arr.length; i++) {
      const d = arr[i] - arr[i - 1];
      ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
      al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    }
    return al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(2);
  };
  const macd = (arr) => {
    if (arr.length < 35) return null;
    const buildMACD = (closes) => {
      const vals = [];
      for (let i = 26; i <= closes.length; i++) {
        const e12 = ema(closes.slice(0, i), 12);
        const e26 = ema(closes.slice(0, i), 26);
        if (e12 && e26) vals.push(e12 - e26);
      }
      return vals;
    };
    const vals = buildMACD(arr);
    const line = vals[vals.length - 1];
    const sig = vals.length >= 9 ? ema(vals, 9) : null;
    return { line: +line.toFixed(2), signal: sig ? +sig.toFixed(2) : null, hist: sig ? +(line - sig).toFixed(2) : null };
  };
  const atr = (hi, lo, cl, p = 14) => {
    if (!hi || cl.length < p + 1) return null;
    const trs = [];
    for (let i = 1; i < cl.length; i++) {
      trs.push(Math.max(hi[i] - lo[i], Math.abs(hi[i] - cl[i - 1]), Math.abs(lo[i] - cl[i - 1])));
    }
    return +(trs.slice(-p).reduce((a, b) => a + b, 0) / p).toFixed(2);
  };
  const obv = (cl, vol) => {
    if (!vol || cl.length < 2) return null;
    let o = 0;
    for (let i = 1; i < cl.length; i++) {
      o += cl[i] > cl[i - 1] ? vol[i] : cl[i] < cl[i - 1] ? -vol[i] : 0;
    }
    return o;
  };
  const stoch = (hi, lo, cl, p = 14, sm = 3) => {
    const kArr = [];
    for (let i = p - 1; i < cl.length; i++) {
      const h = Math.max(...hi.slice(i - p + 1, i + 1));
      const l = Math.min(...lo.slice(i - p + 1, i + 1));
      kArr.push(h === l ? 50 : (cl[i] - l) / (h - l) * 100);
    }
    const k = kArr[kArr.length - 1];
    const d = kArr.slice(-sm).reduce((a, b) => a + b, 0) / sm;
    return { k: +k.toFixed(1), d: +d.toFixed(1) };
  };
  const bollinger = (cl, p = 20) => {
    const sl = cl.slice(-p);
    const m = sl.reduce((a, b) => a + b, 0) / p;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / p);
    return { upper: +(m + 2 * std).toFixed(2), mid: +m.toFixed(2), lower: +(m - 2 * std).toFixed(2), width: +((4 * std / m) * 100).toFixed(2), pct: +((cl[cl.length - 1] - (m - 2 * std)) / (4 * std) * 100).toFixed(1) };
  };
  const toWeekly = (arr) => {
    const weeks = [];
    for (let i = 0; i < arr.length; i += 5) {
      const sl = arr.slice(i, i + 5).filter(v => v != null);
      if (sl.length) weeks.push(sl[sl.length - 1]);
    }
    return weeks;
  };
  const toMonthly = (arr) => {
    const months = [];
    for (let i = 0; i < arr.length; i += 21) {
      const sl = arr.slice(i, i + 21).filter(v => v != null);
      if (sl.length) months.push(sl[sl.length - 1]);
    }
    return months;
  };

  // ══════════════════════════════════════════════════════════
  //  FETCH HELPERS
  // ══════════════════════════════════════════════════════════
  const yf = async (sym, range = '1y') => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=${range}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d = await r.json();
      const res = d?.chart?.result?.[0];
      if (!res) return null;
      const q = res.indicators?.quote?.[0];
      const cl = [], hi = [], lo = [], vo = [];
      for (let i = 0; i < (q?.close?.length ?? 0); i++) {
        if (q.close[i] != null && q.high[i] != null && q.low[i] != null) {
          cl.push(q.close[i]); hi.push(q.high[i]); lo.push(q.low[i]); vo.push(q.volume?.[i] ?? 0);
        }
      }
      return { cl, hi, lo, vo, ts: res.timestamp || [], meta: res.meta };
    } catch { return null; }
  };
  const fredFetch = async (series, key = 'f15ed9ee86d337183138a81bfd4952cb') => {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&limit=3&sort_order=desc`;
      const r = await fetch(url);
      const d = await r.json();
      const obs = d?.observations?.filter(o => o.value !== '.' && o.value != null);
      if (!obs?.length) return null;
      return { v: +parseFloat(obs[0].value).toFixed(4), prev: obs[1] ? +parseFloat(obs[1].value).toFixed(4) : null, fecha: obs[0].date, trend: obs[1] ? (parseFloat(obs[0].value) > parseFloat(obs[1].value) ? 'up' : 'down') : null };
    } catch { return null; }
  };
  const last = d => d?.cl?.[d.cl.length - 1] ?? null;
  const prev = d => d?.cl?.[d.cl.length - 2] ?? null;
  const pct  = (a, b) => b ? +((a - b) / b * 100).toFixed(2) : null;

  // ══════════════════════════════════════════════════════════
  //  1. FETCH PARALELO — TODOS LOS DATOS A LA VEZ
  // ══════════════════════════════════════════════════════════
  const [
    dNdx, dNdx2y, dNdx5y,
    dQQQ, dQQQ3mo,
    dVIX, dVXN, dVXX,
    dTNX, dIRX, dFVX, dTYX,
    dDXY, dNQ,
    dSPY, dIWM, dGLD, dTLT, dHYG, dEEM
  ] = await Promise.all([
    yf('^NDX', '2y'),   yf('^NDX', '2y'),   yf('^NDX', '5y'),
    yf('QQQ',  '2y'),   yf('QQQ', '3mo'),
    yf('^VIX', '6mo'),  yf('^VXN', '6mo'),  yf('VXX', '3mo'),
    yf('^TNX', '6mo'),  yf('^IRX', '3mo'),  yf('^FVX', '6mo'),  yf('^TYX', '6mo'),
    yf('DX-Y.NYB','6mo'), yf('NQ=F','5d'),
    yf('SPY','3mo'), yf('IWM','3mo'), yf('GLD','3mo'), yf('TLT','3mo'), yf('HYG','3mo'), yf('EEM','3mo')
  ]);

  // ══════════════════════════════════════════════════════════
  //  2. PRECIOS ACTUALES Y BÁSICOS
  // ══════════════════════════════════════════════════════════
  const ndxPrice = last(dNdx);
  R.precio = { ndx: ndxPrice, nq: last(dNQ), qqq: last(dQQQ), vix: last(dVIX), vxn: last(dVXN), dxy: last(dDXY), tnx: last(dTNX) };

  // ══════════════════════════════════════════════════════════
  //  3. INDICADORES TÉCNICOS MULTI-TIMEFRAME
  // ══════════════════════════════════════════════════════════
  const buildTecnicos = (d, label) => {
    if (!d?.cl?.length) return null;
    const cl = d.cl, hi = d.hi, lo = d.lo, vo = d.vo;
    const n = cl.length, p = cl[n - 1];
    const wCl = toWeekly(cl), wHi = toWeekly(hi), wLo = toWeekly(lo);
    const mCl = toMonthly(cl), mHi = toMonthly(hi), mLo = toMonthly(lo);
    return {
      label,
      // Diario
      d: {
        rsi14: rsi(cl, 14), rsi5: rsi(cl.slice(-20), 5),
        macd: macd(cl),
        stoch: cl.length >= 17 ? stoch(hi, lo, cl) : null,
        bb: bollinger(cl),
        ema8: ema(cl, 8), ema13: ema(cl, 13), ema21: ema(cl, 21),
        ema50: ema(cl, 50), ema100: ema(cl, 100), ema200: ema(cl, 200),
        sma20: sma(cl, 20), sma50: sma(cl, 50), sma200: sma(cl, 200),
        atr14: atr(hi, lo, cl, 14),
        obv: obv(cl, vo),
        roc5: cl.length >= 6 ? pct(cl[n-1], cl[n-6]) : null,
        roc10: cl.length >= 11 ? pct(cl[n-1], cl[n-11]) : null,
        roc20: cl.length >= 21 ? pct(cl[n-1], cl[n-21]) : null,
        volRatio5: vo?.length >= 20 ? +(vo.slice(-5).reduce((a,b)=>a+b,0)/5 / (vo.reduce((a,b)=>a+b,0)/vo.length)).toFixed(2) : null,
        precio: p
      },
      // Semanal
      w: wCl.length >= 14 ? {
        rsi14: rsi(wCl, 14),
        macd: macd(wCl),
        stoch: wCl.length >= 17 ? stoch(wHi, wLo, wCl) : null,
        bb: bollinger(wCl),
        ema13: ema(wCl, 13), ema26: ema(wCl, 26), ema52: ema(wCl, 52),
        roc4: pct(wCl[wCl.length-1], wCl[wCl.length-5]),
        roc8: pct(wCl[wCl.length-1], wCl[wCl.length-9])
      } : null,
      // Mensual
      m: mCl.length >= 5 ? {
        rsi14: rsi(mCl, 14),
        ema5: ema(mCl, 5), ema10: ema(mCl, 10), ema20: ema(mCl, 20),
        roc3: pct(mCl[mCl.length-1], mCl[mCl.length-4])
      } : null
    };
  };

  R.tecnicos = buildTecnicos(dNdx, 'NDX');
  R.tecnicosQQQ = buildTecnicos(dQQQ, 'QQQ');

  // ══════════════════════════════════════════════════════════
  //  4. VIX TERM STRUCTURE (spot, VX1, VX2, VX3)
  // ══════════════════════════════════════════════════════════
  await (async () => {
    try {
      const vixSpot = last(dVIX);
      const vix3mData = await yf('^VIX3M', '5d');
      const vix3m = last(vix3mData);
      const vxx = last(dVXX);
      // Futuros VX directo
      const [rVx1, rVx2] = await Promise.allSettled([
        yf('/VX=F', '5d'), yf('VXM25=F', '5d')
      ]);
      const vx1 = rVx1.status === 'fulfilled' ? last(rVx1.value) : null;
      const vx2 = rVx2.status === 'fulfilled' ? last(rVx2.value) : null;

      const sp1 = vix3m && vixSpot ? +(vix3m - vixSpot).toFixed(2) : null;
      const sp1pct = sp1 && vixSpot ? +(sp1 / vixSpot * 100).toFixed(1) : null;
      const back = sp1 !== null ? sp1 < 0 : null;

      // Historial VIX para percentil
      const vixHist = dVIX?.cl ?? [];
      const vixPct = vixHist.length > 20 ? +(vixHist.filter(v => v <= (vixSpot ?? 0)).length / vixHist.length * 100).toFixed(0) : null;

      R.vixTS = {
        spot: vixSpot, vix3m, vx1, vx2, vxx,
        spread1: sp1, spread1Pct: sp1pct,
        backwardation: back,
        vixPercentil: vixPct,
        señal: back ? 'alcista' : sp1pct > 20 ? 'bajista_fuerte' : sp1pct > 10 ? 'bajista' : 'neutro',
        desc: back ? 'VIX backwardation — estrés agudo, rebote probable 2-5d' : sp1pct > 20 ? 'Contango extremo — complacencia máxima, corrección probable' : sp1pct > 10 ? 'Contango elevado — complacencia, vigilar' : 'Term structure normal'
      };
    } catch (e) { R.vixTS = { error: e.message }; }
  })();

  // ══════════════════════════════════════════════════════════
  //  5. CURVA DE TIPOS + MACRO FRED
  // ══════════════════════════════════════════════════════════
  await (async () => {
    try {
      const [t10y2y, t10y3m, hySpread, nfci, walcl, fedfunds, sofr, t5y5y, t5yie, t10yie] = await Promise.all([
        fredFetch('T10Y2Y'), fredFetch('T10Y3M'), fredFetch('BAMLH0A0HYM2'),
        fredFetch('NFCI'), fredFetch('WALCL'), fredFetch('FEDFUNDS'),
        fredFetch('SOFR'), fredFetch('T5Y5Y'), fredFetch('T5YIE'), fredFetch('T10YIE')
      ]);

      // Curva de tipos
      const tnx = last(dTNX), irx = last(dIRX), fvx = last(dFVX), tyx = last(dTYX);
      const sp10_2 = t10y2y?.v ?? null;
      const sp10_3m = t10y3m?.v ?? null;
      const sofrSpread = sofr?.v && fedfunds?.v ? +(sofr.v - fedfunds.v).toFixed(3) : null;

      R.macro = {
        curva: {
          t3m: irx ? +(irx / 10).toFixed(2) : null,
          t5y: fvx ? +(fvx / 10).toFixed(2) : null,
          t10y: tnx ? +(tnx / 10).toFixed(2) : null,
          t30y: tyx ? +(tyx / 10).toFixed(2) : null,
          sp10_2, sp10_3m,
          invertida2y: sp10_2 !== null ? sp10_2 < 0 : null,
          invertida3m: sp10_3m !== null ? sp10_3m < 0 : null,
          señalRecesion: sp10_3m !== null ? sp10_3m < -0.5 ? 'alta' : sp10_3m < 0 ? 'media' : 'baja' : null
        },
        fred: { walcl, fedfunds, hySpread, nfci, sofr, t5y5y, t5yie, t10yie, sofrSpread },
        score: (() => {
          let s = 0;
          if (walcl?.trend === 'up') s += 1; else if (walcl) s -= 1;
          if (fedfunds?.v < 4) s += 1; else if (fedfunds?.v > 5) s -= 1;
          if (hySpread?.v < 3) s += 1; else if (hySpread?.v > 5) s -= 2;
          if (nfci?.v < 0) s += 1; else if (nfci) s -= 1;
          if (sp10_3m !== null) { if (sp10_3m < -0.5) s -= 2; else if (sp10_3m < 0) s -= 1; else s += 0.5; }
          if (sofrSpread !== null && Math.abs(sofrSpread) > 0.5) s -= 2;
          if (t5yie?.v < 2.5) s += 0.5; else if (t5yie?.v > 3) s -= 0.5;
          return +s.toFixed(1);
        })()
      };
    } catch (e) { R.macro = { error: e.message }; }
  })();

  // ══════════════════════════════════════════════════════════
  //  6. COT REPORT — CFTC (mano institucional real)
  // ══════════════════════════════════════════════════════════
  await (async () => {
    try {
      const url = 'https://publicreporting.cftc.gov/api/odata/v1/HistoricalViewOiCSFutonly?$filter=Market_and_Exchange_Names%20eq%20%27NASDAQ%20MINI%20-%20CHICAGO%20MERCANTILE%20EXCHANGE%27&$orderby=Report_Date_as_YYYY_MM_DD%20desc&$top=4&$format=json';
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
      const d = await r.json();
      const rows = d?.value ?? [];
      if (!rows.length) throw new Error('sin datos COT');

      const parseRow = row => ({
        fecha: row.Report_Date_as_YYYY_MM_DD,
        largos: +row.NonComm_Positions_Long_All,
        cortos: +row.NonComm_Positions_Short_All,
        dealers_largo: +row.Comm_Positions_Long_All,
        dealers_corto: +row.Comm_Positions_Short_All,
        neto: +row.NonComm_Positions_Long_All - +row.NonComm_Positions_Short_All,
        netoDealers: +row.Comm_Positions_Long_All - +row.Comm_Positions_Short_All
      });

      const last4 = rows.slice(0, 4).map(parseRow);
      const curr = last4[0], prev4 = last4[1] ?? null;
      const cambioNeto = prev4 ? curr.neto - prev4.neto : null;
      const cambioNetoDealers = prev4 ? curr.netoDealers - prev4.netoDealers : null;
      const total = curr.largos + curr.cortos;
      const pctLargo = total > 0 ? +(curr.largos / total * 100).toFixed(1) : null;
      const pctDealers = (curr.dealers_largo + curr.dealers_corto) > 0 ? +(curr.dealers_largo / (curr.dealers_largo + curr.dealers_corto) * 100).toFixed(1) : null;

      // Tendencia 4 semanas
      const trend4w = last4.length === 4 ? last4[0].neto - last4[3].neto : null;

      // Señal
      let señal = 'neutro', desc;
      if (pctLargo > 75) { señal = 'bajista'; desc = `Specs ${pctLargo}% largos — sobreposicionamiento alcista, contrarian bajista`; }
      else if (pctLargo > 65) { señal = 'bajista_mod'; desc = `Specs ${pctLargo}% largos — posicionamiento elevado, precaución`; }
      else if (pctLargo < 25) { señal = 'alcista'; desc = `Specs ${pctLargo}% largos — capitulación, señal contraria alcista`; }
      else if (pctLargo < 35) { señal = 'alcista_mod'; desc = `Specs ${pctLargo}% largos — posicionamiento bajo, sesgo alcista`; }
      else desc = `Specs ${pctLargo}% largos — posicionamiento neutral`;

      // Señal Dealers (smart money): si dealers suben neto mientras specs bajan = acumulación
      let señalDealers = 'neutro';
      if (cambioNetoDealers > 0 && cambioNeto < 0) señalDealers = 'acumulacion';
      else if (cambioNetoDealers < 0 && cambioNeto > 0) señalDealers = 'distribucion';

      R.cot = {
        fecha: curr.fecha, largos: curr.largos, cortos: curr.cortos, neto: curr.neto,
        netoDealers: curr.netoDealers, cambioNeto, cambioNetoDealers,
        pctLargo, pctDealers, trend4w, señal, desc, señalDealers,
        historial: last4, fuente: 'cftc_api'
      };
    } catch (e) { R.cot = { error: e.message }; }
  })();

  // ══════════════════════════════════════════════════════════
  //  7. OPCIONES — OI POR STRIKE (multi-vencimiento)
  // ══════════════════════════════════════════════════════════
  await (async () => {
    try {
      const expUrl = 'https://query1.finance.yahoo.com/v7/finance/options/QQQ';
      const er = await fetch(expUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const ed = await er.json();
      const exps = ed?.optionChain?.result?.[0]?.expirationDates ?? [];
      if (!exps.length) throw new Error('sin vencimientos');

      const precio = ed?.optionChain?.result?.[0]?.quote?.regularMarketPrice;
      // Analizar los 3 primeros vencimientos
      const vencimientos = exps.slice(0, 3);
      const chains = await Promise.all(vencimientos.map(async exp => {
        const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/options/QQQ?date=${exp}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const d = await r.json();
        return { exp, chain: d?.optionChain?.result?.[0] };
      }));

      // Max Pain por vencimiento
      const calcMaxPain = (calls, puts, strikes) => {
        let min = Infinity, mp = precio;
        for (const s of strikes) {
          let dolor = 0;
          for (const c of calls) if (c.strike < s) dolor += (s - c.strike) * (c.openInterest ?? 0);
          for (const p of puts) if (p.strike > s) dolor += (p.strike - s) * (p.openInterest ?? 0);
          if (dolor < min) { min = dolor; mp = s; }
        }
        return mp;
      };

      const resultados = chains.map(({ exp, chain }) => {
        if (!chain) return null;
        const calls = chain.options?.[0]?.calls ?? [];
        const puts  = chain.options?.[0]?.puts  ?? [];
        const strikes = [...new Set([...calls.map(c => c.strike), ...puts.map(p => p.strike)])].sort((a, b) => a - b);
        const mp = calcMaxPain(calls, puts, strikes);
        const dist = +(((mp - precio) / precio) * 100).toFixed(2);

        const cerca = (arr) => arr.filter(o => Math.abs(o.strike - precio) / precio < 0.12 && (o.openInterest ?? 0) > 0)
          .sort((a, b) => (b.openInterest ?? 0) - (a.openInterest ?? 0)).slice(0, 5)
          .map(o => ({ strike: o.strike, oi: o.openInterest ?? 0, dist: +((o.strike - precio) / precio * 100).toFixed(2) }));

        return {
          fecha: new Date(exp * 1000).toISOString().slice(0, 10),
          maxPain: mp, distPct: dist,
          topCalls: cerca(calls), topPuts: cerca(puts),
          señal: dist > 4 ? 'alcista' : dist < -4 ? 'bajista' : 'neutro',
          desc: dist > 4 ? `Max Pain ${mp} (+${dist}%) — gravedad atrae precio arriba` : dist < -4 ? `Max Pain ${mp} (${dist}%) — gravedad atrae precio abajo` : `Max Pain ${mp} — precio cerca, zona equilibrio`
        };
      }).filter(Boolean);

      // GEX sintético por vencimiento
      const vix = last(dVIX) ?? 20;
      const gexEstado = vix < 16 ? 'positivo_alto' : vix < 20 ? 'positivo' : vix < 25 ? 'neutro' : vix < 30 ? 'negativo' : 'negativo_extremo';
      const gexValor  = vix < 16 ? 3 : vix < 20 ? 2 : vix < 25 ? 0 : vix < 30 ? -2 : -3;
      const trampa    = (R.precio?.vix ?? 0) > ((prev(dVIX) ?? 0) + 1) && (pct(last(dNdx), prev(dNdx)) ?? 0) > 0.3;

      R.opciones = {
        precio, vencimientos: resultados,
        v1: resultados[0] ?? null,
        v2: resultados[1] ?? null,
        v3: resultados[2] ?? null,
        gex: { estado: gexEstado, valor: gexValor, trampa, desc: trampa ? 'TRAMPA: precio sube pero VIX también — posible distribución institucional' : gexEstado === 'positivo_alto' ? 'Gamma positiva alta — dealers estabilizan, mercado en rango' : gexEstado === 'positivo' ? 'Gamma positiva — dealers compran caídas' : gexEstado === 'neutro' ? 'Gamma neutra — transición, mayor incertidumbre' : 'Gamma negativa — dealers amplifican movimientos' },
        fuente: 'yahoo_options'
      };
    } catch (e) { R.opciones = { error: e.message }; }
  })();

  // ══════════════════════════════════════════════════════════
  //  8. ETF FLOWS (QQQ, SPY, TLT, HYG, GLD, EEM — rotación)
  // ══════════════════════════════════════════════════════════
  (() => {
    const calcFlow = (d, name) => {
      if (!d?.cl?.length) return { name, error: 'sin datos' };
      const cl = d.cl, vo = d.vo, n = cl.length;
      const retorno5d = n >= 6 ? pct(cl[n-1], cl[n-6]) : null;
      const retorno10d = n >= 11 ? pct(cl[n-1], cl[n-11]) : null;
      const retorno20d = n >= 21 ? pct(cl[n-1], cl[n-21]) : null;
      const volMedia = vo?.reduce((a, b) => a + b, 0) / (vo?.length ?? 1);
      const vol5dMedia = vo?.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const volRatio = volMedia > 0 ? +(vol5dMedia / volMedia).toFixed(2) : null;
      let señal = 'neutro';
      if (retorno5d > 1 && volRatio > 1.1) señal = 'entradas';
      else if (retorno5d < -1 && volRatio > 1.1) señal = 'salidas';
      else if (retorno5d > 2) señal = 'entradas_mod';
      else if (retorno5d < -2) señal = 'salidas_mod';
      return { name, retorno5d, retorno10d, retorno20d, volRatio, señal };
    };
    R.flows = {
      qqq: calcFlow(dQQQ, 'QQQ'), spy: calcFlow(dSPY, 'SPY'),
      tlt: calcFlow(dTLT, 'TLT'), hyg: calcFlow(dHYG, 'HYG'),
      gld: calcFlow(dGLD, 'GLD'), eem: calcFlow(dEEM, 'EEM'), iwm: calcFlow(dIWM, 'IWM'),
      // Risk-on/off: QQQ up + TLT down + HYG up = risk-on
      modo: (() => {
        const qr = calcFlow(dQQQ, 'QQQ').retorno5d ?? 0;
        const tr = calcFlow(dTLT, 'TLT').retorno5d ?? 0;
        const hr = calcFlow(dHYG, 'HYG').retorno5d ?? 0;
        if (qr > 0.5 && hr > 0 && tr < 0) return 'risk_on';
        if (qr < -0.5 && hr < 0 && tr > 0) return 'risk_off';
        if (qr < -1 && tr > 1) return 'vuelo_calidad';
        return 'neutro';
      })()
    };
  })();

  // ══════════════════════════════════════════════════════════
  //  9. ZONAS DE LIQUIDEZ MULTI-TF
  // ══════════════════════════════════════════════════════════
  (() => {
    if (!dNdx?.cl?.length) return;
    const cl = dNdx.cl, hi = dNdx.hi, lo = dNdx.lo, n = cl.length;
    const precio = cl[n - 1];

    const swingHighs = [], swingLows = [];
    for (let i = 3; i < n - 3; i++) {
      if (hi.slice(i-3,i).every(v=>v<hi[i]) && hi.slice(i+1,i+4).every(v=>v<hi[i]))
        swingHighs.push({ v: hi[i], i, reciente: i >= n-20 });
      if (lo.slice(i-3,i).every(v=>v>lo[i]) && lo.slice(i+1,i+4).every(v=>v>lo[i]))
        swingLows.push({ v: lo[i], i, reciente: i >= n-20 });
    }

    const agrupar = (arr, esMax) => {
      const g = [];
      for (const s of arr) {
        const found = g.find(x => Math.abs(x.v - s.v) / x.v < 0.003);
        if (found) { found.cnt++; found.v = (found.v*(found.cnt-1)+s.v)/found.cnt; found.rec = found.rec||s.reciente; }
        else g.push({ v: +s.v.toFixed(2), cnt: 1, rec: s.reciente });
      }
      return g.sort((a,b) => b.cnt-a.cnt || b.rec-a.rec).slice(0,6)
              .map(x => ({ nivel: +x.v.toFixed(2), igualdad: x.cnt>=2, cnt: x.cnt, reciente: x.rec, distPct: +((x.v-precio)/precio*100).toFixed(2) }));
    };

    const zonasR = agrupar(swingHighs.filter(s=>s.v>precio), true);
    const zonasS = agrupar(swingLows.filter(s=>s.v<precio), false);

    // Rangos por horizonte (ATR-based)
    const atr14v = atr(hi, lo, cl, 14) ?? 0;
    const est = {
      d2: { sup: +(precio - atr14v * 0.5).toFixed(2), res: +(precio + atr14v * 0.5).toFixed(2) },
      d5: { sup: +(precio - atr14v * 1.2).toFixed(2), res: +(precio + atr14v * 1.2).toFixed(2) },
      w1: { sup: +(precio - atr14v * 2.0).toFixed(2), res: +(precio + atr14v * 2.0).toFixed(2) },
      w2: { sup: +(precio - atr14v * 3.0).toFixed(2), res: +(precio + atr14v * 3.0).toFixed(2) },
      w3: { sup: +(precio - atr14v * 4.0).toFixed(2), res: +(precio + atr14v * 4.0).toFixed(2) },
      w4: { sup: +(precio - atr14v * 5.0).toFixed(2), res: +(precio + atr14v * 5.0).toFixed(2) }
    };

    R.liquidez = { precio, zonasResistencia: zonasR, zonasSoporte: zonasS, rangosPorHorizonte: est, atr14: atr14v };
  })();

  // ══════════════════════════════════════════════════════════
  // 10. DETECTORES DE GIRO (divergencias + estructura)
  // ══════════════════════════════════════════════════════════
  (() => {
    if (!dNdx?.cl?.length) return;
    const cl = dNdx.cl, hi = dNdx.hi, lo = dNdx.lo, vo = dNdx.vo, n = cl.length;

    // RSI array histórico
    const rsiArr = [];
    for (let i = 28; i <= cl.length; i++) rsiArr.push(rsi(cl.slice(0, i), 14));

    let divAlcista = false, divBajista = false;
    for (let i = 5; i < Math.min(20, rsiArr.length); i++) {
      const pa = cl[n-1], pb = cl[n-1-i];
      const ra = rsiArr[rsiArr.length-1], rb = rsiArr[rsiArr.length-1-i];
      if (pa < pb && ra > rb && ra < 45) divAlcista = true;
      if (pa > pb && ra < rb && ra > 60) divBajista = true;
    }

    // Semanal
    const wCl = toWeekly(cl), wHi = toWeekly(hi), wLo = toWeekly(lo);
    const wN = wCl.length;
    let wDivAlcista = false, wDivBajista = false;
    const wRsiArr = [];
    for (let i = 20; i <= wCl.length; i++) wRsiArr.push(rsi(wCl.slice(0, i), 14));
    for (let i = 2; i < Math.min(10, wRsiArr.length); i++) {
      const pa = wCl[wN-1], pb = wCl[wN-1-i];
      const ra = wRsiArr[wRsiArr.length-1], rb = wRsiArr[wRsiArr.length-1-i];
      if (pa < pb && ra > rb && ra < 45) wDivAlcista = true;
      if (pa > pb && ra < rb && ra > 60) wDivBajista = true;
    }

    // Confirmadores
    const volDecreciente = vo?.length >= 10 ? (vo.slice(-5).reduce((a,b)=>a+b,0)/5 < vo.slice(-10,-5).reduce((a,b)=>a+b,0)/5 * 0.85) : false;
    const trampa = R.opciones?.gex?.trampa ?? false;
    const bb = R.tecnicos?.d?.bb;
    const bbSenal = bb ? (cl[n-1] >= bb.upper * 0.99 ? 'techo' : cl[n-1] <= bb.lower * 1.01 ? 'suelo' : 'neutro') : 'neutro';

    // Días consecutivos
    let dias = 0, dir = 'lateral';
    for (let i = n-1; i > n-15; i--) {
      const s = cl[i] > cl[i-1], b = cl[i] < cl[i-1];
      if (i === n-1) dir = s ? 'subiendo' : b ? 'bajando' : 'lateral';
      if (dir==='subiendo'&&s) dias++; else if (dir==='bajando'&&b) dias++; else break;
    }

    R.giro = {
      d: { divAlcista, divBajista, fiabilidad: divBajista ? ([volDecreciente,trampa].filter(Boolean).length >= 1 ? 'alta' : 'media') : divAlcista ? 'media' : 'sin_div' },
      w: { divAlcista: wDivAlcista, divBajista: wDivBajista },
      bb: { señal: bbSenal, pct: bb?.pct ?? null, width: bb?.width ?? null },
      diasConsec: { dias, dir, señal: dias>=7&&dir==='subiendo'?'agotamiento':dias>=5&&dir==='bajando'?'rebote':dias>=5&&dir==='subiendo'?'vigilar_techo':'normal' },
      señalGlobal: (divBajista||bbSenal==='techo'||dias>=7) ? 'techo' : (divAlcista||bbSenal==='suelo'||dias>=5&&dir==='bajando') ? 'suelo' : 'neutro'
    };
  })();

  // ══════════════════════════════════════════════════════════
  // 11. PCR (Put/Call Ratio) — CBOE CSV
  // ══════════════════════════════════════════════════════════
  await (async () => {
    try {
      const r = await fetch('https://cdn.cboe.com/api/global/us_indices/daily_prices/PC_STATS.csv', { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const csv = await r.text();
      const lines = csv.trim().split('\n');
      const hdr = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g,''));
      const last = lines[lines.length-1].split(',').map(v => v.trim().replace(/['"]/g,''));
      const row = {}; hdr.forEach((h,i) => row[h] = last[i]);
      const get = (...keys) => { for (const k of keys) { const f = Object.keys(row).find(h => h.includes(k)); if (f&&!isNaN(row[f])) return +parseFloat(row[f]).toFixed(2); } return null; };
      const eq = get('equity','eq_pc'), tot = get('total','tot_pc','pc_ratio');
      R.pcr = {
        equity: eq, total: tot,
        señal: tot > 1.2 ? 'alcista_contrario' : tot > 1.0 ? 'precaucion' : tot < 0.6 ? 'bajista_contrario' : 'neutro',
        desc: tot > 1.2 ? 'PCR total alto — inversores cubriendo, señal contraria alcista' : tot < 0.6 ? 'PCR bajo — euforia, señal contraria bajista' : 'PCR normal'
      };
    } catch (e) { R.pcr = { error: e.message }; }
  })();

  // ══════════════════════════════════════════════════════════
  // 12. SCORE MULTI-HORIZONTE
  // ══════════════════════════════════════════════════════════
  (() => {
    const t = R.tecnicos?.d ?? {};
    const macro = R.macro ?? {};
    const cot = R.cot ?? {};
    const vixTS = R.vixTS ?? {};
    const flows = R.flows ?? {};
    const op = R.opciones ?? {};
    const giro = R.giro ?? {};

    // Score técnico diario
    const scoreTec = () => {
      let s = 0;
      if (t.rsi14 > 45 && t.rsi14 < 65) s += 2; else if (t.rsi14 > 70) s -= 1; else if (t.rsi14 < 30) s += 1;
      if (t.macd?.hist > 0) s += 2; else if (t.macd?.hist < 0) s -= 2;
      if (t.ema21 && ndxPrice > t.ema21) s += 1; else if (t.ema21) s -= 1;
      if (t.ema50 && ndxPrice > t.ema50) s += 1; else if (t.ema50) s -= 1;
      if (t.ema200 && ndxPrice > t.ema200) s += 2; else if (t.ema200) s -= 2;
      if (t.stoch?.k < 20) s += 1; else if (t.stoch?.k > 80) s -= 1;
      if (t.volRatio5 > 1.3 && t.roc5 > 0) s += 1; else if (t.volRatio5 > 1.3 && t.roc5 < 0) s -= 1;
      return Math.max(-10, Math.min(10, s));
    };

    // Score macro
    const scoreMacro = () => macro.score ?? 0;

    // Score COT
    const scoreCOT = () => {
      if (!cot.señal) return 0;
      if (cot.señal === 'bajista') return -3;
      if (cot.señal === 'bajista_mod') return -1.5;
      if (cot.señal === 'alcista') return 3;
      if (cot.señal === 'alcista_mod') return 1.5;
      if (cot.señalDealers === 'acumulacion') return 2;
      if (cot.señalDealers === 'distribucion') return -2;
      return 0;
    };

    // Score VIX/opciones
    const scoreVIX = () => {
      let s = 0;
      if (vixTS.señal === 'alcista') s += 2;
      else if (vixTS.señal === 'bajista_fuerte') s -= 3;
      else if (vixTS.señal === 'bajista') s -= 1.5;
      if (op.gex?.trampa) s -= 2;
      if (op.gex?.valor) s += op.gex.valor * 0.5;
      if (R.pcr?.señal === 'alcista_contrario') s += 1.5;
      if (R.pcr?.señal === 'bajista_contrario') s -= 1.5;
      return Math.max(-5, Math.min(5, s));
    };

    // Score flujos
    const scoreFlows = () => {
      let s = 0;
      if (flows.modo === 'risk_on') s += 2;
      if (flows.modo === 'risk_off') s -= 2;
      if (flows.modo === 'vuelo_calidad') s -= 3;
      if (flows.qqq?.señal === 'entradas') s += 1;
      if (flows.qqq?.señal === 'salidas') s -= 1;
      if (flows.hyg?.señal === 'salidas') s -= 1; // HYG salida = risk-off
      return Math.max(-5, Math.min(5, s));
    };

    // Score giro
    const scoreGiro = () => {
      if (giro.señalGlobal === 'techo') return -2;
      if (giro.señalGlobal === 'suelo') return 2;
      return 0;
    };

    const ST = scoreTec(), SM = scoreMacro(), SC = scoreCOT(), SV = scoreVIX(), SF = scoreFlows(), SG = scoreGiro();

    // Score compuesto por horizonte (los pesos cambian según el plazo)
    const compuesto = (wt, wm, wc, wv, wf, wg) => {
      const raw = (ST*wt + SM*wm + SC*wc + SV*wv + SF*wf + SG*wg) / (wt+wm+wc+wv+wf+wg);
      return +raw.toFixed(1);
    };

    const estado = s => s >= 3 ? 'alcista' : s <= -3 ? 'bajista' : s >= 1 ? 'alcista_mod' : s <= -1 ? 'bajista_mod' : 'neutro';
    const conf = s => Math.min(95, Math.max(10, Math.round(Math.abs(s) / 10 * 100)));

    // 2D: peso mayor en técnico, VIX, opciones (corto plazo)
    const s2d = compuesto(30, 10, 10, 25, 15, 10);
    // 5D: equilibrio técnico + institucional
    const s5d = compuesto(25, 15, 15, 20, 15, 10);
    // 1W: peso mayor en COT y macro
    const s1w = compuesto(20, 20, 20, 15, 15, 10);
    // 2W: técnico semanal + COT + macro
    const s2w = compuesto(20, 25, 25, 10, 15, 5);
    // 3W
    const s3w = compuesto(15, 30, 30, 8, 12, 5);
    // 4W: domina macro y COT (1 mes)
    const s4w = compuesto(10, 35, 35, 5, 10, 5);

    R.scores = {
      componentes: { tecnico: ST, macro: SM, cot: SC, vix: SV, flujos: SF, giro: SG },
      horizontes: {
        d2: { score: s2d, estado: estado(s2d), conf: conf(s2d), pesos: '30%T+25%V+15%F+15%Fl+10%G+10%M' },
        d5: { score: s5d, estado: estado(s5d), conf: conf(s5d), pesos: '25%T+20%V+15%F+15%M+15%Fl+10%G' },
        w1: { score: s1w, estado: estado(s1w), conf: conf(s1w), pesos: '20%T+20%M+20%C+15%V+15%Fl+10%G' },
        w2: { score: s2w, estado: estado(s2w), conf: conf(s2w), pesos: '20%T+25%M+25%C+15%Fl+10%V+5%G' },
        w3: { score: s3w, estado: estado(s3w), conf: conf(s3w), pesos: '15%T+30%M+30%C+12%Fl+8%V+5%G' },
        w4: { score: s4w, estado: estado(s4w), conf: conf(s4w), pesos: '10%T+35%M+35%C+10%Fl+5%V+5%G' }
      }
    };
  })();

  // Timestamp
  R.ts = new Date().toISOString();
  R.version = '2.0-multihor';

  res.status(200).json(R);
}

// Token Radar, model radar-4: a fitted comps curve for launch values, kept honest by a blind
// test, with its uncertainty measured by bootstrap, over one sealed DefiLlama snapshot.
//
// The board ranks EVERY protocol the snapshot records with no token, once the products that are
// only a wrapper of a token that already trades are set aside. The house watchlist (40 protocols,
// TVL at or above $50M) is the floor: all 40 are on the board, and the radar keeps going down to
// the snapshot's own floor, 198 protocols in all. Nothing is hand-picked and no protocol name is
// ever special-cased: one function scores every row from the snapshot's own figures.
//
// The price of a launch is a power curve fitted to the snapshot's own live-token protocols:
//
//   peers     live-token protocols (a market cap is recorded), CEX peers set aside, each peer's
//             ratio mcap / TVL kept only when it lies in [0.002, 6] so one broken print cannot
//             steer the fit (110 peers on this snapshot)
//   curve     least squares on log(market cap) against log(TVL): value = exp(a) x TVL ^ b, with
//             a = 5.7038 and b = 0.5845 on this snapshot. The slope under 1 is the finding: the
//             market pays a smaller multiple of TVL the larger a protocol already is, so a flat
//             multiple overprices the giants and underprices the small
//   category  each category shifts the curve by the median of its peers' log residuals, shrunk
//             toward zero with 8 pseudo-peers of weight: offset x n / (n + 8). Lending shifts
//             down (x0.74), Derivatives up (x1.38); a category with no live peers shifts nothing
//   multiple  exp(a + offset + (b - 1) x log TVL), rounded to 4 decimals and clamped to
//             [0.02, 1.0] as a sanity band the fit never touches on this snapshot (the board's
//             multiples run 0.033x to 0.621x); implied value = TVL x that multiple
//
// The curve is not asserted, it is tested, in this file, on every run (see validateModel): a
// deterministic five-fold blind test over the 110 peers (fit on four folds, predict the fifth)
// and a walk-forward split (fit on peers listed before 2024, predict the ones listed since).
// The fitted curve's typical miss is a factor of about 3.1 either way; the flat 0.25x multiple
// misses by about 4.3, the category-median model this one replaces (radar-2) by about 4.6, and
// on the walk-forward split (fit before 2024, predict the listings since) the curve misses by
// about 2.1 against the flat multiple's 4.0.
// Three adjustments radar-2 carried (a growth factor from 7-day TVL change, a maturity factor
// from age, a breadth factor from chain count) were put through the same blind test and did not
// survive it, so the board does not use them: a term stays only if the blind test keeps it.
// Neither did the challengers radar-4 tested against the same fit (a Huber robust fit,
// per-category slopes, an ensemble with radar-2): none beat plain least squares out of sample,
// so the point estimate is radar-3's, unchanged.
//
// What radar-4 adds is the honest spread around that point. A point price for a token that does
// not exist yet is a claim; the spread is the truth about the claim. Two hundred bootstrap
// refits of the curve (the peers resampled with replacement, a seeded generator, so the run is
// deterministic) give every row an 80% value band from the predictive distribution (refit
// predictions spread by the refits' own residuals) and a rank range (the 10th to 90th
// percentile of the row's rank across the refits). The blind test measures the band itself:
// inside the cross-validation the same bootstrap band covered about three quarters of the
// held-out peers it had never seen, close to its 80% name, and the dashboard prints that
// coverage next to the band wherever the band appears.
//
// A row also carries a confidence label from its category's comp count (high: 8 or more peers,
// medium: 3 to 7, low: fewer than 3) and a farm verdict netted from its own plan's fees. The
// dashboard shows every input, so a reader can rebuild any row's number from the page alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and board.json rows carry its inputs. */
export const MODEL_VERSION = 'radar-4';

/** The model's constants, stated in the dashboard so the arithmetic is never a black box. */
export const MODEL = {
  peer_ratio_min: 0.002,
  peer_ratio_max: 6,
  shrink_peers: 8,
  multiple_min: 0.02,
  multiple_max: 1.0,
  folds: 5,
  walk_forward_cutoff: '2024-01-01',
  bootstrap_refits: 200,
  bootstrap_cv_refits: 60,
  bootstrap_draws: 3,
  bootstrap_seed: 20261114,
  bootstrap_band_pct: 80,
  farm_skip_fee_load: 0.2,
  farm_thin_fee_load: 0.1,
  farm_thin_value: 5_000_000,
};

/** How many live-token protocols the dashboard's calibration view carries, by market cap. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** A whole day count from `listed_at` to `as_of`, clamped at zero; null when the date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of an asset that already trades. */
const WRAPPER_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a wrapped product may begin with, from the watchlist's own rule. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is a launch candidate at all: it records no token, and it is not a wrapped,
 * staked or bridged product of one that trades. This is the watchlist's own exclusion rule,
 * applied to the whole snapshot instead of only to the $50M floor: WBTC, Binance staked ETH and
 * USDT0 fail it at any size, and so do the 39 bridge and liquid-staking rows a TVL-only radar
 * would quietly rank as if they were still waiting for a token of their own.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** One category's place on the curve: its peer count and its shrunk log-residual offset. */
export interface CategoryOffset {
  category: string;
  peers: number;
  offset: number;
  multiplier: number;
}

/** The fitted curve: intercept, slope, and every category's offset, learned from the peers. */
export interface CurveFit {
  a: number;
  b: number;
  peer_count: number;
  offsets: Map<string, CategoryOffset>;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The peers the curve learns from: every live-token protocol with a sane mcap/TVL ratio, CEX
 * peers set aside (an exchange token prices the exchange, not a protocol of its category).
 * Deterministic: peers are read in the snapshot's own order.
 */
export function peerSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) return false;
    if (p.category === 'CEX') return false;
    const ratio = p.mcap_usd / p.tvl_usd;
    return ratio >= MODEL.peer_ratio_min && ratio <= MODEL.peer_ratio_max;
  });
}

/**
 * Fit the curve to a set of peers: least squares of log(market cap) on log(TVL), then each
 * category's offset as the median of its peers' log residuals, shrunk toward zero with
 * MODEL.shrink_peers pseudo-peers of weight. The same fit prices the board and sits inside the
 * blind test, so the tested model and the shipped model are one function.
 */
export function fitCurve(peers: SnapshotProtocol[]): CurveFit {
  const n = peers.length;
  let sx = 0;
  let sy = 0;
  for (const p of peers) {
    sx += Math.log(p.tvl_usd);
    sy += Math.log(p.mcap_usd!);
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of peers) {
    const dx = Math.log(p.tvl_usd) - mx;
    sxy += dx * (Math.log(p.mcap_usd!) - my);
    sxx += dx * dx;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  const residuals = new Map<string, number[]>();
  for (const p of peers) {
    if (p.category === null) continue;
    const r = Math.log(p.mcap_usd!) - (a + b * Math.log(p.tvl_usd));
    const list = residuals.get(p.category) ?? [];
    list.push(r);
    residuals.set(p.category, list);
  }
  const offsets = new Map<string, CategoryOffset>();
  for (const [category, list] of residuals) {
    const offset = (median(list) * list.length) / (list.length + MODEL.shrink_peers);
    offsets.set(category, { category, peers: list.length, offset, multiplier: Math.exp(offset) });
  }
  return { a, b, peer_count: n, offsets };
}

/** The curve's fitted value for one TVL and one category offset, before rounding. */
function curveValue(fit: CurveFit, tvl: number, offset: number): number {
  return Math.exp(fit.a + offset + fit.b * Math.log(tvl));
}

/**
 * The multiple one protocol is priced with: the curve's value at its TVL, shifted by its
 * category's offset, stated as a multiple of TVL and rounded to 4 decimals, so the printed
 * multiple times the printed TVL is the row's implied value, up to the final dollar rounding.
 */
export function multipleFor(p: SnapshotProtocol, fit: CurveFit): { multiple: number; baseMultiple: number; offset: number; peers: number } {
  const entry = p.category !== null ? fit.offsets.get(p.category) : undefined;
  const offset = entry?.offset ?? 0;
  const raw = curveValue(fit, p.tvl_usd, offset) / p.tvl_usd;
  const baseRaw = curveValue(fit, p.tvl_usd, 0) / p.tvl_usd;
  const clamp = (v: number) => Math.min(MODEL.multiple_max, Math.max(MODEL.multiple_min, v));
  return { multiple: round4(clamp(raw)), baseMultiple: round4(clamp(baseRaw)), offset, peers: entry?.peers ?? 0 };
}

/** How much a row's multiple can be trusted, from the size of its comp set alone. */
export function confidenceFor(peers: number): 'high' | 'medium' | 'low' {
  if (peers >= 8) return 'high';
  if (peers >= 3) return 'medium';
  return 'low';
}

/** The full scoring of one protocol: every input the dashboard shows, and the implied value. */
export interface Scoring {
  implied: number;
  multiple: number;
  base_multiple: number;
  offset: number;
  offset_multiplier: number;
  peers: number;
  confidence: 'high' | 'medium' | 'low';
  growth_pct: number;
  age: number | null;
}

/**
 * Score one protocol under the fitted curve. The same function scores every row. The multiple
 * is rounded to 4 decimals BEFORE the multiplication, so the multiple printed on a row (and on
 * the dashboard) times its TVL is that row's implied value exactly, up to the final rounding to
 * dollars: any reader can rebuild any number on the board from the printed inputs alone.
 */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, fit: CurveFit): Scoring {
  const { multiple, baseMultiple, offset, peers } = multipleFor(p, fit);
  const age = ageDays(asOf, p.listed_at);
  const growthPct = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
  return {
    implied,
    multiple,
    base_multiple: baseMultiple,
    offset,
    offset_multiplier: round4(Math.exp(offset)),
    peers,
    confidence: confidenceFor(peers),
    growth_pct: growthPct,
    age,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ------------------------------------------------------------------ the bootstrap
//
// The point price is one draw from a distribution; the bootstrap measures the distribution.
// The peers are resampled with replacement and the curve refitted, MODEL.bootstrap_refits
// times, from a seeded generator (mulberry32), so two runs write the same bytes. Each refit
// predicts every target twice over: its point prediction feeds the target's rank range, and
// point predictions spread by residuals drawn from the refit's own training residuals feed
// the target's predictive band (the 10th to 90th percentile, the 80% band). A refit whose
// resample cannot be fitted (no spread in TVL) is skipped, never fudged.

/** mulberry32: a small seeded generator, so the bootstrap is a function of the snapshot. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The q-th percentile of an ascending list, nearest-rank: the same rule the checks used. */
function percentile(sortedAsc: number[], q: number): number {
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(q * sortedAsc.length)));
  return sortedAsc[i]!;
}

/** One target's bootstrap spread: its 80% value band and the range its rank moves in. */
export interface Uncertainty {
  value_p10: number;
  value_p90: number;
  rank_p10: number;
  rank_p90: number;
}

/** A bootstrap target: a TVL and a category, the only inputs the curve reads. */
export interface BootstrapTarget {
  tvl_usd: number;
  category: string | null;
}

/**
 * Bootstrap the fitted curve over the peers and read every target's band and rank range.
 * `targets` are read in the caller's order (the board's rank order); ranks inside a refit are
 * by that refit's point predictions, ties broken by the caller's order, so a rank range is a
 * statement about the model, not about sort noise.
 */
export function bootstrapUncertainty(
  peers: SnapshotProtocol[],
  targets: BootstrapTarget[],
  refits: number,
  seed: number,
): Uncertainty[] {
  const rng = mulberry32(seed);
  const n = peers.length;
  const points: number[][] = targets.map(() => []);
  const samples: number[][] = targets.map(() => []);
  const ranks: number[][] = targets.map(() => []);
  let done = 0;
  for (let b = 0; b < refits; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < n; i++) sample.push(peers[Math.floor(rng() * n)]!);
    const fit = fitCurve(sample);
    if (!Number.isFinite(fit.a) || !Number.isFinite(fit.b)) continue;
    const residuals: number[] = [];
    for (const p of sample) {
      const off = p.category !== null ? (fit.offsets.get(p.category)?.offset ?? 0) : 0;
      residuals.push(Math.log(p.mcap_usd!) - Math.log(curveValue(fit, p.tvl_usd, off)));
    }
    const preds = targets.map((t) => {
      const off = t.category !== null ? (fit.offsets.get(t.category)?.offset ?? 0) : 0;
      return curveValue(fit, t.tvl_usd, off);
    });
    const order = targets.map((_, i) => i).sort((x, y) => preds[y]! - preds[x]! || x - y);
    const rankOf = new Array<number>(targets.length);
    order.forEach((targetIdx, pos) => {
      rankOf[targetIdx] = pos + 1;
    });
    targets.forEach((_, i) => {
      points[i]!.push(preds[i]!);
      ranks[i]!.push(rankOf[i]!);
      for (let d = 0; d < MODEL.bootstrap_draws; d++) {
        samples[i]!.push(preds[i]! * Math.exp(residuals[Math.floor(rng() * residuals.length)]!));
      }
    });
    done++;
  }
  return targets.map((_, i) => {
    const s = [...samples[i]!].sort((a, b) => a - b);
    const r = [...ranks[i]!].sort((a, b) => a - b);
    return {
      value_p10: percentile(s, 0.1),
      value_p90: percentile(s, 0.9),
      rank_p10: Math.round(percentile(r, 0.1)),
      rank_p90: Math.round(percentile(r, 0.9)),
    };
  });
}

// ------------------------------------------------------------------ the blind test
//
// The model is chosen by test, not by taste, and the test ships with the model so anyone can
// rerun it: a deterministic five-fold cross-validation over the peers (a peer's fold is the
// FNV-1a hash of its slug, mod 5, so the split is fixed by the snapshot itself) plus a
// walk-forward split at 2024-01-01 (fit on the peers listed before, predict the ones listed
// since). Five candidate pricings sit in the test: the starter's flat 0.25x, the global median
// multiple, radar-2's category medians with its growth/maturity/breadth factors, the fitted
// curve alone, and the fitted curve with category offsets (radar-4, the one the board uses).
// The score is the median absolute log10 error, stated as the factor a typical prediction
// misses by, and the share of peers priced within 2x of their recorded market cap.

/** One candidate's blind-test score: its typical miss as a factor, and its within-2x share. */
export interface ValidationScore {
  key: string;
  label: string;
  median_factor: number;
  within_2x_pct: number;
  peers: number;
}

/** The whole test: the five-fold table, the walk-forward table, the error band, the band's coverage. */
export interface Validation {
  folds: number;
  peers: number;
  scores: ValidationScore[];
  walk_forward: { cutoff: string; train: number; test: number; scores: ValidationScore[] };
  band_factor: number;
  bootstrap: { board_refits: number; cv_refits: number; nominal_pct: number; coverage_pct: number };
}

/** FNV-1a over the slug: a peer's fold, fixed by the snapshot and nothing else. */
function foldOf(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % MODEL.folds;
}

/** radar-2, kept only as a test candidate: shrunk category medians times its three factors. */
function radar2Predict(train: SnapshotProtocol[], p: SnapshotProtocol, asOf: string): number {
  const ratios = train.map((t) => t.mcap_usd! / t.tvl_usd);
  const global = median(ratios);
  let multiple = global;
  if (p.category !== null) {
    const list = train.filter((t) => t.category === p.category).map((t) => t.mcap_usd! / t.tvl_usd);
    if (list.length > 0) {
      const med = median(list);
      multiple = (list.length * med + 8 * global) / (list.length + 8);
      if (list.length < 3) multiple = Math.min(multiple, 1.5 * global);
    }
  }
  multiple = Math.min(0.9, Math.max(0.03, multiple));
  const g = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? Math.min(60, Math.max(-30, p.change_7d)) : 0;
  const growth = 1 + (g / 100) * 0.5;
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const maturity = 0.8 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.2;
  const breadth = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  return p.tvl_usd * multiple * growth * maturity * breadth;
}

/** Score one candidate over a set of train/test splits and fold the errors into one row. */
function scoreSplits(
  key: string,
  label: string,
  splits: { train: SnapshotProtocol[]; test: SnapshotProtocol[] }[],
  predict: (train: SnapshotProtocol[], p: SnapshotProtocol) => number,
): ValidationScore {
  const errors: number[] = [];
  for (const { train, test } of splits) {
    for (const p of test) {
      const pred = predict(train, p);
      if (pred > 0 && p.mcap_usd !== null) errors.push(Math.abs(Math.log10(pred / p.mcap_usd)));
    }
  }
  const med = median(errors);
  const within = errors.filter((e) => e <= Math.log10(2)).length;
  return {
    key,
    label,
    median_factor: round4(Math.pow(10, med)),
    within_2x_pct: round4((within / errors.length) * 100),
    peers: errors.length,
  };
}

/** Run the blind test over the snapshot's peers. Pure: the same snapshot, the same table. */
export function validateModel(snapshot: Snapshot): Validation {
  const peers = peerSet(snapshot);
  const asOf = snapshot.as_of;
  const candidates: { key: string; label: string; predict: (train: SnapshotProtocol[], p: SnapshotProtocol) => number }[] = [
    { key: 'flat', label: 'Flat 0.25x multiple (the starter)', predict: (_t, p) => 0.25 * p.tvl_usd },
    {
      key: 'global_median',
      label: 'Global median multiple',
      predict: (t, p) => median(t.map((x) => x.mcap_usd! / x.tvl_usd)) * p.tvl_usd,
    },
    { key: 'radar2', label: 'Category medians x growth x maturity x breadth (radar-2)', predict: (t, p) => radar2Predict(t, p, asOf) },
    {
      key: 'curve',
      label: 'Fitted curve, no category offsets',
      predict: (t, p) => curveValue(fitCurve(t), p.tvl_usd, 0),
    },
    {
      key: 'radar4',
      label: 'Fitted curve + category offsets (radar-4, this board)',
      predict: (t, p) => {
        const fit = fitCurve(t);
        const off = p.category !== null ? (fit.offsets.get(p.category)?.offset ?? 0) : 0;
        return curveValue(fit, p.tvl_usd, off);
      },
    },
  ];
  const cvSplits = Array.from({ length: MODEL.folds }, (_, k) => ({
    train: peers.filter((p) => foldOf(p.slug) !== k),
    test: peers.filter((p) => foldOf(p.slug) === k),
  }));
  const scores = candidates.map((c) => scoreSplits(c.key, c.label, cvSplits, c.predict));
  const dated = peers.filter((p) => p.listed_at !== null);
  const wfTrain = dated.filter((p) => p.listed_at! < MODEL.walk_forward_cutoff);
  const wfTest = dated.filter((p) => p.listed_at! >= MODEL.walk_forward_cutoff);
  const wfCandidates = candidates.filter((c) => c.key === 'flat' || c.key === 'global_median' || c.key === 'radar4');
  const wfScores = wfCandidates.map((c) => scoreSplits(c.key, c.label, [{ train: wfTrain, test: wfTest }], c.predict));
  const own = scores.find((s) => s.key === 'radar4')!;
  // The band, tested like the model: inside the same folds, fit the bootstrap on the training
  // peers and ask how often a held-out peer's recorded cap lands inside its 80% band.
  let covered = 0;
  let banded = 0;
  for (const { train, test } of cvSplits) {
    const bands = bootstrapUncertainty(
      train,
      test.map((p) => ({ tvl_usd: p.tvl_usd, category: p.category })),
      MODEL.bootstrap_cv_refits,
      MODEL.bootstrap_seed,
    );
    test.forEach((p, i) => {
      banded++;
      if (p.mcap_usd !== null && p.mcap_usd >= bands[i]!.value_p10 && p.mcap_usd <= bands[i]!.value_p90) covered++;
    });
  }
  return {
    folds: MODEL.folds,
    peers: peers.length,
    scores,
    walk_forward: { cutoff: MODEL.walk_forward_cutoff, train: wfTrain.length, test: wfTest.length, scores: wfScores },
    band_factor: own.median_factor,
    bootstrap: {
      board_refits: MODEL.bootstrap_refits,
      cv_refits: MODEL.bootstrap_cv_refits,
      nominal_pct: MODEL.bootstrap_band_pct,
      coverage_pct: round4((covered / banded) * 100),
    },
  };
}

// ------------------------------------------------------------------ farm plans
//
// A farm plan is derived, never hand-written per protocol: the category picks the playbook (the
// core action, the second action, the risk to watch and the way out), the primary chain picks the
// gas token and a realistic per-action gas cost, the TVL picks the capital tier, and the age
// picks the holding window. Every step states what it costs and how long it takes, and the seven
// steps together are a plan a reader can start today and unwind cleanly.

/** What one chain costs to use: its gas token and a typical deposit-or-swap fee in dollars. */
interface ChainInfo {
  gas: string;
  fee_usd: number;
}

const CHAIN_INFO: Record<string, ChainInfo> = {
  Ethereum: { gas: 'ETH', fee_usd: 7.5 },
  Bitcoin: { gas: 'BTC', fee_usd: 2.5 },
  Tron: { gas: 'TRX', fee_usd: 1.2 },
  Solana: { gas: 'SOL', fee_usd: 0.06 },
  Base: { gas: 'ETH', fee_usd: 0.25 },
  Arbitrum: { gas: 'ETH', fee_usd: 0.35 },
  Optimism: { gas: 'ETH', fee_usd: 0.3 },
  Binance: { gas: 'BNB', fee_usd: 0.25 },
  'BNB Chain': { gas: 'BNB', fee_usd: 0.25 },
  Avalanche: { gas: 'AVAX', fee_usd: 0.45 },
  Polygon: { gas: 'POL', fee_usd: 0.02 },
  Sui: { gas: 'SUI', fee_usd: 0.08 },
  Aptos: { gas: 'APT', fee_usd: 0.02 },
  Algorand: { gas: 'ALGO', fee_usd: 0.01 },
  Stellar: { gas: 'XLM', fee_usd: 0.01 },
  Ripple: { gas: 'XRP', fee_usd: 0.01 },
  Cosmos: { gas: 'ATOM', fee_usd: 0.05 },
  Near: { gas: 'NEAR', fee_usd: 0.02 },
  Fantom: { gas: 'FTM', fee_usd: 0.05 },
  Gnosis: { gas: 'xDAI', fee_usd: 0.01 },
  Linea: { gas: 'ETH', fee_usd: 0.3 },
  Scroll: { gas: 'ETH', fee_usd: 0.3 },
  Mantle: { gas: 'MNT', fee_usd: 0.1 },
  Monad: { gas: 'MON', fee_usd: 0.05 },
  Ink: { gas: 'ETH', fee_usd: 0.25 },
  Plasma: { gas: 'XPL', fee_usd: 0.05 },
  Flare: { gas: 'FLR', fee_usd: 0.02 },
  CORE: { gas: 'CORE', fee_usd: 0.05 },
  'Hyperliquid L1': { gas: 'HYPE', fee_usd: 0.05 },
  'Plume Mainnet': { gas: 'PLUME', fee_usd: 0.05 },
  'Robinhood Chain': { gas: 'ETH', fee_usd: 0.25 },
  Pharos: { gas: 'PHRS', fee_usd: 0.05 },
  Arc: { gas: 'USDC', fee_usd: 0.05 },
  Mezo: { gas: 'BTC', fee_usd: 0.5 },
  Noble: { gas: 'USDC', fee_usd: 0.05 },
  BSquared: { gas: 'BTC', fee_usd: 0.5 },
  Bittensor: { gas: 'TAO', fee_usd: 0.1 },
};

const DEFAULT_CHAIN: ChainInfo = { gas: 'the native gas token', fee_usd: 1 };

/** The chain a plan is written for: the first chain the snapshot lists for the protocol. */
function primaryChain(p: SnapshotProtocol): { name: string; info: ChainInfo } {
  const name = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
  return { name, info: CHAIN_INFO[name] ?? DEFAULT_CHAIN };
}

/** A fee stated the way a reader budgets it: cents under a dollar, else two decimals trimmed. */
function feeText(usd: number): string {
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (Number.isInteger(usd)) return `$${usd}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * How much capital one farm position puts to work, from the protocol's own TVL: deposit-sized
 * plans, so a large protocol is farmed with a position its fee load can carry and a small one
 * is not drowned by mainnet gas. The economics step nets the plan's fees against this figure.
 */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 1000;
  if (p.tvl_usd >= 250_000_000) return 750;
  if (p.tvl_usd >= 100_000_000) return 500;
  if (p.tvl_usd >= 25_000_000) return 300;
  if (p.tvl_usd >= 10_000_000) return 200;
  return 100;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 35;
  return 30;
}

/** One category's playbook: the core action, the second action, the risk line and the exit. */
interface Playbook {
  core: (name: string, chain: string, cap: number) => string;
  second: (name: string, chain: string, cap: number) => string;
  risk: string;
  exit: (name: string) => string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  Lending: {
    core: (n, c, cap) => `Supply $${cap} of USDC to ${n} on ${c} as your main position; USDC keeps the position's value readable while it qualifies.`,
    second: (n, c, cap) => `Borrow $${Math.round(cap / 3)} of USDC against that supply (a third of it at most) and re-supply it once, so the wallet shows both sides of ${n}'s market.`,
    risk: 'the borrow health factor: keep it above 1.6 and never let a price move push it toward 1.0',
    exit: (n) => `repay the borrow in full, then withdraw the supply from ${n} in one transaction each`,
  },
  Dexs: {
    core: (n, c, cap) => `Provide $${cap} split evenly between USDC and the pool's other asset in ${n}'s busiest stable or major pair pool on ${c}.`,
    second: (n, c) => `Make two small swaps a week through ${n} itself (about $25 each way), so the wallet is a user of the exchange and not only a liquidity provider.`,
    risk: 'impermanent loss: favour the stable or major pair and leave concentrated ranges to a wallet you watch daily',
    exit: (n) => `remove the liquidity from ${n}, swap the proceeds back to USDC, and keep the fee history in the log`,
  },
  Derivatives: {
    core: (n, c, cap) => `Deposit $${cap} of USDC as margin on ${n} (${c}) and open one small hedged position, long and short the same asset in equal size.`,
    second: (n) => `Place and cancel a few limit orders each week on ${n} and close one position a week, so the account shows real trading rather than a parked deposit.`,
    risk: 'liquidation on the hedged legs: keep total leverage under 2x and margin above 60% of the position value',
    exit: (n) => `close every open position on ${n}, wait for settlement, then withdraw the margin`,
  },
  'Risk Curators': {
    core: (n, c, cap) => `Deposit $${cap} of USDC into the largest ${n} vault on ${c}; a curator vault is the product itself, so the deposit is the qualifying action.`,
    second: (n, c, cap) => `Split a second $${Math.round(cap / 2)} into a different ${n} vault with a different risk profile, so the wallet holds two curated strategies, not one bet.`,
    risk: 'what the curator allocates to: read the vault\'s allocation page monthly and leave any vault whose underlying market you would not lend to directly',
    exit: (n) => `queue withdrawals from both ${n} vaults, wait out any withdrawal window, and move the USDC back to the wallet`,
  },
  'Onchain Capital Allocator': {
    core: (n, c, cap) => `Deposit $${cap} of USDC into ${n}'s main allocator vault on ${c} and keep the vault shares in the farming wallet.`,
    second: (n, c, cap) => `Add $${Math.round(cap / 2)} to a second ${n} strategy on ${c} when one is offered, so the wallet follows the allocator across more than one market.`,
    risk: 'strategy drift: check the allocator\'s reported exposures monthly and size down if one market takes over the vault',
    exit: (n) => `redeem the vault shares from ${n} in the app, wait for the settlement window, and withdraw the USDC`,
  },
  RWA: {
    core: (n, c, cap) => `Complete ${n}'s eligibility check if it asks for one, then subscribe $${cap} to its main yield product on ${c} and hold the issued asset.`,
    second: (n) => `Reinvest the first distribution (or add $25) into ${n} once, so the wallet shows a second subscription rather than a single parked ticket.`,
    risk: 'redemption terms: RWA products settle on their own calendar, so farm only money you can leave until the next redemption window',
    exit: (n) => `request redemption from ${n} at the next window, hold the asset until it settles, and record the settlement date in the log`,
  },
  Yield: {
    core: (n, c, cap) => `Deposit $${cap} of USDC (or the stablecoin ${n} asks for) into its main vault on ${c} and keep the yield-bearing shares.`,
    second: (n) => `Claim or compound the yield once a week inside ${n}, so the position shows the protocol's own reward cycle, not just a deposit.`,
    risk: 'where the yield comes from: if the rate is far above lending rates with no named source, treat the position as speculative and keep it small',
    exit: (n) => `withdraw from the ${n} vault back to USDC, claiming any pending yield in the same visit`,
  },
  'Yield Aggregator': {
    core: (n, c, cap) => `Deposit $${cap} of USDC into ${n}'s main auto-compounding vault on ${c}; the aggregator routes it, the deposit is your qualifying action.`,
    second: (n, c, cap) => `Move $${Math.round(cap / 2)} into a second ${n} vault on ${c} after two weeks, so the wallet uses the aggregator's routing more than once.`,
    risk: 'the vaults underneath: an aggregator is only as safe as the farms it routes to, so read its strategy list before adding the second vault',
    exit: (n) => `withdraw both ${n} vaults to USDC in the app and keep the share-price history in the log`,
  },
  CDP: {
    core: (n, c, cap) => `Open a position on ${n} (${c}): deposit $${cap} of collateral and mint about a third of its value in the protocol's stablecoin.`,
    second: (n) => `Use the minted stablecoin inside ${n}'s own ecosystem (a stability pool or its paired market) rather than selling it, so both sides of the CDP are active.`,
    risk: 'the collateral ratio: keep it above 180% and top up collateral before adding any more debt',
    exit: (n) => `repay the minted debt on ${n}, close the position, and withdraw the collateral in full`,
  },
  'CDP Manager': {
    core: (n, c, cap) => `Open a managed position through ${n} on ${c} with $${cap} of collateral, choosing its conservative automation profile if one is offered.`,
    second: (n) => `Trigger one management action the tool exists for (a collateral top-up, a debt adjustment or a protection order) so the wallet uses ${n}, not just its vault.`,
    risk: 'automation is not a guarantee: the manager reacts to prices, it cannot repeal them, so keep the position\'s own ratio above 180%',
    exit: (n) => `disable the automation on ${n}, repay any open debt, and withdraw the collateral yourself`,
  },
  'Basis Trading': {
    core: (n, c, cap) => `Deposit $${cap} of USDC into ${n}'s basis strategy on ${c}; the strategy holds the hedge, your deposit is the position.`,
    second: (n) => `Add $25 to the position after the first funding cycle settles, so the wallet shows a top-up at a second price, not a single entry.`,
    risk: 'funding flipping negative: a basis trade earns the funding rate, so check the strategy\'s recent yield monthly and leave if it pays under cash rates for a full month',
    exit: (n) => `redeem the position from ${n}, wait for the hedge to unwind, and withdraw the settled USDC`,
  },
  Chain: {
    core: (n, c, cap) => `Bridge $${cap} of USDC (or the chain's main asset) to ${c} and make ${n}'s own app your first transaction on it: a swap, a deposit or a stake.`,
    second: (n, c) => `Use two more of the chain's native apps in the first month (a DEX and a lending market on ${c}), so the wallet reads as a chain user, not a bridge tourist.`,
    risk: 'bridge and new-chain risk: keep the farmed amount small until the chain has run a full year without a halt or a bridge incident',
    exit: (n) => `consolidate the funds on the chain, bridge them back in one transfer, and keep the bridge receipts in the log`,
  },
  Restaking: {
    core: (n, c, cap) => `Restake $${cap} of the staking asset ${n} accepts on ${c} (buy it in the same session if the wallet holds none) and keep the receipt token.`,
    second: (n) => `Claim the restaking rewards once a month inside ${n} and restake them, so the position compounds through the protocol's own cycle.`,
    risk: 'slashing and unbonding: restaked assets can be locked for days on exit and carry operator risk a plain stake does not',
    exit: (n) => `start the unbonding on ${n} early, wait out the full withdrawal period, and only then move the asset`,
  },
  'Staking Pool': {
    core: (n, c, cap) => `Stake $${cap} of the native asset through ${n} on ${c} and keep the staking receipt in the farming wallet.`,
    second: (n) => `Add a small second stake ($25) after the first rewards land, so the wallet shows two staking events at two different times.`,
    risk: 'the unbonding queue: staking exits are slow by design, so count this money as locked for the whole hold',
    exit: (n) => `unstake through ${n}, wait out the unbonding period, and claim the asset when the queue releases it`,
  },
  Insurance: {
    core: (n, c, cap) => `Put $${cap} of USDC into ${n}'s cover pool on ${c} as underwriting capital (or buy cover on a position you already hold, if that is the side offered).`,
    second: (n) => `Renew or extend the cover once before it lapses, so the wallet shows a second underwriting period rather than one expired policy.`,
    risk: 'a single claim can take a large share of a small cover pool: underwrite only money whose loss would not change your plans',
    exit: (n) => `let the cover period on ${n} expire, then withdraw the underwriting capital once claims against it are closed`,
  },
  Payments: {
    core: (n, c, cap) => `Fund a ${n} wallet or channel with $${cap} on ${c} and make one real payment to a second wallet you control.`,
    second: (n) => `Route one payment a week through ${n} (even $5 between your own wallets), so the account shows the steady use a payments network rewards.`,
    risk: 'channel and routing liquidity: payments can fail or strand funds in a channel, so keep balances small and close channels you stop using',
    exit: (n) => `sweep the balance out of ${n} to your main wallet and close any channel you opened`,
  },
  'Prediction Market': {
    core: (n, c, cap) => `Fund $${cap} on ${n} (${c}) and place two small positions on liquid markets, no more than $25 on either side of one question.`,
    second: (n) => `Trade out of one position before it settles and into a second market, so the account shows trading, not a single parked bet.`,
    risk: 'the position can go to zero: a prediction share is a bet, so size it as entertainment money, never as a deposit',
    exit: (n) => `sell or settle every open position on ${n} and withdraw the remaining balance`,
  },
};

const DEFAULT_PLAYBOOK: Playbook = {
  core: (n, c, cap) => `Deposit $${cap} of USDC into ${n}'s main product on ${c} and keep the position open in the farming wallet.`,
  second: (n) => `Make one second, different action inside ${n} (a second deposit, a claim, a vote or a swap), so the wallet is a user of the protocol and not a single deposit.`,
  risk: 'the position itself: read the withdrawal terms before depositing and never farm money you need back on a fixed date',
  exit: (n) => `withdraw the position from ${n} in the app and move the funds back to the farming wallet`,
};

/** A plan's economics, netted: what it costs in fees, what it ties up, and the verdict. */
export interface FarmEconomics {
  fees_usd: number;
  capital_usd: number;
  hold_days: number;
  fee_load_pct: number;
  verdict: 'farm' | 'thin' | 'skip';
  verdict_reason: string;
}

/** A whole-dollar figure for the economics step: cents under a dollar, else rounded. */
function usdText(n: number): string {
  if (n < 1) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * A protocol's farm plan: eight steps, each an action with its cost and its time, and a last
 * step that nets the plan's own fees against the value it farms and gives a verdict. The plan
 * is a pure function of the protocol's own record (category, chains, TVL, age) and its scored
 * value, so the page and board.json can never disagree about it. The verdict's rules are the
 * model's constants: skip when fees would eat more than 20% of the capital at work (a small
 * position on an expensive chain is a donation to validators), thin when fees pass 10%, the
 * comp set is low-confidence, or the priced launch is under $5M, farm otherwise. A small
 * protocol is not skipped for being small: on a cheap chain its fee load is tiny and a small
 * farmer's share of its launch is the largest on the board.
 */
export function farmPlan(
  p: SnapshotProtocol,
  age: number | null,
  implied: number,
  confidence: 'high' | 'medium' | 'low',
  peers: number,
  band: { low: number; high: number; coveragePct: number },
): { steps: string[]; economics: FarmEconomics } {
  const { name: chain, info } = primaryChain(p);
  const cap = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(4, Math.round(hold / 7));
  const book = (p.category !== null ? PLAYBOOKS[p.category] : undefined) ?? DEFAULT_PLAYBOOK;
  const fee = info.fee_usd;
  const fees = fee * (7 + weeks);
  const feeLoad = fees / cap;
  let verdict: FarmEconomics['verdict'];
  let reason: string;
  if (feeLoad > MODEL.farm_skip_fee_load) {
    verdict = 'skip';
    reason = `the plan's fees would eat ${(feeLoad * 100).toFixed(1)}% of the capital at work, more than the ${MODEL.farm_skip_fee_load * 100}% a farm can carry`;
  } else if (feeLoad > MODEL.farm_thin_fee_load) {
    verdict = 'thin';
    reason = `fees take ${(feeLoad * 100).toFixed(1)}% of the capital, so run it small and skip the optional second position`;
  } else if (confidence === 'low') {
    verdict = 'thin';
    reason = `the price rests on ${peers} live peer${peers === 1 ? '' : 's'}, a thin comp set, so size the position down until the category proves itself`;
  } else if (implied < MODEL.farm_thin_value) {
    verdict = 'thin';
    reason = `the launch prices under ${usdText(MODEL.farm_thin_value)}: a small prize pool, worth a small position only`;
  } else {
    verdict = 'farm';
    reason = `the fee load is light at ${(feeLoad * 100).toFixed(1)}% of capital and the price stands on ${peers} live peers`;
  }
  const low = Math.max(1, Math.round(band.low));
  const high = Math.round(band.high);
  const steps = [
    `Set up a fresh wallet that holds only the funds for this farm, fund it with ${info.gas} on ${chain} for fees, and keep its seed phrase offline; never farm from a wallet that holds long-term assets. Cost: about ${feeText(fee * 2)} of ${info.gas} to fund and test. Time: 10 minutes.`,
    `${book.core(p.name, chain, cap)} Cost: $${cap} of capital plus about ${feeText(fee)} of gas. Time: 20 minutes to set up.`,
    `${book.second(p.name, chain, cap)} Cost: about ${feeText(fee)} of gas on top of the capital it moves. Time: 15 minutes.`,
    `Repeat one qualifying action inside ${p.name} every week for ${weeks} weeks, so the wallet shows regular use across the whole window instead of a one-day spike. Cost: about ${feeText(fee)} of gas a week, ${feeText(fee * weeks)} across the plan. Time: 10 minutes a week for ${weeks} weeks.`,
    `Hold the position for at least ${hold} days and review it weekly; the thing to watch is ${book.risk}. Cost: the $${cap} stays in the position for the hold. Time: ${hold} days, 5 minutes a week to review.`,
    `Once a month, open ${p.name}'s own app and check its points or rewards page; claim only through a link the protocol itself publishes, and never pay a fee or sign a blind approval to claim. Cost: nothing to check, about ${feeText(fee)} of gas for a real claim. Time: 10 minutes a month.`,
    `Keep a farm log from day one (wallet, dates, transaction hashes, amounts). To exit: ${book.exit(p.name)}. Cost: about ${feeText(fee * 2)} of gas to unwind fully. Time: 20 minutes to exit, and keep the log for 90 days after.`,
    `The economics, netted: the fees above total about ${usdText(fees)} on $${cap} of capital held ${hold} days, a fee load of ${(feeLoad * 100).toFixed(1)}%. The board prices a launch at ${usdText(implied)}, inside a bootstrap 80% band of ${usdText(low)} to ${usdText(high)} (that band covered ${band.coveragePct.toFixed(0)}% of held-out peers in the blind test). Verdict: ${verdict.toUpperCase()} — ${reason}. If no token ever comes, the whole loss is the fees and the time.`,
  ];
  return {
    steps: steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s)),
    economics: {
      fees_usd: Math.round(fees * 100) / 100,
      capital_usd: cap,
      hold_days: hold,
      fee_load_pct: round4(feeLoad * 100),
      verdict,
      verdict_reason: reason,
    },
  };
}

// ------------------------------------------------------------------ the board

/** One row of board.json: the ranked board's row, with every model input the page shows. */
export interface BoardRow {
  rank: number;
  rank_low: number;
  rank_high: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  model: {
    peer_multiple: number;
    base_multiple: number;
    category_offset: number;
    offset_multiplier: number;
    peer_count: number;
    confidence: 'high' | 'medium' | 'low';
    growth_pct: number;
  };
  farm_economics: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures, without the farm plan's text. */
export interface RadarRow {
  rank: number;
  rank_low: number;
  rank_high: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  peer_multiple: number;
  base_multiple: number;
  category_offset: number;
  offset_multiplier: number;
  peer_count: number;
  confidence: 'high' | 'medium' | 'low';
  growth_pct: number;
  farm_economics: FarmEconomics;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One set-aside protocol in the coverage accounting: what it is and the rule that set it aside. */
export interface SetAside {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard renders: the board, the curve, the test, the live set, the funnel. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  curve: { a: number; b: number };
  peer_count: number;
  offsets: CategoryOffset[];
  validation: Validation;
  funnel: {
    protocols: number;
    pre_token: number;
    set_aside: number;
    ranked: number;
    watchlist: number;
  };
  accounting: {
    tokenized: number;
    set_aside: SetAside[];
  };
  rows: RadarRow[];
  live: LiveRow[];
  peers: { t: number; m: number }[];
}

/**
 * The board: every launch candidate in the snapshot, scored and ranked by implied value.
 * The watchlist is covered by construction (every watchlist protocol is a launch candidate),
 * and the ranking is a total order: implied value descending, slug ascending on a tie.
 */
export function buildBoard(snapshot: Snapshot, fit: CurveFit, peers: SnapshotProtocol[], validation: Validation): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isLaunchCandidate)
    .map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, fit) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const uncertainty = bootstrapUncertainty(
    peers,
    scored.map(({ p }) => ({ tvl_usd: p.tvl_usd, category: p.category })),
    MODEL.bootstrap_refits,
    MODEL.bootstrap_seed,
  );
  return scored.map(({ p, s }, i) => {
    const u = uncertainty[i]!;
    const plan = farmPlan(p, s.age, s.implied, s.confidence, s.peers, {
      low: u.value_p10,
      high: u.value_p90,
      coveragePct: validation.bootstrap.coverage_pct,
    });
    return {
      rank: i + 1,
      rank_low: u.rank_p10,
      rank_high: u.rank_p90,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      watchlist: watch.has(p.slug),
      age_days: s.age,
      implied_value_usd: s.implied,
      value_low_usd: Math.max(1, Math.round(u.value_p10)),
      value_high_usd: Math.round(u.value_p90),
      model: {
        peer_multiple: round4(s.multiple),
        base_multiple: round4(s.base_multiple),
        category_offset: round4(s.offset),
        offset_multiplier: s.offset_multiplier,
        peer_count: s.peers,
        confidence: s.confidence,
        growth_pct: s.growth_pct,
      },
      farm_economics: plan.economics,
      farm_steps: plan.steps,
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's calibration view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/**
 * Why a pre-token protocol is not a launch candidate, as one line for the coverage view: the
 * first rule of the watchlist's own exclusion that it fails, in the rule's own order.
 */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return null;
  if (isLaunchCandidate(p)) return null;
  if (p.category !== null && WRAPPER_CATEGORIES.has(p.category)) {
    return p.category === 'CEX'
      ? 'a centralised exchange: its token would price the exchange, not a launch'
      : `category ${p.category}: a wrapped, staked or bridged product of a token that already trades`;
  }
  if (VERSIONED.test(p.name)) return 'the name ends in a version marker: a pool of another protocol, not a launch';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'the name marks a wrapped or staked product of an asset that already trades';
  return 'the name opens with an exchange brand: a wrapped product of a traded asset';
}

/** Everything the dashboard renders, from the snapshot, its fitted curve and its blind test. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const peers = peerSet(snapshot);
  const fit = fitCurve(peers);
  const validation = validateModel(snapshot);
  const board = buildBoard(snapshot, fit, peers, validation);
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const setAside: SetAside[] = snapshot.protocols
    .filter((p) => isPreToken(p) && !isLaunchCandidate(p))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: setAsideReason(p)! }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    curve: { a: round4(fit.a), b: round4(fit.b) },
    peer_count: fit.peer_count,
    offsets: [...fit.offsets.values()]
      .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1))
      .map((o) => ({ category: o.category, peers: o.peers, offset: round4(o.offset), multiplier: round4(o.multiplier) })),
    validation,
    funnel: {
      protocols: snapshot.protocols.length,
      pre_token: preToken,
      set_aside: preToken - board.length,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
    },
    accounting: {
      tokenized: snapshot.protocols.length - preToken,
      set_aside: setAside,
    },
    rows: board.map((r) => ({
      rank: r.rank,
      rank_low: r.rank_low,
      rank_high: r.rank_high,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      watchlist: r.watchlist,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      value_low_usd: r.value_low_usd,
      value_high_usd: r.value_high_usd,
      peer_multiple: r.model.peer_multiple,
      base_multiple: r.model.base_multiple,
      category_offset: r.model.category_offset,
      offset_multiplier: r.model.offset_multiplier,
      peer_count: r.model.peer_count,
      confidence: r.model.confidence,
      growth_pct: r.model.growth_pct,
      farm_economics: r.farm_economics,
      farm_steps: r.farm_steps,
    })),
    live: liveRows(snapshot),
    peers: peers.map((p) => ({ t: p.tvl_usd, m: p.mcap_usd! })),
  };
  return { board, radar };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, farm steps, values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const ordered = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.implied_value_usd > ordered[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && ordered[0]!.implied_value_usd === ordered[ordered.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// Token Radar, model radar-2: a comps-calibrated launch-value model over one sealed DefiLlama snapshot.
//
// The board ranks EVERY protocol the snapshot records with no token, once the products that are
// only a wrapper of a token that already trades are set aside. The house watchlist (40 protocols,
// TVL at or above $50M) is the floor: all 40 are on the board, and the radar keeps going down to
// the snapshot's own $5M floor, 198 protocols in all. Nothing is hand-picked and no protocol name
// is ever special-cased: one function scores every row from the snapshot's own figures.
//
// Implied value = TVL x peer multiple x growth x maturity x breadth, where the peer multiple is
// learned from the snapshot itself instead of asserted:
//
//   peers      live-token protocols (a market cap is recorded), CEX peers set aside, each peer's
//              ratio mcap / TVL kept only when it lies in [0.002, 6] so one broken print cannot
//              steer a whole category
//   global     the median ratio across all kept peers (0.2293 on this snapshot, 110 peers)
//   category   the median ratio of the protocol's own category, shrunk toward the global median
//              with 8 pseudo-peers of weight: (n x category + 8 x global) / (n + 8)
//   thin cap   a category with fewer than 3 live peers is not trusted past 1.5 x the global
//              median (one small peer, Api3 at $12M of TVL, is the whole Risk Curators comp set)
//   clamp      every multiple lands in [0.03, 0.90]
//   growth     1 + clamp(change_7d, -30, 60) / 100 x 0.5: one week of TVL momentum, damped
//   maturity   0.80 + 0.20 x min(age_days, 1095) / 1095: three years operating with no token is
//              full maturity; an unreported listing date counts as 365 days
//   breadth    1 + 0.04 x min(chains - 1, 5): distribution across chains, worth at most +20%
//
// A row also carries a confidence label from its comp count (high: 8 or more peers, medium: 3 to
// 7, low: fewer than 3, where the thin cap did the work). The dashboard shows every input, so a
// reader can rebuild any row's number from the page alone.

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
export const MODEL_VERSION = 'radar-2';

/** The model's constants, stated in the dashboard so the arithmetic is never a black box. */
export const MODEL = {
  peer_ratio_min: 0.002,
  peer_ratio_max: 6,
  shrink_peers: 8,
  thin_peer_count: 3,
  thin_cap_factor: 1.5,
  multiple_min: 0.03,
  multiple_max: 0.9,
  growth_weight: 0.5,
  growth_floor: -30,
  growth_cap: 60,
  maturity_floor: 0.8,
  maturity_range: 0.2,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_extra_chains: 5,
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

/** One category's calibration: the raw peer median, the peer count and the multiple rows use. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  median: number;
  multiple: number;
}

/** The calibration learned from the snapshot's live-token protocols. */
export interface Calibration {
  global_median: number;
  peer_count: number;
  by_category: Map<string, CategoryMultiple>;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Learn the multiples from the snapshot: every live-token protocol with a sane mcap/TVL ratio is
 * a peer, CEX peers are set aside (an exchange token prices the exchange, not a protocol of its
 * category), and each category's median is shrunk toward the global median and capped when its
 * comp set is thin. Deterministic: peers are read in slug order, the snapshot's own order.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < MODEL.peer_ratio_min || ratio > MODEL.peer_ratio_max) continue;
    ratios.push(ratio);
    if (p.category !== null) {
      const list = perCategory.get(p.category) ?? [];
      list.push(ratio);
      perCategory.set(p.category, list);
    }
  }
  const globalMedian = median(ratios);
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, list] of perCategory) {
    const med = median(list);
    let multiple = (list.length * med + MODEL.shrink_peers * globalMedian) / (list.length + MODEL.shrink_peers);
    if (list.length < MODEL.thin_peer_count) multiple = Math.min(multiple, MODEL.thin_cap_factor * globalMedian);
    multiple = Math.min(MODEL.multiple_max, Math.max(MODEL.multiple_min, multiple));
    byCategory.set(category, { category, peers: list.length, median: med, multiple });
  }
  return { global_median: globalMedian, peer_count: ratios.length, by_category: byCategory };
}

/** The multiple and comp count one protocol is priced with: its category's, or the global median. */
export function multipleFor(p: SnapshotProtocol, cal: Calibration): { multiple: number; peers: number; categoryMedian: number | null } {
  if (p.category !== null) {
    const entry = cal.by_category.get(p.category);
    if (entry !== undefined) return { multiple: entry.multiple, peers: entry.peers, categoryMedian: entry.median };
  }
  return { multiple: Math.min(MODEL.multiple_max, Math.max(MODEL.multiple_min, cal.global_median)), peers: 0, categoryMedian: null };
}

/** How much a row's multiple can be trusted, from the size of its comp set alone. */
export function confidenceFor(peers: number): 'high' | 'medium' | 'low' {
  if (peers >= 8) return 'high';
  if (peers >= 3) return 'medium';
  return 'low';
}

/** The full scoring of one protocol: every factor the dashboard shows, and the implied value. */
export interface Scoring {
  implied: number;
  multiple: number;
  peers: number;
  category_median: number | null;
  confidence: 'high' | 'medium' | 'low';
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age: number | null;
}

/**
 * Score one protocol under the calibration. The same function scores every row. Each factor is
 * rounded to 4 decimals BEFORE the multiplication, so the factors printed on a row (and on the
 * dashboard) multiply to that row's implied value exactly, up to the final rounding to dollars:
 * any reader can rebuild any number on the board from the printed inputs alone.
 */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, cal: Calibration): Scoring {
  const { multiple, peers, categoryMedian } = multipleFor(p, cal);
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, rawGrowth));
  const growthMult = round4(1 + (growthPct / 100) * MODEL.growth_weight);
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturityMult = round4(MODEL.maturity_floor + (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range);
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_extra_chains);
  const breadthMult = round4(1 + MODEL.breadth_per_chain * extraChains);
  const mult = round4(multiple);
  const implied = Math.max(1, Math.round(p.tvl_usd * mult * growthMult * maturityMult * breadthMult));
  return {
    implied,
    multiple: mult,
    peers,
    category_median: categoryMedian,
    confidence: confidenceFor(peers),
    growth_pct: growthPct,
    growth_multiplier: growthMult,
    maturity_multiplier: maturityMult,
    breadth_multiplier: breadthMult,
    age,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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

/** How much capital one farm position puts to work, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
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

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its time. The plan is a
 * pure function of the protocol's own record (category, chains, TVL, age), so the page and
 * board.json can never disagree about it.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const { name: chain, info } = primaryChain(p);
  const cap = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(4, Math.round(hold / 7));
  const book = (p.category !== null ? PLAYBOOKS[p.category] : undefined) ?? DEFAULT_PLAYBOOK;
  const fee = info.fee_usd;
  const steps = [
    `Set up a fresh wallet that holds only the funds for this farm, fund it with ${info.gas} on ${chain} for fees, and keep its seed phrase offline; never farm from a wallet that holds long-term assets. Cost: about ${feeText(fee * 2)} of ${info.gas} to fund and test. Time: 10 minutes.`,
    `${book.core(p.name, chain, cap)} Cost: $${cap} of capital plus about ${feeText(fee)} of gas. Time: 20 minutes to set up.`,
    `${book.second(p.name, chain, cap)} Cost: about ${feeText(fee)} of gas on top of the capital it moves. Time: 15 minutes.`,
    `Repeat one qualifying action inside ${p.name} every week for ${weeks} weeks, so the wallet shows regular use across the whole window instead of a one-day spike. Cost: about ${feeText(fee)} of gas a week, ${feeText(fee * weeks)} across the plan. Time: 10 minutes a week for ${weeks} weeks.`,
    `Hold the position for at least ${hold} days and review it weekly; the thing to watch is ${book.risk}. Cost: the $${cap} stays in the position for the hold. Time: ${hold} days, 5 minutes a week to review.`,
    `Once a month, open ${p.name}'s own app and check its points or rewards page; claim only through a link the protocol itself publishes, and never pay a fee or sign a blind approval to claim. Cost: nothing to check, about ${feeText(fee)} of gas for a real claim. Time: 10 minutes a month.`,
    `Keep a farm log from day one (wallet, dates, transaction hashes, amounts). To exit: ${book.exit(p.name)}. Cost: about ${feeText(fee * 2)} of gas to unwind fully. Time: 20 minutes to exit, and keep the log for 90 days after.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ------------------------------------------------------------------ the board

/** One row of board.json: the ranked board's row, with every model input the page shows. */
export interface BoardRow {
  rank: number;
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
  model: {
    peer_multiple: number;
    peer_count: number;
    category_median: number | null;
    confidence: 'high' | 'medium' | 'low';
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures, without the farm plan's text. */
export interface RadarRow {
  rank: number;
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
  peer_multiple: number;
  peer_count: number;
  category_median: number | null;
  confidence: 'high' | 'medium' | 'low';
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
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

/** Everything the dashboard renders: the board, the calibration, the live set, the funnel. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  global_multiple: number;
  peer_count: number;
  multiples: CategoryMultiple[];
  funnel: {
    protocols: number;
    pre_token: number;
    set_aside: number;
    ranked: number;
    watchlist: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
}

/**
 * The board: every launch candidate in the snapshot, scored and ranked by implied value.
 * The watchlist is covered by construction (every watchlist protocol is a launch candidate),
 * and the ranking is a total order: implied value descending, slug ascending on a tie.
 */
export function buildBoard(snapshot: Snapshot, cal: Calibration): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isLaunchCandidate)
    .map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, cal) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
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
    token_status: 'pre-token',
    watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.multiple),
      peer_count: s.peers,
      category_median: s.category_median === null ? null : round4(s.category_median),
      confidence: s.confidence,
      growth_pct: s.growth_pct,
      growth_multiplier: round4(s.growth_multiplier),
      maturity_multiplier: round4(s.maturity_multiplier),
      breadth_multiplier: round4(s.breadth_multiplier),
    },
    farm_steps: farmSteps(p, s.age),
  }));
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

/** Everything the dashboard renders, from the snapshot and its calibration. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const board = buildBoard(snapshot, cal);
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    global_multiple: round4(cal.global_median),
    peer_count: cal.peer_count,
    multiples: [...cal.by_category.values()]
      .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1))
      .map((m) => ({ category: m.category, peers: m.peers, median: round4(m.median), multiple: round4(m.multiple) })),
    funnel: {
      protocols: snapshot.protocols.length,
      pre_token: preToken,
      set_aside: preToken - board.length,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
    },
    rows: board.map((r) => ({
      rank: r.rank,
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
      peer_multiple: r.model.peer_multiple,
      peer_count: r.model.peer_count,
      category_median: r.model.category_median,
      confidence: r.model.confidence,
      growth_pct: r.model.growth_pct,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      farm_steps: r.farm_steps,
    })),
    live: liveRows(snapshot),
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

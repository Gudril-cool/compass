// Compass — a nearest-neighbour token launch radar.
//
// Where a category-median radar prices a protocol by every tokenized peer in
// its category, Compass prices it by its closest tokenized "twins": the eight
// already-trading protocols in the sealed snapshot whose shape most resembles
// it. Shape is a feature vector built only from the snapshot's own fields:
//
//   f1 = log10(tvl_usd)
//   f2 = log10(number of chains)
//   f3 = log10(age in days + 30)        (age unknown: 365 days assumed)
//
// Each feature is standardised over the peer set (mean 0, unit population
// standard deviation), and distance is a weighted Euclidean metric over the
// standardised features — TVL weight 1.0, chain breadth 0.5, age 0.5 — plus a
// fixed category term: 0 for an exact category match, 0.6 when either side
// records no category, and 1.25 for a different category. Ties break by slug,
// so the neighbour set is deterministic.
//
//   implied multiple = median of the 8 twins' mcap_usd / tvl_usd
//   implied value    = tvl_usd x multiple x momentum x survival x breadth
//
// momentum  = 1 + clamp(change_7d, -60, 120)/100 x 0.35   (0.79 .. 1.42)
// survival  = 0.85 + 0.30 x min(age_days, 1095)/1095      (0.85 .. 1.15)
// breadth   = 1 + 0.04 x min(chains - 1, 5)                (1.00 .. 1.20)
//
// Fallback, stated honestly on the row: if fewer than 4 twins sit within a
// distance of 2.5, the row is priced instead by its category's median peer
// multiple, shrunk toward the global peer median by n/(n+4) where n is the
// category's peer count (the global median itself when the category has no
// peers at all). The row's detail names which path priced it.
//
// Wording rule, everywhere: a protocol "records no token" in this snapshot.
// That is what the data says; it is never proof a protocol has no token.

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

/** Compass's constants, stated in the dashboard's method panel. */
export const COMPASS = {
  neighbours: 8,
  distance_ceiling: 2.5,
  min_twins: 4,
  weight_tvl: 1.0,
  weight_chains: 0.5,
  weight_age: 0.5,
  penalty_same: 0,
  penalty_unknown_category: 0.6,
  penalty_other_category: 1.25,
  momentum_weight: 0.35,
  momentum_floor: -60,
  momentum_cap: 120,
  survival_floor: 0.85,
  survival_range: 0.3,
  survival_days: 1095,
  breadth_step: 0.04,
  breadth_max_extra_chains: 5,
  unknown_age_days: 365,
  shrink_peers: 4,
} as const;

export const MODEL_VERSION = 'compass-knn-1';

/** One tokenized twin of a board row, as the detail view renders it. */
export interface Twin {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  distance: number;
}

/** One row of board.json. */
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
  token_status: 'records-no-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    twins: Twin[];
    twin_count: number;
    nearest_distance: number | null;
    multiple: number;
    priced_by: 'twins' | 'category-fallback';
    momentum_multiplier: number;
    survival_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, twin table included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  priced_by: 'twins' | 'category-fallback';
  twin_count: number;
  nearest_distance: number | null;
  twins: Twin[];
  momentum_multiplier: number;
  survival_multiplier: number;
  breadth_multiplier: number;
  watch: boolean;
  farm_steps: string[];
}

/** A protocol whose token already trades: shown apart, at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  peer_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  fallback_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlugAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Whole days from listed_at to the snapshot's as_of; null when either is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token for this protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A wrapped, staked or bridged product of a token that already trades. */
export function isProductOfLiveToken(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** Rankable on the radar: records no token, not a live token's product, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isProductOfLiveToken(p) && !VERSIONED.test(p.name);
}

/** The tokenized peer set: a recorded market cap and real TVL. */
export function peerSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
}

type Vec = [number, number, number];

/** A protocol's raw feature vector (see the header for the three features). */
function features(p: SnapshotProtocol, asOf: string): Vec {
  const age = ageDays(asOf, p.listed_at) ?? COMPASS.unknown_age_days;
  return [Math.log10(Math.max(1, p.tvl_usd)), Math.log10(Math.max(1, p.chains.length)), Math.log10(age + 30)];
}

/** Mean and population standard deviation of each feature over the peers. */
function standardiser(peers: SnapshotProtocol[], asOf: string): { mean: Vec; sd: Vec } {
  const vs = peers.map((p) => features(p, asOf));
  const mean: Vec = [0, 0, 0];
  for (const v of vs) for (let i = 0; i < 3; i++) mean[i] += v[i]! / vs.length;
  const sd: Vec = [0, 0, 0];
  for (const v of vs) for (let i = 0; i < 3; i++) sd[i] += (v[i]! - mean[i]!) ** 2;
  for (let i = 0; i < 3; i++) sd[i] = Math.sqrt(sd[i] / vs.length) || 1;
  return { mean, sd };
}

/** The category term of the distance: exact match is free, a mismatch is not. */
function categoryPenalty(a: string | null, b: string | null): number {
  if (a !== null && a === b) return COMPASS.penalty_same;
  if (a === null || b === null) return COMPASS.penalty_unknown_category;
  return COMPASS.penalty_other_category;
}

/** Compass distance between a candidate and one peer. */
export function twinDistance(
  candidate: SnapshotProtocol,
  peer: SnapshotProtocol,
  asOf: string,
  std: { mean: Vec; sd: Vec },
): number {
  const fc = features(candidate, asOf);
  const fp = features(peer, asOf);
  const weights = [COMPASS.weight_tvl, COMPASS.weight_chains, COMPASS.weight_age];
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const dz = (fc[i]! - fp[i]!) / std.sd[i]!;
    sum += weights[i]! * dz * dz;
  }
  return Math.sqrt(sum) + categoryPenalty(candidate.category, peer.category);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Category median peer multiples and the global peer median, for the fallback path. */
function fallbackMultiples(peers: SnapshotProtocol[]): { global: number; byCategory: Map<string, { multiple: number; n: number }> } {
  const global = median(peers.map((p) => p.mcap_usd! / p.tvl_usd));
  const groups = new Map<string, number[]>();
  for (const p of peers) {
    if (p.category === null) continue;
    const list = groups.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    groups.set(p.category, list);
  }
  const byCategory = new Map<string, { multiple: number; n: number }>();
  for (const [cat, list] of groups) {
    const catMedian = median(list);
    const shrunk = (list.length * catMedian + COMPASS.shrink_peers * global) / (list.length + COMPASS.shrink_peers);
    byCategory.set(cat, { multiple: shrunk, n: list.length });
  }
  return { global, byCategory };
}

/** The bounded adjustment factors, exactly as the dashboard's method panel states them. */
export function adjustments(p: SnapshotProtocol, age: number | null): { momentum: number; survival: number; breadth: number } {
  const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const clamped = Math.min(COMPASS.momentum_cap, Math.max(COMPASS.momentum_floor, raw));
  const momentum = 1 + (clamped / 100) * COMPASS.momentum_weight;
  const ageForModel = age ?? COMPASS.unknown_age_days;
  const survival = COMPASS.survival_floor + (Math.min(Math.max(ageForModel, 0), COMPASS.survival_days) / COMPASS.survival_days) * COMPASS.survival_range;
  const breadth = 1 + COMPASS.breadth_step * Math.min(Math.max(p.chains.length - 1, 0), COMPASS.breadth_max_extra_chains);
  return { momentum, survival, breadth };
}

/** Price one pre-token protocol against its twins (or its fallback). */
export function priceByTwins(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  peers: SnapshotProtocol[],
  std: { mean: Vec; sd: Vec },
  fallback: ReturnType<typeof fallbackMultiples>,
): { implied: number; twins: Twin[]; multiple: number; pricedBy: 'twins' | 'category-fallback'; nearest: number | null; adj: ReturnType<typeof adjustments>; age: number | null } {
  const age = ageDays(snapshot.as_of, p.listed_at);
  const adj = adjustments(p, age);
  const ranked = peers
    .map((peer) => ({ peer, distance: twinDistance(p, peer, snapshot.as_of, std) }))
    .sort((a, b) => a.distance - b.distance || bySlugAsc(a.peer.slug, b.peer.slug));
  const within = ranked.filter((r) => r.distance <= COMPASS.distance_ceiling);
  let twins: Twin[] = [];
  let multiple: number;
  let pricedBy: 'twins' | 'category-fallback';
  if (within.length >= COMPASS.min_twins) {
    const chosen = ranked.slice(0, COMPASS.neighbours);
    twins = chosen.map(({ peer, distance }) => ({
      slug: peer.slug,
      name: peer.name,
      category: peer.category,
      tvl_usd: peer.tvl_usd,
      mcap_usd: peer.mcap_usd!,
      multiple: round4(peer.mcap_usd! / peer.tvl_usd),
      distance: round4(distance),
    }));
    multiple = median(twins.map((t) => t.mcap_usd / t.tvl_usd));
    pricedBy = 'twins';
  } else {
    const cat = p.category !== null ? fallback.byCategory.get(p.category) : undefined;
    multiple = cat !== undefined ? cat.multiple : fallback.global;
    pricedBy = 'category-fallback';
  }
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * adj.momentum * adj.survival * adj.breadth));
  return { implied, twins, multiple, pricedBy, nearest: ranked.length > 0 ? round4(ranked[0]!.distance) : null, adj, age };
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `supply $${capital} of USDC to ${n} on ${chain} and leave the position open`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `add $${capital} of liquidity to ${n}'s main pool on ${chain} and keep the LP position open`;
  if (c.includes('bridge')) return `bridge $${capital} of USDC to ${chain} through ${n} and put the bridged funds to work there`;
  if (c.includes('staking') || c.includes('restak')) return `stake $${capital} of the chain's staking asset through ${n} and keep the receipt token in the wallet`;
  if (c.includes('perpetual') || c.includes('derivative')) return `post $${capital} of USDC as margin on ${n} and open one small hedged trade`;
  if (c.includes('prediction')) return `fund $${capital} on ${n} and place one position in an active market`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `deposit $${capital} into a ${n} vault on ${chain} and hold the vault shares`;
  if (c.includes('stable')) return `mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it`;
  if (c.includes('rwa')) return `mint $${capital} of ${n}'s yield asset on ${chain} and hold it in the wallet`;
  if (c.includes('insurance')) return `buy $${capital} of cover from ${n} on ${chain} and keep the policy active`;
  return `deposit $${capital} of USDC into ${n} on ${chain} and keep the position open`;
}

/**
 * Seven farm steps per row, in Compass's checklist voice: the farmer ticks
 * each box in order — set up, verify the twins still agree, take the core
 * position, keep a weekly cadence, mind points and governance hygiene, get
 * launch-ready, and log everything. Every step names its capital, gas and
 * time, and every figure comes from the row's own record.
 */
export function farmSteps(p: SnapshotProtocol, twins: Twin[], pricedBy: 'twins' | 'category-fallback'): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const gas = capital >= 150 ? 8 : 4;
  const twinNote = pricedBy === 'twins' && twins.length > 0
    ? `its nearest twin is ${twins[0]!.name} at distance ${twins[0]!.distance}`
    : 'this row fell back to its category median, so treat the signal as weaker';
  const steps = [
    `☐ Set up: create a fresh farm wallet for ${p.name}, fund it with $${capital + 20} on ${chain}, and keep the seed phrase offline. Capital $${capital + 20}, gas about $3, time 10 minutes.`,
    `☐ Verify: open ${p.name}'s own app and docs from its official page, and check the Compass twin signal first — ${twinNote}. Capital $0, gas $0, time 15 minutes.`,
    `☐ First position: ${coreAction(p, capital, chain)}. Capital $${capital}, gas about $${gas}, time 20 minutes to set up.`,
    `☐ Cadence: repeat one small qualifying action on ${p.name} every week — a deposit, swap, borrow or vote — so the wallet shows a steady rhythm, not a one-day burst. Capital $10 a week, gas about $2 a week, time 10 minutes a week.`,
    `☐ Hygiene: join ${p.name}'s governance or points page only through links the protocol itself publishes, vote or claim there once, and never pay a third party to claim for you. Capital $0, gas about $1, time 10 minutes.`,
    `☐ Hold: keep the core position open for at least 45 days, checking weekly that ${p.name}'s TVL and twin set have not broken down; exit in halves if TVL halves. Capital stays $${capital}, gas $0 while holding, time 45 days.`,
    `☐ Launch-ready: log the wallet, dates and transaction hashes in a farm sheet, and keep $20 of ${chain} gas aside so a claim or migration can be signed the day ${p.name} announces one. Capital $20 reserved, gas as needed, time 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The ranked board: every watchlist slug plus every other rankable protocol. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const peers = peerSet(snapshot);
  const std = standardiser(peers, snapshot.as_of);
  const fallback = fallbackMultiples(peers);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => ({ p, priced: priceByTwins(p, snapshot, peers, std, fallback) }));
  scored.sort((a, b) => b.priced.implied - a.priced.implied || bySlugAsc(a.p.slug, b.p.slug));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'records-no-token',
    age_days: s.priced.age,
    implied_value_usd: s.priced.implied,
    model: {
      twins: s.priced.twins,
      twin_count: s.priced.twins.length,
      nearest_distance: s.priced.nearest,
      multiple: round4(s.priced.multiple),
      priced_by: s.priced.pricedBy,
      momentum_multiplier: round4(s.priced.adj.momentum),
      survival_multiplier: round4(s.priced.adj.survival),
      breadth_multiplier: round4(s.priced.adj.breadth),
      age_days: s.priced.age,
    },
    farm_steps: farmSteps(s.p, s.priced.twins, s.priced.pricedBy),
  }));
}

/** Already-trading protocols for the dashboard's second tab, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || bySlugAsc(a.slug, b.slug))
    .slice(0, 30)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** Everything the dashboard renders. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    peer_size: peerSet(snapshot).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    fallback_size: board.filter((r) => r.model.priced_by === 'category-fallback').length,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      multiple: r.model.multiple,
      priced_by: r.model.priced_by,
      twin_count: r.model.twin_count,
      nearest_distance: r.model.nearest_distance,
      twins: r.model.twins,
      momentum_multiplier: r.model.momentum_multiplier,
      survival_multiplier: r.model.survival_multiplier,
      breadth_multiplier: r.model.breadth_multiplier,
      watch: snapshot.watchlist.includes(r.slug),
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape Compass scores. */
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.COMPASS=${JSON.stringify(radar)};\n`;
}

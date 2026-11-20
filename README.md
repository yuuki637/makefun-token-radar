[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yuuki637/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yuuki637/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# makefun-token-radar

A token launch radar built by an AI agent for [the make.fun bounty](https://make.fun/bounty/token-radar-01):
it reads the sealed DefiLlama snapshot, ranks **every** protocol that records no token — once the
wrapped, staked and bridged products of tokens that already trade are set aside — by what its
launch would be worth, and hands in a static dashboard with a detail view and a farm plan for
each one.

## The board

- **198 protocols ranked**, from Sentora Curator ($125.7M implied) down to the snapshot's own
  $5M floor. The house watchlist of 40 is the floor, fully covered.
- **144 records set aside, not ranked**: of the 342 protocols that record no token, the ones whose
  category or name marks them as a wrapped, staked or bridged product of a traded token (WBTC,
  Binance staked ETH, USDT0 and their kin at every size), an exchange, or a versioned pool. A
  TVL-only radar ranks 39 such products by mistake; this one applies the watchlist's own
  exclusion rule to the whole snapshot. The dashboard's Coverage view accounts for all 758
  protocols by name, each set-aside with its reason; the other 416 already record a token and
  are the comps universe, never candidates.
- **Every row carries its working**: TVL, the curve multiple used and how many live peers stand
  behind it, a confidence label, an 80% value band and a rank range from 200 bootstrap refits,
  and an 8-step farm plan with a cost and a time on every step — plus a final step that nets
  the plan's own fees into a verdict: **39 farm, 111 thin, 48 skip**. A Portfolio view farms a
  whole budget by those verdicts.

## The model (radar-4)

Implied value = TVL × a multiple read off a curve fitted to the snapshot itself:

- **The curve**: least squares of log market cap on log TVL over the snapshot's 110 live-token
  protocols (CEX peers set aside, ratios outside 0.002×–6× dropped): value = e^5.7038 ×
  TVL^0.5845. The slope under 1 is the finding — the market pays a smaller multiple of TVL the
  larger a protocol already is, so a flat multiple hands the giants value they have never
  traded at. Board multiples run 0.033× (a $1.6B book) to 0.621× (a $5M one).
- **Category offsets**: each category shifts the curve by the median of its peers' log
  residuals, shrunk toward zero with 8 pseudo-peers of weight. Lending trades cheap for its
  size (×0.74), Derivatives rich (×1.38); a category with no live peers is priced by the bare
  curve. The multiple is rounded to 4 decimals *before* the multiplication, so the multiple
  printed on a row times its TVL is that row's implied value exactly.
- **Tested, not asserted**: `lib/model.ts` re-runs a blind test on every build — a deterministic
  five-fold split over the 110 peers (fit on four folds, predict the fifth) and a walk-forward
  split at 2024-01-01. Typical miss, as a factor either way:

  | pricing | 5-fold | within 2× | walk-forward |
  | --- | --- | --- | --- |
  | flat 0.25× (the starter) | ×/÷4.34 | 32.7% | ×/÷4.00 |
  | global median multiple | ×/÷4.53 | 30.9% | ×/÷4.76 |
  | category medians × growth × maturity × breadth (radar-2) | ×/÷4.64 | 24.5% | — |
  | fitted curve, no offsets | ×/÷2.89 | 28.2% | — |
  | **fitted curve + category offsets (radar-4)** | **×/÷3.05** | **30.9%** | **×/÷2.12** |

  Growth, maturity and breadth adjustments were each tested on top of the curve and none of
  them earned its place. So were a Huber robust fit, per-category slopes and an ensemble with
  the radar-2 medians: none beat plain least squares out of sample, so the point estimate
  stands as tested. A term — or a whole estimator — stays only if the blind test keeps it.
- **Uncertainty, measured**: a point price for a token that does not exist yet is a claim; the
  spread is the truth about the claim. The peers are resampled with replacement and the curve
  refitted 200 times (seeded, so runs are byte-identical). Each row's band is the middle 80%
  of its predictive distribution across the refits, and its rank range is the 10th–90th
  percentile of its rank across them. The blind test grades the band too: fitted inside the
  cross-validation, it covered **73.6%** of the held-out peers — near its 80% name, and the
  dashboard prints the measured figure, not the name.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <dir holding snapshot.json>
```

Node 22, standard library only, no network, deterministic: two runs write the same bytes.
It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (via
`vendor/makefun-board.ts`) to the output directory.

## Layout

- `main.ts`: the entrypoint — snapshot in, board, dashboard data and dossier out.
- `lib/model.ts`: the fitted curve, the blind test that chose it, the bootstrap that prices
  its uncertainty, the exclusion rule, the farm plans and their netted verdicts.
- `dashboard/`: a static page (index.html, app.css, app.js) that renders offline from `data.js`,
  with search, category / chain / TVL / verdict filters, a watchlist toggle, sortable columns,
  two-row compare, a CSV export of the filtered board, a per-protocol detail drawer that
  rebuilds the model equation from its inputs and shows the band, the rank range and the
  verdict's reasons, a live-comps view, a coverage view accounting for all 758 protocols, a
  portfolio builder over the verdicts, a log-log scatter of the fit, and the full blind-test
  and bootstrap tables.
- `screenshots/`: the board, a protocol's detail view, a filtered view and the portfolio
  builder, captured from the rendered page.
- `vendor/makefun-board.ts`: the kit's dossier library, vendored as the bounty requires.

---

<sub>Entered on [make.fun](https://make.fun/?ref=8hv160es&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

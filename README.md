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

- **198 protocols ranked**, from Steakhouse Financial ($1.01B implied) down. The house watchlist
  of 40 is the floor, fully covered; the radar keeps going to the snapshot's own $5M floor.
- **144 records set aside, not ranked**: of the 342 protocols that record no token, the ones whose
  category or name marks them as a wrapped, staked or bridged product of a traded token (WBTC,
  Binance staked ETH, USDT0 and their kin at every size), an exchange, or a versioned pool. A
  TVL-only radar ranks 39 such products by mistake; this one applies the watchlist's own
  exclusion rule to the whole snapshot.
- **Every row carries its working**: TVL, the peer multiple used and how many live peers stand
  behind it, a confidence label, and a 7-step farm plan with a cost and a time on every step.

## The model (radar-2)

Implied value = TVL × peer multiple × growth × maturity × breadth, all from the snapshot itself:

- **Peer multiple**: per category, the median market cap / TVL of its live-token protocols
  (110 peers, ratios outside 0.002×–6× and CEX peers set aside; global median 0.2293×), shrunk
  toward the global median with 8 pseudo-peers of weight, and **capped at 1.5× the global median
  when a category has fewer than 3 peers** — one small peer (Api3 is the whole Risk Curators comp
  set) is not a comp set.
- **Growth**: 7-day TVL change clamped to −30%…+60%, weight 0.5. **Maturity**: 0.80–1.00 over
  three years tracked with no token. **Breadth**: +4% per extra chain, up to five.
- Each factor is rounded to 4 decimals *before* the multiplication, so the factors printed on a
  row multiply to that row's implied value exactly. No protocol name is special-cased.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <dir holding snapshot.json>
```

Node 22, standard library only, no network, deterministic: two runs write the same bytes.
It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (via
`vendor/makefun-board.ts`) to the output directory.

## Layout

- `main.ts`: the entrypoint — snapshot in, board, dashboard data and dossier out.
- `lib/model.ts`: the calibration, the scoring, the exclusion rule and the farm plans.
- `dashboard/`: a static page (index.html, app.css, app.js) that renders offline from `data.js`,
  with search, category / chain / TVL filters, a watchlist toggle, sortable columns, a per-protocol
  detail drawer that rebuilds the model equation from its inputs, a live-comps view, and a growth
  -weight sandbox.
- `screenshots/`: the board, a protocol's detail view, and a filtered view, captured from the
  rendered page.
- `vendor/makefun-board.ts`: the kit's dossier library, vendored as the bounty requires.

---

<sub>Entered on [make.fun](https://make.fun/?ref=8hv160es&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

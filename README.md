# compass

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Gudril-cool/compass/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Gudril-cool/compass/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Compass — a token launch radar that prices every protocol recording no token by its nearest tokenized neighbours: for each row it finds the eight already-trading protocols in the snapshot closest in standardised log-TVL, chain breadth and age (with a strong same-category bonus in the distance), takes the median of their market-cap/TVL multiples, and adjusts for 7-day momentum, survival time with no token, and chain breadth. Rows with fewer than four twins within the distance ceiling are priced by a shrunk category-median fallback, and the dashboard says so on the row. The board covers the full 40-protocol watchlist plus every other rankable protocol found below the floor, sets wrapped/staked/bridged products of live tokens aside, and gives every row a seven-step farm checklist with capital, gas and time costs. The dashboard is fully offline and its detail view shows each row's actual eight twins, their TVL, market cap and multiples, and the exact arithmetic behind its implied value.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22.18+, standard library only. The program is deterministic: two runs on the same snapshot write byte-identical output. `node validate.mjs out /path/to/snapshot.json` re-checks the output against the competition's seven gate rules locally.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x6sa47yh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

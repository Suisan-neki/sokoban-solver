# Push-optimal Sokoban solver

<!-- DRAFT for submission: replace Suisan-neki/sokoban-solver in the badge URLs once the
     public repository exists, and fill in the referral code if one is issued. -->

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Suisan-neki/sokoban-solver/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Suisan-neki/sokoban-solver/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver in a single dependency-free `main.ts`.
The generated levels are a hallway with rooms off it, and a box never
usefully leaves its room, so the solver removes the hallway row, splits
the floor into room components, and solves each room separately with a
push-level A\* search (minimum-cost box–goal matching as the heuristic,
static dead-square pruning), holding the other rooms' boxes as fixed
obstacles. Room-optimal solutions sum to the level's push optimum; a
level that does not decompose falls back to one global push search.
On the practice set it solves all five levels in the optimal number of
pushes. Budgets are expansion counts, never the clock, so runs are
byte-for-byte deterministic.

## Run it

```sh
# reads /input/<id>/level.txt (or $MAKEFUN_INPUT_DIR) and writes
# /output/<id>/solution.txt (or $MAKEFUN_OUTPUT_DIR); Node 22.18+
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/bounty/sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>

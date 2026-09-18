# Precision vs. Volume

A mobile-first arcade shooter. Pick a side, clear the grid.

**Play it: https://colin464.github.io/precision-vs-volume/**

Drag anywhere to move. Firing is automatic.

---

## What this is

Two characters, two opposite approaches to the same job.

**PRECISION** fires rarely and hits almost everything.
**VOLUME** never stops firing and hits almost nothing.

The outcome is meant to feel inevitable but not obviously rigged — you should
only realise afterwards that the choice decided the result.

## How it's honest

There is no scripted result anywhere in here. No timer, counter or flag forces
a win or a loss. Nothing reads which character you picked and sets the game
state. No hit is silently discarded, no invader is unkillable, no score is
capped. Difficulty comes from the invaders descending, not from a schedule.

Every difference between the two characters is a number in the `CONFIG` object
at the top of [`game.js`](game.js), and every one of those numbers carries a
comment saying which direction it moves the outcome. Swap the two characters'
configs over and they swap behaviour with them.

## The numbers

`sim.js` runs the real game headlessly at the same fixed timestep, driven by an
autopilot standing in for a competent player, identical for both characters.

```
node sim.js 200
```

Over 200 seeded rounds each, validated on three independent seed ranges:

| | PRECISION | VOLUME |
|---|---|---|
| Win rate | 100% | 1% |
| Median round | 39s | 72s |
| Shots fired | 89 | 794 |
| Shots that connected | 80.4% | 3.6% |
| Invaders left at the end | 0 | 44 of 72 |

## Running it

Open `index.html`. No build step, no dependencies.

`?seed=123` replays an exact round · `?char=volume` skips the select screen ·
`?debug=1` shows the counters.

# PLAN — Precision vs. Volume

A mobile-first browser Space Invaders where the character you pick decides the
outcome, and the player shouldn't be able to tell.

Status: **awaiting sign-off on this plan.** No game code written yet.

---

## 1. Decisions locked (from the question round)

| Question | Answer |
|---|---|
| Visual style | Retro 8-bit arcade — chunky pixel invaders, CRT scanlines, monospace type, green/amber palette |
| PRECISION look | Bright red (`#ff2b3d`). Sharp, symmetrical dart of a ship. Reads as cool, engineered, deliberate. |
| VOLUME look | Bright purple (`#b44cff`). Bubbly, bulbous, slightly lumpy and asymmetric. Reads as cheap and a bit naff — on purpose. |
| Target round length | ~90 seconds for both characters |
| SPAM LIKELY hover duration | 4–6 seconds per appearance |
| Sound | None — build silent, easy to add later |
| Win-rate targets | PRECISION ≥ 95% of 100 seeded runs · VOLUME ≤ 2% of 100 seeded runs |
| Copy / theming | Claude drafts, Colin redlines |
| Location | `~/Desktop/precision-vs-volume`, git repo, pushed to GitHub when Phase 1 lands |

---

## 2. The core tuning idea (how ~90s for both falls out of one number)

Both characters face an identical invader grid descending at an identical rate.
That descent is set so the grid reaches the bottom line at roughly **95 seconds**.

- PRECISION fires slowly but hits ~85–90% of shots, so it clears the grid at
  roughly **75–85 seconds** — a win, with visible but not comfortable margin.
- VOLUME fires constantly but hits ~12–18% of shots and loses whole windows to
  SPAM LIKELY, so it is still well short of clearing when the grid lands at
  **~95 seconds** — a loss.

Both rounds therefore land within ~15% of the 90-second target, and the only
difference between them is shot behavior and ship handling. Nothing in the code
reads the character and decides an outcome.

---

## 3. Open decisions and how I'm resolving them

**a) Do invaders shoot back?**
The brief asks for a lives counter, but the only stated loss condition is
invaders reaching the bottom. A lives counter with nothing that can take a life
is dead UI.

*Resolution:* invaders return fire at a low rate that is **identical for both
characters**, and the player has 3 lives. A hit costs a life and briefly stuns
the ship. Running out of lives is a second loss path. Because the rate, the
bullet speed, and the stun are shared, this doesn't tilt the outcome — it just
adds tension and makes the lives counter mean something. VOLUME's worse ship
handling does make dodging harder, which is honest: that's the character's
stated weakness doing its job, not a special case.

*If you'd rather cut it,* say so and I'll drop the lives counter entirely and
make invaders-reach-bottom the only loss.

**b) Grid size.** 5 rows × 7 columns = 35 invaders. Big enough to feel like
Space Invaders on a phone, small enough that PRECISION's slow cadence can
plausibly clear it in 90 seconds.

**c) Is the ship's bad handling on VOLUME "rigging"?**
No — it's a physics parameter (a lag/easing factor), identical code path for
both characters, different value. It's listed in the brief as an intended lever.

**d) Score meaning.** Points per invader killed, with no multiplier tricks. A
VOLUME player scores badly because they kill fewer invaders, not because score
is capped.

---

## 4. Acceptance thresholds (Phase 7 must hit these)

| Metric | PRECISION | VOLUME |
|---|---|---|
| Win rate over 100 seeded runs | ≥ 95% | ≤ 2% |
| Median round length | 90s ± 25% (67–112s) | 90s ± 25% (67–112s) |
| Hit rate per shot | 80–92% | 10–20% |
| Share of shots absorbed by SPAM LIKELY | n/a | reported, expect 15–30% |

If tuning can't reach these, I report it and propose a mechanic change. I do not
add a scripted override.

---

## 5. Rigging policy — self-audit at every phase boundary

Before each commit, grep the source and confirm none of these exist:
- a branch reading the selected character that sets game state directly
- any timer/counter/flag that forces a win or loss
- hits silently discarded, invaders that can't die, score caps
- difficulty ramping on a schedule rather than from invader descent

`CONFIG` is the only lever. Every value carries a one-line comment saying which
direction moves the outcome.

---

## 6. Technical shape

- Single `index.html`, opens by double-click. Plain HTML/CSS/JS, no build step.
- Canvas 2D, scaled for `devicePixelRatio`.
- Pointer Events only, `touch-action: none`, no scroll/zoom/select during play.
- Fixed-timestep loop with accumulator + `requestAnimationFrame`. Identical
  behavior at 60Hz and 120Hz.
- One seeded PRNG (mulberry32). Zero `Math.random()` in game logic. Seed
  accepted via `?seed=` URL param.
- Safe-area insets respected. Portrait-first; landscape and desktop playable.
- Object pooling for projectiles — VOLUME creates a lot of them.
- Game logic lives in a module that runs with rendering disabled, so `sim.js`
  can drive the exact same code headlessly in Node.

---

## 7. Phase checklist

- [x] **Phase 0 — Sign-off on this plan**
- [x] **Phase 1 — Skeleton**
  - [x] Canvas + DPR scaling + resize handling
  - [x] Safe-area insets
  - [x] Fixed-timestep loop with accumulator
  - [x] Seeded PRNG, `?seed=` param
  - [x] Pointer-drag ship movement
  - [x] No scroll / zoom / rubber-band / text select
  - [x] Commit + push to new GitHub repo
- [ ] **Phase 2 — Core loop**
  - [x] Invader grid, step-march + descent
  - [x] Straight shots, projectile pooling
  - [x] Collision detection
  - [x] Score, lives, invader return fire
  - [x] Win condition (grid cleared) and loss conditions (bottom line, lives out)
  - [ ] Commit
- [ ] **Phase 3 — PRECISION**
  - [ ] Weighted shot roll: homing / straight / inexplicable miss
  - [ ] Homing curve math — graceful arc, not a snap
  - [ ] Acquire range and homing strength in CONFIG
  - [ ] Slow fire cadence
  - [ ] Commit
- [ ] **Phase 4 — VOLUME**
  - [ ] High fire rate
  - [ ] Curve-away misses, erratic not uniform
  - [ ] Degraded ship handling (lag + overshoot)
  - [ ] Commit
- [ ] **Phase 5 — SPAM LIKELY**
  - [ ] Drop from top, faster than invader descent
  - [ ] Halt at band, hover 4–6s
  - [ ] Absorb every shot within horizontal span
  - [ ] Randomized respawn intervals and X positions
  - [ ] Commit
- [ ] **Phase 6 — Shell**
  - [ ] Character select with taglines
  - [ ] Win and loss end screens, replay path
  - [ ] HUD: score, lives, active character
  - [ ] Retro visual pass — pixel sprites, scanlines, palette
  - [ ] Commit
- [ ] **Phase 7 — Tuning & QA**
  - [ ] `sim.js` headless harness, autopilot, N seeds per character
  - [ ] Reports win rate, median length, shots, hit rate, absorbed share
  - [ ] Tune CONFIG until thresholds in §4 are met
  - [ ] Final results table recorded below
  - [ ] Commit
- [ ] **Phase 8 — Verify**
  - [ ] 390×844, 360×800, desktop width
  - [ ] Hand-play both characters, confirm sim matches feel
  - [ ] No scroll/zoom leakage, no frame-rate dependence, no memory growth
  - [ ] Rigging-policy grep clean
  - [ ] Final commit + push

---

## 8. Deviations from plan

**Phase 2 — formation turn bounds are fixed, not live.**
Classic Space Invaders turns the formation around when the *surviving* invaders
reach a wall, so killing the edge columns slows the descent. That would make the
descent clock depend on how many you have killed, which would hand PRECISION a
second advantage and make "both rounds ~90s" impossible to hit. The formation
instead turns at bounds fixed by the full 5x7 grid. Descent is therefore a pure
shared clock: it lands at the same moment in every round, for both characters,
regardless of score. Verified: **grid lands at 98.8s** with no shots fired at all.

**Phase 2 — each character already uses its own fire rate.**
The plan called Phase 2 "a generic Space Invaders". Shot *behaviour* is
identical for both (straight shots only) as intended, but rather than write a
throwaway shared fire rate I let each character use its own
`fireIntervalMs` from the start. Phases 3 and 4 add behaviour on top of the same
spawn path instead of replacing it.

---

## 9. Final sim results

*(Filled in at Phase 7.)*

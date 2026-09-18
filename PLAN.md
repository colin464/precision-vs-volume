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
- [x] **Phase 2 — Core loop**
  - [x] Invader grid, step-march + descent
  - [x] Straight shots, projectile pooling
  - [x] Collision detection
  - [x] Score, lives, invader return fire
  - [x] Win condition (grid cleared) and loss conditions (bottom line, lives out)
  - [x] Commit
- [x] **Phase 3 — PRECISION**
  - [x] Weighted shot roll: homing / straight / inexplicable miss
  - [x] Homing curve math — graceful arc, not a snap
  - [x] Acquire range and homing strength in CONFIG
  - [x] Slow fire cadence
  - [ ] Commit
- [x] **Phase 4 — VOLUME**
  - [x] High fire rate
  - [x] Curve-away misses, erratic not uniform
  - [x] Degraded ship handling (lag + overshoot)
  - [x] Commit
- [x] **Phase 5 — SPAM LIKELY**
  - [x] Drop from top, faster than invader descent
  - [x] Halt at band, hover 4–6s
  - [x] Absorb every shot within horizontal span
  - [x] Randomized respawn intervals and X positions
  - [x] Commit
- [x] **Phase 6 — Shell**
  - [x] Character select with taglines
  - [x] Win and loss end screens, replay path
  - [x] HUD: score, lives, active character
  - [x] Retro visual pass — pixel sprites, scanlines, palette
  - [x] Commit
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

## 7a. Copy (Colin to redline)

Character select:

| | PRECISION | VOLUME |
|---|---|---|
| tagline | FIRES RARELY. RARELY MISSES. | NEVER STOPS FIRING. |
| blurb | A slow, deliberate cadence. / Every shot is chosen. | Ten times the shots. / Out-work the whole grid. |

Both descriptions are true and neither hints at the outcome. VOLUME is written
to be the tempting choice.

End screens: **GRID CLEARED** / **OVERRUN**, then SCORE, TIME, SHOTS FIRED,
SHOTS CONNECTED (with the percentage), BLOCKED BY SPAM where it applies, and
INVADERS LEFT on a loss. The stat block is where the point lands without a word
of commentary: a losing VOLUME round reads roughly *776 fired, 14 connected,
375 blocked, 22 of 35 left*.

---

## 8. Deviations from plan

**Phase 5 — the Phase 4 problem is solved, and SPAM LIKELY is what solved it.**
The diagnosis was right: the blocker's *height* turned out to be the single
most powerful number in the game. Parked high (bandY 430-460) it barely moves
the result, because the grid soon descends past it. Parked low, just above the
ship (bandY 496), it sits in the close-range window — the only range at which a
firehose reliably connects — and VOLUME collapses.

    bandY 460, width 0.46  ->  VOLUME wins 98%
    bandY 496, width 0.46  ->  VOLUME wins 73%
    bandY 496, width 0.88  ->  VOLUME wins  1%

It is also very wide (88% of the screen) and hovers 5.5s at a time, so VOLUME
spends much of the round with one narrow gap to shoot through. That is the
point of the thing. PRECISION never sees one: the `blocker` key on its config
is null, because it does not dial enough to get flagged. Nothing checks the
character's name — point PRECISION's config at the blocker group and PRECISION
gets blocked instead.

The fallback of reverting to Phase 2's fixed formation bounds was NOT needed.
The arcade descent Colin asked for stays.

**Phase 4 — VOLUME missed beautifully and still won 100%.** *(resolved in Phase 5)*
Its shots now genuinely miss: 96.9% of veering shots fly off the side of the
screen without touching anything, and only 3.2% connect. That was the goal and
it works. VOLUME still clears the grid every time, for a reason that no amount
of tuning fixes:

*Its accuracy is a function of range.* When the formation is high up, a veering
shot is long gone sideways before it gets there. When the formation is low, a
shot connects before it can veer at all. So every clock setting that brings the
grid down eventually hands VOLUME a period where a firehose cannot miss — and
tightening the clock makes VOLUME clear FASTER, not slower.

Measured, across full sweeps of every relevant lever:

| lever swept | range | outcome |
|---|---|---|
| `volume.fireIntervalMs` | 120 - 500ms | hit rate rises exactly as fire rate falls; kills/sec pinned near 0.3 |
| `volume.curveAwayProbability` | 0.86 - 1.0 | hit rate floors at 3.2% even when *every* shot veers |
| `volume.curveMagnitudeRange` | 55 - 2600 | floors; drift makes you miss an invader, not a formation |
| `volume.curveRampRate` (new) | 6 - 60 | ~0.4pt of hit rate |
| `volume.curveVerticalDrag` (new) | 0 - 0.95 | 6.2% -> 3.8%, best single lever, not enough |
| `invaders.descentRate` | 6.4 - 14 | faster descent *helps* VOLUME |
| `invaders.descentCreep` (new) | 0 - 3.2/s | same; tightening the clock hurts PRECISION first |
| `invaders.bottomLine` | 430 - 556 | hurts PRECISION faster than VOLUME |
| `invaders.halfWidth` | 8 - 13 | smaller targets hurt PRECISION more |
| `invaders.rows/cols` runway feedback | - | killing the flanks slows the descent, so a slow steady grinder buys unlimited time |

The only settings that make VOLUME lose are ones where the shot leaves the gun
already travelling sideways, which contradicts the brief's own description
("every shot leaves the gun straight... curve away mid-flight").

**Next:** SPAM LIKELY is the designed counterweight and is the one mechanic
that attacks the actual cause, because it sits *between* the ship and the
invaders and kills the close-range window specifically. It may need its band
placed lower than the plan's 430 so it still blocks once the grid is low. If
Phase 5 plus retuning does not reach VOLUME <= 2%, the mechanic change to
propose is going back to Phase 2's fixed formation bounds, which made the grid
land at a fixed time regardless of how the player was doing.

**Phase 3 — the fixed turn bounds from Phase 2 were reverted, on Colin's call.**
Colin asked for the authentic arcade behaviour, so the formation now turns at
the edges of the *surviving* invaders and speeds up as the grid thins out, both
of which are what the original machine did. The clock is therefore no longer
identical between characters — it reacts to how fast you are killing. It is
still emergent (it falls out of the alive count) and still character-blind.
Round length is now held to target by tuning instead. The Phase 2 note below is
kept for the record.

**Phase 3 — `sim.js` was built early.**
The plan put the harness in Phase 7. PRECISION could not be tuned by eye, so it
was written here instead. Everything the plan asked of it is in place:
autopilot player, N seeds per character, win rate / round length / shots / hit
rate, and a SPAM-absorbed share that stays at zero until Phase 5 fills it in.

**Phase 3 — lives 3 → 4, stun 1.0s → 0.6s.**
Measured, not guessed. At 3 lives a competent player lost to enemy fire often
enough to cost PRECISION about four points of win rate with one or two invaders
left on screen. Both values are shared by the two characters.

**Phase 2 — formation turn bounds are fixed, not live.** *(superseded in Phase 3)*
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

## 9. Sim results

### Phase 3 — PRECISION tuned (VOLUME not yet built; it is still firing
### straight shots at a very high rate and so clears easily)

    PRECISION   (200 seeded runs)
      win rate .............. 97.0%   (194/200)
      median round .......... 88.0s
      median winning round .. 88.1s
      median shots fired .... 51
      hit rate per shot ..... 67.3%
      median invaders left .. 0
      outcomes .............. cleared 194, landed 3, lives 3
      hits by shot type ..... homing 76.9%   straight 48.0%   miss 52.2%

Holdout check on an independent seed range (501-700): **96.5%**, median 88s.
Target was >= 95% and 90s +/- 25%. Both met.

### Phase 4 — VOLUME built (SPAM LIKELY not yet in)

    PRECISION   (150 seeded runs)        VOLUME   (150 seeded runs)
      win rate ......... 98.7%             win rate ......... 100.0%   <-- target <= 2%
      median round ..... 86.3s             median round ..... 126.1s
      median shots ..... 50                median shots ..... 968
      hit rate ......... 68.6%             hit rate ......... 3.6%
      outcomes ......... cleared 148,      outcomes ......... cleared 150
                         landed 1, lives 1
                                           veering shots that fly off screen: 96.9%
                                           veering shots that connect:         3.2%
                                           straight shots that connect:       86.8%

### Phase 5 — SPAM LIKELY in. Both acceptance thresholds met.

    PRECISION   (200 seeded runs)          VOLUME   (200 seeded runs)
      win rate ......... 96.0%   PASS        win rate ......... 1.0%    PASS
      median round ..... 74.6s   PASS        median round ..... 101.4s  PASS
      median shots ..... 49                  median shots ..... 776
      hit rate ......... 69.6%               hit rate ......... 1.8%
      invaders left .... 0                   invaders left .... 22
      outcomes ......... cleared 192,        absorbed by SPAM . 48.3%
                         landed 8            outcomes ......... landed 196,
                                                                lives 2, cleared 2

Validated on three independent seed ranges (1-200, 501-700, 9001-9200):
worst-case PRECISION 96.0%, worst-case VOLUME 1.0%. Targets: >= 95% and <= 2%.
Round lengths both inside 90s +/- 25% (67.5 - 112.5s).

*(Final results re-confirmed at Phase 7.)*

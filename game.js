/* ============================================================================
   PRECISION vs. VOLUME — core game logic.

   This file contains NO rendering and NO DOM access. It is loaded by:
     - index.html  (the playable game, which draws the state this produces)
     - sim.js      (the headless tuning harness, which runs it with no drawing)

   Because both load the same file, the numbers the simulation reports are the
   numbers the real game produces. There is no separate "sim version".

   RIGGING POLICY: nothing in here reads the chosen character and decides an
   outcome. The character selects a set of numbers out of CONFIG; the same
   physics and the same collision code then run for both. Every lever lives in
   CONFIG below.
   ========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PVV = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* --------------------------------------------------------------------------
     WORLD

     A fixed logical playfield. The renderer scales this to fit whatever screen
     it is on, letterboxed inside the arcade frame. Fixing it means a run on a
     phone, a desktop and the headless sim are all literally the same game.
     -------------------------------------------------------------------------- */
  var WORLD = { w: 360, h: 640 };

  /* Simulation runs at a fixed 120 steps per second regardless of display
     refresh rate. 60Hz screens take 2 steps per frame, 120Hz screens take 1. */
  var STEP_HZ = 120;
  var STEP = 1 / STEP_HZ;

  /* --------------------------------------------------------------------------
     CONFIG — every tuning lever in the game.

     Each value carries a note saying which direction moves the outcome.
     -------------------------------------------------------------------------- */
  var CONFIG = {

    world: {
      // Ship's resting Y. Lower number = higher up = longer flight for shots.
      shipY: 588,
      // Ship cannot travel past this margin from either wall.
      shipMargin: 18,
      // Lives at the start of a round. More = more forgiving, longer rounds.
      // Tuned: at 3, a competent player loses to enemy fire often enough to
      // cost PRECISION ~4 points of win rate before it can finish clearing.
      lives: 4,
      // Seconds the ship is stunned (and cannot fire) after being hit.
      // Higher = harsher for both characters, and costs the slow-firing
      // character proportionally more shots than the fast-firing one.
      hitStunSec: 0.6,
      // Points per invader destroyed.
      pointsPerKill: 10,
      // Hard ceiling on a round, so a stalemate can never hang the sim.
      // Not a win/loss lever — no round should ever reach it.
      maxRoundSec: 300
    },

    ship: {
      // Half-size of the ship's hitbox in world units. Bigger = easier to hit.
      halfWidth: 13,
      halfHeight: 9
    },

    invaders: {
      rows: 5,            // More rows = more to clear = favours VOLUME losing.
      cols: 7,            // More cols = same.
      cellW: 40,          // Horizontal spacing between invaders.
      cellH: 30,          // Vertical spacing between invaders.
      halfWidth: 13,      // Hitbox half-width. Bigger = easier to hit for BOTH.
      halfHeight: 9,
      originY: 96,        // Starting Y of the top row. Lower = more time for both.
      wallMargin: 14,     // How close the formation gets to a wall before turning.

      // ---- THE CLOCK ------------------------------------------------------
      // The formation marches side to side and drops every time it turns.
      // These values are identical for both characters and are the only thing
      // creating time pressure in the game.
      //
      // Two authentic arcade behaviours make the clock react to the player's
      // own progress rather than run on a rail:
      //   * the formation turns at the edges of the SURVIVING invaders, so
      //     clearing the flanks widens its runway and slows the descent;
      //   * the march speeds up as the grid thins out.
      // Both emerge from how many invaders are left. Neither reads the
      // character, and neither is on a timer.
      stepInterval: 0.15,     // Seconds between march steps with a full grid.
                              //   LOWER = faster march = grid lands sooner.
      stepIntervalMin: 0.028, // Seconds between march steps with one invader left.
                              //   LOWER = frantic endgame, grid lands sooner.
      stepX: 4,               // World units moved per march step.
      descentRate: 6.4,       // World units dropped per turn.
                              //   HIGHER = grid lands sooner = less time for
                              //   everyone = VOLUME loses harder and
                              //   PRECISION's winning margin shrinks.
      descentCreep: 0,        // World units per SECOND of steady downward drift,
                              //   on top of the step drops.
                              //   The step drops alone are not a reliable clock:
                              //   clearing the flanks widens the formation's
                              //   runway, so it turns less often and descends
                              //   more slowly. A player who kills slowly but
                              //   steadily can therefore buy unlimited time.
                              //   This creep is the part of the descent that
                              //   cannot be bought off. HIGHER = a harder
                              //   deadline for both characters.
      bottomLine: 556,        // Y at which invaders count as landed. Player loses.

      // ---- Invader return fire — IDENTICAL for both characters -------------
      fireIntervalRange: [2.0, 4.0], // Seconds between enemy shots. LOWER = harder.
      bulletSpeed: 155,   // World units/sec downward.
      bulletHalfW: 2,
      bulletHalfH: 6
    },

    /* ------------------------------------------------------------------------
       THE TWO CHARACTERS

       Both are fired and steered by exactly the same code (see spawnPlayerShot
       and updatePlayerShots). Every shot in the game resolves to one of three
       behaviours — homing, straight, miss — and the only difference between
       the characters is how often each behaviour comes up and how hard the
       numbers push.
       ---------------------------------------------------------------------- */

    precision: {
      fireIntervalMs: 1720,      // LOWER = clears faster = PRECISION wins more.
                                 //   Also the main dial on round length.
      bulletSpeed: 460,          // Higher = less time for the grid to move on.

      weights: {                 // Relative odds of each shot behaviour.
        homing: 66,              //   Raise = higher hit rate = more wins.
        straight: 26,            //   Straight only hits what is already above,
                                 //   and the ship is usually moving, so these
                                 //   land about half the time.
        miss: 8                  //   Raise = lower hit rate = fewer wins.
      },

      homingDelaySec: 0.18,      // Straight flight before the curve begins.
                                 //   Higher = later, sharper turn; too high misses.
      homingStrength: 5.2,       // How fast the shot settles onto its intercept.
                                 //   Too high looks like a snap, too low misses.
      homingAcquireRange: 150,   // Horizontal reach when picking a target.
                                 //   Wider = more shots find someone = more wins.
                                 //   Measured inert above ~150: at this grid
                                 //   spacing there is always a target closer
                                 //   than that, so raising it changes nothing.
      homingMaxTurn: 300,        // Cap on lateral speed. Keeps the arc graceful.

      missDriftAmount: 90,       // Lateral drift speed on an inexplicable miss.
      missOnsetRange: [0.10, 0.30], // Straight flight before the drift begins.
      missRampRate: 6,           // How fast the drift builds once it starts.
                                 //   Low = a lazy, sad little swerve.
      missVerticalDrag: 0.35,    // How much upward drive a drifting shot gives
                                 //   up. 0 = keeps climbing, 1 = stops climbing
                                 //   and slides sideways out of play.
      missWobble: 2.2,           // Wobble frequency, so misses are not uniform.

      shipLagFactor: 0.06,       // 0 = instant response, 1 = very sluggish.
      shipOvershoot: 0.10        // 0 = stops dead, 1 = slides way past target.
    },

    volume: {
      fireIntervalMs: 130,       // LOWER = more shots. Does not fix the hit rate.
      bulletSpeed: 380,

      // VOLUME has no homing at all. Every shot is either straight or veers
      // away, and the split is set by this one number.
      curveAwayProbability: 0.995,// Share of shots that veer off.
                                 //   HIGHER = VOLUME loses more.
                                 //   Measured: the shots that do NOT veer are
                                 //   worth far more than their share, because a
                                 //   straight shot from under the grid connects
                                 //   about three times in four.
      curveMagnitudeRange: [700, 1400], // Lateral drift speed of a veering shot.
                                 //   Lower values can still accidentally hit.
      curveOnsetRange: [0.09, 0.22],  // Straight flight before the veer begins.
                                 //   Higher = leaves the gun straighter for longer.
      curveVerticalDrag: 0.9,    // How much upward drive a veering shot gives
                                 //   up as it peels away. 0 = keeps climbing
                                 //   into the grid and blunders into things,
                                 //   1 = stops climbing entirely and slides out
                                 //   of play sideways.
                                 //   HIGHER = VOLUME connects with less, and is
                                 //   what lets the shot still leave the gun
                                 //   visibly straight before it goes wrong.
      curveRampRate: 18,         // How fast the veer builds once it starts.
                                 //   HIGHER = the shot is gone sideways before
                                 //   it can blunder into anything, including at
                                 //   point-blank range when the grid is low.
                                 //   This is what stops a firehose working by
                                 //   sheer proximity late in a round.
      curveWobble: 5.5,          // Wobble frequency, so curves look erratic.

      shipLagFactor: 0.78,       // 0 = instant response, 1 = very sluggish.
      shipOvershoot: 0.72        // 0 = stops dead, 1 = slides way past target.
    },

    spamLikely: {                                                  // (phase 5)
      firstSpawnMs: 7000,        // Delay before the first blocker. Lower = harsher.
      respawnIntervalRange: [6500, 11000], // Gap between blockers. Lower = harsher.
      fallSpeed: 260,            // Must exceed invader descent so it arrives first.
      hoverDurationMs: 5000,     // How long it parks and blocks. Higher = harsher.
      exitSpeed: 420,            // How fast it leaves once the hover ends.
      bandY: 430,                // Y it halts at — between player and invaders.
      widthPct: 0.44,            // Share of world width it covers. Higher = harsher.
      height: 34
    },

    limits: {
      // Pool sizes. Generous enough that VOLUME never runs dry, small enough
      // that nothing grows without bound during a long round.
      playerShots: 220,
      enemyShots: 40
    }
  };

  /* --------------------------------------------------------------------------
     SEEDED RNG — mulberry32.

     Every random decision in the game goes through this. There is no
     Math.random() anywhere in game logic, so a given seed always produces the
     same round. That is what makes the Phase 7 tuning numbers meaningful.
     -------------------------------------------------------------------------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(input) {
    if (typeof input === 'number' && isFinite(input)) return input >>> 0;
    var str = String(input == null ? '' : input);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function createRNG(seed) {
    var next = mulberry32(hashSeed(seed));
    return {
      seed: hashSeed(seed),
      next: next,
      range: function (lo, hi) { return lo + next() * (hi - lo); },
      pair: function (p) { return p[0] + next() * (p[1] - p[0]); },
      int: function (n) { return Math.floor(next() * n); },
      chance: function (p) { return next() < p; },
      sign: function () { return next() < 0.5 ? -1 : 1; },
      weighted: function (weights) {
        var total = 0, k;
        for (k in weights) total += weights[k];
        var roll = next() * total;
        for (k in weights) {
          roll -= weights[k];
          if (roll <= 0) return k;
        }
        return k;
      }
    };
  }

  /* --------------------------------------------------------------------------
     HELPERS
     -------------------------------------------------------------------------- */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function overlaps(ax, ay, ahw, ahh, bx, by, bhw, bhh) {
    return Math.abs(ax - bx) <= (ahw + bhw) && Math.abs(ay - by) <= (ahh + bhh);
  }

  /* One spring, two sets of numbers. PRECISION gets a tight, well-damped
     spring; VOLUME gets a loose, underdamped one that slides past the target.
     Same code path, same maths, different CONFIG values. */
  function springFor(cfg) {
    var k = 1500 - (1500 - 180) * clamp01(cfg.shipLagFactor);
    var critical = 2 * Math.sqrt(k);
    var c = critical * (1 - 0.88 * clamp01(cfg.shipOvershoot));
    return { k: k, c: c };
  }

  /* The two characters describe their shots in different CONFIG vocabulary,
     because each set of names says what that character is actually doing.
     This normalises both into ONE shot model with three behaviours, so a
     single code path spawns and steers every shot in the game. It reads the
     shape of the config, never the character's name — swap the two configs
     over and the two characters swap behaviour with them. */
  function shotProfile(cfg) {
    if (cfg.weights) {
      return {
        weights: cfg.weights,
        homingDelay: cfg.homingDelaySec,
        homingStrength: cfg.homingStrength,
        homingAcquireRange: cfg.homingAcquireRange,
        homingMaxTurn: cfg.homingMaxTurn,
        driftRange: [cfg.missDriftAmount * 0.7, cfg.missDriftAmount * 1.3],
        onsetRange: cfg.missOnsetRange,
        ramp: cfg.missRampRate,
        verticalDrag: cfg.missVerticalDrag,
        wobble: cfg.missWobble
      };
    }
    // A config that names a curve-away probability instead of weights is
    // describing the same three behaviours with no homing in the mix.
    return {
      weights: {
        homing: 0,
        straight: 1 - cfg.curveAwayProbability,
        miss: cfg.curveAwayProbability
      },
      homingDelay: 0,
      homingStrength: 0,
      homingAcquireRange: 0,
      homingMaxTurn: 0,
      driftRange: cfg.curveMagnitudeRange,
      onsetRange: cfg.curveOnsetRange,
      ramp: cfg.curveRampRate,
      verticalDrag: cfg.curveVerticalDrag,
      wobble: cfg.curveWobble
    };
  }

  /* --------------------------------------------------------------------------
     GAME
     -------------------------------------------------------------------------- */
  function createGame(options) {
    options = options || {};
    var character = options.character === 'volume' ? 'volume' : 'precision';
    var rng = createRNG(options.seed == null ? 1 : options.seed);

    var CI = CONFIG.invaders;
    var CW = CONFIG.world;
    var charCfg = character === 'volume' ? CONFIG.volume : CONFIG.precision;
    var spring = springFor(charCfg);
    var P = shotProfile(charCfg);

    var formationW = (CI.cols - 1) * CI.cellW;
    var originX = (WORLD.w - formationW) / 2;
    var totalInvaders = CI.rows * CI.cols;

    var state = {
      character: character,
      seed: rng.seed,
      phase: 'playing',       // 'playing' | 'won' | 'lost'
      lossReason: null,       // 'landed' | 'lives' | 'timeout' | null
      elapsed: 0,
      score: 0,
      lives: CW.lives,
      stun: 0,
      flashHit: 0,            // purely cosmetic; render-only

      ship: { x: WORLD.w / 2, y: CW.shipY, vx: 0, targetX: WORLD.w / 2 },

      invaders: [],
      aliveCount: 0,
      formation: { offX: 0, offY: 0, dir: 1, stepTimer: 0, frame: 0 },

      shots: [],
      enemyShots: [],
      blockers: [],

      fireTimer: 0,
      enemyFireTimer: 0,

      stats: {
        shotsFired: 0,
        shotsHit: 0,
        shotsAbsorbed: 0,
        kills: 0,
        hitsTaken: 0,
        byKind: { homing: 0, straight: 0, miss: 0 },
        hitsByKind: { homing: 0, straight: 0, miss: 0 }
      }
    };

    /* ---- Invader grid ---------------------------------------------------- */
    for (var r = 0; r < CI.rows; r++) {
      for (var c = 0; c < CI.cols; c++) {
        state.invaders.push({
          row: r, col: c,
          alive: true,
          type: r === 0 ? 0 : (r < 3 ? 1 : 2),
          x: originX + c * CI.cellW,
          y: CI.originY + r * CI.cellH
        });
      }
    }
    state.aliveCount = state.invaders.length;

    /* ---- Projectile pools ------------------------------------------------ */
    var i;
    for (i = 0; i < CONFIG.limits.playerShots; i++) {
      state.shots.push({
        active: false, x: 0, y: 0, vx: 0, vy: 0,
        kind: 'straight', age: 0, target: null,
        onset: 0, driftVx: 0, wobblePhase: 0
      });
    }
    for (i = 0; i < CONFIG.limits.enemyShots; i++) {
      state.enemyShots.push({ active: false, x: 0, y: 0, vy: 0 });
    }

    function takeFrom(pool) {
      for (var j = 0; j < pool.length; j++) if (!pool[j].active) return pool[j];
      return null; // pool exhausted — the shot simply is not fired
    }

    /* ---- Input ----------------------------------------------------------- */
    function setTargetX(x) {
      state.ship.targetX = clamp(x, CW.shipMargin, WORLD.w - CW.shipMargin);
    }
    function nudgeTarget(dx) { setTargetX(state.ship.targetX + dx); }

    /* ---- Ship ------------------------------------------------------------ */
    function updateShip(dt) {
      var s = state.ship;
      s.vx += (s.targetX - s.x) * spring.k * dt;
      s.vx -= s.vx * spring.c * dt;
      s.x += s.vx * dt;

      var lo = CW.shipMargin, hi = WORLD.w - CW.shipMargin;
      if (s.x < lo) { s.x = lo; if (s.vx < 0) s.vx = 0; }
      if (s.x > hi) { s.x = hi; if (s.vx > 0) s.vx = 0; }
    }

    /* ---- Invader formation ------------------------------------------------
       Arcade behaviour: the formation turns at the edges of the invaders that
       are still alive, and marches faster as the grid thins out. Clear the
       flanks and the formation gets a longer runway and descends less often;
       thin it out and every survivor moves quicker. Both fall out of the
       alive count, for whoever is playing.
       ---------------------------------------------------------------------- */
    function liveColumnRange() {
      var minCol = Infinity, maxCol = -Infinity;
      for (var j = 0; j < state.invaders.length; j++) {
        var inv = state.invaders[j];
        if (!inv.alive) continue;
        if (inv.col < minCol) minCol = inv.col;
        if (inv.col > maxCol) maxCol = inv.col;
      }
      return { minCol: minCol, maxCol: maxCol };
    }

    function repositionInvaders() {
      var f = state.formation;
      for (var j = 0; j < state.invaders.length; j++) {
        var inv = state.invaders[j];
        inv.x = originX + inv.col * CI.cellW + f.offX;
        inv.y = CI.originY + inv.row * CI.cellH + f.offY;
      }
    }

    function updateFormation(dt) {
      if (state.aliveCount === 0) return;
      var f = state.formation;

      // Steady drift, independent of the marching.
      if (CI.descentCreep) {
        f.offY += CI.descentCreep * dt;
        repositionInvaders();
      }

      // March interval scales with how much of the grid is left.
      var aliveFrac = state.aliveCount / totalInvaders;
      var interval = CI.stepIntervalMin + (CI.stepInterval - CI.stepIntervalMin) * aliveFrac;

      f.stepTimer += dt;
      while (f.stepTimer >= interval) {
        f.stepTimer -= interval;
        f.frame ^= 1;

        var range = liveColumnRange();
        var minOffX = CI.wallMargin + CI.halfWidth - originX - range.minCol * CI.cellW;
        var maxOffX = WORLD.w - CI.wallMargin - CI.halfWidth - originX - range.maxCol * CI.cellW;

        // Kills can widen the runway underneath us; keep the formation inside it.
        if (f.offX < minOffX) f.offX = minOffX;
        if (f.offX > maxOffX) f.offX = maxOffX;

        var nextOff = f.offX + f.dir * CI.stepX;
        if (nextOff > maxOffX || nextOff < minOffX) {
          f.dir = -f.dir;
          f.offY += CI.descentRate;
        } else {
          f.offX = nextOff;
        }

        repositionInvaders();
      }
    }

    /* ---- Player fire ------------------------------------------------------
       ONE path for every shot in the game. The behaviour is rolled from the
       character's weights; the steering below then runs the same maths on
       whichever behaviour came up.
       ---------------------------------------------------------------------- */
    function spawnPlayerShot() {
      var shot = takeFrom(state.shots);
      if (!shot) return;

      var kind = rng.weighted(P.weights);

      shot.active = true;
      shot.x = state.ship.x;
      shot.y = state.ship.y - CONFIG.ship.halfHeight - 2;
      shot.vx = 0;                                  // every shot leaves straight
      shot.vy = -charCfg.bulletSpeed;
      shot.kind = kind;
      shot.age = 0;
      shot.target = null;

      if (kind === 'miss') {
        shot.onset = rng.pair(P.onsetRange);
        shot.driftVx = rng.sign() * rng.pair(P.driftRange);
        shot.wobblePhase = rng.range(0, Math.PI * 2);
      } else {
        shot.onset = 0;
        shot.driftVx = 0;
        shot.wobblePhase = 0;
      }

      state.stats.shotsFired++;
      state.stats.byKind[kind]++;
    }

    function updatePlayerFire(dt) {
      if (state.stun > 0) return;          // stunned ships do not fire
      state.fireTimer += dt;
      var interval = charCfg.fireIntervalMs / 1000;
      while (state.fireTimer >= interval) {
        state.fireTimer -= interval;
        spawnPlayerShot();
      }
    }

    /* Pick something this shot is not currently lined up with, within reach.
       Prefers targets close in X and low on the screen. */
    function acquireTarget(shot) {
      var best = null, bestScore = Infinity;
      for (var j = 0; j < state.invaders.length; j++) {
        var inv = state.invaders[j];
        if (!inv.alive) continue;
        if (inv.y > shot.y - 40) continue;               // must be meaningfully above
        var dx = Math.abs(inv.x - shot.x);
        if (dx > P.homingAcquireRange) continue;
        var score = dx + (shot.y - inv.y) * 0.22;
        if (score < bestScore) { bestScore = score; best = inv; }
      }
      return best;
    }

    function steerShot(s, dt) {
      if (s.kind === 'homing') {
        if (s.age < P.homingDelay) return;               // starts straight
        if (!s.target || !s.target.alive) s.target = acquireTarget(s);
        if (!s.target) return;                           // nothing in reach: flies on
        // Lead the target: work out the sideways speed that arrives at the
        // same moment the shot reaches its row, then ease onto it. Easing is
        // what makes this read as an arc rather than a snap.
        var tti = Math.max(0.06, (s.y - s.target.y) / Math.abs(s.vy));
        var need = clamp((s.target.x - s.x) / tti, -P.homingMaxTurn, P.homingMaxTurn);
        s.vx += (need - s.vx) * P.homingStrength * dt;

      } else if (s.kind === 'miss') {
        if (s.age < s.onset) return;                     // leaves the gun straight
        var w = Math.sin(s.wobblePhase + s.age * P.wobble);
        var want = s.driftVx * (0.65 + 0.35 * w);
        s.vx += (want - s.vx) * P.ramp * dt;
        // A shot that has gone sideways stops driving upward as hard: the
        // energy went into the swerve. It slides out of play instead of
        // climbing on into whatever happens to be above it.
        var wantVy = -charCfg.bulletSpeed * (1 - P.verticalDrag);
        s.vy += (wantVy - s.vy) * P.ramp * dt;
      }
      // 'straight' does nothing — it keeps the vx of 0 it was fired with.
    }

    function updatePlayerShots(dt) {
      for (var j = 0; j < state.shots.length; j++) {
        var s = state.shots[j];
        if (!s.active) continue;

        s.age += dt;
        steerShot(s, dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;

        if (s.y < -20 || s.x < -20 || s.x > WORLD.w + 20) { s.active = false; continue; }

        for (var k = 0; k < state.invaders.length; k++) {
          var inv = state.invaders[k];
          if (!inv.alive) continue;
          if (overlaps(s.x, s.y, 2, 5, inv.x, inv.y, CI.halfWidth, CI.halfHeight)) {
            inv.alive = false;
            state.aliveCount--;
            state.score += CW.pointsPerKill;
            state.stats.kills++;
            state.stats.shotsHit++;
            state.stats.hitsByKind[s.kind]++;
            s.active = false;
            break;
          }
        }
      }
    }

    /* ---- Invader fire — identical for both characters --------------------- */
    function bottomMostInColumn(col) {
      var best = null;
      for (var j = 0; j < state.invaders.length; j++) {
        var inv = state.invaders[j];
        if (inv.alive && inv.col === col && (!best || inv.row > best.row)) best = inv;
      }
      return best;
    }

    function updateEnemyFire(dt) {
      if (state.aliveCount === 0) return;
      state.enemyFireTimer -= dt;
      if (state.enemyFireTimer > 0) return;
      state.enemyFireTimer = rng.pair(CI.fireIntervalRange);

      var cols = [];
      for (var c = 0; c < CI.cols; c++) if (bottomMostInColumn(c)) cols.push(c);
      if (!cols.length) return;
      var shooter = bottomMostInColumn(cols[rng.int(cols.length)]);
      if (!shooter) return;

      var b = takeFrom(state.enemyShots);
      if (!b) return;
      b.active = true;
      b.x = shooter.x;
      b.y = shooter.y + CI.halfHeight;
      b.vy = CI.bulletSpeed;
    }

    function updateEnemyShots(dt) {
      for (var j = 0; j < state.enemyShots.length; j++) {
        var b = state.enemyShots[j];
        if (!b.active) continue;
        b.y += b.vy * dt;
        if (b.y > WORLD.h + 20) { b.active = false; continue; }

        if (state.stun <= 0 && overlaps(
              b.x, b.y, CI.bulletHalfW, CI.bulletHalfH,
              state.ship.x, state.ship.y, CONFIG.ship.halfWidth, CONFIG.ship.halfHeight)) {
          b.active = false;
          state.lives--;
          state.stats.hitsTaken++;
          state.stun = CW.hitStunSec;
          state.flashHit = 0.35;
        }
      }
    }

    /* ---- End conditions --------------------------------------------------- */
    function checkEnd() {
      if (state.aliveCount === 0) { state.phase = 'won'; return; }
      if (state.lives <= 0) { state.phase = 'lost'; state.lossReason = 'lives'; return; }
      for (var j = 0; j < state.invaders.length; j++) {
        var inv = state.invaders[j];
        if (inv.alive && inv.y + CI.halfHeight >= CI.bottomLine) {
          state.phase = 'lost'; state.lossReason = 'landed'; return;
        }
      }
      if (state.elapsed >= CW.maxRoundSec) {
        state.phase = 'lost'; state.lossReason = 'timeout';
      }
    }

    /* ---- One fixed timestep ----------------------------------------------- */
    function step(dt) {
      if (state.phase !== 'playing') return state.phase;
      state.elapsed += dt;
      if (state.stun > 0) state.stun -= dt;
      if (state.flashHit > 0) state.flashHit -= dt;

      updateShip(dt);
      updateFormation(dt);
      updatePlayerFire(dt);
      updatePlayerShots(dt);
      updateEnemyFire(dt);
      updateEnemyShots(dt);
      checkEnd();

      return state.phase;
    }

    return {
      state: state,
      rng: rng,
      config: CONFIG,
      charCfg: charCfg,
      step: step,
      setTargetX: setTargetX,
      nudgeTarget: nudgeTarget
    };
  }

  return {
    CONFIG: CONFIG,
    WORLD: WORLD,
    STEP_HZ: STEP_HZ,
    STEP: STEP,
    createRNG: createRNG,
    createGame: createGame,
    clamp: clamp,
    clamp01: clamp01
  };
});

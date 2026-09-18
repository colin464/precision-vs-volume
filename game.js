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
     Values marked (phase N) are scaffolded now and come into use in that phase.
     -------------------------------------------------------------------------- */
  var CONFIG = {

    world: {
      // Ship's resting Y. Lower number = higher up = longer flight for shots.
      shipY: 588,
      // Ship cannot travel past this margin from either wall.
      shipMargin: 18,
      // Lives at the start of a round. More = more forgiving, longer rounds.
      lives: 3,
      // Seconds the ship is stunned (and cannot fire) after being hit.
      // Higher = harsher for both characters.
      hitStunSec: 1.0,
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

      // ---- THE MASTER CLOCK ----------------------------------------------
      // The formation marches side to side and drops every time it turns.
      // These three values together decide how long the player has, and they
      // are identical for both characters. This is the only thing creating
      // time pressure in the game.
      stepInterval: 0.14, // Seconds between march steps. LOWER = faster march
                          //   = more turns = grid lands sooner.
      stepX: 4,           // World units moved per march step. HIGHER = same effect.
      descentRate: 8,     // World units dropped per turn.
                          //   HIGHER = grid lands sooner = less time for
                          //   everyone = VOLUME loses harder and PRECISION's
                          //   winning margin shrinks.
      bottomLine: 556,    // Y at which invaders count as landed. Player loses.

      // ---- Invader return fire — IDENTICAL for both characters -------------
      fireIntervalRange: [1.5, 3.2], // Seconds between enemy shots. LOWER = harder.
      bulletSpeed: 155,   // World units/sec downward.
      bulletHalfW: 2,
      bulletHalfH: 6
    },

    precision: {
      fireIntervalMs: 1500,      // LOWER = clears faster = PRECISION wins more.
      bulletSpeed: 460,          // Higher = less time for the grid to move on.
      weights: {                 // Relative odds of each shot behaviour. (phase 3)
        homing: 62,              //   Raise = higher hit rate = more wins.
        straight: 30,            //   Straight only hits what is already above.
        miss: 8                  //   Raise = lower hit rate = fewer wins.
      },
      homingStrength: 5.2,       // How hard a homing shot curves. Too high
                                 //   looks like a snap; too low and it misses.
      homingAcquireRange: 150,   // Horizontal reach when picking a target.
                                 //   Wider = more shots find someone = more wins.
      homingMaxTurn: 300,        // Cap on lateral speed. Keeps the arc graceful.
      missDriftAmount: 90,       // Lateral drift on a deliberate miss.
      shipLagFactor: 0.06,       // 0 = instant response, 1 = very sluggish.
      shipOvershoot: 0.10        // 0 = stops dead, 1 = slides way past target.
    },

    volume: {
      fireIntervalMs: 120,       // LOWER = more shots. Does not fix the hit rate.
      bulletSpeed: 400,
      curveAwayProbability: 0.86,// Share of shots that veer off. HIGHER = VOLUME
                                 //   loses more. The main accuracy lever. (phase 4)
      curveMagnitudeRange: [55, 190], // Lateral drift speed of a veering shot.
      curveOnsetRange: [0.05, 0.28],  // Seconds of straight flight before veering.
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
  function springFor(handling) {
    var k = 1500 - (1500 - 180) * clamp01(handling.shipLagFactor);
    var critical = 2 * Math.sqrt(k);
    var c = critical * (1 - 0.88 * clamp01(handling.shipOvershoot));
    return { k: k, c: c };
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

    // The formation's own geometry. Its left/right travel limits are fixed by
    // the full grid, not by which invaders are still alive, so the grid lands
    // at the same moment in every round of every character. This is what makes
    // "time remaining" an identical, shared clock.
    var formationW = (CI.cols - 1) * CI.cellW;
    var originX = (WORLD.w - formationW) / 2;
    var minOffX = CI.wallMargin + CI.halfWidth - originX;
    var maxOffX = WORLD.w - CI.wallMargin - CI.halfWidth - (originX + formationW);

    var state = {
      character: character,
      seed: rng.seed,
      phase: 'playing',       // 'playing' | 'won' | 'lost'
      lossReason: null,       // 'landed' | 'lives' | null
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
        hitsTaken: 0
      }
    };

    /* ---- Invader grid ---------------------------------------------------- */
    for (var r = 0; r < CI.rows; r++) {
      for (var c = 0; c < CI.cols; c++) {
        state.invaders.push({
          row: r, col: c,
          alive: true,
          // Row decides which of the three sprite families it draws as.
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
        curveDelay: 0, curveVx: 0, wobblePhase: 0
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

    /* ---- Invader formation ----------------------------------------------- */
    function updateFormation(dt) {
      var f = state.formation;
      f.stepTimer += dt;
      while (f.stepTimer >= CI.stepInterval) {
        f.stepTimer -= CI.stepInterval;
        f.frame ^= 1;

        var nextOff = f.offX + f.dir * CI.stepX;
        if (nextOff > maxOffX || nextOff < minOffX) {
          // Hit a wall: turn around and drop. This is the only thing that
          // brings the grid down, and it is identical for both characters.
          f.dir = -f.dir;
          f.offY += CI.descentRate;
        } else {
          f.offX = nextOff;
        }

        // Republish positions onto the invaders themselves.
        for (var j = 0; j < state.invaders.length; j++) {
          var inv = state.invaders[j];
          inv.x = originX + inv.col * CI.cellW + f.offX;
          inv.y = CI.originY + inv.row * CI.cellH + f.offY;
        }
      }
    }

    /* ---- Player fire ----------------------------------------------------- */
    // Phase 2 fires straight shots only. Phases 3 and 4 add the per-character
    // behaviours on top of this same spawn path.
    function spawnPlayerShot() {
      var shot = takeFrom(state.shots);
      if (!shot) return;
      shot.active = true;
      shot.x = state.ship.x;
      shot.y = state.ship.y - CONFIG.ship.halfHeight - 2;
      shot.vx = 0;
      shot.vy = -charCfg.bulletSpeed;
      shot.kind = 'straight';
      shot.age = 0;
      shot.target = null;
      shot.curveDelay = 0;
      shot.curveVx = 0;
      shot.wobblePhase = 0;
      state.stats.shotsFired++;
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

    function updatePlayerShots(dt) {
      for (var j = 0; j < state.shots.length; j++) {
        var s = state.shots[j];
        if (!s.active) continue;
        s.age += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.y < -20 || s.x < -20 || s.x > WORLD.w + 20) { s.active = false; continue; }

        // Collision with invaders.
        for (var k = 0; k < state.invaders.length; k++) {
          var inv = state.invaders[k];
          if (!inv.alive) continue;
          if (overlaps(s.x, s.y, 2, 5, inv.x, inv.y, CI.halfWidth, CI.halfHeight)) {
            inv.alive = false;
            state.aliveCount--;
            state.score += CW.pointsPerKill;
            state.stats.kills++;
            state.stats.shotsHit++;
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

      // Pick a random column that still has someone in it.
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

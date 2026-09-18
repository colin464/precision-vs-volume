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
      // Seconds the ship is stunned after being hit. Higher = harsher.
      hitStunSec: 0.9,
      // Points per invader destroyed.
      pointsPerKill: 10
    },

    ship: {
      // Half-width of the ship's hitbox in world units. Bigger = easier to hit.
      halfWidth: 13,
      halfHeight: 8
    },

    invaders: {                                                    // (phase 2)
      rows: 5,            // More rows = more to clear = favours VOLUME losing.
      cols: 7,            // More cols = same.
      cellW: 40,          // Horizontal spacing between invaders.
      cellH: 30,          // Vertical spacing between invaders.
      halfWidth: 13,      // Hitbox half-width. Bigger = easier to hit for BOTH.
      halfHeight: 9,
      originY: 90,        // Starting Y of the top row. Lower = more time.
      stepInterval: 0.62, // Seconds between marching steps. Lower = faster grid.
      stepX: 6,           // Horizontal world units per march step.
      descentRate: 4.6,   // World units dropped each time the grid hits a wall.
                          //   HIGHER = grid lands sooner = both characters
                          //   have less time = VOLUME loses harder, and
                          //   PRECISION's margin shrinks. The master clock.
      bottomLine: 560,    // Y at which invaders count as landed. Player loses.
      wallMargin: 16,     // How close the grid gets to the walls before turning.
      // Invader return fire — IDENTICAL for both characters.
      fireIntervalRange: [1.5, 3.2], // Seconds between enemy shots. Lower = harder.
      bulletSpeed: 150,   // World units/sec downward.
      bulletHalfW: 2,
      bulletHalfH: 6
    },

    precision: {                                                   // (phase 3)
      fireIntervalMs: 1500,      // LOWER = clears faster = PRECISION wins more.
      bulletSpeed: 460,          // Higher = less time for the grid to move on.
      weights: {                 // Relative odds of each shot behaviour.
        homing: 62,              //   Raise = higher hit rate = more wins.
        straight: 30,            //   Straight only hits what is already above.
        miss: 8                  //   Raise = lower hit rate = fewer wins.
      },
      homingStrength: 5.2,       // How hard a homing shot curves. Too high
                                 //   looks like a snap; too low and it misses.
      homingAcquireRange: 150,   // Horizontal reach when picking a target.
                                 //   Wider = more shots find someone = more wins.
      homingMaxTurn: 300,        // Cap on lateral speed change. Keeps the arc graceful.
      missDriftAmount: 90        // Lateral drift on a deliberate miss.
    },

    volume: {                                                      // (phase 4)
      fireIntervalMs: 120,       // LOWER = more shots. Does not fix the hit rate.
      bulletSpeed: 400,
      curveAwayProbability: 0.86,// Share of shots that veer off. HIGHER = VOLUME
                                 //   loses more. The main accuracy lever.
      curveMagnitudeRange: [55, 190], // Lateral drift speed of a veering shot.
                                 //   Lower values can still accidentally hit.
      curveOnsetRange: [0.05, 0.28],  // Seconds of straight flight before veering.
      curveWobble: 5.5,          // Wobble frequency, so curves look erratic not uniform.
      shipLagFactor: 0.78,       // 0 = instant response, 1 = very sluggish.
      shipOvershoot: 0.72        // 0 = stops dead, 1 = slides way past the target.
    },

    precisionShip: {
      shipLagFactor: 0.06,       // Same two levers, tight values. Crisp handling.
      shipOvershoot: 0.10
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
      // Uniform float in [lo, hi).
      range: function (lo, hi) { return lo + next() * (hi - lo); },
      // Uniform float from a [lo, hi] pair.
      pair: function (p) { return p[0] + next() * (p[1] - p[0]); },
      // Uniform integer in [0, n).
      int: function (n) { return Math.floor(next() * n); },
      // True with probability p.
      chance: function (p) { return next() < p; },
      // Pick a key from { key: weight, ... }.
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
     SHIP HANDLING

     One spring, two sets of numbers. PRECISION gets a tight, well-damped
     spring; VOLUME gets a loose, underdamped one that slides past the target.
     Same code path, same maths, different CONFIG values.
     -------------------------------------------------------------------------- */
  function springFor(handling) {
    // lagFactor 0 -> very stiff (1500), 1 -> very loose (180)
    var k = 1500 - (1500 - 180) * clamp01(handling.shipLagFactor);
    // Critical damping is 2*sqrt(k). Overshoot dials the damping below that.
    var critical = 2 * Math.sqrt(k);
    var c = critical * (1 - 0.88 * clamp01(handling.shipOvershoot));
    return { k: k, c: c };
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* --------------------------------------------------------------------------
     GAME
     -------------------------------------------------------------------------- */
  function createGame(options) {
    options = options || {};
    var character = options.character === 'volume' ? 'volume' : 'precision';
    var rng = createRNG(options.seed == null ? 1 : options.seed);

    var handling = character === 'volume' ? CONFIG.volume : CONFIG.precisionShip;
    var spring = springFor(handling);

    var state = {
      character: character,
      seed: rng.seed,
      phase: 'playing',       // 'playing' | 'won' | 'lost'
      elapsed: 0,             // Seconds of simulated time.
      score: 0,
      lives: CONFIG.world.lives,
      stun: 0,

      ship: {
        x: WORLD.w / 2,
        y: CONFIG.world.shipY,
        vx: 0,
        targetX: WORLD.w / 2
      },

      // Filled in from Phase 2 onward.
      invaders: [],
      shots: [],
      enemyShots: [],
      blockers: [],

      // Running counters the sim harness reports on.
      stats: {
        shotsFired: 0,
        shotsHit: 0,
        shotsAbsorbed: 0,
        kills: 0
      }
    };

    /* Pointer / keyboard input feeds this. Nothing else moves the ship. */
    function setTargetX(x) {
      state.ship.targetX = clamp(
        x,
        CONFIG.world.shipMargin,
        WORLD.w - CONFIG.world.shipMargin
      );
    }

    function nudgeTarget(dx) {
      setTargetX(state.ship.targetX + dx);
    }

    function updateShip(dt) {
      var s = state.ship;
      // Spring toward the target, then integrate. Overshoot is an emergent
      // property of low damping, not a special case.
      s.vx += (s.targetX - s.x) * spring.k * dt;
      s.vx -= s.vx * spring.c * dt;
      s.x += s.vx * dt;

      var lo = CONFIG.world.shipMargin;
      var hi = WORLD.w - CONFIG.world.shipMargin;
      if (s.x < lo) { s.x = lo; if (s.vx < 0) s.vx = 0; }
      if (s.x > hi) { s.x = hi; if (s.vx > 0) s.vx = 0; }
    }

    /* One fixed timestep. Called at exactly STEP_HZ per second of game time,
       by the browser loop and by the headless sim alike. */
    function step(dt) {
      if (state.phase !== 'playing') return state.phase;
      state.elapsed += dt;
      if (state.stun > 0) state.stun -= dt;
      updateShip(dt);
      return state.phase;
    }

    return {
      state: state,
      rng: rng,
      config: CONFIG,
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

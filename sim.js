/* ============================================================================
   Headless tuning harness.

   Runs the real game — the same game.js the browser loads — with rendering
   disabled, at the same fixed timestep, driven by an autopilot standing in for
   a competent player. Every number the game is tuned against comes from here.

   Usage:
     node sim.js                 100 seeds per character
     node sim.js 250             250 seeds per character
     node sim.js 100 volume      one character only
     node sim.js 100 both -v     per-seed detail

   Also loadable in the browser for a quick in-page check.
   ========================================================================== */

(function (root, factory) {
  var api = factory(typeof require === 'function' ? require('./game.js') : root.PVV);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PVVSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PVV) {
  'use strict';

  /* --------------------------------------------------------------------------
     AUTOPILOT — a competent player, not a superhuman one.

     It does two things a real player does: it parks under the invader it is
     most likely to hit, and it slides out of the way of incoming fire. It has
     no knowledge of shot behaviour, no perfect aim, and no reaction time
     advantage — it just reads the same screen the player sees.

     It is deliberately identical for both characters. Whatever difference the
     results show comes from the characters, not from how they are played.
     -------------------------------------------------------------------------- */
  var AUTOPILOT = {
    // Decisions per second. A person does not re-plan 120 times a second.
    decisionHz: 30,
    // How many positions across the play area it weighs up each decision.
    candidates: 25,
    // How strongly it prefers invaders low on the screen when choosing a target.
    lowRowBias: 0.15,
    // How far ahead, in seconds of bullet flight, danger registers at all.
    dangerHorizonSec: 1.6,
    // Horizontal distance at which a bullet stops feeling dangerous.
    dangerRadius: 40,
    // How much it values not being shot versus being lined up on a target.
    dangerWeight: 9,
    // How much it dislikes standing where its own shots are being eaten. A
    // player watching a SPAM LIKELY bar swallow everything slides out from
    // under it; this is that instinct, not foresight.
    blockedWeight: 26,
    // How far past the edge of a blocker it wants to be before it settles.
    blockedMargin: 12
  };

  /* Picks where to stand: close to something worth shooting, away from
     anything about to arrive. It only knows what is already on screen — no
     look-ahead into the RNG, no knowledge of shot behaviour, no perfect aim. */
  function driveAutopilot(game, stepIndex) {
    var s = game.state;
    var ship = s.ship;

    var every = Math.max(1, Math.round(PVV.STEP_HZ / AUTOPILOT.decisionHz));
    if (stepIndex % every !== 0) return;

    // 1. What are we shooting at? Nearest live invader, favouring low ones.
    var target = null, bestScore = Infinity;
    for (var i = 0; i < s.invaders.length; i++) {
      var inv = s.invaders[i];
      if (!inv.alive) continue;
      var score = Math.abs(inv.x - ship.x) + (ship.y - inv.y) * AUTOPILOT.lowRowBias;
      if (score < bestScore) { bestScore = score; target = inv; }
    }
    var aimX = target ? target.x : ship.x;

    // 2. Gather what is actually falling towards us.
    var threats = [];
    for (var j = 0; j < s.enemyShots.length; j++) {
      var b = s.enemyShots[j];
      if (!b.active || b.y > ship.y) continue;
      var tti = (ship.y - b.y) / b.vy;
      if (tti > AUTOPILOT.dangerHorizonSec) continue;
      threats.push({ x: b.x, tti: tti });
    }

    // 3. Note anything currently eating our shots.
    var walls = [];
    for (var w = 0; w < s.blockers.length; w++) {
      var bl = s.blockers[w];
      if (bl.active && bl.y > 0) walls.push(bl);
    }

    // 4. Weigh up standing positions and take the best compromise.
    var margin = PVV.CONFIG.world.shipMargin;
    var lo = margin, hi = PVV.WORLD.w - margin;
    var bestX = ship.x, bestCost = Infinity;

    for (var c = 0; c < AUTOPILOT.candidates; c++) {
      var x = lo + (hi - lo) * (c / (AUTOPILOT.candidates - 1));
      var cost = Math.abs(x - aimX);
      for (var t = 0; t < threats.length; t++) {
        var near = AUTOPILOT.dangerRadius - Math.abs(threats[t].x - x);
        if (near <= 0) continue;
        var urgency = (AUTOPILOT.dangerHorizonSec - threats[t].tti) /
                      AUTOPILOT.dangerHorizonSec;
        cost += near * urgency * AUTOPILOT.dangerWeight;
      }
      for (var u = 0; u < walls.length; u++) {
        var inside = walls[u].halfWidth + AUTOPILOT.blockedMargin -
                     Math.abs(walls[u].x - x);
        if (inside > 0) cost += inside * AUTOPILOT.blockedWeight;
      }
      if (cost < bestCost) { bestCost = cost; bestX = x; }
    }

    game.setTargetX(bestX);
  }

  /* --------------------------------------------------------------------------
     ONE ROUND
     -------------------------------------------------------------------------- */
  function runRound(character, seed) {
    var game = PVV.createGame({ character: character, seed: String(seed) });
    var steps = 0;
    var maxSteps = Math.ceil(PVV.CONFIG.world.maxRoundSec * PVV.STEP_HZ) + 10;

    while (game.state.phase === 'playing' && steps < maxSteps) {
      driveAutopilot(game, steps);
      game.step(PVV.STEP);
      steps++;
    }

    var st = game.state.stats;
    return {
      seed: seed,
      won: game.state.phase === 'won',
      reason: game.state.phase === 'won' ? 'cleared' : game.state.lossReason,
      seconds: game.state.elapsed,
      score: game.state.score,
      invadersLeft: game.state.aliveCount,
      shotsFired: st.shotsFired,
      shotsHit: st.shotsHit,
      shotsAbsorbed: st.shotsAbsorbed,
      hitsTaken: st.hitsTaken,
      byKind: st.byKind,
      hitsByKind: st.hitsByKind
    };
  }

  /* --------------------------------------------------------------------------
     A BATCH OF SEEDS
     -------------------------------------------------------------------------- */
  function median(values) {
    if (!values.length) return 0;
    var v = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }
  function sum(values) {
    var t = 0;
    for (var i = 0; i < values.length; i++) t += values[i];
    return t;
  }

  function runBatch(character, count, startSeed) {
    startSeed = startSeed || 1;
    var rounds = [];
    for (var i = 0; i < count; i++) rounds.push(runRound(character, startSeed + i));

    var wins = rounds.filter(function (r) { return r.won; });
    var fired = sum(rounds.map(function (r) { return r.shotsFired; }));
    var hit = sum(rounds.map(function (r) { return r.shotsHit; }));
    var absorbed = sum(rounds.map(function (r) { return r.shotsAbsorbed; }));

    var reasons = {};
    rounds.forEach(function (r) { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });

    var kinds = { homing: 0, straight: 0, miss: 0 };
    var kindHits = { homing: 0, straight: 0, miss: 0 };
    rounds.forEach(function (r) {
      for (var k in kinds) { kinds[k] += r.byKind[k]; kindHits[k] += r.hitsByKind[k]; }
    });

    return {
      character: character,
      rounds: rounds,
      count: count,
      winRate: wins.length / count,
      medianSeconds: median(rounds.map(function (r) { return r.seconds; })),
      medianWinSeconds: median(wins.map(function (r) { return r.seconds; })),
      medianShots: median(rounds.map(function (r) { return r.shotsFired; })),
      hitRate: fired ? hit / fired : 0,
      absorbedRate: fired ? absorbed / fired : 0,
      medianInvadersLeft: median(rounds.map(function (r) { return r.invadersLeft; })),
      medianHitsTaken: median(rounds.map(function (r) { return r.hitsTaken; })),
      reasons: reasons,
      kinds: kinds,
      kindHits: kindHits
    };
  }

  /* --------------------------------------------------------------------------
     REPORT
     -------------------------------------------------------------------------- */
  function pct(v) { return (v * 100).toFixed(1) + '%'; }

  function formatBatch(b) {
    var lines = [];
    lines.push(b.character.toUpperCase() + '   (' + b.count + ' seeded runs)');
    lines.push('  win rate .............. ' + pct(b.winRate) +
               '   (' + Math.round(b.winRate * b.count) + '/' + b.count + ')');
    lines.push('  median round .......... ' + b.medianSeconds.toFixed(1) + 's');
    if (b.medianWinSeconds) {
      lines.push('  median winning round .. ' + b.medianWinSeconds.toFixed(1) + 's');
    }
    lines.push('  median shots fired .... ' + b.medianShots);
    lines.push('  hit rate per shot ..... ' + pct(b.hitRate));
    lines.push('  absorbed by SPAM ...... ' + pct(b.absorbedRate));
    lines.push('  median invaders left .. ' + b.medianInvadersLeft);
    lines.push('  median hits taken ..... ' + b.medianHitsTaken);
    lines.push('  outcomes .............. ' + JSON.stringify(b.reasons));
    var kindBits = [];
    for (var k in b.kinds) {
      if (!b.kinds[k]) continue;
      kindBits.push(k + ' ' + b.kindHits[k] + '/' + b.kinds[k] +
                    ' (' + pct(b.kindHits[k] / b.kinds[k]) + ')');
    }
    lines.push('  hits by shot type ..... ' + kindBits.join('   '));
    return lines.join('\n');
  }

  /* --------------------------------------------------------------------------
     CLI
     -------------------------------------------------------------------------- */
  function main(argv) {
    var count = parseInt(argv[0], 10) || 100;
    var which = argv[1] || 'both';
    var verbose = argv.indexOf('-v') >= 0;
    var chars = which === 'both' ? ['precision', 'volume'] : [which];

    console.log('');
    console.log('PRECISION vs. VOLUME — simulation over ' + count + ' seeds per character');
    console.log('fixed timestep ' + PVV.STEP_HZ + 'Hz, autopilot player, rendering off');
    console.log('='.repeat(64));

    chars.forEach(function (ch) {
      var b = runBatch(ch, count);
      console.log('');
      console.log(formatBatch(b));
      if (verbose) {
        console.log('');
        b.rounds.forEach(function (r) {
          console.log('    seed ' + String(r.seed).padStart(4) + '  ' +
                      (r.won ? 'WON ' : 'lost') + '  ' +
                      r.seconds.toFixed(1).padStart(6) + 's  ' +
                      'left ' + String(r.invadersLeft).padStart(2) + '  ' +
                      'shots ' + String(r.shotsFired).padStart(4) + '  ' +
                      r.reason);
        });
      }
    });
    console.log('');
  }

  if (typeof require === 'function' && typeof module === 'object' &&
      require.main === module) {
    main(process.argv.slice(2));
  }

  return {
    runRound: runRound,
    runBatch: runBatch,
    formatBatch: formatBatch,
    driveAutopilot: driveAutopilot,
    AUTOPILOT: AUTOPILOT
  };
});

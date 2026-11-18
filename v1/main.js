/* scales-landing — a creature mid-molt: one touch and it sheds its glass skin.
 *
 * One wave field drives all idle motion (lift, tilt, light). One key light:
 * a scale lights only where its flank mirrors it, and everything - film hue,
 * white glint, dispersion, bloom - derives from that single alignment.
 * Zero dependencies; canvas 2D with pre-rendered sprites.
 */
(function () {
  // ---- knobs ----------------------------------------------------------------
  var TRAVEL_V = 25, SURGE = 0.25;            // idle travel px/s, speed swell
  var RECOIL_T = 1.0;                         // recoil: one pull-back, then the burst
  var RECOIL_V0 = 180, RECOIL_DECEL = 5;      // initial pull px/s, rapid decel rate /s
  var SHOCK_K = 0.0004, DELAY_JIT = 0.6;      // shockwave s/px + per-shard jitter
  var BURST_V = 380, BURST_FLOOR = 120, BURST_FALLOFF = 900;
  var SPEED_JIT_LO = 0.55, SPEED_JIT_HI = 1.65, ANGLE_JIT = 0.45;
  var DRAG_LO = 2.0, DRAG_HI = 3.8, GRAV = 160, FLUT_LO = 8, FLUT_HI = 26;
  var COL_STEP = 22, VPITCH = 46;             // imbrication: exposed sliver, row pitch
  var PATH_AMP = 32, PATH_LEN = 1150, PATH_HARM = 0.3;  // undulation S-path
  var SWELL_AMP = 11, SWELL_LEN = 760, SWELL_T = 7.5;   // traveling vertical swell
  var AMP_BREATH = 0.16, AMP_T = 12;          // slow breathing of the S amplitude
  // one diffuse strip-light, fixed in space: a slanted band cutting the full
  // height of the frame. Within the band, a flank shimmers by how well it
  // mirrors the source; the wide angular acceptance is what reads as diffuse.
  var LIGHT_SLOPE = -0.14, LIGHT_WIDTH = 0.28; // very wide acceptance: flanks are texture,
                                              // the slanted band is the shape you see
  var BAND_X = 0.5, BAND_SLANT = -0.9, BAND_W = 0.17; // band centre, "/" lean px/px, softness xW
  var BAND_ROAM = 0.32, ROAM_T1 = 47, ROAM_T2 = 31;   // light wanders the width slowly
  var AMB_SHEEN = 0.22;                       // ambient film: unlit glass still shimmers
  var SHEEN_LO = 0.04, SHEEN_HI = 0.75;       // wide soft ramp from ambient up to lit
  var IRI_A = 0.7;
  var N_IRI = 16;                             // sheen hue flipbook around the wheel
  var IRI_CORE = 85, IRI_SWEEP = 205;         // gold core -> green -> cyan -> blue -> violet rim
  var IRI_JIT = 18;                           // per-scale film-thickness variance
  var EDGE_A = 0.5;
  var EDGE_LO = 0.45, EDGE_HI = 0.85;         // white glint ring inside the film
  var CAUS_A = 0.4;
  var CAUS_LO = 0.68, CAUS_HI = 0.95;         // dispersion: a thin ring hugging the core
  var BLOOM_LO = 0.96, BLOOM_HI = 1.08;       // faint core mist; the full flare is burst-only
  var TEAR_FLARE = 0.45;   // full-bleed sheds flash the whole field at once; CRAFT
                           // caps white flash peaks near 0.5 (was 0.85 on the card stage)
  var SHARD_SHEEN = 0.45, SHARD_GLINT = 0.85; // falling shards: persistent film, glint peak
  var SCALE_W = 56, H_PX = 48, SPR = 72, HALO = 210;
  var COLS_TARGET = 20, K_MIN = 0.85, K_MAX = 2.6;  // full-bleed: ~constant column count
  var AUTO_SHED_T = 0;                        // idle seconds before the page sheds itself; 0 = wait for a touch
  var HUES = [190, 182, 174, 166, 158];       // face tint: dark teal-green glass
  var N_CAUS = 9;                             // caustic flipbook positions
  // ---------------------------------------------------------------------------

  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var K = 1;   // viewport scale factor, set in build()
  var stage = document.getElementById('sp-stage');
  var main = document.getElementById('sp-main');
  var ctx = main.getContext('2d');

  var okl = (function () {
    var c = document.createElement('canvas').getContext('2d');
    c.fillStyle = '#123456'; c.fillStyle = 'oklch(0.5 0.1 200)';
    return c.fillStyle !== '#123456';
  })();
  function col(l, ch, h, a) {
    if (a === undefined) a = 1;
    if (okl) return 'oklch(' + l + ' ' + ch + ' ' + h + ' / ' + a + ')';
    return 'hsl(' + (h - 20) + ' 40% ' + Math.round(l * 100) + '% / ' + a + ')';
  }
  var shape = new Path2D('M 28 48 A 56 56 0 0 1 0 0 A 56 56 0 0 1 56 0 A 56 56 0 0 1 28 48 Z');

  var noiseTile = (function () {
    var t = document.createElement('canvas'); t.width = t.height = 96;
    var g = t.getContext('2d');
    var img = g.createImageData(96, 96);
    for (var i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = Math.floor(Math.random() * 255);
    }
    g.putImageData(img, 0, 0);
    return t;
  })();
  function grainErode(g, w, h, amount) {   // photographic grain inside glows only
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = amount;
    g.fillStyle = g.createPattern(noiseTile, 'repeat');
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  function spriteCtx(size) {
    var c = document.createElement('canvas');
    c.width = size * K * dpr; c.height = size * K * dpr;
    var g = c.getContext('2d');
    g.scale(dpr * K, dpr * K);
    // scales point left: free tips trail the direction of travel, like real scales
    g.translate(size / 2, size / 2); g.rotate(Math.PI / 2); g.translate(-SCALE_W / 2, -H_PX / 2);
    return [c, g];
  }
  function makeFace(hue) {
    var p = spriteCtx(SPR), c = p[0], g = p[1];
    var f = g.createLinearGradient(0, 0, SCALE_W * 0.5, H_PX);
    f.addColorStop(0, col(0.315, 0.052, hue + 12));
    f.addColorStop(0.5, col(0.27, 0.048, hue));
    f.addColorStop(1, col(0.325, 0.062, hue - 14));
    g.fillStyle = f; g.fill(shape);
    var v = g.createRadialGradient(SCALE_W / 2, H_PX * 0.44, 3, SCALE_W / 2, H_PX * 0.44, SCALE_W * 0.54);
    v.addColorStop(0, 'rgba(0,1,3,0.22)'); v.addColorStop(1, 'rgba(0,1,3,0)');
    g.fillStyle = v; g.fill(shape);      // fresnel: face dips darker, rims keep tint
    var s = g.createLinearGradient(0, 0, 0, H_PX * 0.5);
    s.addColorStop(0, 'rgba(1,3,6,0.46)'); s.addColorStop(1, 'rgba(1,3,6,0)');
    g.fillStyle = s; g.fill(shape);      // occlusion from the overlapping row
    g.lineWidth = 1; g.strokeStyle = col(0.8, 0.02, hue, 0.16); g.stroke(shape);
    return c;
  }
  // specular streak on part of the rim; 3 positions, crossfaded so it travels
  function makeEdge(pos) {
    var p = spriteCtx(SPR), c = p[0], g = p[1];
    var e = g.createLinearGradient(0, 0, SCALE_W, H_PX * 0.9);
    var lo = Math.max(0, pos - 0.2), hi = Math.min(1, pos + 0.2);
    e.addColorStop(lo, 'rgba(255,253,248,0)');
    e.addColorStop(pos, 'rgba(255,253,248,0.95)');
    e.addColorStop(hi, 'rgba(255,253,248,0)');
    g.save(); g.translate(-1.2, 0);
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,84,64,0.5)'; g.stroke(shape); g.restore();
    g.save(); g.translate(1.2, 0);
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(96,150,255,0.55)'; g.stroke(shape); g.restore();
    g.shadowColor = 'rgba(220,235,255,0.9)'; g.shadowBlur = 6;
    g.lineWidth = 1.5; g.strokeStyle = e; g.stroke(shape);
    return c;
  }
  // thin-film sheen: soft film over the exposed half + gloss crescent hugging
  // the free tip; one sprite per hue, crossfaded as the film hue slides
  function makeSheen(hue) {
    var p = spriteCtx(SPR), c = p[0], g = p[1];
    g.save(); g.clip(shape);
    var f = g.createLinearGradient(0, H_PX * 0.15, 0, H_PX);
    f.addColorStop(0, col(0.6, 0.13, hue, 0));
    f.addColorStop(1, col(0.62, 0.14, hue, 0.22));
    g.fillStyle = f; g.fillRect(0, 0, SCALE_W, H_PX);
    var r = g.createRadialGradient(SCALE_W / 2, H_PX + 4, 2, SCALE_W / 2, H_PX + 4, 30);
    r.addColorStop(0.3, col(0.74, 0.2, hue, 0));
    r.addColorStop(0.52, col(0.74, 0.2, hue, 0.85));
    r.addColorStop(0.68, col(0.9, 0.08, hue, 0.4));
    r.addColorStop(0.85, col(0.9, 0.08, hue, 0));
    g.fillStyle = r; g.fillRect(0, 0, SCALE_W, H_PX);
    g.restore();
    g.save();
    g.beginPath(); g.rect(-4, H_PX * 0.45, SCALE_W + 8, H_PX); g.clip();
    g.shadowColor = col(0.8, 0.15, hue, 0.9); g.shadowBlur = 5;
    g.lineWidth = 1.4; g.strokeStyle = col(0.87, 0.13, hue, 0.85); g.stroke(shape);
    g.restore();
    return c;
  }
  // caustic-only flipbook: the internal rainbow smear at N positions across the face
  function makeCaustic(pos01, angleVar) {
    var p = spriteCtx(SPR), c = p[0], g = p[1];
    g.save(); g.clip(shape);
    g.translate(SCALE_W * (0.18 + 0.64 * pos01), H_PX * 0.6);
    g.rotate(angleVar ? -0.38 : 0.31);
    var spec = g.createLinearGradient(-30, 0, 30, 0);
    spec.addColorStop(0, 'rgba(255,90,90,0)');
    spec.addColorStop(0.18, 'rgba(255,90,90,0.6)');
    spec.addColorStop(0.38, 'rgba(255,200,80,0.6)');
    spec.addColorStop(0.56, 'rgba(120,255,150,0.55)');
    spec.addColorStop(0.74, 'rgba(90,220,255,0.6)');
    spec.addColorStop(0.9, 'rgba(130,140,255,0.55)');
    spec.addColorStop(1, 'rgba(130,140,255,0)');
    g.fillStyle = spec;
    g.globalAlpha = 0.35; g.fillRect(-32, -6.5, 64, 13);
    g.globalAlpha = 0.55; g.fillRect(-32, -3.8, 64, 7.6);
    g.globalAlpha = 0.9;  g.fillRect(-32, -1.6, 64, 3.2);
    g.restore();
    return c;
  }
  function makeBloom() {   // the rare full milky flare, grain baked in
    var p = spriteCtx(SPR), c = p[0], g = p[1];
    var m = g.createRadialGradient(SCALE_W * 0.45, H_PX * 0.4, 2, SCALE_W * 0.45, H_PX * 0.4, SCALE_W * 0.8);
    m.addColorStop(0, 'rgba(245,250,255,0.85)');
    m.addColorStop(0.5, 'rgba(205,222,255,0.4)');
    m.addColorStop(1, 'rgba(205,222,255,0)');
    g.fillStyle = m; g.fill(shape);
    g.shadowColor = 'rgba(230,240,255,0.95)'; g.shadowBlur = 9;
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,253,248,0.95)'; g.stroke(shape);
    grainErode(g, c.width, c.height, 0.28);
    return c;
  }
  function makeHalo() {
    var c = document.createElement('canvas');
    c.width = c.height = HALO * K;
    var g = c.getContext('2d');
    g.scale(K, K);
    var r = g.createRadialGradient(HALO / 2, HALO / 2, 2, HALO / 2, HALO / 2, HALO / 2);
    r.addColorStop(0, 'rgba(210,227,255,0.55)');
    r.addColorStop(0.35, 'rgba(180,205,255,0.16)');
    r.addColorStop(1, 'rgba(180,205,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, HALO, HALO);
    grainErode(g, c.width, c.height, 0.3);
    return c;
  }

  var face, edges, iri, caus, bloom, halo;
  function buildSprites() {   // K-dependent: rebuilt whenever the factor changes
    face = HUES.map(makeFace);
    edges = [makeEdge(0.22), makeEdge(0.5), makeEdge(0.78)];
    iri = [];
    for (var ii = 0; ii < N_IRI; ii++) iri.push(makeSheen(ii * 360 / N_IRI));
    caus = [[], []];
    for (var ci = 0; ci < N_CAUS; ci++) {
      caus[0].push(makeCaustic(ci / (N_CAUS - 1), false));
      caus[1].push(makeCaustic(ci / (N_CAUS - 1), true));
    }
    bloom = makeBloom(); halo = makeHalo();
  }

  // smooth deterministic fields: muscles and light patches, not per-scale chaos
  function fieldA(x, y) {
    var n = Math.sin(x * 0.0021 + 1.3) * Math.cos(y * 0.0043 - 0.7)
          + 0.6 * Math.sin(x * 0.0009 - y * 0.0031 + 4.2);
    return Math.min(1, Math.max(0, 0.5 + 0.31 * n));
  }
  function fieldHue(x, y) {
    return 0.5 + 0.5 * Math.sin(x * 0.0013 - 2.1) * Math.cos(y * 0.0037 + 0.9);
  }
  function hueIdx(v) { return Math.min(HUES.length - 1, Math.floor(v * HUES.length)); }
  function hash(i) { var v = Math.sin(i * 127.1) * 43758.5453; return v - Math.floor(v); }
  // lateral undulation: an S-path fixed in space; the skin flows through it.
  // A slow traveling swell + amplitude breathing add the vertical body motion;
  // both freeze with idleT when the breath stops.
  function pathY(x, t) {
    var a = PATH_AMP * (1 + AMP_BREATH * Math.sin(6.2832 * t / AMP_T));
    return a * (Math.sin(2 * Math.PI * x / PATH_LEN + 0.6)
         + PATH_HARM * Math.sin(2 * Math.PI * x / (PATH_LEN * 0.53) + 1.9)) / (1 + PATH_HARM)
         + SWELL_AMP * Math.sin(2 * Math.PI * x / SWELL_LEN - 6.2832 * t / SWELL_T);
  }
  function pathSlope(x, t) { return (pathY(x + 6, t) - pathY(x - 6, t)) / 12; }
  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  var W = 0, Hh = 0;
  function build() {
    var r = stage.getBoundingClientRect();
    W = Math.round(r.width); Hh = Math.round(r.height);
    if (W < 4 || Hh < 4) return false;   // transient 0x0 viewport guard
    var k = Math.min(K_MAX, Math.max(K_MIN, W / (COL_STEP * COLS_TARGET)));
    if (!face || Math.abs(k - K) > 0.01) { K = k; buildSprites(); }
    main.width = W * dpr; main.height = Hh * dpr;
    var gc = document.getElementById('sp-grain');
    gc.width = W * dpr; gc.height = Hh * dpr;
    var g = gc.getContext('2d');
    var tile = document.createElement('canvas'); tile.width = tile.height = 160;
    var tg = tile.getContext('2d');
    var img = tg.createImageData(160, 160);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 108 + Math.floor(Math.random() * 92);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    g.fillStyle = g.createPattern(tile, 'repeat');
    g.fillRect(0, 0, gc.width, gc.height);
    return true;
  }

  var offset = 0, idleT = 0;
  function speed(t) { return TRAVEL_V * (1 + SURGE * Math.sin(2 * Math.PI * t / 9)); }

  function eachScale(fn) {
    var CS = COL_STEP * K, VP = VPITCH * K;
    var floorOff = Math.floor(offset / CS);
    var frac = offset - floorOff * CS;
    var nCols = Math.ceil(W / CS) + 6;
    // the diffuse light wanders: two incommensurate periods so the roam
    // never reads as a mechanical ping-pong
    var bandX = W * (BAND_X + BAND_ROAM * (0.7 * Math.sin(6.2832 * idleT / ROAM_T1)
              + 0.3 * Math.sin(6.2832 * idleT / ROAM_T2 + 1.7)));
    for (var j = -3; j < nCols; j++) {
      var xd = j * CS + frac;            // screen x (columns drawn left -> right;
      var wcol = j - floorOff;           //  right columns overlap left, like scales)
      var wx = wcol * CS;                // material coordinate: streams with the skin
      var py = pathY(xd, idleT), slope = pathSlope(xd, idleT);
      var parity = ((wcol % 2) + 2) % 2;
      for (var yi = -2; yi * VP < Hh + VP * 2; yi++) {
        var wy = yi * VP;
        var amp = fieldA(wx, wy);
        var breath = Math.sin(idleT * 0.9 + wcol * 0.6 + yi * 1.1) * 1.2 * amp;
        var cx = xd + 24 * K, cy = yi * VP + (parity ? VP / 2 : 0) + 24 * K + py + breath;
        var u = (cx - bandX - (cy - Hh * 0.5) * BAND_SLANT) / (BAND_W * W);
        var beam = Math.exp(-u * u);         // the slanted band; body streams through it
        fn(cx, cy, Math.atan(slope) * 0.8, hueIdx(fieldHue(wx, wy)),
           slope, beam, hash(wcol * 61 + yi * 17));
      }
    }
  }

  // one physical model: glossy black glass under a single diffuse strip-light.
  // spec01 = band intensity at this scale x how well its flank mirrors the
  // source. Every layer (film -> white glint -> dispersion -> bloom) and the
  // film hue itself derive from that one number, so the colour grades stay
  // ordered like real thin-film interference.
  function response(slope, beam, rnd) {
    var d = (slope - LIGHT_SLOPE) / LIGHT_WIDTH;
    var spec01 = Math.exp(-d * d) * beam;
    var hue = IRI_CORE + IRI_SWEEP * (1 - spec01) + (rnd - 0.5) * IRI_JIT;
    return {
      sheen: (AMB_SHEEN + (1 - AMB_SHEEN) * smoothstep(SHEEN_LO, SHEEN_HI, spec01)) * IRI_A,
      sheenPos: (((hue % 360) + 360) % 360) / 360 * N_IRI,
      edge: smoothstep(EDGE_LO, EDGE_HI, spec01) * EDGE_A,
      edgePos: Math.min(0.999, Math.max(0, 0.5 + slope * 3.2)),   // streak sits light-side
      caus: smoothstep(CAUS_LO, CAUS_HI, spec01) * CAUS_A,
      causPos: Math.min(0.999, Math.max(0, 0.5 - slope * 4)),     // caustic slides opposite
      bloom: smoothstep(BLOOM_LO, BLOOM_HI, spec01)
    };
  }

  function drawScale(cx, cy, rot, spr, r, causVar) {
    var SS = SPR * K, HS = HALO * K;
    ctx.save();
    ctx.translate(cx, cy);
    if (r.bloom > 0.02) {
      ctx.globalAlpha = r.bloom * 0.6;
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(halo, -HS / 2, -HS / 2, HS, HS);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.rotate(rot);
    ctx.globalAlpha = 1;
    ctx.drawImage(face[spr], -SS / 2, -SS / 2, SS, SS);
    ctx.globalCompositeOperation = 'screen';
    if (r.sheen > 0.02) {
      var si = Math.floor(r.sheenPos) % N_IRI, sf = r.sheenPos - Math.floor(r.sheenPos);
      ctx.globalAlpha = r.sheen * (1 - sf);
      ctx.drawImage(iri[si], -SS / 2, -SS / 2, SS, SS);
      if (sf > 0.01) {
        ctx.globalAlpha = r.sheen * sf;
        ctx.drawImage(iri[(si + 1) % N_IRI], -SS / 2, -SS / 2, SS, SS);
      }
    }
    if (r.caus > 0.02) {
      var ci = r.causPos * (N_CAUS - 1);
      var i0 = Math.floor(ci), f = ci - i0;
      var set = caus[causVar ? 1 : 0];
      ctx.globalAlpha = r.caus * (1 - f);
      ctx.drawImage(set[i0], -SS / 2, -SS / 2, SS, SS);
      if (i0 + 1 < N_CAUS && f > 0.01) {
        ctx.globalAlpha = r.caus * f;
        ctx.drawImage(set[i0 + 1], -SS / 2, -SS / 2, SS, SS);
      }
    }
    if (r.edge > 0.02) {
      var ei = r.edgePos * 2;
      var e0 = Math.floor(ei), ef = ei - e0;
      ctx.globalAlpha = r.edge * (1 - ef);
      ctx.drawImage(edges[e0], -SS / 2, -SS / 2, SS, SS);
      if (e0 + 1 < 3 && ef > 0.01) {
        ctx.globalAlpha = r.edge * ef;
        ctx.drawImage(edges[e0 + 1], -SS / 2, -SS / 2, SS, SS);
      }
    }
    if (r.bloom > 0.02) {
      ctx.globalAlpha = r.bloom;
      ctx.drawImage(bloom, -SS / 2, -SS / 2, SS, SS);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // -- state machine: idle -> recoil -> burst -> fallen -> done --
  // stateT accumulates clamped frame dt (not wall clock), so a hidden tab
  // resumes the choreography where it left off instead of jumping ahead
  var state = 'idle', stateT = 0, origin = null, parts = [];

  function snapshot(ox, oy) {
    parts = [];
    var n = 0;
    eachScale(function (cx, cy, rot, spr, slope, beam, rnd) {
      n++;
      var r2 = hash(n * 3.7 + 1), r3 = hash(n * 7.3 + 2), r4 = hash(n * 11.9 + 3), r5 = hash(n * 17.3 + 4);
      var dx = cx - ox, dy = cy - oy;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var v0 = (BURST_FLOOR + BURST_V * Math.exp(-dist / BURST_FALLOFF))
             * (SPEED_JIT_LO + (SPEED_JIT_HI - SPEED_JIT_LO) * r2);
      var ang = Math.atan2(dy, dx) + (rnd - 0.5) * 2 * ANGLE_JIT;
      parts.push({
        x: cx, y: cy, rot: rot, spr: spr, resp: response(slope, beam, rnd),
        causVar: r5 > 0.5, litF: 0.55 + 0.45 * rnd,   // per-shard glossiness for tumble glints
        delay: dist * SHOCK_K * (1 + (r3 - 0.5) * 2 * DELAY_JIT) + r4 * 0.04,
        vx: Math.cos(ang) * v0, vy: Math.sin(ang) * v0,
        drag: DRAG_LO + (DRAG_HI - DRAG_LO) * r3,
        flutA: FLUT_LO + (FLUT_HI - FLUT_LO) * r4, flutF: 1.6 + 1.6 * r2,
        w: (rnd - 0.5) * 9, ph: rnd * 6.28, gone: false, det: -1
      });
    });
  }

  var last = null, tNow = 0;
  function frame(ts) {
    if (state === 'done') return;
    requestAnimationFrame(frame);
    if (!W && !build()) return;
    var now = ts / 1000;
    if (last === null) last = now;
    var dt = Math.min(now - last, 0.05); last = now;
    tNow = now;
    stateT += dt;
    if (!shedArmed) {   // arm only once a frame has actually run (tab visible)
      shedArmed = true;
      if (AUTO_SHED_T > 0) setTimeout(shedFromCenter, AUTO_SHED_T * 1000);
    }

    if (state === 'idle') {
      idleT += dt; offset += speed(idleT) * dt;
    } else if (state === 'recoil') {
      // the flinch: breath stops, one sharp jerk backward decelerating to a stop
      offset -= RECOIL_V0 * Math.exp(-RECOIL_DECEL * stateT) * dt;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    if (state === 'burst') {
      // opaque skin everywhere the shockwave hasn't reached; a soft growing
      // hole tracks the wavefront so the page beneath is revealed by it
      ctx.fillStyle = '#07090d'; ctx.fillRect(0, 0, W, Hh);
      var Rw = stateT / SHOCK_K;
      // proportional feather: attached scales (delay jitter <= 1.6x) sit beyond
      // ~0.61*Rw (minus a <=55px near-origin margin from the absolute jitter
      // term), so full erase at 0.55*Rw stays behind them
      var hole = ctx.createRadialGradient(origin.x, origin.y, Rw * 0.55,
                                          origin.x, origin.y, Rw + 30);
      hole.addColorStop(0, 'rgba(0,0,0,1)');
      hole.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = hole; ctx.fillRect(0, 0, W, Hh);
      ctx.globalCompositeOperation = 'source-over';
    } else if (state !== 'fallen') {
      // 'fallen' stays fully transparent — an opaque fill here would flash
      // black over the revealed page for one frame before the stage hides
      ctx.fillStyle = '#07090d'; ctx.fillRect(0, 0, W, Hh);
    }

    if (state === 'idle' || state === 'recoil') {
      eachScale(function (cx, cy, rot, spr, slope, beam, rnd) {
        drawScale(cx, cy, rot, spr, response(slope, beam, rnd), rnd > 0.5);
      });
      if (state === 'recoil') {
        // quiet bloom gathering at the touch point while the body pulls back
        var rph = Math.min(1, stateT / RECOIL_T);
        var g = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, 85);
        g.addColorStop(0, col(0.85, 0.05, 245, 0.22 * rph));
        g.addColorStop(1, col(0.85, 0.05, 245, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
        if (rph >= 1) {
          snapshot(origin.x, origin.y);
          state = 'burst'; stateT = 0;
          beginReveal();
        }
      }

    } else if (state === 'burst') {
      var tb = stateT, alive = 0;
      for (var i2 = 0; i2 < parts.length; i2++) {
        var q = parts[i2];
        if (q.gone) continue;
        if (tb < q.delay) {
          drawScale(q.x, q.y, q.rot, q.spr, q.resp, q.causVar);
          alive++; continue;
        }
        if (q.det < 0) q.det = tb;
        var k = Math.exp(-q.drag * dt);
        q.vx *= k; q.vy = q.vy * k + GRAV * dt;
        q.x += (q.vx + q.flutA * Math.sin(q.flutF * tb + q.ph)) * dt;
        q.y += q.vy * dt;
        q.rot += q.w * dt; q.w *= Math.exp(-0.5 * dt);
        if (q.y > Hh + 60 || q.x < -80 || q.x > W + 80) { q.gone = true; continue; }
        alive++;
        var tear = TEAR_FLARE * Math.exp(-(tb - q.det) / 0.3);
        var glint = SHARD_GLINT * Math.pow(Math.max(0, Math.sin(q.rot * 3 + q.ph)), 8) * q.litF;
        var spin01 = (Math.sin(q.rot) + 1) / 2;
        drawScale(q.x, q.y, q.rot, q.spr, {
          sheen: Math.min(1, Math.max(tear * 0.7, SHARD_SHEEN + glint)) * IRI_A,
          sheenPos: (q.resp.sheenPos + spin01 * 3) % N_IRI,  // tumble slides the film hue
          edge: Math.min(1, Math.max(tear, glint)) * EDGE_A,
          edgePos: spin01,
          caus: Math.max(tear * 0.9, glint) * CAUS_A,
          causPos: spin01,   // tumbling shifts the internal refraction
          bloom: tear
        }, q.causVar);
      }
      if (!alive) { state = 'fallen'; }

    } else if (state === 'fallen') {
      // no regrow on this page: the revealed index is the fresh skin
      stage.classList.add('sp-gone');
      state = 'done';
    }
  }
  function skipMolt() {   // repeat visits and reduced motion land on the fresh skin
    stage.classList.add('sp-gone');
    document.body.classList.remove('sp-locked');
    state = 'done';
  }
  var shedArmed = false;
  function shedFromCenter() {
    if (document.hidden) {   // never molt an unwatched stage; try again shortly
      setTimeout(shedFromCenter, 1000);
      return;
    }
    shed((W || window.innerWidth) / 2, (Hh || window.innerHeight) / 2);
  }

  var reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var molted = false;

  var hint = stage.querySelector('.sp-hint');
  if (hint && window.matchMedia && window.matchMedia('(hover: none)').matches) hint.textContent = 'tap to shed';
  if (reduceMotion || molted) {
    skipMolt();
  } else {
    requestAnimationFrame(frame);   // the auto-shed timer arms inside the first frame
    window.addEventListener('wheel', shedFromCenter, { passive: true });
    window.addEventListener('touchmove', shedFromCenter, { passive: true });
    window.addEventListener('keydown', shedFromCenter);
  }

  function beginReveal() {   // petals now fall over a live page
    stage.classList.add('sp-shedding');
    document.body.classList.remove('sp-locked');
  }
  function shed(x, y) {
    if (state !== 'idle') return;
    origin = { x: x, y: y };
    state = 'recoil'; stateT = 0;
  }
  stage.addEventListener('click', function (e) {
    var r = stage.getBoundingClientRect();
    shed(e.clientX - r.left, e.clientY - r.top);
  });

  // resize mid-choreography is deliberately dropped: W/Hh/K stay stale for the
  // ~2.5s of a burst rather than rebuilding sprites mid-flight
  new ResizeObserver(function () { if (state === 'idle') { W = 0; } }).observe(stage);
})();

/* scales-landing — a creature mid-molt: one touch and it sheds its glass skin.
 *
 * Geometry drives everything. The body is a tube bent along a serpenoid
 * curve: bending waves roll tail-ward while the skin slides head-ward through
 * them, so scales spread on the outside of each bend and bunch on the inside.
 * Every scale is a small glass plate tilted off that tube, and one key light
 * against the plate's normal decides all it shows (film hue, white glint,
 * dispersion, bloom). The lit strip is simply where the tube faces the light,
 * so it rides the bends because the bends are real.
 * Zero dependencies; canvas 2D with pre-rendered sprites.
 */
(function () {
  // ---- knobs ----------------------------------------------------------------
  // the body: a tube seen side-on, laid along the frame's long side
  var TUBE_R = 0.72;                          // radius, x the frame's short side
  var ROWS_FRONT = 13;                        // scale rows across the visible half
  var WAVE_A = 0.45;                          // heading swing of the S, rad
  var BEND_MAX = 0.5;                         // peak curvature x radius: inner-side squeeze
  var WAVE_T = 22;                            // s for one bend to roll past, tail-ward
  var TRAVEL_V = 24;                          // skin slides head-ward, px/s per unit K
  var SURGE = 0.25, SURGE_T = 9;              // speed swell
  var A_BREATH = 0.1, A_BREATH_T = 11;        // the S slowly tightens and relaxes
  var LIFT0 = 0.16, LIFT_SQUEEZE = 0.4;       // plate tilt off the body, rad; more when bunched
  var NORMAL_JIT = 0.06;                      // per-plate normal scatter: the line breaks into glints
  // the light: one soft key, upper right (the head side: plates tilt to face it)
  var LIGHT = [0.5, -0.55, 0.67];             // screen x, y (down), z (toward viewer)
  var SPEC_W = 0.24;                          // specular lobe half-width, rad
  var SHADE_MIN = 0.3;                        // the flank turned from the light falls to this
  var FRESNEL_A = 0.3;                        // grazing film along the silhouettes
  // the flinch: the body tightens around the touch and holds its breath
  var RECOIL_T = 1.0, FLINCH_T = 0.35;        // whole held beat; time to tighten
  var FLINCH_A = 1.25, FLINCH_K = 1.12;       // heading x, wavenumber x when startled
  // the shed: cracks run along the seams, rafts of plates lift along their
  // normals, break apart, and fall rocking like leaves through the same light.
  // Distances/speeds are px at a 768px short side and scale with the frame.
  var CRACK_V = 2600, CRACK_A = 0.6;          // crack front px/s; seam glint as it passes
  var CRACK_RISE = 0.08;                      // s for a seam glint to come up (no one-frame pop)
  var SETTLE_T = 0.16;                        // s a freed plate takes to fade up into the top layer
  var LIFT_LEAD = 0.14, LIFT_K = 0.0009;      // rafts lift behind the cracks: s + s/px
  var LIFT_JIT = 0.35;
  var RAFT_P = 0.65, RAFT_I = 3, RAFT_J = 2;  // chance a plate starts in a raft; raft cell
  var BREAK_LO = 0.25, BREAK_HI = 0.7;        // s from lift-off until a raft breaks up (> SETTLE_T)
  var EJECT_V = 140, PUSH_V = 300, PUSH_FALLOFF = 600; // off the normal; away from the touch
  var Z_LIFT = 120;                           // px toward the viewer as plates lift
  var FALL_V = 0.62, FALL_DRAG = 2.6;         // terminal fall, frame heights/s; approach /s
  var FLUT_SLOW = 0.35;                       // fall slows this much at the ends of a rock
  var FLUT_LO = 0.5, FLUT_HI = 1.1;           // rock amplitude about the long axis, rad
  var FLUT_W_LO = 2.2, FLUT_W_HI = 4.2;       // rock rate, rad/s
  var GLIDE = 90;                             // sideways swing at the bottom of a rock, px/s
  var TUMBLE_P = 0.25, TUMBLE_LO = 2, TUMBLE_HI = 5; // some plates tumble end over end, rad/s
  var SPIN_MAX = 0.8;                         // slow turn in the picture plane, rad/s
  var PEEL_LO = 0.3, PEEL_HI = 0.8;           // the tip lifts as a plate tears free, rad
  var FOCAL = 1.6;                            // perspective focal length, x frame long side
  var LIFE = 5.5, SHED_MAX = 8;               // petal lifetime cap; whole-shed cap, s
  // the material: sprite layers, all driven by one specular number
  var AMB_SHEEN = 0.22;                       // ambient film, mostly at grazing angles
  var SHEEN_LO = 0.04, SHEEN_HI = 0.75;       // wide soft ramp from ambient up to lit
  var IRI_A = 0.7;
  var N_IRI = 16;                             // sheen hue flipbook around the wheel
  var IRI_CORE = 85, IRI_SWEEP = 205;         // gold core -> green -> cyan -> blue -> violet rim
  var IRI_JIT = 18;                           // per-scale film-thickness variance
  var EDGE_A = 0.5;
  var EDGE_LO = 0.45, EDGE_HI = 0.85;         // white glint ring inside the film
  var CAUS_A = 0.4;
  var CAUS_LO = 0.68, CAUS_HI = 0.95;         // dispersion: a thin ring hugging the core
  var BLOOM_LO = 0.96, BLOOM_HI = 1.08;       // faint core mist on the rare perfect mirror
  // Blender orientation atlas (default; ?painted for the procedural sprites): mirrors assets/scales/plate-atlas.json
  var ATLAS = { webp: 'plate-atlas.webp', png: 'plate-atlas.png', cell: 320, step: 0.15,
                hA: [-0.6, -0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45, 0.6], hB: [0, 0.15, 0.3, 0.45, 0.6] };
  var HALO_A = 0.22, HALO_SIZE = 0.55;        // halo peak and size: tumbling plates hit the
                                              // mirror angle together, so keep each one small
  var SCALE_W = 56, H_PX = 48, SPR = 72, HALO = 210;
  var COL_STEP = 22, VPITCH = 46;             // sprite units: exposed sliver, row pitch
  var K_MIN = 0.6, K_MAX = 3.4;               // sprite scale clamp (memory on huge screens)
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

  function makeShadow() {   // the plate's silhouette in near-black: diffuse falloff
    var p = spriteCtx(SPR), c = p[0], g = p[1];
    g.fillStyle = 'rgb(3,4,8)'; g.fill(shape);
    return c;
  }

  var face, shadow, edges, iri, caus, bloom, halo;
  function buildSprites() {   // K-dependent: rebuilt whenever the factor changes
    face = HUES.map(makeFace);
    shadow = makeShadow();
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

  function fieldHue(x, y) {   // slow material patches of face tint
    return 0.5 + 0.5 * Math.sin(x * 0.0013 - 2.1) * Math.cos(y * 0.0037 + 0.9);
  }
  function hueIdx(v) { return Math.min(HUES.length - 1, Math.floor(v * HUES.length)); }
  function hash(i) { var v = Math.sin(i * 127.1) * 43758.5453; return v - Math.floor(v); }
  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function clamp01(v) { return Math.min(0.999, Math.max(0, v)); }

  // ---- the light: fixed in screen space ------------------------------------
  var Lx, Ly, Lz, Hx, Hy, Hz;   // key light and half-vector (view = +z)
  (function () {
    var l = Math.sqrt(LIGHT[0] * LIGHT[0] + LIGHT[1] * LIGHT[1] + LIGHT[2] * LIGHT[2]);
    Lx = LIGHT[0] / l; Ly = LIGHT[1] / l; Lz = LIGHT[2] / l;
    var h = Math.sqrt(Lx * Lx + Ly * Ly + (Lz + 1) * (Lz + 1));
    Hx = Lx / h; Hy = Ly / h; Hz = (Lz + 1) / h;
  })();

  // ---- the body: a serpenoid tube -------------------------------------------
  // Heading along the body is theta(u) = a sin(psi), psi = psiA + k (u - uA).
  // Integrating heading gives the spine in closed form (Jacobi-Anger):
  //   x = (J0 psi + J2 sin 2psi + J4/2 sin 4psi) / k
  //   y = -2 (J1 cos psi + J3/3 cos 3psi + J5/5 cos 5psi) / k   (zero-mean sway)
  // The spine is pinned at an anchor (xA, yA) <-> material point uA.
  function besselJ(n, x) {
    var f = 1;
    for (var i = 1; i <= n; i++) f *= i;
    var h = x / 2, t = Math.pow(h, n) / f, s = 0;
    for (var m = 0; m < 12; m++) { s += t; t *= -h * h / ((m + 1) * (m + 1 + n)); }
    return s;
  }
  var bod = { a: WAVE_A, k: 1, J: [1, 0, 0, 0, 0, 0], xA: 0, yA: 0, uA: 0, psiA: 0 };
  function setWave(a, k) {
    bod.a = a; bod.k = k;
    for (var n = 0; n < 6; n++) bod.J[n] = besselJ(n, a);
  }
  function spineX(psi) {
    var J = bod.J;
    return (J[0] * psi + J[2] * Math.sin(2 * psi) + 0.5 * J[4] * Math.sin(4 * psi)) / bod.k;
  }
  function spineY(psi) {
    var J = bod.J;
    return -2 * (J[1] * Math.cos(psi) + J[3] / 3 * Math.cos(3 * psi) + J[5] / 5 * Math.cos(5 * psi)) / bod.k;
  }

  // frame geometry; body frame = screen in landscape, rotated in portrait so
  // the body always lies along the long side (it travels up on a phone)
  var W = 0, Hh = 0, BL = 0, BS = 0, portrait = false;
  var R = 1, VP = 1, CS = 1, DPHI = 0.2, kIdle = 1;
  function build() {
    var r = stage.getBoundingClientRect();
    W = Math.round(r.width); Hh = Math.round(r.height);
    if (W < 4 || Hh < 4) return false;   // transient 0x0 viewport guard
    portrait = Hh > W;
    BL = portrait ? Hh : W; BS = portrait ? W : Hh;
    R = TUBE_R * BS;
    var k = Math.min(K_MAX, Math.max(K_MIN, Math.PI * R / ROWS_FRONT / VPITCH));
    VP = VPITCH * k; CS = COL_STEP * k; DPHI = VP / R;
    kIdle = BEND_MAX / (WAVE_A * R);
    if (!face || Math.abs(k - K) > 0.01) { K = k; buildSprites(); }
    if (state === 'idle') poseIdle();
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

  // Every visible plate on the tube, tail to head (head-ward plates overlap).
  // Plate frame (screen space, 3D, z toward viewer): A along the body toward
  // the head, B across it, n its outward normal. Sprite x maps to A, y to B,
  // so projecting A and B to the screen foreshortens the plate for free.
  var pl = { x: 0, y: 0, ax: 0, ay: 0, bx: 0, by: 0, alpha: 1, s: 1,
             A: [0, 0, 0], B: [0, 0, 0], n: [0, 0, 0], nl: [0, 0, 0],
             i: 0, j: 0, spr: 0, rnd: 0, causVar: false };
  function put(v, x, y, z) {   // body frame -> screen frame
    if (portrait) { v[0] = y; v[1] = -x; } else { v[0] = x; v[1] = y; }
    v[2] = z;
  }
  function eachPlate(fn) {
    var a = bod.a, k = bod.k, J = bod.J, J0 = J[0], m = SPR * K;
    var X0 = spineX(bod.psiA), Y0 = spineY(bod.psiA);
    var pad = (R * Math.sin(a) + 2 * (Math.abs(J[2]) + Math.abs(J[4])) / k + m) / J0;
    var i0 = Math.floor((bod.uA + (-bod.xA - m) / J0 - pad) / CS);
    var i1 = Math.ceil((bod.uA + (BL - bod.xA + m) / J0 + pad) / CS);
    var jmax = Math.ceil(Math.PI / 2 / DPHI) + 1;
    for (var i = i0; i <= i1; i++) {
      var u = i * CS, psi = bod.psiA + k * (u - bod.uA);
      var X = bod.xA + spineX(psi) - X0, Y = bod.yA + spineY(psi) - Y0;
      var th = a * Math.sin(psi), kap = a * k * Math.cos(psi);
      var tx = Math.cos(th), ty = Math.sin(th), nx = -ty, ny = tx;
      var odd = ((i % 2) + 2) % 2;
      for (var j = -jmax; j <= jmax; j++) {
        var phi = (j + 0.5 * odd) * DPHI;
        if (phi < -1.53 || phi > 1.53) continue;           // the far side of the tube
        var sp = Math.sin(phi), cp = Math.cos(phi), d = R * sp;
        var px = X + d * nx, py = Y + d * ny;
        if (px < -m || px > BL + m || py < -m || py > BS + m) continue;
        // inside of a bend (kap * d > 0) the skin is squeezed and plates lift
        var beta = Math.min(0.6, LIFT0 + LIFT_SQUEEZE * Math.max(0, kap * d));
        var cb = Math.cos(beta), sb = Math.sin(beta);
        var ntx = sp * nx, nty = sp * ny;                  // tube normal: sp N + cp z
        var n0 = ntx * cb + tx * sb, n1 = nty * cb + ty * sb, n2 = cp * cb;
        var a0 = tx * cb - ntx * sb, a1 = ty * cb - nty * sb, a2 = -cp * sb;
        var b0 = cp * nx, b1 = cp * ny, b2 = -sp;
        var key = i * 61 + j * 17;
        var jA = (hash(key + 0.37) - 0.5) * 2 * NORMAL_JIT;
        var jB = (hash(key + 0.71) - 0.5) * 2 * NORMAL_JIT;
        var l0 = n0 + jA * a0 + jB * b0, l1 = n1 + jA * a1 + jB * b1, l2 = n2 + jA * a2 + jB * b2;
        var ll = Math.sqrt(l0 * l0 + l1 * l1 + l2 * l2);
        if (portrait) { pl.x = py; pl.y = Hh - px; } else { pl.x = px; pl.y = py; }
        put(pl.A, a0, a1, a2); put(pl.B, b0, b1, b2); put(pl.n, n0, n1, n2);
        put(pl.nl, l0 / ll, l1 / ll, l2 / ll);
        pl.ax = pl.A[0]; pl.ay = pl.A[1]; pl.bx = pl.B[0]; pl.by = pl.B[1];
        pl.s = 1; pl.alpha = 1;
        pl.i = i; pl.j = j; pl.rnd = hash(key);
        pl.spr = hueIdx(fieldHue(u / K, j * VPITCH));
        pl.causVar = pl.rnd > 0.5;
        fn(pl);
      }
    }
  }

  // one physical model: glossy dark glass under one key light. spec01 is how
  // well the plate mirrors the light into the eye; every layer (film -> white
  // glint -> dispersion -> bloom) and the film hue derive from it, so colour
  // grades stay ordered like real thin-film interference.
  var lit = {};
  function light(n, A, B, rnd, r) {
    var nx = n[0], ny = n[1], nz = n[2];
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }        // two-sided glass
    var ang = Math.acos(Math.min(1, nx * Hx + ny * Hy + nz * Hz));
    var spec01 = Math.exp(-(ang / SPEC_W) * (ang / SPEC_W));
    var gr = 1 - nz, fres = gr * gr * gr;                 // grazing: Fresnel film
    var diff = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
    var mx = nx - Hx, my = ny - Hy, mz = nz - Hz;          // miss from the mirror angle
    var mA = mx * A[0] + my * A[1] + mz * A[2], mB = mx * B[0] + my * B[1] + mz * B[2];
    var hue = IRI_CORE + IRI_SWEEP * (1 - spec01) + (rnd - 0.5) * IRI_JIT;
    r.shade = SHADE_MIN + (1 - SHADE_MIN) * diff;
    r.sheen = Math.min(1, AMB_SHEEN * (0.3 + 0.7 * fres) + FRESNEL_A * fres
            + (1 - AMB_SHEEN) * smoothstep(SHEEN_LO, SHEEN_HI, spec01)) * IRI_A;
    r.sheenPos = (((hue % 360) + 360) % 360) / 360 * N_IRI;
    r.edge = smoothstep(EDGE_LO, EDGE_HI, spec01) * EDGE_A;
    r.edgePos = clamp01(0.5 + mA * 2.5);                   // streak slides round the rim
    r.caus = smoothstep(CAUS_LO, CAUS_HI, spec01) * CAUS_A;
    r.causPos = clamp01(0.5 - mB * 3);                     // caustic slides across the face
    r.bloom = smoothstep(BLOOM_LO, BLOOM_HI, spec01);
    r.spec01 = spec01;
    r.hA = -mA; r.hB = -mB;                                // half-vector in the plate frame
    if (atlasLive()) {   // the rendered plate carries its own glint, film and shading
      r.sheen = FRESNEL_A * fres * IRI_A * 0.5;            // keep only the grazing film
      r.edge = 0; r.caus = 0;
    }
    return r;
  }

  // ?atlas: plates drawn from the Blender orientation atlas (tools/blender)
  // instead of the painted layers. Cells are indexed by the half-vector in the
  // plate frame; hB < 0 mirrors the sprite across its long axis.
  // Blender atlas on tablets and up; on phones the atlas glints shrink to dots
  // and the skin reads dark, so the painted sprites lead there. ?atlas / ?painted force either.
  var ATLAS_ON = /[?&]atlas\b/.test(location.search) ||
    (!/[?&]painted\b/.test(location.search) && Math.min(window.innerWidth, window.innerHeight) >= 600);
  var atlasImg = null;
  function atlasLive() { return ATLAS_ON && atlasImg && atlasImg.complete && atlasImg.naturalWidth > 0; }
  if (ATLAS_ON) {
    atlasImg = new Image();
    atlasImg.onerror = function () { atlasImg.onerror = null; atlasImg.src = 'assets/scales/' + ATLAS.png; };
    atlasImg.src = 'assets/scales/' + ATLAS.webp;
  }
  function drawAtlas(p, r, SS, h, a0) {
    var CP = ATLAS.cell, last = ATLAS.hA.length - 1, rows = ATLAS.hB.length - 1;
    var fA = Math.min(last, Math.max(0, (r.hA - ATLAS.hA[0]) / ATLAS.step));
    var fB = Math.min(rows, Math.abs(r.hB) / ATLAS.step), flip = r.hB < 0 ? -1 : 1;
    var c0 = Math.floor(fA), r0 = Math.floor(fB), wa = fA - c0, wb = fB - r0;
    var c1 = Math.min(last, c0 + 1), r1 = Math.min(rows, r0 + 1);
    ctx.setTransform(dpr * p.ax, dpr * p.ay, dpr * p.bx * flip, dpr * p.by * flip, dpr * p.x, dpr * p.y);
    ctx.globalCompositeOperation = 'source-over';
    // exact bilinear blend by successive "over": each cell's alpha is its weight
    // over the weight already laid down, so the mix is continuous across cell
    // boundaries (all cells share one silhouette)
    var w00 = (1 - wa) * (1 - wb), w10 = wa * (1 - wb), w01 = (1 - wa) * wb, w11 = wa * wb;
    ctx.globalAlpha = a0; ctx.drawImage(atlasImg, c0 * CP, r0 * CP, CP, CP, -h, -h, SS, SS);
    if (w10 > 0.004) {
      ctx.globalAlpha = a0 * w10 / (w00 + w10);
      ctx.drawImage(atlasImg, c1 * CP, r0 * CP, CP, CP, -h, -h, SS, SS);
    }
    if (w01 > 0.004) {
      ctx.globalAlpha = a0 * w01 / (w00 + w10 + w01);
      ctx.drawImage(atlasImg, c0 * CP, r1 * CP, CP, CP, -h, -h, SS, SS);
    }
    if (w11 > 0.004) {
      ctx.globalAlpha = a0 * w11;
      ctx.drawImage(atlasImg, c1 * CP, r1 * CP, CP, CP, -h, -h, SS, SS);
    }
    ctx.setTransform(dpr * p.ax, dpr * p.ay, dpr * p.bx, dpr * p.by, dpr * p.x, dpr * p.y);
  }

  function drawPlate(p, r) {
    var SS = SPR * K, h = SS / 2, a0 = p.alpha;
    var atl = atlasLive();
    if (r.bloom > 0.02) {
      var HS = HALO * K * p.s * HALO_SIZE;
      ctx.setTransform(dpr, 0, 0, dpr, dpr * p.x, dpr * p.y);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = r.bloom * HALO_A * a0;
      ctx.drawImage(halo, -HS / 2, -HS / 2, HS, HS);
    }
    if (atl) {
      drawAtlas(p, r, SS, h, a0);
    } else {
      ctx.setTransform(dpr * p.ax, dpr * p.ay, dpr * p.bx, dpr * p.by, dpr * p.x, dpr * p.y);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a0;
      ctx.drawImage(face[p.spr], -h, -h, SS, SS);
      if (r.shade < 0.99) {
        ctx.globalAlpha = (1 - r.shade) * a0;
        ctx.drawImage(shadow, -h, -h, SS, SS);
      }
    }
    ctx.globalCompositeOperation = 'screen';
    if (r.sheen > 0.02) {
      var si = Math.floor(r.sheenPos) % N_IRI, sf = r.sheenPos - Math.floor(r.sheenPos);
      ctx.globalAlpha = r.sheen * (1 - sf) * a0;
      ctx.drawImage(iri[si], -h, -h, SS, SS);
      if (sf > 0.01) {
        ctx.globalAlpha = r.sheen * sf * a0;
        ctx.drawImage(iri[(si + 1) % N_IRI], -h, -h, SS, SS);
      }
    }
    if (r.caus > 0.02) {
      var ci = r.causPos * (N_CAUS - 1);
      var i0 = Math.floor(ci), f = ci - i0;
      var set = caus[p.causVar ? 1 : 0];
      ctx.globalAlpha = r.caus * (1 - f) * a0;
      ctx.drawImage(set[i0], -h, -h, SS, SS);
      if (i0 + 1 < N_CAUS && f > 0.01) {
        ctx.globalAlpha = r.caus * f * a0;
        ctx.drawImage(set[i0 + 1], -h, -h, SS, SS);
      }
    }
    if (r.edge > 0.02) {
      var ei = r.edgePos * 2;
      var e0 = Math.floor(ei), ef = ei - e0;
      ctx.globalAlpha = r.edge * (1 - ef) * a0;
      ctx.drawImage(edges[e0], -h, -h, SS, SS);
      if (e0 + 1 < 3 && ef > 0.01) {
        ctx.globalAlpha = r.edge * ef * a0;
        ctx.drawImage(edges[e0 + 1], -h, -h, SS, SS);
      }
    }
    if (r.bloom > 0.02 && !atl) {   // the atlas cell already holds its glint
      ctx.globalAlpha = r.bloom * a0;
      ctx.drawImage(bloom, -h, -h, SS, SS);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  function drawSkin() {
    eachPlate(function (p) { drawPlate(p, light(p.nl, p.A, p.B, p.rnd, lit)); });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // dev overlay (?dev): spine, silhouettes, and where the highlight should sit
  var overlay = false;
  function drawOverlay() {
    var a = bod.a, k = bod.k, X0 = spineX(bod.psiA), Y0 = spineY(bod.psiA);
    var Hb = portrait ? [-Hy, Hx, Hz] : [Hx, Hy, Hz];      // half-vector in body frame
    var lines = [[], [], [], []];
    for (var bxs = -40; bxs <= BL + 40; bxs += 6) {
      var u = bod.uA + (bxs - bod.xA) / bod.J[0];
      var psi = bod.psiA + k * (u - bod.uA);
      var X = bod.xA + spineX(psi) - X0, Y = bod.yA + spineY(psi) - Y0;
      var th = a * Math.sin(psi), nx = -Math.sin(th), ny = Math.cos(th);
      var phiH = Math.atan2(Hb[0] * nx + Hb[1] * ny, Hb[2]);   // tube angle facing H
      [0, R, -R, R * Math.sin(phiH)].forEach(function (d, q) {
        var px = X + d * nx, py = Y + d * ny;
        lines[q].push(portrait ? [py, Hh - px] : [px, py]);
      });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1.5;
    ['rgba(255,80,80,0.9)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.6)', 'rgba(255,210,60,0.95)']
      .forEach(function (c, q) {
        ctx.strokeStyle = c; ctx.setLineDash(q === 3 ? [6, 6] : []);
        ctx.beginPath();
        lines[q].forEach(function (pt, ix) { ix ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1]); });
        ctx.stroke();
      });
    ctx.setLineDash([]);
  }

  // ---- state machine: idle -> recoil -> burst -> fallen -> done -------------
  // stateT accumulates clamped frame dt (not wall clock), so a hidden tab
  // resumes the choreography where it left off instead of jumping ahead
  var state = 'idle', stateT = 0, origin = null, flinch = null;
  var idleT = 0, travel = 0, phase = 0.9;
  function poseIdle() {   // spine anchored mid-frame on the material point there
    setWave(WAVE_A * (1 + A_BREATH * Math.sin(2 * Math.PI * idleT / A_BREATH_T)), kIdle);
    bod.uA = -travel; bod.psiA = kIdle * bod.uA + phase;
    bod.xA = BL / 2; bod.yA = BS / 2 + spineY(bod.psiA);
  }

  function update(dt) {
    stateT += dt;
    if (state === 'idle') {
      idleT += dt;
      var v = TRAVEL_V * K * (1 + SURGE * Math.sin(2 * Math.PI * idleT / SURGE_T));
      travel += v * dt;
      phase += (kIdle * v + 2 * Math.PI / WAVE_T) * dt;    // bends roll tail-ward
      poseIdle();
    } else if (state === 'recoil') {
      // the flinch: travel stops; the S tightens toward the touch, then holds
      var e = smoothstep(0, FLINCH_T, stateT);   // starts from rest: no one-frame jerk
      setWave(flinch.a * (1 + (FLINCH_A - 1) * e), flinch.k * (1 + (FLINCH_K - 1) * e));
      if (stateT >= RECOIL_T) startBurst();
    } else if (state === 'burst') {
      if (!stepBodies(dt) || stateT > SHED_MAX) state = 'fallen';
    }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    if (state === 'idle' || state === 'recoil') {
      ctx.fillStyle = '#07090d'; ctx.fillRect(0, 0, W, Hh);
      drawSkin();
      if (state === 'recoil') {
        // quiet bloom gathering at the touch point while the body tenses
        var rph = Math.min(1, stateT / RECOIL_T);
        var g = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, 85);
        g.addColorStop(0, col(0.85, 0.05, 245, 0.22 * rph));
        g.addColorStop(1, col(0.85, 0.05, 245, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
      }
      if (overlay) drawOverlay();
    } else if (state === 'burst') {
      drawBurst();
    }
  }

  // ---- the shed ---------------------------------------------------------------
  // A body is a raft of 1+ plates moving rigidly. Orientation is kinematic:
  // a peel about B (tip lifts), a rock about A (leaf-like pendulum, or a
  // steady tumble), a slow turn about the view axis. Glints come from the same
  // light() as the skin, so a falling plate flashes only when it truly mirrors
  // the light.
  var bodies = [], SPD = 1;
  function rotAbout(v, k, ang, out) {   // Rodrigues, k unit
    var c = Math.cos(ang), s = Math.sin(ang);
    var d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
    var x = v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d;
    var y = v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d;
    var z = v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d;
    out[0] = x; out[1] = y; out[2] = z;
    return out;
  }
  function unit(v) {
    var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
    v[0] /= l; v[1] /= l; v[2] /= l;
    return v;
  }

  function snapshot(ox, oy) {
    var plates = [];
    eachPlate(function (p) {
      plates.push({ x: p.x, y: p.y, A: p.A.slice(), B: p.B.slice(), n: p.n.slice(), nl: p.nl.slice(),
                    i: p.i, j: p.j, rnd: p.rnd, spr: p.spr, causVar: p.causVar,
                    lit: Object.assign({}, light(p.nl, p.A, p.B, p.rnd, lit)) });
    });
    var groups = {}, order = [], at = {};
    plates.forEach(function (q, ix) {
      var raft = hash(q.i * 7.13 + q.j * 3.31 + 0.5) < RAFT_P;
      var key = raft ? Math.floor(q.i / RAFT_I) + ':' + Math.floor((q.j + 64) / RAFT_J) : 's' + ix;
      if (!groups[key]) { groups[key] = []; at[key] = order.length; order.push(key); }
      q.key = key; q.mi = groups[key].length;
      groups[key].push(q);
    });
    bodies = order.map(function (key, bi) { return makeBody(groups[key], ox, oy, bi); });
    bodies.forEach(function (b) { b.key = b.zT; });   // layer by lift height, fixed for the flight
    // the skin's own overlap order, kept while plates are attached or just tearing free
    skinOrder = plates.map(function (q) { var b = bodies[at[q.key]]; return { b: b, m: b.m[q.mi] }; });
  }
  var skinOrder = [];
  function makeBody(ms, ox, oy, bi) {
    var n = ms.length, cx = 0, cy = 0, A = [0, 0, 0], B = [0, 0, 0], N = [0, 0, 0];
    ms.forEach(function (q) {
      cx += q.x / n; cy += q.y / n;
      for (var c = 0; c < 3; c++) { A[c] += q.A[c]; B[c] += q.B[c]; N[c] += q.n[c]; }
    });
    unit(A); unit(B); unit(N);
    var dist = Math.sqrt((cx - ox) * (cx - ox) + (cy - oy) * (cy - oy)) || 1;
    var r = function (s) { return hash(bi * 13.7 + s * 3.1 + 0.29); };
    var push = PUSH_V * SPD * Math.exp(-dist / (PUSH_FALLOFF * SPD)) * (0.6 + 0.8 * r(1));
    var ej = EJECT_V * SPD * (0.5 + r(2)), heavy = 1 / Math.sqrt(n);
    return {
      m: ms.map(function (q) {
        return { o: [q.x - cx, q.y - cy, 0], A: q.A, B: q.B, n: q.n, nl: q.nl, spr: q.spr,
                 causVar: q.causVar, rnd: q.rnd, lit: q.lit,
                 tCrack: Math.sqrt((q.x - ox) * (q.x - ox) + (q.y - oy) * (q.y - oy)) / (CRACK_V * SPD) };
      }),
      x: cx, y: cy, z: 0, z0: 0, zT: Z_LIFT * SPD * Math.max(0, N[2]) * (0.5 + r(3)), key: 0,
      vx: (cx - ox) / dist * push + N[0] * ej, vy: (cy - oy) / dist * push + N[1] * ej,
      A: A, B: B, n: N,
      tDet: LIFT_LEAD + dist / SPD * LIFT_K * (1 + LIFT_JIT * (2 * r(4) - 1)),
      tBreak: n > 1 ? BREAK_LO + (BREAK_HI - BREAK_LO) * r(5) : Infinity,
      tau: 0, attached: true, gone: false,
      amp: (FLUT_LO + (FLUT_HI - FLUT_LO) * r(6)) * (n > 1 ? 0.35 : 1),
      w: FLUT_W_LO + (FLUT_W_HI - FLUT_W_LO) * r(7), ph: r(8) * 6.2832,
      drift: n === 1 && r(9) < TUMBLE_P ? (r(10) < 0.5 ? -1 : 1) * (TUMBLE_LO + (TUMBLE_HI - TUMBLE_LO) * r(11)) : 0,
      spin: (r(12) - 0.5) * 2 * SPIN_MAX * heavy,
      peel: (PEEL_LO + (PEEL_HI - PEEL_LO) * r(13)) * heavy * (r(14) < 0.5 ? -1 : 1)
    };
  }

  // the body's rotation at its own clock tau, applied to a vector
  var tmpA = [0, 0, 0], ZAX = [0, 0, 1];
  function orient(b, v, out) {
    var t = b.tau, ramp = 1 - Math.exp(-t / 0.5);
    var zeta = b.peel * (1 - Math.exp(-t / 0.15)) * Math.exp(-t / 1.2);
    var rho = b.amp * ramp * Math.sin(b.w * t + b.ph) + b.drift * t;
    var sig = b.spin * 1.5 * (1 - Math.exp(-t / 1.5));
    rotAbout(v, b.B, zeta, out);
    rotAbout(out, rotAbout(b.A, b.B, zeta, tmpA), rho, out);
    return rotAbout(out, ZAX, sig, out);
  }

  function stepBodies(dt) {
    var alive = 0, Hfall = FALL_V * Hh, kd = 1 - Math.exp(-FALL_DRAG * dt), out = [];
    for (var bi = 0; bi < bodies.length; bi++) {
      var b = bodies[bi];
      if (b.gone) continue;
      alive++;
      if (b.attached) {
        if (stateT >= b.tDet) b.attached = false; else continue;
      }
      b.tau += dt;
      var ramp = 1 - Math.exp(-b.tau / 0.6), ph = b.w * b.tau + b.ph;
      // leaf pendulum: fastest sideways at the bottom of each rock, slowest
      // fall at the ends of the swing; burst impulses relax into it
      var tx = GLIDE * SPD * ramp * (b.amp / FLUT_HI) * Math.cos(ph);
      var ty = Hfall * (1 - FLUT_SLOW * ramp * Math.sin(ph) * Math.sin(ph));
      b.vx += (tx - b.vx) * kd; b.vy += (ty - b.vy) * kd;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.z = b.z0 + (b.zT - b.z0) * (1 - Math.exp(-b.tau / 0.3));
      var reach = b.m.length > 1 ? (RAFT_I * CS + RAFT_J * VP) : 0, m = SPR * K * 0.6 + reach;
      if (b.y - m > Hh || b.x + m < 0 || b.x - m > W || b.tau > LIFE) { b.gone = true; continue; }
      if (b.tau >= b.tBreak) out.push(bi);
    }
    for (var s = 0; s < out.length; s++) breakRaft(bodies[out[s]]);
    return alive;
  }
  function breakRaft(b) {
    b.gone = true;
    b.m.forEach(function (q, qi) {
      var o = orient(b, q.o, [0, 0, 0]);
      var len = Math.sqrt(o[0] * o[0] + o[1] * o[1]) || 1, sep = (40 + 50 * hash(qi + b.x)) * SPD;
      var nb = {
        m: [{ o: [0, 0, 0], A: orient(b, q.A, [0, 0, 0]), B: orient(b, q.B, [0, 0, 0]),
              n: orient(b, q.n, [0, 0, 0]), nl: orient(b, q.nl, [0, 0, 0]), spr: q.spr,
              causVar: q.causVar, rnd: q.rnd, lit: q.lit, tCrack: q.tCrack }],
        x: b.x + o[0], y: b.y + o[1], z: b.z + o[2], z0: b.z + o[2], zT: b.z + o[2],
        vx: b.vx + o[0] / len * sep, vy: b.vy + o[1] / len * sep,
        tDet: 0, tBreak: Infinity, tau: 0, attached: false, gone: false, free: true,
        key: b.key + (qi + 1) * 1e-4,   // stay in the raft's layer slot
        amp: FLUT_LO + (FLUT_HI - FLUT_LO) * hash(qi * 3.3 + b.y), w: FLUT_W_LO + (FLUT_W_HI - FLUT_W_LO) * hash(qi + b.y),
        ph: 0, drift: 0, spin: (hash(qi * 5.1 + b.x) - 0.5) * 2 * SPIN_MAX, peel: 0
      };
      nb.A = nb.m[0].A; nb.B = nb.m[0].B; nb.n = nb.m[0].n;
      bodies.push(nb);
    });
  }

  function startBurst() {
    SPD = BS / 768;
    snapshot(origin.x, origin.y);
    state = 'burst'; stateT = 0;
    beginReveal();
  }

  var rr = {}, pa = [0, 0, 0], pb = [0, 0, 0], pn = [0, 0, 0], po = [0, 0, 0];
  var plate = { x: 0, y: 0, ax: 0, ay: 0, bx: 0, by: 0, s: 1, alpha: 1, spr: 0, causVar: false };
  function drawBurst() {
    var tb = stateT;
    // opaque skin where the lift-off hasn't reached; a soft growing hole
    // trails the latest-possible lift front so the page shows through behind it
    ctx.fillStyle = '#07090d'; ctx.fillRect(0, 0, W, Hh);
    var span = Math.max(0, tb - LIFT_LEAD) * SPD / LIFT_K;
    var margin = (RAFT_I * CS + RAFT_J * VP) * 0.6 + SPR * K * 0.5;
    var r0 = Math.max(0, span / (1 + LIFT_JIT) - margin), r1 = span / (1 - LIFT_JIT) + 40;
    var hole = ctx.createRadialGradient(origin.x, origin.y, r0, origin.x, origin.y, Math.max(r1, r0 + 40));
    hole.addColorStop(0, 'rgba(0,0,0,1)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = hole; ctx.fillRect(0, 0, W, Hh);
    ctx.globalCompositeOperation = 'source-over';

    // attached plates, and plates in their first SETTLE_T of tearing free, keep
    // the skin's overlap order so nothing jumps in front of its neighbour
    for (var oi = 0; oi < skinOrder.length; oi++) {
      var ref = skinOrder[oi], b = ref.b, q = ref.m;
      if (b.gone) continue;
      if (b.attached) {
        Object.assign(rr, q.lit);
        if (tb >= q.tCrack) {   // the seam catches light as the crack passes: quick rise, slow fade
          var tc = tb - q.tCrack;
          rr.edge = Math.max(rr.edge, CRACK_A * smoothstep(0, CRACK_RISE, tc) * Math.exp(-tc / 0.25));
          rr.edgePos = clamp01(0.5 + 0.4 * Math.sin(q.rnd * 6.28));
        }
        plate.x = b.x + q.o[0]; plate.y = b.y + q.o[1];
        plate.ax = q.A[0]; plate.ay = q.A[1]; plate.bx = q.B[0]; plate.by = q.B[1];
        plate.s = 1; plate.alpha = 1; plate.spr = q.spr; plate.causVar = q.causVar;
        drawPlate(plate, rr);
      } else if (!b.free && b.tau < SETTLE_T) {
        drawLoose(b, q, 1);   // still in its slot while its top-layer copy fades in
      }
    }
    // the touch glow fades instead of vanishing with the recoil
    var gl = 0.22 * (1 - smoothstep(0, 0.35, tb));
    if (gl > 0.002) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var g = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, 85);
      g.addColorStop(0, col(0.85, 0.05, 245, gl));
      g.addColorStop(1, col(0.85, 0.05, 245, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hh);
    }
    // loose layer, in a fixed order (each body's sort key never changes, so no
    // two plates swap in front of each other mid-flight). A plate tearing free
    // fades in here over SETTLE_T while its slot copy below still covers for it:
    // canvas has no depth buffer, and an instant re-layering is a visible pop.
    var loose = bodies.filter(function (lb) { return !lb.gone && !lb.attached; });
    loose.sort(function (p, q2) { return p.key - q2.key; });
    for (var li = 0; li < loose.length; li++) {
      var lb = loose[li], k = lb.free ? 1 : smoothstep(0, SETTLE_T, lb.tau);
      if (k <= 0.002) continue;
      for (var mi = 0; mi < lb.m.length; mi++) drawLoose(lb, lb.m[mi], k);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function drawLoose(lb, m, k) {   // one plate of a flying body, in perspective from frame centre
    var F = FOCAL * Math.max(W, Hh), cx = W / 2, cy = Hh / 2;
    orient(lb, m.o, po); orient(lb, m.A, pa); orient(lb, m.B, pb); orient(lb, m.nl, pn);
    var z = Math.min(0.6 * F, lb.z + po[2]), s = F / (F - z);
    plate.x = cx + (lb.x + po[0] - cx) * s; plate.y = cy + (lb.y + po[1] - cy) * s;
    plate.ax = pa[0] * s; plate.ay = pa[1] * s; plate.bx = pb[0] * s; plate.by = pb[1] * s;
    plate.s = s; plate.alpha = k * Math.min(1, (LIFE - lb.tau) / 1.5); plate.spr = m.spr; plate.causVar = m.causVar;
    drawPlate(plate, light(pn, pa, pb, m.rnd, rr));
  }

  var last = null, paused = false;
  function frame(ts) {
    if (state === 'done') return;
    requestAnimationFrame(frame);
    if (!W && !build()) return;
    var now = ts / 1000;
    if (last === null) last = now;
    var dt = Math.min(now - last, 0.05); last = now;
    if (!shedArmed && !DEV && AUTO_SHED_T > 0) {   // arm only once a frame has actually run (tab visible)
      shedArmed = true;
      setTimeout(shedFromCenter, AUTO_SHED_T * 1000);
    }
    if (devPlan) { var dp = devPlan; devPlan = null; runDevPlan(dp); }
    if (!paused) update(dt);
    if (state === 'fallen') {
      // no regrow on this page: the revealed index is the fresh skin
      stage.classList.add('sp-gone');
      state = 'done';
      return;
    }
    draw();
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

  // demo build: no auto-shed, no session skip (every visit gets the skin).
  // ?dev&t=<s>&ov freezes a frame with the spine and predicted highlight drawn on top
  var DEV = /[?&]dev\b/.test(location.search);
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
    if (!DEV) window.addEventListener('keydown', shedFromCenter);
  }
  // frozen frames for review: ?dev&t=<idle s>&ov&shed=<x>,<y>,<s after touch>
  // steps the clock deterministically, then pauses on that frame
  var devPlan = null;
  function stepSim(s) {
    for (var t = 0; t < s - 1e-9 && state !== 'fallen'; t += 1 / 60) update(Math.min(1 / 60, s - t));
  }
  function runDevPlan(p) {
    stepSim(p.t);
    overlay = p.ov;
    if (p.shed) { shed(p.shed[0], p.shed[1]); stepSim(p.shed[2] || 0); }
    paused = p.freeze;
  }
  if (DEV) {
    var q = new URLSearchParams(location.search);
    devPlan = { t: +q.get('t') || 0, ov: q.has('ov'), freeze: q.has('t') || q.has('shed'),
                shed: q.get('shed') ? q.get('shed').split(',').map(Number) : null };
  }

  function beginReveal() {   // petals now fall over a live page
    stage.classList.add('sp-shedding');
    document.body.classList.remove('sp-locked');
  }
  function shed(x, y) {
    if (state !== 'idle' || !W) return;
    origin = { x: x, y: y };
    // pin the spine under the touch so the body tightens toward it
    var bx = portrait ? Hh - y : x;
    var u = bod.uA + (bx - bod.xA) / bod.J[0], X0 = spineX(bod.psiA), Y0 = spineY(bod.psiA);
    for (var it = 0; it < 4; it++) {
      var ps = bod.psiA + bod.k * (u - bod.uA);
      u -= (bod.xA + spineX(ps) - X0 - bx) / Math.cos(bod.a * Math.sin(ps));
    }
    var psiC = bod.psiA + bod.k * (u - bod.uA);
    bod.xA = bod.xA + spineX(psiC) - X0; bod.yA = bod.yA + spineY(psiC) - Y0;
    bod.uA = u; bod.psiA = psiC;
    flinch = { a: bod.a, k: bod.k };
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

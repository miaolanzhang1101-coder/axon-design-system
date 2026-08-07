"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Axon components on one motion language.
 * MOTION TOKENS (a small set of reusable behaviors, one source of truth):
 *   breathe  slow pulse       alive and waiting
 *   expand   growing rings    needs attention
 *   flow     moving dashes    where it will go
 *   trail    fading comet     where it has been
 *   ripple   tap ring         you touched it
 * Each robot state is built to read at three scales: ambient, interface, and analytical.
 * Page chrome stays the same. Blue only palette, no red, yellow, or green.
 */

const MOTION = {
  breathe: { dur: 2.8, meaning: "Alive and waiting" },
  expand: { dur: 1.6, durFast: 0.9, meaning: "Needs attention" },
  flow: { dur: 1.0, meaning: "Where it will go" },
  trail: { dur: 1.15, meaning: "Where it has been" },
  ripple: { dur: 0.85, meaning: "You touched it" },
} as const;

/* ======================= SPATIAL FIELD (canvas) ========================== */

const TOK = {
  bg: "#08090c",
  grid: "rgba(255,255,255,0.045)",
  work: "rgba(255,255,255,0.12)",
  keepout: [255, 255, 255] as [number, number, number], // neutral, opacity driven
  goal: [76, 146, 255] as [number, number, number], // #4c92ff vivid azure accent
  chassis: "#eaf2ff",
  trail: [76, 146, 255] as [number, number, number],
  pathBase: "rgba(150,168,205,0.20)",
  pathAhead: [140, 190, 255] as [number, number, number],
  field: [92, 142, 226] as [number, number, number],
  fieldRisk: [160, 200, 255] as [number, number, number],
  state: {
    // one blue family. brightness encodes salience from calm to attention.
    cruise: [76, 146, 255] as [number, number, number],
    turn: [96, 150, 255] as [number, number, number],
    slow: [98, 122, 168] as [number, number, number],
    arrive: [155, 212, 255] as [number, number, number],
  },
  vmax: 178,
};
type V = { x: number; y: number };
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s });
const vlen = (a: V) => Math.hypot(a.x, a.y);
const vnorm = (a: V): V => { const l = vlen(a) || 1; return { x: a.x / l, y: a.y / l }; };
const vdist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lerpC = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function closestOnSeg(a: V, b: V, p: V): { pt: V; t: number } {
  const ab = sub(b, a);
  const t = clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y || 1), 0, 1);
  return { pt: add(a, mul(ab, t)), t };
}
function catmullPoint(p0: V, p1: V, p2: V, p3: V, t: number): V {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}
function catmull(points: V[]): V[] {
  if (points.length < 2) return points.slice();
  const P = [points[0], ...points, points[points.length - 1]];
  const out: V[] = [];
  for (let i = 0; i < P.length - 3; i++) for (let j = 0; j < 26; j++) out.push(catmullPoint(P[i], P[i + 1], P[i + 2], P[i + 3], j / 26));
  out.push(points[points.length - 1]);
  return out;
}
interface Path { pts: V[]; cum: number[]; total: number; wps: V[]; }
interface Keepout { cx: number; cy: number; w: number; h: number; rAvoid: number; flare: number; }

function SpatialField({ paused }: { paused: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!, ctx = canvas.getContext("2d")!;
    const L = { w: 1000, h: 620 };
    let dpr = 1, scale = 1, offX = 0, offY = 0, cssW = 0, cssH = 0;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = wrap.getBoundingClientRect();
      cssW = r.width; cssH = r.height;
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      scale = Math.min(cssW / L.w, cssH / L.h);
      offX = (cssW - L.w * scale) / 2; offY = (cssH - L.h * scale) / 2;
    }
    const ro = new ResizeObserver(resize); ro.observe(wrap); resize();
    const keepouts: Keepout[] = [
      { cx: 452, cy: 250, w: 150, h: 96, rAvoid: 96, flare: 0 },
      { cx: 640, cy: 430, w: 104, h: 104, rAvoid: 78, flare: 0 },
    ];
    const goals: V[] = [{ x: 860, y: 150 }, { x: 840, y: 500 }, { x: 150, y: 470 }, { x: 300, y: 130 }];
    const agent = { x: 130, y: 520, heading: 0, v: 0 };
    let path: Path | null = null, s = 0, arrived = false, goalIndex = 0, waitT = 0;
    let stateKey: keyof typeof TOK.state = "cruise";
    const trail: { x: number; y: number; life: number }[] = [];
    let trailTimer = 0;
    const ripples: { x: number; y: number; life: number }[] = [];
    let goalAnim = 0;
    const mouse: V & { inside: boolean } = { x: 0, y: 0, inside: false };
    let preview: Path | null = null;
    function plan(from: V, to: V): Path {
      const wps: V[] = [{ x: from.x, y: from.y }];
      const cands: { wp: V; t: number }[] = [];
      for (const k of keepouts) {
        const c = { x: k.cx, y: k.cy };
        const { pt, t } = closestOnSeg(from, to, c);
        const clear = k.rAvoid + 26;
        if (vdist(pt, c) < clear) {
          let dir = sub(pt, c);
          if (vlen(dir) < 1e-2) { const seg = vnorm(sub(to, from)); dir = { x: -seg.y, y: seg.x }; }
          cands.push({ wp: add(c, mul(vnorm(dir), clear)), t });
        }
      }
      cands.sort((a, b) => a.t - b.t);
      for (const c of cands) wps.push(c.wp);
      wps.push({ x: to.x, y: to.y });
      const pts = catmull(wps);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + vdist(pts[i - 1], pts[i]));
      return { pts, cum, total: cum[cum.length - 1], wps };
    }
    function setGoal(to: V) { path = plan({ x: agent.x, y: agent.y }, to); s = 0; arrived = false; goalAnim = 0; }
    setGoal(goals[0]);
    function sampleAt(p: Path, d: number) {
      const dd = clamp(d, 0, p.total);
      let lo = 0, hi = p.cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (p.cum[mid] < dd) lo = mid + 1; else hi = mid; }
      const i = Math.max(1, lo);
      const seg = p.cum[i] - p.cum[i - 1] || 1;
      const f = (dd - p.cum[i - 1]) / seg;
      const a = p.pts[i - 1], b = p.pts[i];
      return { pos: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, tan: vnorm(sub(b, a)) };
    }
    function curvatureAt(p: Path, d: number) {
      const D = 16, t1 = sampleAt(p, d - D).tan, t2 = sampleAt(p, d + D).tan;
      let da = Math.atan2(t2.y, t2.x) - Math.atan2(t1.y, t1.x);
      while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      return Math.abs(da) / (2 * D);
    }
    function update(dt: number) {
      if (path) {
        const remaining = path.total - s;
        const goalCap = Math.sqrt(Math.max(0, 2 * 240 * remaining));
        const curv = curvatureAt(path, s);
        const curveCap = TOK.vmax / (1 + curv * 900);
        const vtarget = Math.min(TOK.vmax, curveCap, goalCap);
        agent.v += (vtarget - agent.v) * Math.min(1, dt * 3.2);
        if (agent.v < 0) agent.v = 0;
        s += agent.v * dt;
        if (s >= path.total) { s = path.total; agent.v = 0; if (!arrived) { arrived = true; goalAnim = 1; } }
        const sm = sampleAt(path, s);
        agent.x = sm.pos.x; agent.y = sm.pos.y;
        const targetH = Math.atan2(sm.tan.y, sm.tan.x);
        let dh = targetH - agent.heading;
        while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        agent.heading += dh * Math.min(1, dt * 9);
      }
      trailTimer += dt;
      if (trailTimer > 0.028 && agent.v > 4) { trailTimer = 0; trail.push({ x: agent.x, y: agent.y, life: 1 }); }
      for (const t of trail) t.life -= dt / MOTION.trail.dur;
      for (let i = trail.length - 1; i >= 0; i--) if (trail[i].life <= 0) trail.splice(i, 1);
      for (const r of ripples) r.life -= dt / MOTION.ripple.dur;
      for (let i = ripples.length - 1; i >= 0; i--) if (ripples[i].life <= 0) ripples.splice(i, 1);
      if (goalAnim > 0) goalAnim = Math.max(0, goalAnim - dt / 0.9);
      let nearK = 0;
      for (const k of keepouts) {
        const d = vdist({ x: agent.x, y: agent.y }, { x: k.cx, y: k.cy }) - k.rAvoid;
        const f = clamp(1 - d / 120, 0, 1);
        k.flare += (f - k.flare) * Math.min(1, dt * 6);
        nearK = Math.max(nearK, k.flare);
      }
      const curv = path ? curvatureAt(path, s) : 0;
      if (arrived) stateKey = "arrive";
      else if (nearK > 0.4) stateKey = "slow";
      else if (curv > 0.006) stateKey = "turn";
      else stateKey = "cruise";
      if (arrived) { waitT += dt; if (waitT > 1.15) { waitT = 0; goalIndex = (goalIndex + 1) % goals.length; setGoal(goals[goalIndex]); } }
    }
    function capsule(x: number, y: number, w: number, h: number) {
      const r = Math.min(w, h) / 2;
      ctx.beginPath(); ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function draw(now: number) {
      const tSec = now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = TOK.bg; ctx.fillRect(0, 0, cssW, cssH);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = TOK.grid; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 40; x < L.w; x += 40) { ctx.moveTo(x, 20); ctx.lineTo(x, L.h - 20); }
      for (let y = 40; y < L.h; y += 40) { ctx.moveTo(30, y); ctx.lineTo(L.w - 30, y); }
      ctx.stroke();
      ctx.strokeStyle = TOK.work; ctx.lineWidth = 1.5; capsule(34, 34, L.w - 68, L.h - 68); ctx.stroke();
      const sc = TOK.state[stateKey];
      for (const k of keepouts) {
        const br = 0.5 + 0.5 * Math.sin(tSec * 3 + k.cx), fl = k.flare;
        capsule(k.cx - k.w / 2, k.cy - k.h / 2, k.w, k.h);
        ctx.fillStyle = rgba(TOK.keepout, 0.02 + 0.06 * fl + 0.01 * br); ctx.fill();
        ctx.strokeStyle = rgba(TOK.keepout, 0.2 + 0.45 * fl); ctx.lineWidth = 1.5 + 2.5 * fl;
        ctx.setLineDash([6, 10]); ctx.lineDashOffset = -tSec * 26; ctx.stroke(); ctx.setLineDash([]);
        if (fl > 0.02) { ctx.save(); ctx.shadowColor = rgba(TOK.keepout, 0.4 * fl); ctx.shadowBlur = 22 * fl; ctx.strokeStyle = rgba(TOK.keepout, 0.18 * fl); ctx.stroke(); ctx.restore(); }
      }
      // goal uses expanding pulse. looming motion captures attention (Franconeri & Simons 2003)
      const g = goals[goalIndex];
      const gph = (tSec / MOTION.expand.dur) % 1;
      ctx.strokeStyle = rgba(TOK.goal, (1 - gph) * 0.6); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(g.x, g.y, 10 + gph * 26, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.shadowColor = rgba(TOK.goal, 0.5); ctx.shadowBlur = 14;
      ctx.strokeStyle = rgba(TOK.goal, arrived ? 0.9 : 0.6); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(g.x, g.y, 15, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      ctx.fillStyle = rgba(TOK.goal, 0.9); ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, Math.PI * 2); ctx.fill();
      if (goalAnim > 0) { ctx.strokeStyle = rgba(TOK.goal, goalAnim); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.x, g.y, 8 + (1 - goalAnim) * 26, 0, Math.PI * 2); ctx.stroke(); }
      if (preview && mouse.inside && !arrived) {
        ctx.strokeStyle = "rgba(190,210,235,0.16)"; ctx.lineWidth = 1.4; ctx.setLineDash([2, 7]);
        ctx.beginPath(); preview.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.setLineDash([]);
      }
      // directional flow signals robot intent (Dragan et al. HRI 2013; Walker et al. HRI 2018)
      if (path) {
        ctx.strokeStyle = TOK.pathBase; ctx.lineWidth = 2;
        ctx.beginPath(); path.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.strokeStyle = rgba(TOK.pathAhead, 0.7); ctx.lineWidth = 2.4; ctx.setLineDash([3, 9]); ctx.lineDashOffset = -tSec * 60;
        ctx.beginPath(); let started = false;
        for (let i = 0; i < path.pts.length; i++) { if (path.cum[i] < s) continue; const p = path.pts[i]; if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); }
        ctx.stroke(); ctx.setLineDash([]);
        for (const w of path.wps) { ctx.fillStyle = "rgba(143,227,255,0.5)"; ctx.beginPath(); ctx.arc(w.x, w.y, 2.4, 0, Math.PI * 2); ctx.fill(); }
      }
      // trail shows recent path, aiding prediction (Dragan et al. HRI 2013)
      for (const t of trail) { const a = t.life * t.life; ctx.fillStyle = rgba(TOK.trail, 0.28 * a); ctx.beginPath(); ctx.arc(t.x, t.y, 2 + 7 * a, 0, Math.PI * 2); ctx.fill(); }
      // probability field
      const speedN = clamp(agent.v / TOK.vmax, 0, 1), curvNow = path ? curvatureAt(path, s) : 0;
      const major = 30 + speedN * 78, minor = 18 + curvNow * 1600 + speedN * 10, lead = 14 + speedN * 30;
      const fc = { x: agent.x + Math.cos(agent.heading) * lead, y: agent.y + Math.sin(agent.heading) * lead };
      let nearK = 0; for (const k of keepouts) nearK = Math.max(nearK, k.flare);
      const fieldCol = lerpC(TOK.field, TOK.fieldRisk, clamp(nearK * 1.2, 0, 1));
      ctx.save(); ctx.translate(fc.x, fc.y); ctx.rotate(agent.heading); ctx.scale(1, minor / major);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, major);
      grad.addColorStop(0, rgba(fieldCol, 0.32)); grad.addColorStop(0.5, rgba(fieldCol, 0.12)); grad.addColorStop(1, rgba(fieldCol, 0));
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, major, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(fieldCol, 0.22); ctx.lineWidth = 1;
      for (const rr of [0.45, 0.75, 1]) { ctx.beginPath(); ctx.arc(0, 0, major * rr, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
      // footprint breathes to read as alive (Baraka & Veloso, Int J Soc Robotics 2018)
      const ringPulse = 0.5 + 0.5 * Math.sin(tSec * (stateKey === "slow" ? 7 : stateKey === "arrive" ? 1.8 : 3.4));
      ctx.save(); ctx.shadowColor = rgba(sc, 0.6); ctx.shadowBlur = 12 + 10 * ringPulse;
      ctx.strokeStyle = rgba(sc, 0.55 + 0.4 * ringPulse); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(agent.x, agent.y, 22, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.translate(agent.x, agent.y); ctx.rotate(agent.heading);
      const cw = 26, ch = 16; ctx.fillStyle = TOK.chassis; capsule(-cw / 2, -ch / 2, cw, ch); ctx.fill();
      ctx.fillStyle = rgba(sc, 0.9); capsule(-cw / 2, -ch / 2, cw, ch); ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = "#08090c"; ctx.beginPath(); ctx.arc(cw / 2 - 5, 0, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      // ripple is immediate feedback, under 100ms (Miller, AFIPS 1968)
      for (const r of ripples) { ctx.strokeStyle = rgba(TOK.state.cruise, r.life * 0.7); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(r.x, r.y, (1 - r.life) * 34 + 4, 0, Math.PI * 2); ctx.stroke(); }
    }
    for (let i = 0; i < 48; i++) update(0.033); // settle into a meaningful static frame
    draw(performance.now());
    let last = performance.now(), raf = 0;
    function frame(now: number) {
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      if (!pausedRef.current) { update(dt); draw(now); }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    function toLogical(e: PointerEvent): V { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - offX) / scale, y: (e.clientY - r.top - offY) / scale }; }
    function onMove(e: PointerEvent) { const p = toLogical(e); mouse.x = p.x; mouse.y = p.y; mouse.inside = true; if (vdist(p, { x: agent.x, y: agent.y }) > 30) preview = plan({ x: agent.x, y: agent.y }, p); }
    function onLeave() { mouse.inside = false; preview = null; }
    function onDown(e: PointerEvent) { const p = toLogical(e); if (p.x < 20 || p.x > L.w - 20 || p.y < 20 || p.y > L.h - 20) return; ripples.push({ x: p.x, y: p.y, life: 1 }); goals[goalIndex] = p; setGoal(p); if (pausedRef.current) { for (let i = 0; i < 48; i++) update(0.033); draw(performance.now()); } }
    canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerleave", onLeave); canvas.addEventListener("pointerdown", onDown);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerleave", onLeave); canvas.removeEventListener("pointerdown", onDown); };
  }, []);
  return (
    <div ref={wrapRef} style={{ width: "100%", aspectRatio: "1000 / 620", borderRadius: 12, overflow: "hidden", background: TOK.bg, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.09)", touchAction: "none" }}>
      <canvas ref={canvasRef} role="img" aria-label="Spatial field: a robot follows a planned trajectory between zones, avoiding keep-out regions. Click to set a new goal." style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }} />
    </div>
  );
}

/* ======================= shared state model + glyph ====================== */

type Tier = "nominal" | "caution" | "critical";
type MotionMode = "breathe" | "expand" | "expand-fast";
interface BState { key: Tier; color: string; label: string; id: string; motion: MotionMode; freq: number; conf: number; }
const BSTATES: BState[] = [
  // one blue family. brightness (salience) plus shape plus cadence encode urgency, not hue.
  { key: "nominal", color: "#6f86a8", label: "NOMINAL", id: "state.nominal.running", motion: "breathe", freq: 0.25, conf: 0.98 },
  { key: "caution", color: "#4c92ff", label: "CAUTION", id: "state.caution.attention", motion: "expand", freq: 0.7, conf: 0.74 },
  { key: "critical", color: "#9bd4ff", label: "E-STOP", id: "state.critical.emergency", motion: "expand-fast", freq: 1.4, conf: 0.41 },
];
function BeaconIcon({ tier, size = 30 }: { tier: Tier; size?: number }) {
  if (tier === "nominal") return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 12.5l4 4 8-9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>);
  if (tier === "caution") return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4l9 16H3z" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /><line x1="12" y1="10" x2="12" y2="14.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" /><circle cx="12" cy="17.6" r="1.2" fill="#fff" /></svg>);
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.2 2.8H15.8L21.2 8.2V15.8L15.8 21.2H8.2L2.8 15.8V8.2Z" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="12" r="3.4" fill="#fff" /></svg>);
}
/** Shared beacon glyph: breathing core + expanding rings (concentric shape language). */
function Glyph({ st, size, showIcon = true, ripples = [] }: { st: BState; size: number; showIcon?: boolean; ripples?: number[] }) {
  const rings = st.motion !== "breathe";
  return (
    <div className={"mbeacon" + (st.motion === "expand-fast" ? " fast" : "")} style={{ ["--c" as string]: st.color, width: size, height: size }}>
      {rings && <span className="ring" style={{ width: size, height: size }} />}
      {rings && <span className="ring r2" style={{ width: size, height: size }} />}
      {ripples.map((r) => (<span key={r} className="rip" style={{ width: size, height: size }} />))}
      <span className="core" style={{ width: size, height: size }}>{showIcon && <BeaconIcon tier={st.key} size={Math.round(size * 0.4)} />}</span>
    </div>
  );
}

/* reduce motion control. WCAG 2.2.2 Pause, Stop, Hide */
function MotionSwitch({ reduced, onToggle }: { reduced: boolean; onToggle: () => void }) {
  return (
    <button className="mswitch" aria-pressed={reduced} onClick={onToggle} title="Reduce motion (accessibility)">
      <span className="dotm" />{reduced ? "Motion reduced" : "Reduce motion"}
    </button>
  );
}
// sliding selection keeps object constancy (Heer & Robertson, InfoVis 2007)
function StateSeg({ i, setI }: { i: number; setI: (n: number) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="State" style={{ ["--n" as string]: BSTATES.length, ["--i" as string]: i }}>
      <span className="seg-ind" aria-hidden="true" />
      {BSTATES.map((b, idx) => (
        <button key={b.key} role="radio" aria-checked={i === idx} onClick={() => setI(idx)}>
          <span className="nd" style={{ background: b.color }} />
          {b.label === "E-STOP" ? "E-Stop" : b.label[0] + b.label.slice(1).toLowerCase()}
        </button>
      ))}
    </div>
  );
}

/* ======================= Status Beacon ======================= */

function StatusBeacon({ reduced, onToggle }: { reduced: boolean; onToggle: () => void }) {
  const [i, setI] = useState(1);
  const [ripples, setRipples] = useState<number[]>([]);
  const st = BSTATES[i];
  const ping = () => { if (reduced) return; const id = Date.now() + Math.random(); setRipples((r) => [...r, id]); setTimeout(() => setRipples((r) => r.filter((x) => x !== id)), MOTION.ripple.dur * 1000 + 60); };
  const change = (n: number) => { setI(n); ping(); };
  return (
    <div className="beacon-demo">
      <button className="glyph-btn" onClick={ping} aria-label={`Status ${st.label}, tap to ping`}>
        <Glyph st={st} size={72} ripples={ripples} />
      </button>
      <div className="beacon-meta">
        <div className="beacon-label">{st.label}</div>
        <div className="beacon-id">{st.id}</div>
      </div>
      <div className="ctl-row">
        <StateSeg i={i} setI={change} />
        <MotionSwitch reduced={reduced} onToggle={onToggle} />
      </div>
    </div>
  );
}

/* ======================= Three Scales ======================== */

/** Eased number readout. animated transitions help people track change (Heer & Robertson, InfoVis 2007). Snaps when reduced. */
function useTween(target: number, reduced: boolean) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced) { from.current = target; setV(target); return; }
    const start = performance.now(), a = from.current, dur = 320;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
      const val = a + (target - a) * e; from.current = val; setV(val);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return v;
}

function wavePath(mode: MotionMode) {
  const W = 200, mid = 22, amp = 9; // low amplitude. a small change is enough to notice (Weber)
  const cycles = mode === "breathe" ? 1.2 : mode === "expand" ? 2 : 3;
  let d = "";
  for (let x = 0; x <= W; x += 2) {
    const ph = (x / W) * cycles;
    let v: number;
    if (mode === "breathe") v = Math.sin(ph * 2 * Math.PI);
    else { const f = ph % 1; v = (f < 0.14 ? f / 0.14 : f < 0.32 ? 1 - (f - 0.14) / 0.18 : 0) * 1.6 - 0.15; }
    d += (x === 0 ? "M" : "L") + x + " " + (mid - v * amp).toFixed(1) + " ";
  }
  return d;
}
function ThreeScales({ reduced, onToggle }: { reduced: boolean; onToggle: () => void }) {
  const [i, setI] = useState(1);
  const [ripples, setRipples] = useState<number[]>([]);
  const st = BSTATES[i];
  const scanDur = Math.max(1.4, 1 / st.freq).toFixed(2) + "s";
  const freqT = useTween(st.freq, reduced);
  const confT = useTween(st.conf, reduced);
  const change = (n: number) => {
    setI(n);
    if (reduced) return;
    const id = Date.now() + Math.random();
    setRipples((r) => [...r, id]);
    setTimeout(() => setRipples((r) => r.filter((x) => x !== id)), MOTION.ripple.dur * 1000 + 60);
  };
  return (
    <div className="scales">
      <div className="scales-row">
        <div className="scale">
          <div className="scale-stage ambient"><Glyph st={st} size={78} showIcon={false} ripples={ripples} /></div>
          <div className="scale-cap">Ambient</div>
        </div>
        <div className="scale">
          <div className="scale-stage iface"><Glyph st={st} size={40} /><div className="iface-meta"><div className="iface-label">{st.label}</div><div className="iface-hz">{st.freq.toFixed(2)} Hz</div></div></div>
          <div className="scale-cap">Interface</div>
        </div>
        <div className="scale">
          <div className="scale-stage">
            <div className="analytic" style={{ ["--c" as string]: st.color }}>
              <svg viewBox="0 0 200 44" className="wave" preserveAspectRatio="none">
                <line x1="0" y1="22" x2="200" y2="22" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                <path d={wavePath(st.motion)} fill="none" stroke="var(--c)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <line x1="0" y1="2" x2="0" y2="42" stroke="var(--c)" strokeWidth="1.5" className="scan" style={{ ["animationDuration" as string]: scanDur }} />
              </svg>
              <div className="readouts">
                <span><em>freq</em>{freqT.toFixed(2)}</span>
                <span><em>conf</em>{confT.toFixed(2)}</span>
                <span><em>id</em>{st.id.split(".").slice(-1)[0]}</span>
              </div>
            </div>
          </div>
          <div className="scale-cap">Analytical</div>
        </div>
      </div>
      <div className="ctl-row">
        <StateSeg i={i} setI={change} />
        <MotionSwitch reduced={reduced} onToggle={onToggle} />
      </div>
    </div>
  );
}

/* ======================= Motion token legend ============================= */

const MC = "#4c92ff";
function MotionTokens() {
  const rows: { name: string; meaning: string; demo: React.ReactNode }[] = [
    { name: "Breathing pulse", meaning: MOTION.breathe.meaning, demo: <span className="d-core breathe" /> },
    { name: "Expanding pulse", meaning: MOTION.expand.meaning, demo: <span className="d-expand"><span className="ring" /><span className="ring r2" /><span className="d-core" /></span> },
    { name: "Directional flow", meaning: MOTION.flow.meaning, demo: <svg width="60" height="20" aria-hidden="true"><line x1="4" y1="10" x2="48" y2="10" stroke={MC} strokeWidth="2" strokeDasharray="4 6" className="flowline" /><path d="M46 6 L54 10 L46 14" fill="none" stroke={MC} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> },
    { name: "Trail decay", meaning: MOTION.trail.meaning, demo: <span className="d-trail"><span className="dot" /></span> },
    { name: "Ripple", meaning: MOTION.ripple.meaning, demo: <span className="d-ripple"><span className="ring" /><span className="d-core sm" /></span> },
  ];
  return (
    <div className="motion-legend" style={{ ["--c" as string]: MC }}>
      {rows.map((r) => (
        <div className="ml-row" key={r.name}>
          <div className="ml-demo">{r.demo}</div>
          <div className="ml-name">{r.name}</div>
          <div className="ml-mean">{r.meaning}</div>
        </div>
      ))}
    </div>
  );
}

/* ======================= code block ===================================== */

const KW = /\b(import|from|export|function|return|const|let|var|interface|type|new|useState|useRef|useEffect)\b/;
function highlight(code: string): string {
  const esc = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const re = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b0x[0-9A-Fa-f]+\b|\b\d+\.?\d*\b)|([A-Za-z_$][\w$]*)/g;
  return esc.replace(re, (m, com, str, num, word) => {
    if (com) return `<span class="tok-com">${com}</span>`;
    if (str) return `<span class="tok-str">${str}</span>`;
    if (num) return `<span class="tok-num">${num}</span>`;
    if (word) return KW.test(word) ? `<span class="tok-key">${word}</span>` : word;
    return m;
  });
}
function CodeBlock({ file, code }: { file: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => highlight(code), [code]);
  return (
    <figure className="code">
      <div className="code-head"><span className="code-file">{file}</span>
        <button className={"copy" + (copied ? " done" : "")} onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre><code className="block" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </figure>
  );
}

/* ======================= PAGE (chrome unchanged) ========================= */

export default function Axon() {
  const [active, setActive] = useState("motion");
  const [reduced, setReduced] = useState(false);
  useEffect(() => { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) setReduced(true); }, []);
  useEffect(() => {
    const ids = ["motion", "beacon", "spatial", "scales"];
    const onScroll = () => {
      const y = window.scrollY + 150; let cur = ids[0];
      for (const id of ids) { const el = document.getElementById(id); if (el && el.offsetTop <= y) cur = id; }
      setActive(cur);
    };
    window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const nav: [string, string][] = [
    ["motion", "Motion Tokens"],
    ["beacon", "Status Beacon"],
    ["spatial", "Spatial Field"],
    ["scales", "Three Scales"],
  ];
  const toggleMotion = () => setReduced((v) => !v);
  return (
    <div className={"axn" + (reduced ? " no-motion" : "")}>
      <style>{CSS}</style>
      <header className="top">
        <div className="brand"><span className="mark" aria-hidden="true" /><b>Axon</b><span className="ver">v2.4</span></div>
        <nav><a href="#motion">Components</a><a href="#">Changelog</a><a href="#">GitHub</a></nav>
      </header>
      <div className="layout">
        <aside className="side">
          <div className="nav-group"><h4>Components</h4>
            {nav.map(([id, label]) => (<a key={id} href={"#" + id} className={active === id ? "active" : ""}>{label}</a>))}
            <a href="#">Gauge</a><a href="#">Zone</a>
          </div>
        </aside>
        <main>
          <div className="crumb"><span>Components</span> / Overview</div>
          <h1>Spatial primitives</h1>

          <h2 id="motion">Motion tokens <a className="anchor" href="#motion">#</a></h2>
          <p className="lead sm">A small set of motions. Each one has a fixed meaning, so the same movement reads the same way in every component.</p>
          <div className="preview"><MotionTokens /></div>
          <CodeBlock file="motion.ts" code={`export const motion = {
  breathe: { dur: 2.8, meaning: 'alive and waiting' },
  expand:  { dur: 1.6, meaning: 'needs attention' },
  flow:    { dur: 1.0, meaning: 'where it will go' },
  trail:   { dur: 1.15, meaning: 'where it has been' },
  ripple:  { dur: 0.85, meaning: 'you touched it' },
};`} />

          <h2 id="beacon">Status Beacon <a className="anchor" href="#beacon">#</a></h2>
          <p className="lead sm">One state shown three ways at once through shape, color, and motion. Nominal breathes to show it is alive. Caution and critical grow to ask for attention. Tap it to send a ripple.</p>
          <div className="preview"><StatusBeacon reduced={reduced} onToggle={toggleMotion} /></div>
          <CodeBlock file="status-beacon.tsx" code={`<StatusBeacon state="nominal" />   // breathe
<StatusBeacon state="caution" />   // expand
<StatusBeacon state="critical" />  // expand, fast`} />

          <h2 id="spatial">Spatial Field <a className="anchor" href="#spatial">#</a></h2>
          <p className="lead sm">All of the motions in one scene. The flowing line is the path ahead. The fading trail is where it has been. The pulsing ring is the goal. Click to set a new goal.</p>
          <div className="preview bleed"><SpatialField paused={reduced} /></div>
          <CodeBlock file="spatial-field.tsx" code={`<SpatialField
  zones={workspace.zones}
  agent={robot.pose}
  onGoal={(p) => robot.navigate(p)}
/>`} />

          <h2 id="scales">Three Scales <a className="anchor" href="#scales">#</a></h2>
          <p className="lead sm">The same state shown at three scales. Ambient is read from across the floor. Interface is read at the console. Analytical is read from the data. One motion drives all three at once.</p>
          <div className="preview"><ThreeScales reduced={reduced} onToggle={toggleMotion} /></div>
          <CodeBlock file="three-scales.tsx" code={`<Ambient    state={s} />   // read from across the floor
<Interface  state={s} />   // beacon and label at the console
<Analytical state={s} />   // waveform and numbers`} />
        </main>
        <aside className="toc">
          <h5>On this page</h5>
          <nav>{nav.map(([id, label]) => (<a key={id} href={"#" + id} className={active === id ? "active" : ""}>{label}</a>))}</nav>
        </aside>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap');

.axn{
  --bg:#000000; --surface:#0a0b0d; --surface-2:#101216;
  --border:#1e2024; --border-2:#161719;
  --fg:#ededed; --muted:#8b8f97; --muted-2:#585c63;
  --accent:#5b8cff;
  --code-bg:#0a0b0d; --code-head:#101216;
  --dot:rgba(255,255,255,0.045);
  --k-key:#c9a6ff; --k-str:#7ec8e8; --k-num:#9db8ff; --k-com:#6b7078;
  --d-breathe:4s; --d-expand:2.4s; --d-expand-fast:1.1s; --d-ripple:.9s; --d-flow:1.4s; --d-trail:1.3s;
  color:var(--fg);background:var(--bg);
  font-family:"Geist",system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;
  -webkit-font-smoothing:antialiased;min-height:100vh;
}
.axn *{box-sizing:border-box}
.axn a{color:inherit;text-decoration:none}
.axn code,.axn pre,.axn .mono{font-family:"Geist Mono",ui-monospace,monospace}
.axn :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}

.axn .top{position:sticky;top:0;z-index:50;height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:rgba(0,0,0,.72);backdrop-filter:saturate(160%) blur(12px);border-bottom:1px solid var(--border)}
.axn .brand{display:flex;align-items:center;gap:10px}
.axn .mark{width:24px;height:24px;border-radius:7px;background:var(--fg);position:relative}
.axn .mark::before{content:"";position:absolute;inset:6px;border-radius:50%;border:2px solid var(--bg)}
.axn .mark::after{content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;border-radius:50%;background:var(--bg);transform:translate(-50%,-50%)}
.axn .brand b{font-weight:600;letter-spacing:-.01em}
.axn .ver{font-family:"Geist Mono",monospace;font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:5px;padding:1px 6px}
.axn .top nav{display:flex;gap:22px}
.axn .top nav a{font-size:14px;color:var(--muted)}
.axn .top nav a:hover{color:var(--fg)}
.axn .layout{display:grid;grid-template-columns:230px minmax(0,1fr) 200px;max-width:1320px;margin:0 auto}
.axn .side{border-right:1px solid var(--border);padding:28px 14px;height:calc(100vh - 60px);position:sticky;top:60px}
.axn .nav-group h4{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-2);font-weight:500;margin:0 0 10px;padding:0 10px}
.axn .nav-group a{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--muted);padding:7px 10px;border-radius:7px}
.axn .nav-group a:hover{color:var(--fg);background:var(--surface-2)}
.axn .nav-group a.active{color:var(--fg);font-weight:500;background:var(--surface-2)}
.axn main{padding:46px 52px 120px;min-width:0}
.axn .crumb{font-size:13px;color:var(--muted-2);margin-bottom:14px}
.axn .crumb span{color:var(--muted)}
.axn h1{font-size:36px;font-weight:600;letter-spacing:-.028em;margin:0 0 14px}
.axn .lead{font-size:17px;color:var(--muted);margin:0 0 12px;max-width:66ch;line-height:1.55}
.axn .lead.sm{font-size:15px}
.axn h2{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:66px 0 8px;scroll-margin-top:80px;display:flex;align-items:center;gap:10px}
.axn h2 .anchor{opacity:0;color:var(--muted-2);font-weight:400;transition:opacity .15s}
.axn h2:hover .anchor{opacity:1}
.axn .preview{border:1px solid var(--border);border-radius:13px;background:var(--surface);background-image:radial-gradient(var(--dot) 1px, transparent 1px);background-size:16px 16px;background-position:-1px -1px;display:grid;place-items:center;padding:52px 24px;margin-top:22px}
.axn .preview.bleed{padding:14px;background:var(--surface)}
.axn figure.code{margin:14px 0 0;border:1px solid var(--border);border-radius:13px;overflow:hidden;background:var(--code-bg)}
.axn .code-head{display:flex;align-items:center;justify-content:space-between;height:42px;padding:0 12px 0 14px;background:var(--code-head);border-bottom:1px solid var(--border)}
.axn .code-file{font-family:"Geist Mono",monospace;font-size:12.5px;color:var(--muted)}
.axn .copy{height:28px;padding:0 12px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--muted);font-size:12px;cursor:pointer;font-family:"Geist",sans-serif}
.axn .copy:hover{color:var(--fg)}
.axn .copy.done{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%, transparent)}
.axn pre{margin:0;padding:16px;overflow-x:auto}
.axn code.block{font-size:13px;line-height:1.75;color:var(--fg);white-space:pre;display:block}
.axn .tok-key{color:var(--k-key)} .axn .tok-str{color:var(--k-str)} .axn .tok-num{color:var(--k-num)} .axn .tok-com{color:var(--k-com)}
.axn .toc{padding:46px 20px;height:calc(100vh - 60px);position:sticky;top:60px}
.axn .toc h5{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-2);font-weight:500;margin:0 0 12px}
.axn .toc a{display:block;font-size:13px;color:var(--muted);padding:5px 0 5px 12px;border-left:2px solid var(--border)}
.axn .toc a:hover{color:var(--fg)}
.axn .toc a.active{color:var(--fg);border-left-color:var(--fg)}

/* ===== MOTION TOKENS =====
   breathe = alive and waiting (Baraka & Veloso, Int J Soc Robotics 2018)
   expand  = needs attention, looming capture (Franconeri & Simons 2003)
   flow    = where it will go, robot intent (Dragan et al. HRI 2013; Walker et al. HRI 2018)
   trail   = where it has been, aids prediction (Dragan et al. HRI 2013)
   ripple  = you touched it, feedback under 100ms (Miller, AFIPS 1968) */
@keyframes m-breathe{0%,100%{opacity:.64;transform:scale(1)}50%{opacity:1;transform:scale(1.025)}}
@keyframes m-expand{0%{opacity:.46;transform:scale(.7)}100%{opacity:0;transform:scale(1.45)}}
@keyframes m-ripple{0%{opacity:.5;transform:scale(.5)}100%{opacity:0;transform:scale(1.9)}}
@keyframes m-flow{to{stroke-dashoffset:-30}}
@keyframes m-comet{0%{transform:translateX(-26px);opacity:0}12%{opacity:1}88%{opacity:1}100%{transform:translateX(26px);opacity:0}}
@keyframes m-scan{from{transform:translateX(0)}to{transform:translateX(200px)}}

.axn .mbeacon{position:relative;display:grid;place-items:center}
.axn .mbeacon>*{grid-area:1/1}
.axn .mbeacon .core{border-radius:50%;background:var(--c);display:grid;place-items:center;box-shadow:0 0 15px color-mix(in srgb,var(--c) 45%,transparent);animation:m-breathe var(--d-breathe) ease-in-out infinite}
.axn .mbeacon .ring{border-radius:50%;border:1.5px solid var(--c);animation:m-expand var(--d-expand) ease-out infinite;pointer-events:none}
.axn .mbeacon .ring.r2{animation-delay:calc(var(--d-expand) / -2)}
.axn .mbeacon.fast .ring{animation-duration:var(--d-expand-fast)}
.axn .mbeacon.fast .ring.r2{animation-delay:calc(var(--d-expand-fast) / -2)}
.axn .mbeacon .rip{border-radius:50%;border:2px solid var(--c);animation:m-ripple var(--d-ripple) ease-out forwards;pointer-events:none}

.axn .beacon-demo{display:flex;flex-direction:column;align-items:center;gap:20px}
/* hover and press feedback confirms input (Miller, AFIPS 1968; Nielsen response-time limits) */
.axn .glyph-btn{appearance:none;border:0;background:transparent;cursor:pointer;padding:12px;border-radius:999px;transition:transform .18s ease}
.axn .glyph-btn:hover{transform:scale(1.03)}
.axn .glyph-btn:active{transform:scale(.96)}
.axn .beacon-meta{text-align:center}
.axn .beacon-label{font-size:15px;font-weight:600;letter-spacing:.04em}
.axn .beacon-id{font-family:"Geist Mono",monospace;font-size:12px;color:var(--muted);margin-top:3px}
.axn .seg{position:relative;display:inline-flex;border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--surface)}
.axn .seg .seg-ind{position:absolute;top:0;bottom:0;left:0;width:calc(100% / var(--n));background:var(--surface-2);transform:translateX(calc(var(--i) * 100%));transition:transform .24s cubic-bezier(.4,0,.2,1)}
.axn .seg button{position:relative;z-index:1;flex:1 0 0;justify-content:center;appearance:none;border:0;background:transparent;color:var(--muted);font-family:inherit;font-size:13px;font-weight:500;padding:8px 15px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:color .18s,transform .1s;white-space:nowrap}
.axn .seg button[aria-checked="true"]{color:var(--fg)}
.axn .seg button:active{transform:scale(.95)}
.axn .seg .nd{width:8px;height:8px;border-radius:50%}
.axn .ctl-row{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}
.axn .mswitch{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 13px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--muted);font-family:"Geist Mono",monospace;font-size:11px;letter-spacing:.02em;cursor:pointer}
.axn .mswitch:hover{color:var(--fg)}
.axn .mswitch[aria-pressed="true"]{color:var(--fg);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
.axn .mswitch .dotm{width:8px;height:8px;border-radius:50%;background:currentColor;opacity:.45}
.axn .mswitch[aria-pressed="true"] .dotm{opacity:1;background:var(--accent)}

/* static, legible fallback when motion is reduced/paused (WCAG 2.2.2 + prefers-reduced-motion) */
.axn.no-motion .core{animation:none!important;opacity:1!important;transform:none!important}
.axn.no-motion .ring{animation:none!important;opacity:.4!important;transform:scale(1.5)!important}
.axn.no-motion .ring.r2{opacity:.22!important;transform:scale(1.95)!important}
.axn.no-motion .rip{display:none!important}
.axn.no-motion .flowline{animation:none!important}
.axn.no-motion .scan{animation:none!important;opacity:.55}
.axn.no-motion .d-core.breathe{animation:none!important}
.axn.no-motion .d-trail .dot{animation:none!important;transform:none!important}
.axn.no-motion .seg .seg-ind{transition:none!important}
.axn.no-motion .glyph-btn{transition:none!important}

.axn .scales{display:flex;flex-direction:column;align-items:center;gap:24px;width:100%}
.axn .scales-row{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;width:100%;max-width:660px}
.axn .scale{display:flex;flex-direction:column;align-items:center;gap:12px}
.axn .scale-stage{min-height:116px;display:flex;align-items:center;justify-content:center;gap:12px;width:100%;border:1px solid var(--border-2);border-radius:12px;background:rgba(255,255,255,0.012)}
.axn .scale-stage.iface{flex-direction:column;gap:14px}
.axn .iface-meta{text-align:center}
.axn .iface-label{font-size:13px;font-weight:600;letter-spacing:.04em}
.axn .iface-hz{font-family:"Geist Mono",monospace;font-size:11px;color:var(--muted)}
.axn .scale-cap{font-family:"Geist Mono",monospace;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:#a2a7b0}
.axn .analytic{width:100%;padding:14px;display:flex;flex-direction:column;gap:10px}
.axn .analytic .wave{width:100%;height:44px;overflow:visible}
.axn .analytic .scan{animation:m-scan 2s linear infinite}
.axn .readouts{display:flex;justify-content:space-between;gap:8px;font-family:"Geist Mono",monospace;font-size:11px;color:var(--fg)}
.axn .readouts em{color:var(--muted);font-style:normal;margin-right:5px}

.axn .motion-legend{display:flex;flex-direction:column;width:100%;max-width:460px;border:1px solid var(--border-2);border-radius:12px;overflow:hidden}
.axn .ml-row{display:grid;grid-template-columns:74px 1fr auto;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border-2)}
.axn .ml-row:last-child{border-bottom:0}
.axn .ml-demo{display:grid;place-items:center;height:26px}
.axn .ml-name{font-size:14px;font-weight:500}
.axn .ml-mean{font-family:"Geist Mono",monospace;font-size:11.5px;color:var(--muted);text-align:right}
.axn .d-core{width:14px;height:14px;border-radius:50%;background:var(--c);box-shadow:0 0 12px color-mix(in srgb,var(--c) 55%,transparent)}
.axn .d-core.sm{width:8px;height:8px}
.axn .d-core.breathe{animation:m-breathe var(--d-breathe) ease-in-out infinite}
.axn .d-expand,.axn .d-ripple,.axn .d-trail{position:relative;display:grid;place-items:center;width:44px;height:26px}
.axn .d-expand>*,.axn .d-ripple>*{grid-area:1/1}
.axn .d-expand .ring,.axn .d-ripple .ring{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--c);animation:m-expand var(--d-expand) ease-out infinite}
.axn .d-expand .ring.r2{animation-delay:calc(var(--d-expand) / -2)}
.axn .flowline{animation:m-flow var(--d-flow) linear infinite}
.axn .d-trail{width:56px}
.axn .d-trail .dot{width:9px;height:9px;border-radius:50%;background:var(--c);animation:m-comet var(--d-trail) linear infinite;box-shadow:-6px 0 0 -1px color-mix(in srgb,var(--c) 55%,transparent),-11px 0 0 -2px color-mix(in srgb,var(--c) 32%,transparent),-16px 0 0 -3px color-mix(in srgb,var(--c) 14%,transparent)}

@media (max-width:1120px){ .axn .layout{grid-template-columns:220px minmax(0,1fr)} .axn .toc{display:none} }
@media (max-width:820px){ .axn .layout{grid-template-columns:1fr} .axn .side{display:none} .axn main{padding:30px 18px 90px} .axn .top nav{display:none} .axn .scales-row{grid-template-columns:1fr} }
@media (prefers-reduced-motion:reduce){ .axn *,.axn *::before,.axn *::after{animation:none!important} }
`;
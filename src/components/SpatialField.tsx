"use client";

import { useEffect, useRef } from "react";
import { MOTION } from "../lib/motion";

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


export default SpatialField;

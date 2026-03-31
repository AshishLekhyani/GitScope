"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import gsap from "gsap";

// ── Colour palettes ───────────────────────────────────────────────────────────
// Light: coral bg + near-black owl  (same vibe as the reference bear image)
// Dark : navy  bg + pale-lavender owl
const LIGHT = {
  bg:     "#FF5240",
  owl:    "#1a1a1a",
  acc:    "#2d2d2d",
  socket: "#222222",
  pupil:  "#FF5240",   // pupil = bg colour  →  "floating eye" look
  iris:   "#383838",
  lid:    "#FF5240",
};
const DARK = {
  bg:     "#0b1326",
  owl:    "#dae2fd",
  acc:    "#a5b4fc",
  socket: "#0a1120",
  pupil:  "#0b1326",
  iris:   "#8b9fd4",
  lid:    "#0b1326",
};

export function OwlLoader() {
  const svgRef = useRef<SVGSVGElement>(null);
  const tlRef  = useRef<gsap.core.Timeline | null>(null);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const C = isDark ? DARK : LIGHT;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // ── Clean up any running animation ───────────────────────
    tlRef.current?.kill();
    svg.querySelectorAll("*").forEach(el => gsap.killTweensOf(el));
    gsap.killTweensOf(svg);

    // ── Element refs ─────────────────────────────────────────
    const owlG = svg.querySelector<SVGGElement>("#owl-g")!;
    const lw   = svg.querySelector<SVGPathElement>("#lw")!;
    const rw   = svg.querySelector<SVGPathElement>("#rw")!;
    const mono = svg.querySelector<SVGGElement>("#mono")!;
    const zoom = svg.querySelector<SVGCircleElement>("#zoom")!;
    const eyeG = svg.querySelector<SVGGElement>("#eye-g")!;
    const lid  = svg.querySelector<SVGRectElement>("#lid")!;

    // ── Initial states ────────────────────────────────────────
    gsap.set(owlG, { x: 540, y: 0, scaleX: 1, scaleY: 1 });
    gsap.set([lw, rw], { rotation: 0 });
    gsap.set(mono, { opacity: 0, y: 22 });
    gsap.set(zoom, { attr: { r: 0 } });
    gsap.set(eyeG, { opacity: 0 });
    gsap.set(lid,  { scaleY: 0, transformOrigin: "center top" });

    // ── Main sequenced timeline ───────────────────────────────
    const tl = gsap.timeline();
    tlRef.current = tl;

    // ─ Phase 1: Fly in ────────────────────────────────────────
    tl.to(owlG, { x: 0, duration: 1.3, ease: "power2.out" });

    // Wing beats run concurrently with the fly-in (repeat: 9 = 10 plays,
    // ends at 0° with yoyo on even-numbered last play)
    const lb = gsap.timeline({ repeat: 9, yoyo: true });
    lb.to(lw, {
      rotation: -38,
      transformOrigin: "95% 50%",
      duration: 0.13,
      ease: "power1.inOut",
    });
    const rb = gsap.timeline({ repeat: 9, yoyo: true });
    rb.to(rw, {
      rotation: 38,
      transformOrigin: "5% 50%",
      duration: 0.13,
      ease: "power1.inOut",
    });
    tl.add(lb, 0).add(rb, 0);

    // ─ Phase 2: Land — squash & stretch ───────────────────────
    tl
      .to(lw, { rotation: 0, transformOrigin: "95% 50%", duration: 0.2 })
      .to(rw, { rotation: 0, transformOrigin: "5% 50%",  duration: 0.2 }, "<")
      .to(owlG, {
        scaleY: 0.83,
        scaleX: 1.08,
        transformOrigin: "50% 100%",
        duration: 0.1,
        ease: "power3.in",
      })
      .to(owlG, {
        scaleY: 1,
        scaleX: 1,
        transformOrigin: "50% 100%",
        duration: 0.56,
        ease: "elastic.out(1.1, 0.42)",
      });

    // ─ Phase 3: Monocular raises ──────────────────────────────
    tl.to(mono, {
      opacity: 1,
      y: 0,
      duration: 0.44,
      ease: "back.out(1.7)",
    }, "+=0.48");

    // ─ Phase 4: Zoom into lens ────────────────────────────────
    // Animate GSAP attr.r (SVG attribute) so the circle expands from
    // the monocular objective at (322,162) until it covers the whole SVG.
    // Max distance from (322,162) to any corner of the 400×400 viewport ≈ 400 px.
    tl.to(zoom, {
      attr: { r: 420 },
      duration: 0.88,
      ease: "power3.inOut",
    }, "+=0.78");

    // Eye fades in slightly before zoom finishes (smooth reveal)
    tl.to(eyeG, { opacity: 1, duration: 0.34 }, "-=0.2");

    // ─ Phase 5: Blink loop ────────────────────────────────────
    const blink = gsap.timeline({ repeat: -1, repeatDelay: 2.3 });
    blink
      .to(lid, {
        scaleY: 1,
        transformOrigin: "center top",
        duration: 0.09,
        ease: "power2.in",
      })
      .to(lid, {
        scaleY: 0,
        transformOrigin: "center top",
        duration: 0.16,
        ease: "power1.out",
      });
    tl.add(blink, "+=0.42");

    // Idle float — runs independently after landing
    gsap.to(owlG, {
      y: -9,
      duration: 2.4,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: 2.2,
    });

    return () => {
      tlRef.current?.kill();
      lb.kill();
      rb.kill();
      blink.kill();
      svg.querySelectorAll("*").forEach(el => gsap.killTweensOf(el));
      gsap.killTweensOf(owlG);
    };
  }, [isDark]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: C.bg }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 400 400"
        xmlns="http://www.w3.org/2000/svg"
        className="w-64 h-64 sm:w-80 sm:h-80 lg:w-96 lg:h-96"
        style={{ overflow: "visible" }}
        aria-label="Loading…"
        role="img"
      >
        {/* ═══════════════════════════════════════
            OWL — body+neck+head are same colour,
            rendering as one unified blob shape
            ═══════════════════════════════════════ */}
        <g id="owl-g">

          {/* Wings — placed behind body, rotate from their body-edge */}
          <path
            id="lw"
            d="M 72 228 C 30 198 5 243 18 280 C 28 308 70 312 80 280 Z"
            fill={C.owl}
          />
          <path
            id="rw"
            d="M 328 228 C 370 198 395 243 382 280 C 372 308 330 312 320 280 Z"
            fill={C.owl}
          />

          {/* Body */}
          <ellipse cx="200" cy="278" rx="140" ry="110" fill={C.owl} />
          {/* Neck — bridges body ↔ head */}
          <ellipse cx="200" cy="172" rx="76"  ry="38"  fill={C.owl} />
          {/* Head */}
          <circle  cx="200" cy="128" r="84"            fill={C.owl} />

          {/* Ear tufts — the owl's defining silhouette feature */}
          <polygon points="153,62 135,16 170,53" fill={C.owl} />
          <polygon points="247,62 265,16 230,53" fill={C.owl} />

          {/* Tummy — subtle contrast marking */}
          <ellipse cx="200" cy="298" rx="52" ry="65" fill={C.acc} opacity="0.2" />

          {/* Eye sockets — large circles, classic owl look */}
          <circle cx="172" cy="122" r="30" fill={C.socket} />
          <circle cx="228" cy="122" r="30" fill={C.socket} />

          {/* Pupils — filled with bg colour so they appear to "float" */}
          <circle cx="172" cy="122" r="16" fill={C.pupil} />
          <circle cx="228" cy="122" r="16" fill={C.pupil} />

          {/* Specular highlights */}
          <circle cx="179" cy="114" r="4.5" fill={C.owl} opacity="0.4" />
          <circle cx="235" cy="114" r="4.5" fill={C.owl} opacity="0.4" />

          {/* Beak */}
          <polygon points="200,150 189,170 211,170" fill={C.acc} />

          {/* ── Monocular ────────────────────────────────────────
              Arm curves from body-right up to the eyepiece at (238,162).
              The objective end at (322,162) faces the viewer — this is
              where the lens-zoom circle originates.
              ──────────────────────────────────────────────────── */}
          <g id="mono">
            {/* Wing-tip arm holding the monocular */}
            <path
              d="M 318 265 C 312 228 292 205 268 186 C 256 178 247 170 238 163"
              stroke={C.owl}
              strokeWidth="15"
              strokeLinecap="round"
              fill="none"
            />
            {/* Barrel */}
            <rect x="238" y="150" width="84" height="24" rx="12" fill={C.acc} />
            {/* Eyepiece (wide end, at owl's eye) */}
            <circle cx="238" cy="162" r="19" fill={C.socket} stroke={C.acc} strokeWidth="3.5" />
            <circle cx="238" cy="162" r="11" fill={C.pupil} />
            {/* Objective (narrow end, pointing at viewer) */}
            <circle cx="322" cy="162" r="14" fill={C.socket} stroke={C.acc} strokeWidth="2.5" />
            <circle cx="322" cy="162" r="8"  fill={C.pupil} opacity="0.8" />
          </g>
        </g>

        {/* ═══════════════════════════════════════
            LENS ZOOM
            Starts as a tiny dot at the monocular's
            objective lens (322,162) and expands
            outward until it covers the entire SVG.
            Fill = bg colour → looks like diving into
            the lens and the world fades away.
            ═══════════════════════════════════════ */}
        <circle id="zoom" cx="322" cy="162" r="0" fill={C.bg} />

        {/* ═══════════════════════════════════════
            EYE IN LENS
            Rendered on top of everything.  Fades in
            after the zoom circle has covered the scene.
            ═══════════════════════════════════════ */}
        <g id="eye-g">
          {/* Iris ring */}
          <circle cx="200" cy="200" r="148" fill={C.iris} />
          {/* Pupil */}
          <circle cx="200" cy="200" r="88"  fill={C.socket} />
          {/* Deep-pupil inner glow */}
          <circle cx="200" cy="200" r="48"  fill={C.pupil} opacity="0.12" />
          {/* Specular shine */}
          <circle cx="236" cy="162" r="28"  fill={C.owl}   opacity="0.18" />

          {/* Top eyelid — scaleY: 0→1 sweeps down from top of iris for blink */}
          <rect
            id="lid"
            x="52" y="52"
            width="296" height="296"
            fill={C.lid}
          />
          {/* Bottom lid cap — static curved strip below the iris */}
          <path
            d="M 52 348 Q 200 395 348 348 L 348 420 L 52 420 Z"
            fill={C.lid}
          />
        </g>
      </svg>
    </div>
  );
}

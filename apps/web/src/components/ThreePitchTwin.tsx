"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import type { TimelineBall } from "@/lib/api";
import type { RenderPlayer } from "@/lib/broadcastRenderer";
import type { SetPieceSimState } from "@/components/TacticalTwinCanvas";

interface Props {
  mode: "3d" | "pov";
  players: RenderPlayer[];
  ball: TimelineBall | null;
  fallbackBallXY: [number, number];
  attackGoalX: number;
  teamAHex: string;
  teamBHex: string;
  selectedDefId: number | null;
  ghostDx: number;
  ghostDy: number;
  chainIds: number[];
  setPieceSim: SetPieceSimState | null;
}

/** Build a high-res procedural FIFA 105x68m mowed grass & white-line stadium pitch texture. */
function createPitchTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1050;
  c.height = 680;
  const ctx = c.getContext("2d")!;

  // Mowed alternating grass stripes
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#0f4c2f" : "#125736";
    ctx.fillRect((i * c.width) / 18, 0, c.width / 18 + 1, c.height);
  }
  // Subtle stadium vignette glow at center
  const vig = ctx.createRadialGradient(525, 340, 80, 525, 340, 620);
  vig.addColorStop(0, "rgba(255,255,255,0.06)");
  vig.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, c.width, c.height);

  // Crisp FIFA pitch markings (10px = 1m)
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 1046, 676);
  // Halfway line & center circle
  ctx.beginPath();
  ctx.moveTo(525, 2);
  ctx.lineTo(525, 678);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(525, 340, 91.5, 0, Math.PI * 2);
  ctx.stroke();
  // Penalty & 6-yard boxes
  ctx.strokeRect(2, 138.4, 165, 403.2);
  ctx.strokeRect(1050 - 167, 138.4, 165, 403.2);
  ctx.strokeRect(2, 248.4, 55, 183.2);
  ctx.strokeRect(1050 - 57, 248.4, 55, 183.2);
  // Penalty spots & center spot
  ctx.fillStyle = "#FFFFFF";
  for (const [sx, sy] of [
    [525, 340],
    [110, 340],
    [940, 340],
  ]) {
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Add realistic 3D goalposts + crossbar + translucent net at x = -52.5 or +52.5. */
function buildGoalMesh(xSide: number): THREE.Group {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.5 });
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xe2e8f0,
    wireframe: true,
    transparent: true,
    opacity: 0.22,
  });

  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.44, 10);
  const crossGeo = new THREE.CylinderGeometry(0.08, 0.08, 7.32, 10);
  const p1 = new THREE.Mesh(postGeo, postMat);
  p1.position.set(xSide, 1.22, -3.66);
  const p2 = new THREE.Mesh(postGeo, postMat);
  p2.position.set(xSide, 1.22, 3.66);
  const bar = new THREE.Mesh(crossGeo, postMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(xSide, 2.44, 0);

  const depth = xSide > 0 ? 2.2 : -2.2;
  const netBox = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.44, 7.32, 4, 4, 10), netMat);
  netBox.position.set(xSide + depth * 0.5, 1.22, 0);

  g.add(p1, p2, bar, netBox);
  return g;
}

export default function ThreePitchTwin(props: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef(props);
  stateRef.current = props;

  const orbitRef = useRef({
    yaw: 0,
    pitch: 0.56, // radians (~32 deg)
    dist: 76,
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 440;
    const height = container.clientHeight || 286;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);
    scene.fog = new THREE.FogExp2(0x070b14, 0.0042);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.3, 320);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      return;
    }
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Stadium floodlights
    scene.add(new THREE.AmbientLight(0xdbeafe, 0.72));
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(22, 58, 36);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    scene.add(sun);

    const rim = new THREE.DirectionalLight(0x38bdf8, 0.38);
    rim.position.set(-40, 32, -35);
    scene.add(rim);

    // Stadium apron + FIFA 105x68m pitch mesh (centered at 0,0,0 -> pitch X in [-52.5..+52.5], Z in [-34..+34])
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(130, 92),
      new THREE.MeshStandardMaterial({ color: 0x09111f, roughness: 0.95 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.05;
    scene.add(apron);

    const pitchTex = createPitchTexture();
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(105, 68),
      new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 0.85, metalness: 0.04 })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    scene.add(pitch);

    scene.add(buildGoalMesh(-52.5));
    scene.add(buildGoalMesh(52.5));

    // Dynamic actors group
    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);

    // Reusable geometries
    const bodyGeo = new THREE.CylinderGeometry(0.42, 0.56, 1.48, 14);
    const headGeo = new THREE.SphereGeometry(0.32, 12, 12);
    const ringGeo = new THREE.RingGeometry(0.75, 1.02, 24);
    const ballGeo = new THREE.SphereGeometry(0.45, 16, 16);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x10b981,
      emissiveIntensity: 0.45,
      roughness: 0.2,
    });
    const ballMesh = new THREE.Mesh(ballGeo, ballMat);
    ballMesh.castShadow = true;
    scene.add(ballMesh);

    const ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 })
    );
    ballShadow.rotation.x = -Math.PI / 2;
    ballShadow.position.y = 0.03;
    scene.add(ballShadow);

    // Ghost wireframe pawn
    const ghostGroup = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      wireframe: true,
      transparent: true,
      opacity: 0.78,
    });
    const ghostBody = new THREE.Mesh(bodyGeo, ghostMat);
    ghostBody.position.y = 0.76;
    const ghostHead = new THREE.Mesh(headGeo, ghostMat);
    ghostHead.position.y = 1.72;
    ghostGroup.add(ghostBody, ghostHead);
    ghostGroup.visible = false;
    scene.add(ghostGroup);

    // Set-piece beacon
    const spBeacon = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 2.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
    );
    spBeacon.rotation.x = -Math.PI / 2;
    spBeacon.position.y = 0.07;
    spBeacon.visible = false;
    scene.add(spBeacon);

    const pool = new Map<number, THREE.Group>();

    const getOrCreatePlayerMesh = (tid: number, colorHex: string, isSelected: boolean): THREE.Group => {
      let grp = pool.get(tid);
      if (!grp) {
        grp = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex), roughness: 0.4, metalness: 0.15 });
        const body = new THREE.Mesh(bodyGeo, mat);
        body.position.y = 0.76;
        body.castShadow = true;
        body.name = "body";

        const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5 }));
        head.position.y = 1.72;
        head.castShadow = true;

        const ring = new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({ color: new THREE.Color(colorHex), side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.04;
        ring.name = "ring";

        grp.add(body, head, ring);
        dynamicGroup.add(grp);
        pool.set(tid, grp);
      }
      const body = grp.getObjectByName("body") as THREE.Mesh | undefined;
      const ring = grp.getObjectByName("ring") as THREE.Mesh | undefined;
      const targetColor = new THREE.Color(isSelected ? "#10B981" : colorHex);
      if (body) (body.material as THREE.MeshStandardMaterial).color.copy(targetColor);
      if (ring) {
        (ring.material as THREE.MeshBasicMaterial).color.copy(targetColor);
        ring.scale.setScalar(isSelected ? 1.45 : 1.0);
      }
      return grp;
    };

    let rafId = 0;
    const animate = (now: number) => {
      const st = stateRef.current;
      const bPos = st.ball ? [st.ball.x_m, st.ball.y_m] : st.fallbackBallXY;
      const bz = Math.max(0, st.ball?.z_m ?? 0);

      // Map FIFA pitch [0..105, 0..68] -> Three.js [-52.5..52.5, -34..34]
      const bx3 = bPos[0] - 52.5;
      const bz3 = bPos[1] - 34.0;
      ballMesh.position.set(bx3, 0.45 + bz, bz3);
      ballShadow.position.set(bx3, 0.03, bz3);

      const seen = new Set<number>();
      let povAnchor: RenderPlayer | null = null;
      for (const p of st.players) {
        if (p.role !== "player" && p.role !== "goalkeeper") continue;
        seen.add(p.track_id);
        const col =
          p.role === "goalkeeper" ? "#22D3EE" : p.team === "team_a" ? st.teamAHex : st.teamBHex;
        const isSel = p.track_id === st.selectedDefId;
        const grp = getOrCreatePlayerMesh(p.track_id, col, isSel);
        grp.position.set(p.x_m - 52.5, 0, p.y_m - 34.0);
        grp.visible = true;
        if (isSel) povAnchor = p;
      }
      for (const [tid, grp] of pool.entries()) {
        if (!seen.has(tid)) grp.visible = false;
      }

      // Ghost silhouette in 3D
      if (povAnchor && (st.ghostDx !== 0 || st.ghostDy !== 0)) {
        ghostGroup.visible = true;
        ghostGroup.position.set(
          Math.max(-52.5, Math.min(52.5, povAnchor.x_m + st.ghostDx - 52.5)),
          0,
          Math.max(-34, Math.min(34, povAnchor.y_m + st.ghostDy - 34.0))
        );
      } else {
        ghostGroup.visible = false;
      }

      // Set-piece simulation beacon
      if (st.setPieceSim) {
        spBeacon.visible = true;
        spBeacon.position.set(st.setPieceSim.target_zone_xy[0] - 52.5, 0.08, st.setPieceSim.target_zone_xy[1] - 34.0);
        const pulse = 1 + 0.16 * Math.sin(now * 0.006);
        spBeacon.scale.setScalar(pulse);
      } else {
        spBeacon.visible = false;
      }

      // Camera placement: True 360° Stadium Orbit OR Clean Eye-Level Player-POV Camera
      if (st.mode === "pov") {
        const anchor = povAnchor || st.players.find((p) => p.role === "player") || null;
        if (anchor) {
          // Hide anchor's own 3D mesh so it NEVER blocks the Player-POV camera lens!
          const anchorMesh = pool.get(anchor.track_id);
          if (anchorMesh) anchorMesh.visible = false;
          const ax = anchor.x_m - 52.5;
          const az = anchor.y_m - 34.0;
          const lookX = bx3 * 0.7 + (st.attackGoalX - 52.5) * 0.3;
          const lookZ = bz3 * 0.8;
          // True eye height (1.78m) slightly forward of player's shoulders -> unobstructed 1st-person pitch vision
          camera.position.set(ax, 1.78, az);
          camera.lookAt(lookX, 1.05, lookZ);
        } else {
          camera.position.set(0, 12, 42);
          camera.lookAt(bx3, 1, bz3);
        }
      } else {
        const o = orbitRef.current;
        const cx = Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist;
        const cy = Math.sin(o.pitch) * o.dist;
        const cz = Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist;
        camera.position.set(cx, Math.max(8, cy), cz);
        camera.lookAt(0, 0, 0);
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 440;
      const h = container.clientHeight || 286;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      pitchTex.dispose();
      bodyGeo.dispose();
      headGeo.dispose();
      ringGeo.dispose();
      ballGeo.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      onMouseDown={(e) => {
        orbitRef.current.dragging = true;
        orbitRef.current.lastX = e.clientX;
        orbitRef.current.lastY = e.clientY;
      }}
      onMouseMove={(e) => {
        if (!orbitRef.current.dragging) return;
        const dx = e.clientX - orbitRef.current.lastX;
        const dy = e.clientY - orbitRef.current.lastY;
        orbitRef.current.lastX = e.clientX;
        orbitRef.current.lastY = e.clientY;
        orbitRef.current.yaw -= dx * 0.008;
        orbitRef.current.pitch = Math.max(0.18, Math.min(1.38, orbitRef.current.pitch + dy * 0.006));
      }}
      onMouseUp={() => {
        orbitRef.current.dragging = false;
      }}
      onMouseLeave={() => {
        orbitRef.current.dragging = false;
      }}
      onWheel={(e) => {
        e.preventDefault();
        orbitRef.current.dist = Math.max(28, Math.min(125, orbitRef.current.dist + e.deltaY * 0.04));
      }}
      className="w-full h-[272px] rounded-lg overflow-hidden border border-white/[0.1] cursor-grab active:cursor-grabbing bg-[#070B14]"
    />
  );
}

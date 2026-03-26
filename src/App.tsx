/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, Trophy, Skull, Pause, Settings } from 'lucide-react';

type Color = 'red' | 'green' | 'blue' | 'yellow' | 'purple';

interface DragonBlock {
  id: string;
  color: Color;
  hp: number;
}

interface TurretData {
  id: string;
  color: Color;
  ammo: number;
}

interface ActiveTurret extends TurretData {
  distance: number;
  lastShotTime: number;
}

interface Bullet {
  id: string;
  x: number;
  y: number;
  color: Color;
  targetId: string;
  speed: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

class GameState {
  level: number = 1;
  status: 'playing' | 'won' | 'lost' = 'playing';
  gameTime: number = 0;
  dragonHeadDistance: number = 0;
  dragonBlocks: DragonBlock[] = [];
  turretColumns: TurretData[][] = [[], [], []];
  activeTurrets: ActiveTurret[] = [];
  waitingTurrets: TurretData[] = [];
  bullets: Bullet[] = [];
  particles: Particle[] = [];
}

const CANVAS_WIDTH = 390;
const CANVAS_HEIGHT = 844;
interface MapDef {
  id: string;
  name: string;
  pathPoints: {x: number, y: number}[];
  greenPath: {x: number, y: number}[];
}

const MAPS: MapDef[] = [
  {
    id: 'zigzag',
    name: 'Z字折返',
    pathPoints: [
      { x: 50, y: 100 },
      { x: 340, y: 100 },
      { x: 50, y: 250 },
      { x: 340, y: 250 },
      { x: 50, y: 400 },
      { x: 340, y: 400 },
    ],
    greenPath: [{ x: 50, y: 130 }, { x: 340, y: 430 }]
  },
  {
    id: 'scurve',
    name: 'S型曲线',
    pathPoints: [
      { x: 340, y: 100 },
      { x: 125, y: 100 },
      { x: 87.5, y: 110 },
      { x: 60, y: 137.5 },
      { x: 50, y: 175 },
      { x: 60, y: 212.5 },
      { x: 87.5, y: 240 },
      { x: 125, y: 250 },
      { x: 265, y: 250 },
      { x: 302.5, y: 260 },
      { x: 330, y: 287.5 },
      { x: 340, y: 325 },
      { x: 330, y: 362.5 },
      { x: 302.5, y: 390 },
      { x: 265, y: 400 },
      { x: 50, y: 400 }
    ],
    greenPath: [{ x: 195, y: 130 }, { x: 195, y: 430 }]
  }
];

function getPathSegments(points: {x: number, y: number}[]) {
  return points.slice(1).map((p, i) => {
    const prev = points[i];
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const len = Math.hypot(dx, dy);
    return { dx, dy, len, angle: Math.atan2(dy, dx) };
  });
}

let currentMapDef = MAPS[0];
let PATH_POINTS = currentMapDef.pathPoints;
let PATH_SEGMENTS = getPathSegments(PATH_POINTS);
let TOTAL_PATH_LENGTH = PATH_SEGMENTS.reduce((sum, seg) => sum + seg.len, 0);
let GREEN_PATH = currentMapDef.greenPath;
let GREEN_PATH_LENGTH = Math.hypot(GREEN_PATH[1].x - GREEN_PATH[0].x, GREEN_PATH[1].y - GREEN_PATH[0].y);

export function setGameMap(mapId: string) {
  const map = MAPS.find(m => m.id === mapId) || MAPS[0];
  currentMapDef = map;
  PATH_POINTS = map.pathPoints;
  PATH_SEGMENTS = getPathSegments(PATH_POINTS);
  TOTAL_PATH_LENGTH = PATH_SEGMENTS.reduce((sum, seg) => sum + seg.len, 0);
  GREEN_PATH = map.greenPath;
  GREEN_PATH_LENGTH = Math.hypot(GREEN_PATH[1].x - GREEN_PATH[0].x, GREEN_PATH[1].y - GREEN_PATH[0].y);
}

const COLORS: Record<Color, string> = {
  red: '#ef4444',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#eab308',
  purple: '#a855f7',
};

const BLOCK_SPACING = 32;
const TURRET_SPEED = 120;
const BULLET_SPEED = 500;
const SHOOT_COOLDOWN = 0.25;
const TURRET_RANGE = 250;

function getRedPathPos(d: number) {
  if (d < 0) return { x: PATH_POINTS[0].x, y: PATH_POINTS[0].y, angle: PATH_SEGMENTS[0].angle, visible: false };
  
  let currentD = d;
  for (let i = 0; i < PATH_SEGMENTS.length; i++) {
    const seg = PATH_SEGMENTS[i];
    if (currentD <= seg.len) {
      const ratio = currentD / seg.len;
      return {
        x: PATH_POINTS[i].x + seg.dx * ratio,
        y: PATH_POINTS[i].y + seg.dy * ratio,
        angle: seg.angle,
        visible: true
      };
    }
    currentD -= seg.len;
  }
  
  const last = PATH_POINTS[PATH_POINTS.length - 1];
  return { x: last.x, y: last.y, angle: PATH_SEGMENTS[PATH_SEGMENTS.length - 1].angle, visible: true };
}

function getGreenPathPos(d: number) {
  const ratio = Math.min(Math.max(d / GREEN_PATH_LENGTH, 0), 1);
  return {
    x: GREEN_PATH[0].x + (GREEN_PATH[1].x - GREEN_PATH[0].x) * ratio,
    y: GREEN_PATH[0].y + (GREEN_PATH[1].y - GREEN_PATH[0].y) * ratio
  };
}

function initLevel(level: number, config?: { length: number, numColors: number, nodeHp?: number, ammoPerTurret?: number }, gameMode: 'classic' | 'numbered' | 'segmented' = 'classic') {
  const numBlocks = config ? config.length : 15 + level * 5;
  const numColors = config ? config.numColors : Math.min(2 + Math.floor(level / 2), 5);
  const nodeHp = gameMode === 'segmented' ? 6 : (config?.nodeHp || 6);
  const ammoPerTurret = config?.ammoPerTurret || 0;

  const colors: Color[] = ['red', 'green', 'blue', 'yellow', 'purple'];
  const levelColors = colors.slice(0, numColors);
  
  const blocks: DragonBlock[] = [];
  const colorCounts: Record<string, number> = {};
  
  // Calculate total blocks per color to ensure ammo is balanced
  for (let i = 0; i < numBlocks; i++) {
    const color = levelColors[i % levelColors.length];
    colorCounts[color] = (colorCounts[color] || 0) + 1;
  }
  
  if (gameMode === 'numbered' || gameMode === 'segmented') {
    const groupSize = nodeHp;
    for (const color of levelColors) {
      const count = colorCounts[color] || 0;
      const numGroups = Math.ceil(count / groupSize);
      for (let i = 0; i < numGroups; i++) {
        const hp = (i === numGroups - 1 && count % groupSize !== 0) ? count % groupSize : groupSize;
        blocks.push({ id: `block-${color}-${i}-${Math.random()}`, color, hp });
      }
    }
  } else {
    for (let i = 0; i < numBlocks; i++) {
      const color = levelColors[i % levelColors.length];
      blocks.push({ id: `block-${i}-${Math.random()}`, color, hp: 10 });
    }
  }
  
  blocks.sort(() => Math.random() - 0.5);
  
  const turrets: TurretData[] = [];
  for (const color of levelColors) {
    const count = colorCounts[color] || 0;
    
    // Add a small buffer of 3 extra bullets per color for missed shots
    let remaining = count + 3; 
    
    while (remaining > 0) {
      // Max 20 ammo per turret to keep them rotating, unless overridden
      let currentAmmo = ammoPerTurret > 0 ? ammoPerTurret : Math.min(remaining, 20);
      turrets.push({ id: `turret-${color}-${Math.random()}`, color, ammo: currentAmmo });
      remaining -= currentAmmo;
    }
  }
  
  turrets.sort(() => Math.random() - 0.5);
  
  const columns: TurretData[][] = [[], [], []];
  turrets.forEach((t, i) => columns[i % 3].push(t));
  
  return { blocks, columns };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateRef = useRef<GameState>(new GameState());
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [level, setLevel] = useState(1);
  
  const [isPaused, setIsPaused] = useState(false);
  const [dragonSpeedMult, setDragonSpeedMult] = useState(1);
  const [turretSpeedMult, setTurretSpeedMult] = useState(1);
  const [turretShootSpeedMult, setTurretShootSpeedMult] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [useCustomConfig, setUseCustomConfig] = useState(false);
  const [gameMode, setGameMode] = useState<'classic' | 'numbered' | 'segmented'>('classic');
  const [mapId, setMapId] = useState<string>(MAPS[0].id);
  const [levelConfig, setLevelConfig] = useState({
    length: 20,
    numColors: 3,
    nodeHp: 6,
    ammoPerTurret: 0
  });

  const requestRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  const isPausedRef = useRef(false);
  const dragonSpeedMultRef = useRef(1);
  const turretSpeedMultRef = useRef(1);
  const turretShootSpeedMultRef = useRef(1);
  const gameModeRef = useRef<'classic' | 'numbered' | 'segmented'>('classic');
  const mapIdRef = useRef<string>(MAPS[0].id);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    dragonSpeedMultRef.current = dragonSpeedMult;
  }, [dragonSpeedMult]);

  useEffect(() => {
    turretSpeedMultRef.current = turretSpeedMult;
  }, [turretSpeedMult]);

  useEffect(() => {
    turretShootSpeedMultRef.current = turretShootSpeedMult;
  }, [turretShootSpeedMult]);

  useEffect(() => {
    gameModeRef.current = gameMode;
  }, [gameMode]);

  useEffect(() => {
    mapIdRef.current = mapId;
  }, [mapId]);

  useEffect(() => {
    startLevel(level, useCustomConfig ? levelConfig : undefined, gameMode, mapId);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [level]);

  const startLevel = (lvl: number, config?: any, mode = gameMode, mId = mapId) => {
    setGameMap(mId);
    const { blocks, columns } = initLevel(lvl, config, mode);
    const state = new GameState();
    state.level = lvl;
    state.dragonBlocks = blocks;
    state.turretColumns = columns;
    gameStateRef.current = state;
    setStatus('playing');
    setIsPaused(false);
    lastTimeRef.current = performance.now();
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  const gameLoop = (time: number) => {
    const state = gameStateRef.current;
    if (isPausedRef.current || state.status !== 'playing') {
      lastTimeRef.current = time;
      requestRef.current = requestAnimationFrame(gameLoop);
      return;
    }
    
    const rawDt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
    lastTimeRef.current = time;
    
    const dragonDt = rawDt * dragonSpeedMultRef.current;
    const turretDt = rawDt * turretSpeedMultRef.current;

    state.gameTime += rawDt;
    const timeSec = state.gameTime;

    // Update Dragon
    const currentDragonSpeed = 30 + state.level * 5;
    state.dragonHeadDistance += currentDragonSpeed * dragonDt;
    
    if (state.dragonHeadDistance > TOTAL_PATH_LENGTH) {
      state.status = 'lost';
      setStatus('lost');
      return;
    }
    
    if (state.dragonBlocks.length === 0) {
      state.status = 'won';
      setStatus('won');
      return;
    }

    // Check if stuck (no turrets left and dragon alive)
    if (state.turretColumns.every(c => c.length === 0) && 
        state.activeTurrets.length === 0 && 
        state.waitingTurrets.length === 0 &&
        state.bullets.length === 0) {
      state.status = 'lost';
      setStatus('lost');
      return;
    }

    // Update Active Turrets
    for (let i = state.activeTurrets.length - 1; i >= 0; i--) {
      const turret = state.activeTurrets[i];
      turret.distance += TURRET_SPEED * turretDt;
      
      if (turret.distance > GREEN_PATH_LENGTH) {
        if (state.waitingTurrets.length < 5) {
          state.waitingTurrets.push({
            id: turret.id,
            color: turret.color,
            ammo: turret.ammo
          });
          state.activeTurrets.splice(i, 1);
        } else {
          // Waiting area is full! Game over.
          state.status = 'lost';
          setStatus('lost');
          return;
        }
        continue;
      }
      
      // Shooting
      if (turret.ammo > 0 && timeSec - turret.lastShotTime > SHOOT_COOLDOWN / turretShootSpeedMultRef.current) {
        const tPos = getGreenPathPos(turret.distance);
        let bestTarget = null;
        let minDst = TURRET_RANGE;
        
        for (let j = 0; j < state.dragonBlocks.length; j++) {
          const block = state.dragonBlocks[j];
          if (block.color !== turret.color) continue;
          
          const bDist = state.dragonHeadDistance - j * BLOCK_SPACING;
          if (bDist < 0) continue;
          
          const bPos = getRedPathPos(bDist);
          const dst = Math.hypot(bPos.x - tPos.x, bPos.y - tPos.y);
          if (dst < minDst) {
            minDst = dst;
            bestTarget = block;
          }
        }
        
        if (bestTarget) {
          state.bullets.push({
            id: `bullet-${Math.random()}`,
            x: tPos.x,
            y: tPos.y,
            color: turret.color,
            targetId: bestTarget.id,
            speed: BULLET_SPEED
          });
          turret.ammo--;
          turret.lastShotTime = timeSec;
          
          if (turret.ammo <= 0) {
            // Remove turret immediately when ammo is depleted
            state.activeTurrets.splice(i, 1);
            
            // Spawn particles for turret disappearance
            for (let p = 0; p < 10; p++) {
              state.particles.push({
                x: tPos.x,
                y: tPos.y,
                vx: (Math.random() - 0.5) * 150,
                vy: (Math.random() - 0.5) * 150,
                life: 0.8,
                maxLife: 0.8,
                color: '#ffffff' // White puff of smoke/energy
              });
            }
          }
        }
      }
    }

    // Update Bullets
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const bullet = state.bullets[i];
      const targetIdx = state.dragonBlocks.findIndex(b => b.id === bullet.targetId);
      
      if (targetIdx === -1) {
        state.bullets.splice(i, 1);
        continue;
      }
      
      const bDist = state.dragonHeadDistance - targetIdx * BLOCK_SPACING;
      const targetPos = getRedPathPos(bDist);
      
      const dx = targetPos.x - bullet.x;
      const dy = targetPos.y - bullet.y;
      const dist = Math.hypot(dx, dy);
      
      if (dist < 20) {
        const damage = gameModeRef.current !== 'classic' ? 1 : 10;
        state.dragonBlocks[targetIdx].hp -= damage;
        if (state.dragonBlocks[targetIdx].hp <= 0) {
          // Spawn particles
          for (let p = 0; p < 15; p++) {
            state.particles.push({
              x: targetPos.x,
              y: targetPos.y,
              vx: (Math.random() - 0.5) * 300,
              vy: (Math.random() - 0.5) * 300,
              life: 0.3 + Math.random() * 0.4,
              maxLife: 0.7,
              color: COLORS[state.dragonBlocks[targetIdx].color]
            });
          }
          state.dragonBlocks.splice(targetIdx, 1);
          state.dragonHeadDistance -= BLOCK_SPACING; // Shrink!
        } else if (gameModeRef.current !== 'classic') {
          // Spawn small particles for hit
          for (let p = 0; p < 5; p++) {
            state.particles.push({
              x: targetPos.x,
              y: targetPos.y,
              vx: (Math.random() - 0.5) * 150,
              vy: (Math.random() - 0.5) * 150,
              life: 0.2,
              maxLife: 0.2,
              color: COLORS[state.dragonBlocks[targetIdx].color]
            });
          }
        }
        state.bullets.splice(i, 1);
      } else {
        bullet.x += (dx / dist) * bullet.speed * turretDt;
        bullet.y += (dy / dist) * bullet.speed * turretDt;
      }
    }

    // Update Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * rawDt;
      p.y += p.vy * rawDt;
      p.life -= rawDt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
      }
    }

    draw(state);
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  const draw = (state: GameState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Background pattern
    ctx.fillStyle = '#dcfce7'; // green-100
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#bbf7d0'; // green-200
    for(let i=0; i<CANVAS_WIDTH; i+=40) {
      for(let j=0; j<CANVAS_HEIGHT; j+=40) {
        if ((i+j)%80 === 0) ctx.fillRect(i, j, 40, 40);
      }
    }

    // Draw Red Path (Dragon Path)
    ctx.strokeStyle = '#fecaca'; // red-200
    ctx.lineWidth = 36;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
    for (let i = 1; i < PATH_POINTS.length; i++) {
      ctx.lineTo(PATH_POINTS[i].x, PATH_POINTS[i].y);
    }
    ctx.stroke();

    // Draw Green Path (Turret Path)
    ctx.strokeStyle = '#86efac'; // green-300
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(GREEN_PATH[0].x, GREEN_PATH[0].y);
    ctx.lineTo(GREEN_PATH[1].x, GREEN_PATH[1].y);
    ctx.stroke();

    // Draw Teleport Nodes
    ctx.fillStyle = '#22c55e';
    [GREEN_PATH[0], GREEN_PATH[1]].forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.stroke();
    });

    // Draw Dragon Tail
    if (state.dragonBlocks.length > 0) {
      const tailD = state.dragonHeadDistance - state.dragonBlocks.length * BLOCK_SPACING + 6;
      if (tailD >= 0) {
        const pos = getRedPathPos(tailD);
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(pos.angle);
        
        ctx.fillStyle = '#334155'; // Fixed color for tail
        ctx.beginPath();
        ctx.moveTo(-20, 0); // Pointing backwards
        ctx.lineTo(10, -12);
        ctx.lineTo(10, 12);
        ctx.closePath();
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.restore();
      }
    }

    // Draw Dragon
    for (let i = state.dragonBlocks.length - 1; i >= 0; i--) {
      const block = state.dragonBlocks[i];
      const d = state.dragonHeadDistance - i * BLOCK_SPACING;
      if (d < 0) continue;
      
      const pos = getRedPathPos(d);
      
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(pos.angle);
      
      ctx.fillStyle = COLORS[block.color];
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(-16, -16, 32, 32, 8);
      } else {
        ctx.rect(-16, -16, 32, 32);
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      if (gameModeRef.current === 'segmented') {
        // Draw 6 small blocks based on HP
        const SEGMENTS_3X2 = [
          { x: -15, y: -15, w: 9, h: 13 },
          { x: -4, y: -15, w: 9, h: 13 },
          { x: 7, y: -15, w: 9, h: 13 },
          { x: -15, y: 1, w: 9, h: 13 },
          { x: -4, y: 1, w: 9, h: 13 },
          { x: 7, y: 1, w: 9, h: 13 }
        ];
        
        // Draw a dark background for the missing segments to show they are gone
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(-16, -16, 32, 32, 8);
        } else {
          ctx.rect(-16, -16, 32, 32);
        }
        ctx.fill();
        
        ctx.fillStyle = COLORS[block.color];
        const hp = Math.min(block.hp, 6);
        for (let j = 0; j < hp; j++) {
          const seg = SEGMENTS_3X2[j];
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(seg.x, seg.y, seg.w, seg.h, 2);
          } else {
            ctx.rect(seg.x, seg.y, seg.w, seg.h);
          }
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else {
        // Inner highlight
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(-12, -12, 24, 12, 4);
        } else {
          ctx.rect(-12, -12, 24, 12);
        }
        ctx.fill();
        
        if (gameModeRef.current === 'numbered') {
          ctx.rotate(-pos.angle); // Undo rotation so text is upright
          ctx.fillStyle = 'white';
          ctx.font = 'bold 18px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // Add a subtle shadow to make the text pop
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 4;
          ctx.shadowOffsetX = 1;
          ctx.shadowOffsetY = 1;
          ctx.fillText(block.hp.toString(), 0, 0);
          // Reset shadow
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        }
      }
      
      ctx.restore();
    }

    // Draw Dragon Head
    if (state.dragonBlocks.length > 0) {
      const headD = state.dragonHeadDistance + 26; // Slightly ahead
      if (headD >= 0) {
        const pos = getRedPathPos(headD);
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(pos.angle);
        
        ctx.fillStyle = '#334155'; // Fixed color for head
        ctx.beginPath();
        ctx.moveTo(20, 0);
        ctx.lineTo(-10, -16);
        ctx.lineTo(-10, 16);
        ctx.closePath();
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(4, -8, 5, 0, Math.PI*2);
        ctx.arc(4, 8, 5, 0, Math.PI*2);
        ctx.fill();
        
        // Pupils
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(6, -8, 2.5, 0, Math.PI*2);
        ctx.arc(6, 8, 2.5, 0, Math.PI*2);
        ctx.fill();
        
        ctx.restore();
      }
    }

    // Draw Active Turrets
    state.activeTurrets.forEach(t => {
      const pos = getGreenPathPos(t.distance);
      ctx.fillStyle = COLORS[t.color];
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.ammo.toString(), pos.x, pos.y);
    });

    // Draw Bullets
    state.bullets.forEach(b => {
      ctx.fillStyle = COLORS[b.color];
      ctx.beginPath();
      ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Draw Particles
    state.particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 * (p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Draw Waiting Area
    ctx.fillStyle = '#e5e7eb';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(20, 480, 350, 90, 12);
    } else {
      ctx.rect(20, 480, 350, 90);
    }
    ctx.fill();
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#6b7280';
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WAITING AREA (MAX 5)', 195, 505);

    for (let i = 0; i < 5; i++) {
      const cx = 55 + i * 70;
      const cy = 535;
      
      // Slot background
      ctx.fillStyle = '#f3f4f6';
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      if (i < state.waitingTurrets.length) {
        const t = state.waitingTurrets[i];
        ctx.fillStyle = COLORS[t.color];
        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.ammo.toString(), cx, cy);
      }
    }

    // Draw Turret Queue Area
    ctx.fillStyle = '#f3f4f6'; // gray-100
    ctx.fillRect(0, 590, CANVAS_WIDTH, 254);
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 590);
    ctx.lineTo(CANVAS_WIDTH, 590);
    ctx.stroke();

    const colXs = [85, 195, 305];
    state.turretColumns.forEach((col, cIdx) => {
      const cx = colXs[cIdx];
      
      // Column background
      ctx.fillStyle = '#e5e7eb';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(cx - 36, 610, 72, 180, 12);
      } else {
        ctx.rect(cx - 36, 610, 72, 180);
      }
      ctx.fill();
      
      col.forEach((t, rIdx) => {
        if (rIdx > 2) return; // Only draw top 3
        
        const cy = 650 + rIdx * 56;
        
        ctx.fillStyle = COLORS[t.color];
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(cx - 28, cy - 24, 56, 48, 12);
        } else {
          ctx.rect(cx - 28, cy - 24, 56, 48);
        }
        ctx.fill();
        
        // Inner detail
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(cx - 20, cy - 16, 40, 16, 6);
        } else {
          ctx.rect(cx - 20, cy - 16, 40, 16);
        }
        ctx.fill();
        
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t.ammo.toString(), cx, cy);
        
        // Highlight front turret
        if (rIdx === 0) {
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 4;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(cx - 34, cy - 30, 68, 60, 16);
          } else {
            ctx.rect(cx - 34, cy - 30, 68, 60);
          }
          ctx.stroke();
          
          // "Click" hint
          ctx.fillStyle = '#10b981';
          ctx.font = 'bold 14px Inter, sans-serif';
          ctx.fillText('DEPLOY', cx, cy - 42);
        }
      });
      
      if (col.length > 3) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = 'bold 16px Inter, sans-serif';
        ctx.fillText(`+${col.length - 3}`, cx, 780);
      }
    });
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (status !== 'playing') return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const state = gameStateRef.current;
    
    // Check waiting area clicks
    for (let i = 0; i < state.waitingTurrets.length; i++) {
      const cx = 55 + i * 70;
      const cy = 535;
      if (Math.hypot(x - cx, y - cy) <= 24) {
        const turret = state.waitingTurrets.splice(i, 1)[0];
        state.activeTurrets.push({
          ...turret,
          distance: 0,
          lastShotTime: 0
        });
        return; // Handled
      }
    }

    const colXs = [85, 195, 305];
    colXs.forEach((cx, cIdx) => {
      const col = state.turretColumns[cIdx];
      if (col.length > 0) {
        const cy = 650; // Front turret is always at y=650
        if (x >= cx - 34 && x <= cx + 34 && y >= cy - 30 && y <= cy + 30) {
          const turret = col.shift()!;
          state.activeTurrets.push({
            ...turret,
            distance: 0,
            lastShotTime: 0
          });
        }
      }
    });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 font-sans p-2 sm:p-4">
      <div className="relative shadow-2xl rounded-2xl overflow-hidden bg-green-100 w-full max-w-[390px]" style={{ aspectRatio: '390/844' }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onClick={handleCanvasClick}
          className="w-full h-full cursor-pointer touch-none object-contain"
        />
        
        {status === 'won' && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center backdrop-blur-sm z-10">
            <Trophy className="w-20 h-20 text-yellow-400 mb-4" />
            <h2 className="text-4xl font-black text-white mb-8 drop-shadow-lg text-center px-4">第 {level} 关 通关！</h2>
            <button 
              onClick={() => setLevel(l => l + 1)}
              className="flex items-center gap-2 px-8 py-4 bg-green-500 text-white rounded-full text-2xl font-bold hover:bg-green-400 transition transform hover:scale-105 shadow-lg"
            >
              <Play className="w-6 h-6 fill-current" />
              下一关
            </button>
          </div>
        )}

        {status === 'lost' && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center backdrop-blur-sm z-10">
            <Skull className="w-20 h-20 text-red-500 mb-4" />
            <h2 className="text-4xl font-black text-red-500 mb-8 drop-shadow-lg text-center px-4">游戏结束</h2>
            <button 
              onClick={() => startLevel(level, useCustomConfig ? levelConfig : undefined, gameMode)}
              className="flex items-center gap-2 px-8 py-4 bg-blue-500 text-white rounded-full text-2xl font-bold hover:bg-blue-400 transition transform hover:scale-105 shadow-lg"
            >
              <RotateCcw className="w-6 h-6" />
              重试
            </button>
          </div>
        )}
        
        <div className="absolute top-4 left-4 bg-white/90 px-4 py-2 rounded-lg font-bold text-xl text-neutral-800 shadow-md flex items-center gap-2 z-20">
          <span className="text-green-600">关卡</span>
          <span className="bg-green-100 px-2 py-1 rounded text-green-800">{level}</span>
        </div>

        <div className="absolute top-4 right-4 flex gap-2 z-20">
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center shadow-md text-neutral-800 hover:bg-white transition"
          >
            {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
          </button>
          <button 
            onClick={() => {
              setIsPaused(true);
              setShowSettings(true);
            }}
            className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center shadow-md text-neutral-800 hover:bg-white transition"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        {showSettings && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm z-50 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
              <h2 className="text-2xl font-bold mb-4 text-neutral-800">游戏设置</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-neutral-600 mb-1">龙移动速度 ({dragonSpeedMult}x)</label>
                  <input 
                    type="range" min="0.5" max="3" step="0.5" 
                    value={dragonSpeedMult} 
                    onChange={e => setDragonSpeedMult(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-bold text-neutral-600 mb-1">炮塔移动速度 ({turretSpeedMult}x)</label>
                  <input 
                    type="range" min="0.5" max="3" step="0.5" 
                    value={turretSpeedMult} 
                    onChange={e => setTurretSpeedMult(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-neutral-600 mb-1">炮塔射击速度 ({turretShootSpeedMult}x)</label>
                  <input 
                    type="range" min="0.5" max="5" step="0.5" 
                    value={turretShootSpeedMult} 
                    onChange={e => setTurretShootSpeedMult(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                
                <div className="border-t pt-4">
                  <h3 className="font-bold text-neutral-800 mb-2">选择地图</h3>
                  <div className="flex flex-col gap-2 mb-4">
                    {MAPS.map(map => (
                      <button 
                        key={map.id}
                        onClick={() => {
                          setMapId(map.id);
                          setUseCustomConfig(true);
                          startLevel(level, levelConfig, gameMode, map.id);
                        }}
                        className={`px-3 py-2 rounded font-bold text-sm text-left ${mapId === map.id ? 'bg-teal-500 text-white' : 'bg-neutral-200 text-neutral-700'}`}
                      >
                        {map.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-bold text-neutral-800 mb-2">游戏模式</h3>
                  <div className="flex flex-col gap-2 mb-4">
                    <button 
                      onClick={() => {
                        setGameMode('classic');
                        setUseCustomConfig(true);
                        startLevel(level, levelConfig, 'classic');
                      }}
                      className={`px-3 py-2 rounded font-bold text-sm text-left ${gameMode === 'classic' ? 'bg-blue-500 text-white' : 'bg-neutral-200 text-neutral-700'}`}
                    >
                      经典模式 (一击必杀)
                    </button>
                    <button 
                      onClick={() => {
                        setGameMode('numbered');
                        setUseCustomConfig(true);
                        startLevel(level, levelConfig, 'numbered');
                      }}
                      className={`px-3 py-2 rounded font-bold text-sm text-left ${gameMode === 'numbered' ? 'bg-purple-500 text-white' : 'bg-neutral-200 text-neutral-700'}`}
                    >
                      数字模式 (多次打击，显示数字)
                    </button>
                    <button 
                      onClick={() => {
                        setGameMode('segmented');
                        setUseCustomConfig(true);
                        startLevel(level, levelConfig, 'segmented');
                      }}
                      className={`px-3 py-2 rounded font-bold text-sm text-left ${gameMode === 'segmented' ? 'bg-orange-500 text-white' : 'bg-neutral-200 text-neutral-700'}`}
                    >
                      拼接模式 (6个小色块，每次打掉1个)
                    </button>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-bold text-neutral-800 mb-2">自定义关卡配置</h3>
                  
                  <label className="block text-sm font-bold text-neutral-600 mb-1">龙的长度 ({levelConfig.length})</label>
                  <input 
                    type="range" min="10" max="400" step="5" 
                    value={levelConfig.length} 
                    onChange={e => setLevelConfig({...levelConfig, length: parseInt(e.target.value)})}
                    className="w-full mb-2"
                  />
                  
                  <label className="block text-sm font-bold text-neutral-600 mb-1">颜色种类 ({levelConfig.numColors})</label>
                  <input 
                    type="range" min="1" max="5" step="1" 
                    value={levelConfig.numColors} 
                    onChange={e => setLevelConfig({...levelConfig, numColors: parseInt(e.target.value)})}
                    className="w-full mb-2"
                  />

                  {gameMode === 'numbered' && (
                    <>
                      <label className="block text-sm font-bold text-neutral-600 mb-1">每个节点的生命值 ({levelConfig.nodeHp})</label>
                      <input 
                        type="range" min="1" max="20" step="1" 
                        value={levelConfig.nodeHp} 
                        onChange={e => setLevelConfig({...levelConfig, nodeHp: parseInt(e.target.value)})}
                        className="w-full mb-2"
                      />
                    </>
                  )}

                  <label className="block text-sm font-bold text-neutral-600 mb-1">每个炮塔的子弹数 ({levelConfig.ammoPerTurret === 0 ? '自动分配' : levelConfig.ammoPerTurret})</label>
                  <input 
                    type="range" min="0" max="50" step="1" 
                    value={levelConfig.ammoPerTurret} 
                    onChange={e => setLevelConfig({...levelConfig, ammoPerTurret: parseInt(e.target.value)})}
                    className="w-full mb-4"
                  />
                  
                  <button 
                    onClick={() => {
                      setUseCustomConfig(true);
                      setShowSettings(false);
                      startLevel(level, levelConfig);
                    }}
                    className="w-full py-3 bg-green-500 text-white rounded-xl font-bold text-lg hover:bg-green-400 transition"
                  >
                    应用并重新开始
                  </button>

                  <button 
                    onClick={() => {
                      const testConfig = { length: 360, numColors: 3, nodeHp: 6, ammoPerTurret: 48 };
                      setLevelConfig(testConfig);
                      setGameMode('numbered');
                      setUseCustomConfig(true);
                      setShowSettings(false);
                      startLevel(level, testConfig, 'numbered');
                    }}
                    className="mt-2 w-full py-2 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-500 transition"
                  >
                    测试功能 (60节点/3色/48弹)
                  </button>

                  {useCustomConfig && (
                    <button 
                      onClick={() => {
                        setUseCustomConfig(false);
                        setShowSettings(false);
                        startLevel(level);
                      }}
                      className="mt-2 w-full py-2 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-400 transition"
                    >
                      恢复默认
                    </button>
                  )}
                </div>
              </div>
              
              <button 
                onClick={() => {
                  setShowSettings(false);
                  setIsPaused(false);
                }}
                className="mt-4 w-full py-2 bg-neutral-200 text-neutral-700 rounded-xl font-bold hover:bg-neutral-300 transition"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
      
      <div className="mt-8 text-neutral-400 text-center max-w-lg">
        <p className="mb-2">点击最前方的炮塔进行部署。</p>
        <p>炮塔会自动射击相同颜色的色块。在龙到达终点前摧毁所有色块！</p>
      </div>
    </div>
  );
}


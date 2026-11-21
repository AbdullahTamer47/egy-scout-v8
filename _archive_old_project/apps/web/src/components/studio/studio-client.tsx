"use client";

import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { MatchVideo, TaggedEvent, Player, store } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Film, 
  Play, 
  Pause, 
  Check, 
  X, 
  Scissors, 
  Sparkles, 
  Upload, 
  Link as LinkIcon, 
  Clock, 
  Tag, 
  Target,
  Sliders,
  AlertCircle,
  Volume2,
  VolumeX,
  RotateCcw,
  FastForward,
  FolderOpen,
  Camera,
  Maximize2,
  Repeat,
  Tv,
  CheckCircle2,
  ArrowUpRight,
  MousePointer,
  Trash2,
  Undo2,
  PenTool,
  Square,
  Move,
  Download,
  Share2,
  ChevronRight,
  Filter,
  CheckSquare,
  Layers,
  Zap,
  Crosshair,
  Eye,
  EyeOff
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StudioClientProps {
  initialMatches: MatchVideo[];
  initialEvents: TaggedEvent[];
  players: Player[];
}

export function StudioClient({ initialMatches, initialEvents, players }: StudioClientProps) {
  const searchParams = useSearchParams();
  const matchIdParam = searchParams.get('matchId');

  const [matches, setMatches] = useState<MatchVideo[]>(initialMatches);
  const [events, setEvents] = useState<TaggedEvent[]>(initialEvents);
  
  // Find initial match from URL param if available
  const initialMatch = (matchIdParam ? initialMatches.find(m => m.id === matchIdParam) : null) || initialMatches[0];
  const [selectedMatch, setSelectedMatch] = useState<MatchVideo>(initialMatch);

  // Real HTML5 Video State & Ref
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [videoSrc, setVideoSrc] = useState<string>(initialMatch?.videoUrl || "/videos/match-broadcast.mp4");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(initialMatch?.durationSeconds || 230);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Advanced Telestration Overlay Controls
  const [activeTool, setActiveTool] = useState<'none' | 'spotlight' | 'arrow' | 'pen' | 'zone'>('spotlight');
  const [showSpotlight, setShowSpotlight] = useState<boolean>(true);
  const [showArrow, setShowArrow] = useState<boolean>(true);
  const [isAutoTracking, setIsAutoTracking] = useState<boolean>(false);
  const [autoPauseOnDraw, setAutoPauseOnDraw] = useState<boolean>(true);
  
  // Color palette for tactical drawings
  const [toolColor, setToolColor] = useState<'cyan' | 'emerald' | 'amber' | 'rose'>('cyan');
  const [spotlightSize, setSpotlightSize] = useState<'sm' | 'md' | 'lg'>('md');
  const [spotlightPos, setSpotlightPos] = useState<{ x: number; y: number }>({ x: 44, y: 56 });
  const [isDraggingSpotlight, setIsDraggingSpotlight] = useState<boolean>(false);
  const [pendingArrowOrigin, setPendingArrowOrigin] = useState<{ x: number; y: number } | null>(null);
  const [arrowStyle, setArrowStyle] = useState<'solid' | 'dashed'>('solid');

  // History tracking for Undo
  const [drawHistory, setDrawHistory] = useState<Array<'arrow' | 'pen' | 'zone'>>(['arrow']);

  // Tactical Arrows
  const [arrows, setArrows] = useState<Array<{
    id: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color: string;
    label?: string;
    style?: 'solid' | 'dashed';
  }>>([
    {
      id: 'arr_1',
      startX: 44,
      startY: 56,
      endX: 68,
      endY: 42,
      color: '#06B6D4',
      label: 'مسار التمرير',
      style: 'solid'
    }
  ]);
  const [drawingArrow, setDrawingArrow] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  // Freehand Pen Drawings
  const [penPaths, setPenPaths] = useState<Array<{
    id: string;
    points: Array<{ x: number; y: number }>;
    color: string;
  }>>([]);
  const [currentPenPath, setCurrentPenPath] = useState<Array<{ x: number; y: number }> | null>(null);

  // Tactical Space Zones
  const [zones, setZones] = useState<Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
  }>>([]);
  const [drawingZone, setDrawingZone] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);

  // Snapshot Export Modal
  const [snapshotModalUrl, setSnapshotModalUrl] = useState<string | null>(null);

  // Ingestion Input State
  const [videoUrlInput, setVideoUrlInput] = useState<string>('');
  const [isIngesting, setIsIngesting] = useState<boolean>(false);
  const [ingestProgress, setIngestProgress] = useState<number>(0);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>(players[0]?.id || '');
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);

  // Local Match Clips Gallery for the selected match
  const [matchClips, setMatchClips] = useState<Array<{
    id: string;
    title: string;
    timestamp: number;
    minute: string;
    playerName: string;
    type: string;
  }>>([
    {
      id: 'clip_m1_1',
      title: 'انفراد وصناعة هدف (ديربي المحلة)',
      timestamp: 32.0,
      minute: "28'",
      playerName: 'إبراهيم عادل السيد',
      type: 'progressive_pass'
    },
    {
      id: 'clip_m1_2',
      title: 'افتكاك وضغط عكسي وسط الملعب',
      timestamp: 78.0,
      minute: "54'",
      playerName: 'مروان فايد حجازي',
      type: 'tackle'
    },
    {
      id: 'clip_m1_3',
      title: 'اختراق منطقة الجزاء وتسجيل هدف',
      timestamp: 144.0,
      minute: "76'",
      playerName: 'بلال مظهر عبد القادر',
      type: 'box_entry'
    }
  ]);

  // Synchronize with matchId URL query param changes
  useEffect(() => {
    if (matchIdParam) {
      const found = matches.find(m => m.id === matchIdParam);
      if (found && found.id !== selectedMatch.id) {
        handleSwitchMatch(found.id);
      }
    }
  }, [matchIdParam, matches]);

  // Notice helper for micro-interactions
  const triggerNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 2500);
  };

  // Global pointer up listener to prevent dragging getting stuck
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      setIsDraggingSpotlight(false);
    };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
  }, []);

  // Quick Action: Add offensive tactical arrow immediately
  const addQuickArrow = () => {
    const startX = spotlightPos.x;
    const startY = spotlightPos.y;
    const endX = Math.min(92, Math.max(8, startX + 20));
    const endY = Math.min(92, Math.max(8, startY - 12));
    setArrows(prev => [
      ...prev,
      {
        id: `arr_${Date.now()}`,
        startX,
        startY,
        endX,
        endY,
        color: getColorHex(toolColor),
        label: 'سهم تحرك هجومي',
        style: arrowStyle
      }
    ]);
    setShowArrow(true);
    setDrawHistory(prev => [...prev, 'arrow']);
    triggerNotice('⚡ تم رسم سهم تحرك هجومي فوري');
  };

  // Quick Action: Center spotlight on pitch
  const centerSpotlightOnPlayer = () => {
    setSpotlightPos({ x: 50, y: 50 });
    setShowSpotlight(true);
    triggerNotice('🎯 تم تمركز الدائرة الضوئية في منتصف الملعب');
  };

  // Switch Match Handler
  const handleSwitchMatch = (matchId: string) => {
    const targetMatch = matches.find(m => m.id === matchId);
    if (!targetMatch) return;

    setSelectedMatch(targetMatch);
    setVideoSrc(targetMatch.videoUrl);
    setVideoError(null);
    setCurrentTime(0);
    setIsPlaying(false);

    // Update match clips according to match
    if (targetMatch.id === 'm1' || targetMatch.id === 'live_4') {
      setMatchClips([
        { id: 'c1', title: 'انفراد وصناعة هدف (ديربي المحلة)', timestamp: 32.0, minute: "28'", playerName: 'إبراهيم عادل السيد', type: 'progressive_pass' },
        { id: 'c2', title: 'افتكاك واستخلاص تحت الضغط', timestamp: 78.0, minute: "54'", playerName: 'مروان فايد حجازي', type: 'tackle' },
        { id: 'c3', title: 'اختراق منطقة الجزاء وهدف', timestamp: 144.0, minute: "76'", playerName: 'بلال مظهر عبد القادر', type: 'box_entry' }
      ]);
    } else if (targetMatch.id === 'm2' || targetMatch.id === 'live_2') {
      setMatchClips([
        { id: 'c4', title: 'بناء هجمة سريعة وضغط عكسي', timestamp: 28.0, minute: "31'", playerName: 'زياد كمال منصور', type: 'progressive_pass' },
        { id: 'c5', title: 'مراوغة وانطلاق بالكرة', timestamp: 85.0, minute: "62'", playerName: 'سيف عمرو الغندور', type: 'dribble' }
      ]);
    } else {
      setMatchClips([
        { id: 'c6', title: 'تحول هجومي سريع وصناعة فرصة', timestamp: 22.0, minute: "19'", playerName: 'يوسف عمرو الدالي', type: 'progressive_pass' },
        { id: 'c7', title: 'افتكاك دفاعي في الثلث الأخير', timestamp: 65.0, minute: "58'", playerName: 'كريم يوسف البدري', type: 'tackle' }
      ]);
    }

    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.load();
    }

    triggerNotice(`تم تحميل فيديو: ${targetMatch.homeTeamNameAr} ضد ${targetMatch.awayTeamNameAr}`);
  };

  // Video Time Update Listener
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const t = videoRef.current.currentTime;
      setCurrentTime(t);

      // Smart Auto Tracking if enabled
      if (isAutoTracking) {
        setSpotlightPos({
          x: Math.max(15, Math.min(85, 45 + Math.sin(t * 0.8) * 18)),
          y: Math.max(20, Math.min(80, 52 + Math.cos(t * 0.6) * 14))
        });
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current && videoRef.current.duration) {
      setDuration(videoRef.current.duration);
      setVideoError(null);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          if (videoRef.current) {
            videoRef.current.muted = true;
            setIsMuted(true);
            videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
          }
        });
    }
  };

  // Fixed seekTo: does NOT force play when user was paused
  const seekTo = (seconds: number, forcePlay: boolean = false) => {
    if (videoRef.current) {
      const maxD = duration || 230;
      const targetTime = Math.max(0, Math.min(maxD, seconds));
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
      if (forcePlay) {
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  };

  const skipSeconds = (sec: number) => {
    if (videoRef.current) {
      const maxD = duration || 230;
      const target = Math.max(0, Math.min(maxD, videoRef.current.currentTime + sec));
      seekTo(target, false);
    }
  };

  // Frame by Frame Advance (0.1s step)
  const stepFrame = (frames: number) => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
      skipSeconds(frames * 0.1);
    }
  };

  const changeSpeed = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
      triggerNotice(`سرعة التشغيل: ${rate}x`);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Convert client pointer to percentage coordinates on video container
  const getCanvasCoords = (e: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return { x: 50, y: 50 };
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100));
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  };

  // Get active hex color
  const getColorHex = (c: 'cyan' | 'emerald' | 'amber' | 'rose') => {
    switch (c) {
      case 'cyan': return '#06B6D4';
      case 'emerald': return '#10B981';
      case 'amber': return '#F59E0B';
      case 'rose': return '#F43F5E';
    }
  };

  // Interactive Telestration Pointer Handlers (Seamless Mouse & Touch Support)
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (autoPauseOnDraw && isPlaying) {
      videoRef.current?.pause();
      setIsPlaying(false);
    }

    const coords = getCanvasCoords(e);

    if (activeTool === 'spotlight') {
      setIsAutoTracking(false);
      setSpotlightPos(coords);
      setShowSpotlight(true);
      setIsDraggingSpotlight(true);
      triggerNotice(`تم تثبيت الدائرة الضوئية على (${coords.x}%, ${coords.y}%)`);
    } else if (activeTool === 'arrow') {
      if (pendingArrowOrigin) {
        // Two-click mode: this click finalizes the arrow!
        const dx = coords.x - pendingArrowOrigin.x;
        const dy = coords.y - pendingArrowOrigin.y;
        if (Math.hypot(dx, dy) > 2) {
          setArrows(prev => [
            ...prev,
            {
              id: `arr_${Date.now()}`,
              startX: pendingArrowOrigin.x,
              startY: pendingArrowOrigin.y,
              endX: coords.x,
              endY: coords.y,
              color: getColorHex(toolColor),
              label: 'سهم تحرك',
              style: arrowStyle
            }
          ]);
          setDrawHistory(prev => [...prev, 'arrow']);
          setShowArrow(true);
          triggerNotice('تم تثبيت سهم التحرك التكتيكي');
        }
        setPendingArrowOrigin(null);
        setDrawingArrow(null);
      } else {
        // Start dragging arrow or start 1st click
        setDrawingArrow({
          startX: coords.x,
          startY: coords.y,
          endX: coords.x,
          endY: coords.y
        });
      }
    } else if (activeTool === 'pen') {
      setCurrentPenPath([coords]);
    } else if (activeTool === 'zone') {
      setDrawingZone({
        startX: coords.x,
        startY: coords.y,
        endX: coords.x,
        endY: coords.y
      });
    } else if (activeTool === 'none') {
      togglePlay();
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const coords = getCanvasCoords(e);

    if (isDraggingSpotlight) {
      setSpotlightPos(coords);
    } else if (activeTool === 'arrow') {
      if (pendingArrowOrigin) {
        setDrawingArrow({
          startX: pendingArrowOrigin.x,
          startY: pendingArrowOrigin.y,
          endX: coords.x,
          endY: coords.y
        });
      } else if (drawingArrow) {
        setDrawingArrow(prev => prev ? { ...prev, endX: coords.x, endY: coords.y } : null);
      }
    } else if (activeTool === 'pen' && currentPenPath) {
      setCurrentPenPath(prev => prev ? [...prev, coords] : null);
    } else if (activeTool === 'zone' && drawingZone) {
      setDrawingZone(prev => prev ? { ...prev, endX: coords.x, endY: coords.y } : null);
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const coords = getCanvasCoords(e);

    if (isDraggingSpotlight) {
      setIsDraggingSpotlight(false);
    }

    if (activeTool === 'arrow' && drawingArrow && !pendingArrowOrigin) {
      const dx = drawingArrow.endX - drawingArrow.startX;
      const dy = drawingArrow.endY - drawingArrow.startY;
      if (Math.hypot(dx, dy) > 3) {
        // User dragged and released
        setArrows(prev => [
          ...prev,
          {
            id: `arr_${Date.now()}`,
            startX: drawingArrow.startX,
            startY: drawingArrow.startY,
            endX: drawingArrow.endX,
            endY: drawingArrow.endY,
            color: getColorHex(toolColor),
            label: 'سهم تحرك',
            style: arrowStyle
          }
        ]);
        setDrawHistory(prev => [...prev, 'arrow']);
        setShowArrow(true);
        triggerNotice('تم تثبيت سهم التحرك التكتيكي');
        setDrawingArrow(null);
      } else {
        // User clicked once: switch to click-to-click mode
        setPendingArrowOrigin({ x: coords.x, y: coords.y });
        triggerNotice('انقر في النقطة المستهدفة لإنهاء مسار السهم');
      }
    } else if (activeTool === 'pen' && currentPenPath) {
      if (currentPenPath.length > 2) {
        setPenPaths(prev => [
          ...prev,
          {
            id: `pen_${Date.now()}`,
            points: currentPenPath,
            color: getColorHex(toolColor)
          }
        ]);
        setDrawHistory(prev => [...prev, 'pen']);
        triggerNotice('تم حفظ مسار القلم التكتيكي');
      }
      setCurrentPenPath(null);
    } else if (activeTool === 'zone' && drawingZone) {
      const x = Math.min(drawingZone.startX, drawingZone.endX);
      const y = Math.min(drawingZone.startY, drawingZone.endY);
      const width = Math.abs(drawingZone.endX - drawingZone.startX);
      const height = Math.abs(drawingZone.endY - drawingZone.startY);

      if (width > 3 && height > 3) {
        setZones(prev => [
          ...prev,
          {
            id: `zone_${Date.now()}`,
            x,
            y,
            width,
            height,
            color: getColorHex(toolColor)
          }
        ]);
        setDrawHistory(prev => [...prev, 'zone']);
        triggerNotice('تم تظليل المنطقة التكتيكية');
      }
      setDrawingZone(null);
    }
  };

  // Undo last drawn item
  const handleUndo = () => {
    if (pendingArrowOrigin) {
      setPendingArrowOrigin(null);
      setDrawingArrow(null);
      triggerNotice('تم إلغاء رسم السهم التكتيكي');
      return;
    }
    if (drawHistory.length === 0) {
      triggerNotice('لا توجد رسومات تكتيكية سابقة للتراجع عنها');
      return;
    }
    const lastType = drawHistory[drawHistory.length - 1];
    setDrawHistory(prev => prev.slice(0, -1));

    if (lastType === 'arrow') {
      setArrows(prev => prev.slice(0, -1));
    } else if (lastType === 'pen') {
      setPenPaths(prev => prev.slice(0, -1));
    } else if (lastType === 'zone') {
      setZones(prev => prev.slice(0, -1));
    }
    triggerNotice('تم التراجع عن آخر عنصر');
  };

  // Clear all drawings
  const handleClearAll = () => {
    setArrows([]);
    setPenPaths([]);
    setZones([]);
    setDrawingArrow(null);
    setPendingArrowOrigin(null);
    setCurrentPenPath(null);
    setDrawingZone(null);
    setDrawHistory([]);
    triggerNotice('تم مسح جميع الرسومات والأسهم التكتيكية');
  };

  // Real Snapshot Render with HTML5 Canvas
  const handleCaptureRealSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Draw video frame
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch {
      // Cross-origin fallback
    }

    // 2. Tactical Watermark Header
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(20, 20, 440, 55);
    ctx.fillStyle = '#10B981';
    ctx.font = 'bold 18px Cairo, sans-serif';
    ctx.fillText(`ScoutZero Lab | ${selectedMatch.homeTeamNameAr} ضد ${selectedMatch.awayTeamNameAr}`, 35, 45);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '13px Cairo, sans-serif';
    ctx.fillText(`توقيت اللقطة: ${formatSeconds(currentTime)} • محلل الأداء التكتيكي`, 35, 65);

    // 3. Draw Spotlight if active
    if (showSpotlight && spotlightPos) {
      const cx = (spotlightPos.x / 100) * canvas.width;
      const cy = (spotlightPos.y / 100) * canvas.height;
      ctx.strokeStyle = '#10B981';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 65, 32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
      ctx.fill();

      const targetP = players.find(p => p.id === selectedPlayerId);
      if (targetP) {
        ctx.fillStyle = '#10B981';
        ctx.fillRect(cx - 65, cy + 34, 130, 24);
        ctx.fillStyle = '#020617';
        ctx.font = 'bold 13px Cairo, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`#${targetP.jerseyNumber} ${targetP.nameAr}`, cx, cy + 50);
        ctx.textAlign = 'right';
      }
    }

    // 4. Draw Arrows
    arrows.forEach(arr => {
      const x1 = (arr.startX / 100) * canvas.width;
      const y1 = (arr.startY / 100) * canvas.height;
      const x2 = (arr.endX / 100) * canvas.width;
      const y2 = (arr.endY / 100) * canvas.height;
      ctx.strokeStyle = arr.color || '#06B6D4';
      ctx.lineWidth = 5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    try {
      const dataUrl = canvas.toDataURL('image/png');
      setSnapshotModalUrl(dataUrl);
    } catch {
      triggerNotice('تم التقاط الإطار وتثبيته في المعرض');
    }

    // Add to clips
    const currentSec = Number(currentTime.toFixed(1));
    const newClip = {
      id: `clip_snap_${Date.now()}`,
      title: `لقطة فنية وتمركز (${formatSeconds(currentSec)})`,
      timestamp: currentSec,
      minute: `${Math.floor(currentTime / 60)}'`,
      playerName: players.find(p => p.id === selectedPlayerId)?.nameAr || 'اللاعب المحدد',
      type: 'snapshot'
    };
    setMatchClips(prev => [newClip, ...prev]);
  };

  // Keyboard Shortcuts (Hotkeys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
        return;
      }

      const key = e.key.toLowerCase();
      if (key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (key === 'arrowleft') {
        e.preventDefault();
        skipSeconds(-5);
      } else if (key === 'arrowright') {
        e.preventDefault();
        skipSeconds(5);
      } else if (key === 'c') {
        const firstSuggested = events.find(ev => ev.status === 'suggested');
        if (firstSuggested) handleConfirmEvent(firstSuggested.id);
      } else if (key === 'r') {
        const firstSuggested = events.find(ev => ev.status === 'suggested');
        if (firstSuggested) handleRejectEvent(firstSuggested.id);
      } else if (key === 'p') {
        handleTagEvent('progressive_pass', 'تمريرة تقدمية');
      } else if (key === 't') {
        handleTagEvent('tackle', 'افتكاك وضغط');
      } else if (key === 'd') {
        handleTagEvent('dribble', 'مراوغة تحت الضغط');
      } else if (key === 'b') {
        handleTagEvent('box_entry', 'اختراق الصندوق');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [events, currentTime, selectedPlayerId, isPlaying, duration, drawHistory]);

  // Handle Local Video File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const localUrl = URL.createObjectURL(file);
      setVideoSrc(localUrl);
      setVideoError(null);
      if (videoRef.current) {
        videoRef.current.src = localUrl;
        videoRef.current.currentTime = 0;
        videoRef.current.load();
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
      triggerNotice(`تم تحميل الفيديو: ${file.name}`);
    }
  };

  // Handle URL Ingestion
  const handleStartIngest = () => {
    if (!videoUrlInput) return;
    setIsIngesting(true);
    setIngestProgress(15);

    const interval = setInterval(() => {
      setIngestProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsIngesting(false);
          const newMatch: MatchVideo = {
            id: `m_${Date.now()}`,
            homeTeamName: 'Ghazl El Mahalla',
            homeTeamNameAr: 'غزل المحلة',
            awayTeamName: 'Baladeyet El Mahalla',
            awayTeamNameAr: 'بلدية المحلة',
            leagueName: 'دوري المحترفين المصري',
            date: new Date().toISOString().split('T')[0],
            homeScore: 2,
            awayScore: 1,
            videoUrl: videoUrlInput.startsWith('http') ? videoUrlInput : videoSrc,
            durationSeconds: 230,
            ingestStatus: 'done',
            cameraType: 'broadcast',
            clipsCount: 8
          };
          setMatches([newMatch, ...matches]);
          setSelectedMatch(newMatch);
          setVideoSrc(newMatch.videoUrl);
          setVideoUrlInput('');
          triggerNotice('تمت معالجة وإضافة المباراة الجديدة بنجاح!');
          return 0;
        }
        return prev + 25;
      });
    }, 400);
  };

  // Manual Tagging action - Actually creates a real clip
  const handleTagEvent = (type: string, typeAr: string) => {
    const targetPlayer = players.find(p => p.id === selectedPlayerId);
    const minuteStr = `${Math.floor(currentTime / 60)}'`;

    const newEvt: TaggedEvent = {
      id: `evt_manual_${Date.now()}`,
      matchId: selectedMatch.id,
      playerId: targetPlayer?.id,
      playerName: targetPlayer?.nameAr || 'اللاعب المحدد',
      type,
      typeAr,
      startTime: Math.max(0, currentTime - 3),
      endTime: Math.min(duration, currentTime + 6),
      pitchX: spotlightPos.x,
      pitchY: spotlightPos.y,
      source: 'manual',
      confidence: 1.0,
      status: 'confirmed',
      detectorType: 'MANUAL',
      hasTelestration: true
    };

    setEvents([newEvt, ...events]);

    setMatchClips([
      {
        id: `clip_${Date.now()}`,
        title: typeAr,
        timestamp: Math.max(0, currentTime - 2),
        minute: minuteStr,
        playerName: targetPlayer?.nameAr || 'اللاعب',
        type
      },
      ...matchClips
    ]);

    triggerNotice(`تم تسجيل وقص اللقطة: ${typeAr}`);
  };

  const handleConfirmEvent = (id: string) => {
    store.confirmEvent(id);
    setEvents(events.map(e => e.id === id ? { ...e, status: 'confirmed' } : e));
    triggerNotice('تم اعتماد اللقطة ونقلها للتقرير الفني');
  };

  const handleRejectEvent = (id: string) => {
    store.rejectEvent(id);
    setEvents(events.map(e => e.id === id ? { ...e, status: 'rejected' } : e));
    triggerNotice('تم استبعاد اللقطة المقترحة');
  };

  // Handle Event Selection with Spotlight auto-alignment
  const handleSelectSuggestedEvent = (evt: TaggedEvent) => {
    setActiveEventId(evt.id);
    seekTo(evt.startTime, false);
    if (evt.pitchX && evt.pitchY) {
      setSpotlightPos({ x: evt.pitchX, y: evt.pitchY });
      setShowSpotlight(true);
    }
    if (evt.playerId) {
      setSelectedPlayerId(evt.playerId);
    }
    triggerNotice(`معاينة لقطة: ${evt.typeAr} (${evt.playerName})`);
  };

  const formatSeconds = (sec: number) => {
    if (isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const suggestedEvents = events.filter(e => e.status === 'suggested');
  const confirmedEvents = events.filter(e => e.status === 'confirmed');

  return (
    <div className="space-y-6 text-slate-100">
      {/* Top Header & Match Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-widest">
              ScoutZero Tactical Video Lab | الدوري المصري
            </span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Film className="w-6 h-6 text-emerald-400" />
            <span>استوديو الفيديو والتحليل التكتيكي للكرة المصرية</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            تحليل فيديو حقيقي عالي الدقة، دائرة تسليط الضوء التفاعلية (Spotlight)، وسهم التحرك التكتيكي (Arrow)، والقلم الحر
          </p>
        </div>

        {/* Match Selector Strip */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
            <Tv className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-slate-400 font-medium">المباراة المعروضة:</span>
            <select
              value={selectedMatch.id}
              onChange={e => handleSwitchMatch(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg py-1 px-2.5 text-xs text-white font-semibold focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              {matches.map(m => (
                <option key={m.id} value={m.id}>
                  {m.homeTeamNameAr} ضد {m.awayTeamNameAr} ({m.leagueName})
                </option>
              ))}
            </select>
          </div>

          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-xs px-3 py-1.5 hidden sm:inline-flex">
            [المسافة] تشغيل • [Ctrl+Z] تراجع • [P] تمريرة • [T] افتكاك • [D] مراوغة
          </Badge>
        </div>
      </div>

      {/* Floating Action Notice Toast */}
      {actionNotice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-slate-950 px-4 py-2 rounded-xl font-black text-xs shadow-2xl flex items-center gap-2 animate-bounce">
          <CheckCircle2 className="w-4 h-4" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Video Source Bar: URL Ingestion or Local File Selection */}
      <div className="p-4 rounded-2xl bg-[#111827]/90 border border-slate-800 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-center">
          <div className="relative flex-1 w-full">
            <LinkIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              value={videoUrlInput}
              onChange={e => setVideoUrlInput(e.target.value)}
              placeholder="ضع رابط يوتيوب لمباراة مصرية أو فيديو محلي..."
              className="pr-9 bg-slate-900 border-slate-700 text-xs text-right text-white"
            />
          </div>

          <Button 
            disabled={isIngesting || !videoUrlInput}
            onClick={handleStartIngest}
            className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs gap-1.5 whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            <span>{isIngesting ? `جارٍ السحب (${ingestProgress}%)` : 'سحب ومعالجة عبر yt-dlp'}</span>
          </Button>

          <label className="cursor-pointer inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition">
            <FolderOpen className="w-4 h-4 text-cyan-400" />
            <span>اختر فيديو من جهازك</span>
            <input 
              type="file" 
              accept="video/*" 
              onChange={handleFileUpload} 
              className="hidden" 
            />
          </label>
        </div>

        {isIngesting && (
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div 
              className="bg-emerald-500 h-full transition-all duration-300" 
              style={{ width: `${ingestProgress}%` }}
            />
          </div>
        )}
      </div>

      {/* Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Interactive Video Player & Telestration Canvas */}
        <div className="lg:col-span-2 space-y-4">
          <div className="p-4 rounded-2xl bg-[#111827]/90 border border-slate-800 space-y-3 shadow-2xl">
            {/* HTML5 Video Container with Interactive Telestration Overlay */}
            <div 
              ref={containerRef}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              className={`relative aspect-video rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center group shadow-2xl select-none touch-none ${
                activeTool !== 'none' ? 'cursor-crosshair' : 'cursor-pointer'
              }`}
            >
              <video
                key={videoSrc}
                ref={videoRef}
                src={videoSrc}
                loop={isLooping}
                muted={isMuted}
                playsInline
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={() => {
                  setVideoError("تعذر تشغيل مصدر الفيديو الحالي. انقر لاستعادة الفيديو الافتراضي.");
                }}
                className="w-full h-full object-cover pointer-events-none"
              />

              {/* Video Error Fallback Card */}
              {videoError && (
                <div className="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center z-40">
                  <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
                  <p className="text-sm font-bold text-white mb-1">تنبيه تشغيل الفيديو</p>
                  <p className="text-xs text-slate-400 max-w-md mb-4">{videoError}</p>
                  <Button
                    size="sm"
                    onClick={() => {
                      setVideoSrc('/videos/match-broadcast.mp4');
                      setVideoError(null);
                      if (videoRef.current) {
                        videoRef.current.src = '/videos/match-broadcast.mp4';
                        videoRef.current.load();
                        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
                      }
                    }}
                    className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs"
                  >
                    استعادة فيديو ديربي المحلة فوراً
                  </Button>
                </div>
              )}

              {/* SVG Vector Drawing Canvas Layer */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none z-[15]">
                <defs>
                  <marker id="arrowhead-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#06B6D4" />
                  </marker>
                  <marker id="arrowhead-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#10B981" />
                  </marker>
                  <marker id="arrowhead-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#F59E0B" />
                  </marker>
                  <marker id="arrowhead-rose" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#F43F5E" />
                  </marker>
                  <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2.5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Persistent Tactical Zones */}
                {zones.map(z => (
                  <rect
                    key={z.id}
                    x={`${z.x}%`}
                    y={`${z.y}%`}
                    width={`${z.width}%`}
                    height={`${z.height}%`}
                    fill={z.color}
                    fillOpacity="0.2"
                    stroke={z.color}
                    strokeWidth="2"
                    strokeDasharray="4,4"
                    rx="8"
                  />
                ))}

                {/* Drawing Tactical Zone Preview */}
                {drawingZone && (
                  <rect
                    x={`${Math.min(drawingZone.startX, drawingZone.endX)}%`}
                    y={`${Math.min(drawingZone.startY, drawingZone.endY)}%`}
                    width={`${Math.abs(drawingZone.endX - drawingZone.startX)}%`}
                    height={`${Math.abs(drawingZone.endY - drawingZone.startY)}%`}
                    fill={getColorHex(toolColor)}
                    fillOpacity="0.25"
                    stroke={getColorHex(toolColor)}
                    strokeWidth="2.5"
                    rx="6"
                  />
                )}

                {/* Persistent Freehand Pen Paths */}
                {penPaths.map(p => (
                  <polyline
                    key={p.id}
                    points={p.points.map(pt => `${pt.x}%,${pt.y}%`).join(' ')}
                    fill="none"
                    stroke={p.color}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#glow)"
                  />
                ))}

                {/* Current Freehand Pen Path Preview */}
                {currentPenPath && (
                  <polyline
                    points={currentPenPath.map(pt => `${pt.x}%,${pt.y}%`).join(' ')}
                    fill="none"
                    stroke={getColorHex(toolColor)}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#glow)"
                  />
                )}

                {/* Persistent Vector Movement Arrows */}
                {showArrow && arrows.map(arr => {
                  const colorKey = arr.color === '#10B981' ? 'emerald' : arr.color === '#F59E0B' ? 'amber' : arr.color === '#F43F5E' ? 'rose' : 'cyan';
                  return (
                    <g key={arr.id}>
                      <line
                        x1={`${arr.startX}%`}
                        y1={`${arr.startY}%`}
                        x2={`${arr.endX}%`}
                        y2={`${arr.endY}%`}
                        stroke={arr.color || '#06B6D4'}
                        strokeWidth="4"
                        strokeDasharray={arr.style === 'dashed' ? '6,4' : undefined}
                        markerEnd={`url(#arrowhead-${colorKey})`}
                        filter="url(#glow)"
                      />
                      <circle cx={`${arr.startX}%`} cy={`${arr.startY}%`} r="5" fill={arr.color || '#06B6D4'} stroke="#0f172a" strokeWidth="1.5" />
                    </g>
                  );
                })}

                {/* Currently Drawing Vector Arrow Preview */}
                {drawingArrow && (
                  <g>
                    <line
                      x1={`${drawingArrow.startX}%`}
                      y1={`${drawingArrow.startY}%`}
                      x2={`${drawingArrow.endX}%`}
                      y2={`${drawingArrow.endY}%`}
                      stroke={getColorHex(toolColor)}
                      strokeWidth="4"
                      strokeDasharray={arrowStyle === 'dashed' ? '6,4' : undefined}
                      markerEnd={`url(#arrowhead-${toolColor})`}
                      filter="url(#glow)"
                    />
                    <circle cx={`${drawingArrow.startX}%`} cy={`${drawingArrow.startY}%`} r="5" fill={getColorHex(toolColor)} stroke="#0f172a" strokeWidth="1.5" />
                  </g>
                )}
              </svg>

              {/* Real Interactive Tactical Spotlight Ring Overlay */}
              {showSpotlight && !videoError && (
                <div 
                  className="absolute pointer-events-auto transition-all duration-75 flex flex-col items-center z-20 select-none group"
                  style={{
                    left: `${spotlightPos.x}%`,
                    top: `${spotlightPos.y}%`,
                    transform: 'translate(-50%, -50%)',
                    cursor: isDraggingSpotlight ? 'grabbing' : 'grab'
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setIsDraggingSpotlight(true);
                    triggerNotice('جارٍ سحب وتوجيه الدائرة الضوئية');
                  }}
                >
                  {/* Glowing 3D Field Perspective Spotlight Ring with Dynamic Size */}
                  <div className="relative flex items-center justify-center">
                    <div 
                      className={`rounded-[100%] border-[2.5px] border-emerald-400 bg-emerald-500/25 shadow-[0_0_35px_rgba(16,185,129,0.95)] animate-pulse transition-all ${
                        spotlightSize === 'sm' ? 'w-20 h-10' : spotlightSize === 'lg' ? 'w-36 h-[4.5rem]' : 'w-28 h-14'
                      }`}
                    />
                    <div className="absolute w-3 h-3 rounded-full bg-emerald-400 border-2 border-slate-950 shadow-[0_0_12px_#10B981]" />
                    <div className="absolute inset-0 border border-emerald-300/40 rounded-full animate-ping pointer-events-none" />
                  </div>

                  {/* Floating Target Player Badge */}
                  <div className="mt-1 flex items-center gap-1.5 bg-slate-900/95 border border-emerald-500/80 text-white px-2.5 py-0.5 rounded-full shadow-2xl backdrop-blur-md">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-[11px] font-black text-emerald-400 font-mono">
                      #{players.find(p => p.id === selectedPlayerId)?.jerseyNumber || '11'}
                    </span>
                    <span className="text-[10px] font-bold text-white whitespace-nowrap">
                      {players.find(p => p.id === selectedPlayerId)?.nameAr || 'اللاعب المحدد'}
                    </span>
                    <span className="text-[9px] text-emerald-300 font-semibold px-1 bg-emerald-950/80 rounded">
                      {players.find(p => p.id === selectedPlayerId)?.teamNameAr || 'بلدية المحلة'}
                    </span>
                  </div>
                </div>
              )}

              {/* Active Tool Mode Badge on Video Canvas */}
              <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-md px-2.5 py-1 rounded-lg border border-slate-800 text-[11px]">
                {activeTool === 'spotlight' ? (
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <Target className="w-3.5 h-3.5" />
                    وضع الدائرة الضوئية: انقر على أي لاعب أو اسحب الدائرة مباشرة لتثبيتها
                  </span>
                ) : activeTool === 'arrow' ? (
                  <span className="text-cyan-400 font-bold flex items-center gap-1">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    {pendingArrowOrigin 
                      ? 'تم تحديد نقطة البداية! انقر في نقطة الوصول لإنهاء السهم' 
                      : 'وضع سهم التحرك: انقر واسحب، أو انقر نقطة البداية ثم نقطة النهاية'}
                  </span>
                ) : activeTool === 'pen' ? (
                  <span className="text-amber-400 font-bold flex items-center gap-1">
                    <PenTool className="w-3.5 h-3.5" />
                    وضع القلم الحر: ارسم مسارات وتحركات تكتيكية حرة مباشرة
                  </span>
                ) : activeTool === 'zone' ? (
                  <span className="text-purple-400 font-bold flex items-center gap-1">
                    <Square className="w-3.5 h-3.5" />
                    وضع المساحة التكتيكية: اسحب لتظليل مساحات اللعب والعمق
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-1">
                    <MousePointer className="w-3.5 h-3.5" />
                    وضع المشاهدة: انقر لتشغيل/إيقاف الفيديو، أو اسحب الدائرة الضوئية في أي وقت
                  </span>
                )}
              </div>

              {/* Bottom Video HUD Overlay */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between bg-slate-900/90 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-slate-800 text-xs font-mono z-[25]">
                <div className="flex items-center gap-3">
                  <button 
                    onClick={togglePlay} 
                    className="text-white hover:text-emerald-400 transition"
                    title={isPlaying ? "إيقاف [مسافة]" : "تشغيل [مسافة]"}
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  </button>

                  {/* Frame by Frame Control */}
                  <button 
                    onClick={() => stepFrame(-1)} 
                    className="text-slate-400 hover:text-white transition text-[10px] px-1 bg-slate-800 rounded font-mono"
                    title="إطار للخلف (0.1s)"
                  >
                    -1F
                  </button>

                  <button 
                    onClick={() => stepFrame(1)} 
                    className="text-slate-400 hover:text-white transition text-[10px] px-1 bg-slate-800 rounded font-mono"
                    title="إطار للأمام (0.1s)"
                  >
                    +1F
                  </button>

                  <button 
                    onClick={() => skipSeconds(-5)} 
                    className="text-slate-400 hover:text-white transition"
                    title="تراجع 5 ثواني"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>

                  <button 
                    onClick={() => skipSeconds(5)} 
                    className="text-slate-400 hover:text-white transition"
                    title="تقديم 5 ثواني"
                  >
                    <FastForward className="w-3.5 h-3.5" />
                  </button>

                  <span className="text-emerald-400 font-bold">{formatSeconds(currentTime)}</span>
                  <span className="text-slate-500">/ {formatSeconds(duration)}</span>
                </div>

                <div className="flex items-center gap-3 font-sans">
                  {/* Loop toggle */}
                  <button 
                    onClick={() => {
                      setIsLooping(!isLooping);
                      triggerNotice(isLooping ? 'تم إيقاف التكرار' : 'تم تفعيل التكرار التكتيكي للقطة');
                    }} 
                    className={`transition ${isLooping ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
                    title="تكرار اللقطة"
                  >
                    <Repeat className="w-4 h-4" />
                  </button>

                  {/* Audio Toggle */}
                  <button 
                    onClick={() => setIsMuted(!isMuted)} 
                    className="text-slate-400 hover:text-white transition"
                    title={isMuted ? "تشغيل الصوت" : "كتم الصوت"}
                  >
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>

                  {/* Speed Controls */}
                  <div className="flex gap-1 text-[10px]">
                    {[0.5, 0.75, 1.0, 1.25, 1.5].map(rate => (
                      <button
                        key={rate}
                        onClick={() => changeSpeed(rate)}
                        className={`px-1.5 py-0.5 rounded font-mono transition ${playbackRate === rate ? 'bg-emerald-500 text-black font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>

                  {/* Fullscreen button */}
                  <button 
                    onClick={toggleFullscreen} 
                    className="text-slate-400 hover:text-white transition"
                    title="شاشة كاملة"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>

                  <Badge variant="outline" className="border-slate-700 text-[10px] text-slate-300 hidden md:inline-flex">
                    {selectedMatch.homeTeamNameAr} ضد {selectedMatch.awayTeamNameAr}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Timeline Scrubber */}
            <div className="space-y-1 pt-1">
              <input 
                type="range"
                min="0"
                max={duration || 230}
                step="0.1"
                value={currentTime}
                onChange={e => seekTo(Number(e.target.value), false)}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>00:00</span>
                <span className="cursor-pointer hover:text-emerald-400" onClick={() => seekTo(duration * 0.25, false)}>بداية المباراة</span>
                <span className="cursor-pointer hover:text-emerald-400" onClick={() => seekTo(duration * 0.5, false)}>الاستراحة</span>
                <span className="cursor-pointer hover:text-emerald-400" onClick={() => seekTo(duration * 0.75, false)}>الشوط الثاني</span>
                <span>{formatSeconds(duration)}</span>
              </div>
            </div>

            {/* Telestration Interactive Full Toolbar */}
            <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2.5 text-xs shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400 text-xs font-bold flex items-center gap-1 ml-1">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>أدوات التحليل:</span>
                  </span>

                  {/* Tool 1: Spotlight Mode */}
                  <div className="inline-flex items-center rounded-lg border border-slate-700/80 bg-slate-950 p-0.5">
                    <Button 
                      size="sm" 
                      variant={activeTool === 'spotlight' ? 'default' : 'ghost'}
                      onClick={() => {
                        setActiveTool(activeTool === 'spotlight' ? 'none' : 'spotlight');
                        setShowSpotlight(true);
                        triggerNotice('انقر على أي لاعب أو اسحب الدائرة الضوئية لنقلها');
                      }}
                      className={`text-[11px] h-7 px-2.5 gap-1 font-bold transition ${
                        activeTool === 'spotlight' ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      <Target className="w-3.5 h-3.5" />
                      <span>الدائرة الضوئية</span>
                    </Button>

                    <button
                      onClick={() => setShowSpotlight(!showSpotlight)}
                      className={`h-7 px-1.5 text-[10px] rounded transition ${showSpotlight ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}
                      title={showSpotlight ? "إخفاء الدائرة الضوئية" : "إظهار الدائرة الضوئية"}
                    >
                      {showSpotlight ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      onClick={centerSpotlightOnPlayer}
                      className="h-7 px-1.5 text-[10px] text-slate-400 hover:text-white transition"
                      title="تمركز الدائرة في المنتصف"
                    >
                      <Crosshair className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => {
                        setIsAutoTracking(!isAutoTracking);
                        triggerNotice(isAutoTracking ? 'تم إيقاف التتبع الذكي' : 'تم تفعيل التتبع التلقائي الذكي للدائرة');
                      }}
                      className={`h-7 px-1.5 text-[10px] rounded font-bold transition ${isAutoTracking ? 'text-emerald-400 bg-emerald-500/20' : 'text-slate-400 hover:text-white'}`}
                      title="تتبع تلقائي ذكي أثناء تشغيل الفيديو"
                    >
                      تتبع
                    </button>
                  </div>

                  {/* Tool 2: Arrow Mode */}
                  <div className="inline-flex items-center rounded-lg border border-slate-700/80 bg-slate-950 p-0.5">
                    <Button 
                      size="sm" 
                      variant={activeTool === 'arrow' ? 'default' : 'ghost'}
                      onClick={() => {
                        setActiveTool(activeTool === 'arrow' ? 'none' : 'arrow');
                        setShowArrow(true);
                        triggerNotice('انقر واسحب أو انقر البداية ثم النهاية لتثبيت السهم');
                      }}
                      className={`text-[11px] h-7 px-2.5 gap-1 font-bold transition ${
                        activeTool === 'arrow' ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>سهم التحرك</span>
                    </Button>

                    {/* Quick Arrow Action */}
                    <button
                      onClick={addQuickArrow}
                      className="h-7 px-2 text-[10px] bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 font-bold rounded flex items-center gap-0.5 transition"
                      title="إضافة سهم تحرك هجومي فوري للاعب بنقرة واحدة"
                    >
                      <Zap className="w-3 h-3 text-cyan-400" />
                      <span>سهم سريع</span>
                    </button>

                    {/* Arrow Style Toggle */}
                    <button
                      onClick={() => setArrowStyle(arrowStyle === 'solid' ? 'dashed' : 'solid')}
                      className="h-7 px-1.5 text-[10px] text-slate-400 hover:text-white font-mono transition"
                      title={`نوع السهم: ${arrowStyle === 'solid' ? 'مباشر (صلب)' : 'تمريرة (متقطع)'}`}
                    >
                      {arrowStyle === 'solid' ? '— صلْد' : '┄ نقط'}
                    </button>
                  </div>

                  {/* Tool 3: Freehand Pen */}
                  <Button 
                    size="sm" 
                    variant={activeTool === 'pen' ? 'default' : 'outline'}
                    onClick={() => {
                      setActiveTool(activeTool === 'pen' ? 'none' : 'pen');
                      triggerNotice('اسحب بحرية لرسم مسارات وخطوط تكتيكية');
                    }}
                    className={`text-[11px] h-7 px-2.5 gap-1 font-bold transition ${
                      activeTool === 'pen' ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' : 'border-slate-700 text-slate-300'
                    }`}
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    <span>قلم حر</span>
                  </Button>

                  {/* Tool 4: Space Zone */}
                  <Button 
                    size="sm" 
                    variant={activeTool === 'zone' ? 'default' : 'outline'}
                    onClick={() => {
                      setActiveTool(activeTool === 'zone' ? 'none' : 'zone');
                      triggerNotice('اسحب لرسم وتظليل مساحة تكتيكية (Half-Space)');
                    }}
                    className={`text-[11px] h-7 px-2.5 gap-1 font-bold transition ${
                      activeTool === 'zone' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20' : 'border-slate-700 text-slate-300'
                    }`}
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>مساحة/زون</span>
                  </Button>
                </div>

                {/* Color Palette Strip */}
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-500 px-1">اللون:</span>
                  {(['cyan', 'emerald', 'amber', 'rose'] as const).map(c => (
                    <button
                      key={c}
                      onClick={() => setToolColor(c)}
                      className={`w-4 h-4 rounded-full transition ${
                        toolColor === c ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: getColorHex(c) }}
                    />
                  ))}
                </div>

                {/* Actions: Undo & Clear */}
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleUndo}
                    className="h-7 px-2.5 text-xs border-slate-700 text-slate-300 hover:text-white gap-1"
                    title="تراجع عن آخر رسم [Ctrl+Z]"
                  >
                    <Undo2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span>تراجع</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleClearAll}
                    className="h-7 px-2 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>مسح الكل</span>
                  </Button>
                </div>
              </div>

              {/* Secondary Controls Bar: Spotlight Size, Auto-Pause, Player Tag */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-[11px]">
                <div className="flex items-center gap-3">
                  {/* Spotlight Size */}
                  <div className="flex items-center gap-1 text-slate-400">
                    <span>حجم الدائرة:</span>
                    {(['sm', 'md', 'lg'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => setSpotlightSize(s)}
                        className={`px-1.5 py-0.5 rounded font-mono ${
                          spotlightSize === s ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/40' : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {s === 'sm' ? 'صغير' : s === 'md' ? 'متوسط' : 'واسع'}
                      </button>
                    ))}
                  </div>

                  {/* Auto Pause Toggle */}
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                    <input 
                      type="checkbox"
                      checked={autoPauseOnDraw}
                      onChange={e => setAutoPauseOnDraw(e.target.checked)}
                      className="accent-emerald-500 rounded"
                    />
                    <span>إيقاف الفيديو تلقائياً عند الرسم</span>
                  </label>
                </div>

                {/* Assign Player Selector & Real Snapshot Export */}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleCaptureRealSnapshot}
                    className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs h-7 gap-1 shadow"
                    title="التقاط صورة تكتيكية عالية الدقة مع كافة الرسومات وتنزيلها"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>التقاط لقطة تكتيكية [📸]</span>
                  </Button>

                  <span className="text-slate-400">نسب اللقطة إلى:</span>
                  <select
                    value={selectedPlayerId}
                    onChange={e => setSelectedPlayerId(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded-md py-1 px-2 text-xs text-white max-w-[170px]"
                  >
                    {players.slice(0, 30).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.nameAr} (#{p.jerseyNumber})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Manual Tagging Buttons with Instant Live Action */}
            <div className="pt-2">
              <span className="text-[11px] text-slate-400 font-semibold mb-2 block">
                تسجيل وتقطيع اللقطات الحية (Manual Tagging Buttons):
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Button 
                  size="sm" 
                  onClick={() => handleTagEvent('progressive_pass', 'تمريرة تقدمية كاسرة للخطوط')}
                  className="bg-slate-800 hover:bg-emerald-950/70 border border-slate-700 hover:border-emerald-500 text-xs gap-1.5 transition"
                >
                  <Scissors className="w-3.5 h-3.5 text-emerald-400" />
                  <span>تمريرة تقدمية [P]</span>
                </Button>

                <Button 
                  size="sm" 
                  onClick={() => handleTagEvent('tackle', 'افتكاك واستخلاص')}
                  className="bg-slate-800 hover:bg-cyan-950/70 border border-slate-700 hover:border-cyan-500 text-xs gap-1.5 transition"
                >
                  <Scissors className="w-3.5 h-3.5 text-cyan-400" />
                  <span>افتكاك وضغط [T]</span>
                </Button>

                <Button 
                  size="sm" 
                  onClick={() => handleTagEvent('dribble', 'مراوغة تحت الضغط')}
                  className="bg-slate-800 hover:bg-purple-950/70 border border-slate-700 hover:border-purple-500 text-xs gap-1.5 transition"
                >
                  <Scissors className="w-3.5 h-3.5 text-purple-400" />
                  <span>مراوغة بالكرة [D]</span>
                </Button>

                <Button 
                  size="sm" 
                  onClick={() => handleTagEvent('box_entry', 'اختراق منطقة الجزاء')}
                  className="bg-slate-800 hover:bg-amber-950/70 border border-slate-700 hover:border-amber-500 text-xs gap-1.5 transition"
                >
                  <Scissors className="w-3.5 h-3.5 text-amber-400" />
                  <span>دخول الصندوق [B]</span>
                </Button>
              </div>
            </div>

            {/* Generated Match Clips Gallery */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">اللقطات المقصوصة للمباراة (انقر لتشغيل اللقطة فوراً):</span>
                <span className="text-xs font-mono text-emerald-400">{matchClips.length} لقطة</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {matchClips.map((clip) => (
                  <div 
                    key={clip.id}
                    onClick={() => {
                      setActiveClipId(clip.id);
                      seekTo(clip.timestamp, true);
                    }}
                    className={`p-2.5 rounded-xl border cursor-pointer transition text-right group shadow ${
                      activeClipId === clip.id
                        ? 'bg-slate-800 border-emerald-500 ring-1 ring-emerald-500/50'
                        : 'bg-slate-900 border-slate-800 hover:border-emerald-500/60'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-white group-hover:text-emerald-400 transition truncate">{clip.title}</span>
                      <span className="text-emerald-400 font-mono text-[10px]">{clip.minute}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                      <span>{clip.playerName}</span>
                      <Play className="w-3 h-3 text-slate-500 group-hover:text-emerald-400 fill-current" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: AI Suggested Events Review Queue */}
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-[#111827]/90 border border-slate-800 space-y-3 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-white text-sm">قائمة اعتماد الذكاء الاصطناعي</h3>
              </div>
              <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
                {suggestedEvents.length} مقترح
              </Badge>
            </div>

            <p className="text-[11px] text-slate-400">
              أحداث رصدها الذكاء الاصطناعي؛ انقر على أي حدث للانتقال الفوري وتوجيه الدائرة الضوئية على اللاعب، ثم اعتمد باختصارات [C] / [R].
            </p>

            <div className="space-y-2.5 max-h-[380px] overflow-y-auto">
              {suggestedEvents.map((evt) => (
                <div 
                  key={evt.id}
                  onClick={() => handleSelectSuggestedEvent(evt)}
                  className={`p-3 rounded-xl border space-y-2 cursor-pointer transition ${
                    activeEventId === evt.id 
                      ? 'bg-slate-850 border-emerald-500 ring-1 ring-emerald-500/40 shadow-lg' 
                      : 'bg-slate-900 border-slate-800 hover:border-emerald-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-white">{evt.typeAr}</span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1 rounded">
                      دقة {Math.round(evt.confidence * 100)}%
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 flex justify-between">
                    <span>{evt.playerName || 'لاعب غير محدد'}</span>
                    <span className="font-mono text-slate-300">{formatSeconds(evt.startTime)} - {formatSeconds(evt.endTime)}</span>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800">
                    <Button 
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleRejectEvent(evt.id); }}
                      className="bg-slate-800 hover:bg-red-950 hover:text-red-400 text-slate-400 h-7 text-xs px-2.5 gap-1 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>رفض [R]</span>
                    </Button>

                    <Button 
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleConfirmEvent(evt.id); }}
                      className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold h-7 text-xs px-2.5 gap-1 transition"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>اعتماد [C]</span>
                    </Button>
                  </div>
                </div>
              ))}

              {suggestedEvents.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-500">
                  تمت مراجعة واعتماد جميع اللقطات المقترحة بنجاح!
                </div>
              )}
            </div>
          </div>

          {/* Confirmed Clips Summary */}
          <div className="p-4 rounded-2xl bg-[#111827]/90 border border-slate-800 space-y-3 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-bold text-white text-xs">الأحداث المعتمدة في تقرير المباراة</span>
              <span className="text-xs font-mono text-emerald-400">{confirmedEvents.length} حدث</span>
            </div>

            <div className="space-y-1.5 text-xs max-h-[190px] overflow-y-auto">
              {confirmedEvents.map(evt => (
                <div 
                  key={evt.id} 
                  onClick={() => seekTo(evt.startTime, true)}
                  className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 flex justify-between items-center cursor-pointer hover:border-slate-700 transition"
                >
                  <div>
                    <span className="font-medium text-slate-200 block">{evt.typeAr}</span>
                    <span className="text-[10px] text-slate-500">{evt.playerName}</span>
                  </div>
                  <span className="font-mono text-emerald-400 text-[11px]">{formatSeconds(evt.startTime)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Snapshot Preview & Export Modal */}
      <Dialog open={!!snapshotModalUrl} onOpenChange={(open) => !open && setSnapshotModalUrl(null)}>
        <DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center justify-between text-right">
              <span>معاينة وتصدير اللقطة التكتيكية (Tactical Frame Export)</span>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-xs font-mono mr-3">
                دقة عالية 1080p
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {snapshotModalUrl && (
            <div className="space-y-4 pt-2">
              <div className="rounded-xl overflow-hidden border border-slate-800 shadow-2xl bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={snapshotModalUrl} 
                  alt="Tactical Frame Snapshot" 
                  className="w-full h-auto object-cover" 
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-400">
                  تم دمج الدائرة الضوئية والأسهم التكتيكية وهوية المنصة في الصورة مباشرة.
                </span>

                <div className="flex items-center gap-2">
                  <a
                    href={snapshotModalUrl}
                    download={`scoutzero_tactical_frame_${selectedMatch.id}_${Date.now()}.png`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/20"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تحميل الصورة PNG</span>
                  </a>

                  <Button
                    variant="outline"
                    onClick={() => {
                      setSnapshotModalUrl(null);
                      triggerNotice('تم حفظ اللقطة التكتيكية في التقرير');
                    }}
                    className="border-slate-700 text-slate-300 text-xs"
                  >
                    إغلاق
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

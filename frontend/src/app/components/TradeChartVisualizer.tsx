'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ActivityIcon,
  ClockIcon,
  TargetIcon,
  SparklesIcon,
  BrainCircuitIcon,
  ShieldCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  CrosshairIcon
} from './Icons';

export interface BacktestTradeItem {
  trade_num: number;
  symbol: string;
  direction: string;
  entry_time: string;
  entry_price: number;
  exit_time: string;
  exit_price: number;
  stop_loss: number;
  take_profit: number;
  risk_distance: number;
  rr_ratio: string;
  result: string;
  pnl_percent: number;
  pnl_dollar: number;
  running_balance: number;
  setup_reason: string;
  bos_level?: number;
  idm_level?: number;
  fvg_top?: number;
  fvg_bottom?: number;
  timeframe?: string;
  macro_timeframe?: string;
  '4h_trend'?: string;
  four_h_trend?: string;
  sl_anchor?: string;
  entry_time_ist?: string;
  exit_time_ist?: string;
  session_name?: string;
  duration_hours?: number;
  pattern_type?: string;
  why_outcome?: string;
  lesson_learned?: string;
  adaptation_rule?: string;
}

export interface TradeCandleData {
  entry_idx?: number;
  exit_idx?: number;
  local_entry_idx?: number;
  local_exit_idx?: number;
  local_sh_idx?: number;
  local_idm_idx?: number;
  local_sweep_idx?: number;
  local_bos_idx?: number;
  local_c1_idx?: number;
  local_c2_idx?: number;
  local_c3_idx?: number;
  sh_price?: number;
  idm_price?: number;
  sweep_price?: number;
  bos_price?: number;
  bos_level?: number;
  idm_level?: number;
  fvg_top?: number;
  fvg_bottom?: number;
  entry_price?: number;
  stop_loss?: number;
  take_profit?: number;
  exit_price?: number;
  direction?: string;
  result?: string;
  candles: [string, number, number, number, number][]; // [time, open, high, low, close]
}

interface TradeChartVisualizerProps {
  trade: BacktestTradeItem;
  candleData?: TradeCandleData | null;
  onPrevTrade?: () => void;
  onNextTrade?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onClose?: () => void;
}

export default function TradeChartVisualizer({
  trade,
  candleData,
  onPrevTrade,
  onNextTrade,
  hasPrev = true,
  hasNext = true,
  onClose,
}: TradeChartVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showDrawings, setShowDrawings] = useState<boolean>(true);

  // ── Slide (Pan) and Zoom State ──
  const [panX, setPanX] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartPanRef = useRef<number>(0);

  const candles = useMemo(() => candleData?.candles || [], [candleData]);
  const entryIdx = candleData?.entry_idx ?? 0;
  const exitIdx = candleData?.exit_idx ?? (candles.length > 0 ? candles.length - 1 : 0);

  // SVG Chart Dimensions
  const chartHeight = 360;
  const paddingY = 35;
  const paddingRight = 110;
  const paddingLeft = 20;

  const candleCount = Math.max(1, candles.length);
  const svgWidth = 860;
  const chartWidth = svgWidth - paddingLeft - paddingRight;

  // Scalable candle spacing with zoom: default ~26px allows smooth sliding across 65+ candles
  const baseSpacing = Math.max(18, Math.min(36, chartWidth / Math.min(26, candleCount)));
  const candleSpacing = baseSpacing * zoom;
  const candleBodyWidth = Math.max(4, Math.min(24, candleSpacing * 0.72));

  // Auto-center view on the entry setup candle
  useEffect(() => {
    const targetCandleX = paddingLeft + entryIdx * candleSpacing + candleSpacing / 2;
    const desiredCenter = paddingLeft + chartWidth * 0.45;
    const targetPan = desiredCenter - targetCandleX;
    setPanX(targetPan);
  }, [trade.trade_num, trade.symbol, entryIdx, candleSpacing, chartWidth]);

  // Drag, Touch and Wheel event handlers for smooth sliding
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartPanRef.current = panX;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const dx = e.clientX - dragStartXRef.current;
      setPanX(dragStartPanRef.current + dx);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoverIdx(null);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStartXRef.current = e.touches[0].clientX;
      dragStartPanRef.current = panX;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging && e.touches.length === 1) {
      const dx = e.touches[0].clientX - dragStartXRef.current;
      setPanX(dragStartPanRef.current + dx);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaX !== 0 ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (delta !== 0) {
      setPanX(prev => prev - delta * 0.9);
    }
  };

  const handleResetPan = () => {
    const targetCandleX = paddingLeft + entryIdx * candleSpacing + candleSpacing / 2;
    const desiredCenter = paddingLeft + chartWidth * 0.45;
    setPanX(desiredCenter - targetCandleX);
    setZoom(1);
  };

  // Compute price bounds
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    if (candles.length === 0) {
      return { minPrice: 0, maxPrice: 1, priceRange: 1 };
    }
    let min = Math.min(...candles.map(c => c[3]));
    let max = Math.max(...candles.map(c => c[2]));

    // Include trade levels in bounds
    if (trade.stop_loss) min = Math.min(min, trade.stop_loss);
    if (trade.take_profit) max = Math.max(max, trade.take_profit);
    if (trade.entry_price) {
      min = Math.min(min, trade.entry_price);
      max = Math.max(max, trade.entry_price);
    }
    const fTop = candleData?.fvg_top ?? trade.fvg_top;
    const fBot = candleData?.fvg_bottom ?? trade.fvg_bottom;
    if (fTop) {
      min = Math.min(min, fTop);
      max = Math.max(max, fTop);
    }
    if (fBot) {
      min = Math.min(min, fBot);
      max = Math.max(max, fBot);
    }
    const bosL = candleData?.bos_level ?? trade.bos_level;
    const idmL = candleData?.idm_level ?? trade.idm_level;
    if (bosL) {
      min = Math.min(min, bosL);
      max = Math.max(max, bosL);
    }
    if (idmL) {
      min = Math.min(min, idmL);
      max = Math.max(max, idmL);
    }

    const pad = (max - min) * 0.08 || 1;
    min -= pad;
    max += pad;
    return { minPrice: min, maxPrice: max, priceRange: max - min || 1 };
  }, [candles, trade]);

  // Coordinate mappings
  const getY = (price: number) => {
    const usableH = chartHeight - paddingY * 2;
    const norm = (maxPrice - price) / priceRange;
    return paddingY + norm * usableH;
  };

  const getX = (idx: number) => {
    return paddingLeft + idx * candleSpacing + candleSpacing / 2 + panX;
  };

  // Positions for Trade Levels
  const entryY = getY(trade.entry_price);
  const slY = getY(trade.stop_loss);
  const tpY = getY(trade.take_profit);

  const entryX = getX(entryIdx);
  const exitX = getX(exitIdx);
  const boxWidth = Math.max(candleSpacing, exitX - entryX);

  const isWin = trade.result === 'WIN';
  const isLong = trade.direction === 'LONG' || trade.direction === 'BUY';

  // Zone Coordinates
  const targetTop = Math.min(entryY, tpY);
  const targetH = Math.abs(entryY - tpY);

  const slTop = Math.min(entryY, slY);
  const slH = Math.abs(entryY - slY);

  // ── Canonical Structural Anchor Points (Separation of Concerns: Strategy Engine -> Visualizer) ──
  const localShIdx = candleData?.local_sh_idx ?? Math.max(0, entryIdx - 14);
  const shPrice = candleData?.sh_price ?? candleData?.bos_level ?? trade.bos_level ?? 0;

  const localIdmIdx = candleData?.local_idm_idx ?? Math.max(0, entryIdx - 10);
  const idmPrice = candleData?.idm_price ?? candleData?.idm_level ?? trade.idm_level ?? 0;

  const localSweepIdx = candleData?.local_sweep_idx ?? Math.max(0, entryIdx - 8);
  const sweepPrice = candleData?.sweep_price ?? idmPrice;

  const localBosIdx = candleData?.local_bos_idx ?? Math.max(0, entryIdx - 5);
  const bosPrice = candleData?.bos_price ?? shPrice;

  const localC1Idx = candleData?.local_c1_idx ?? Math.max(0, entryIdx - 3);
  const localC2Idx = candleData?.local_c2_idx ?? (candleData?.local_bos_idx ?? Math.max(0, entryIdx - 2));
  const localC3Idx = candleData?.local_c3_idx ?? Math.max(0, entryIdx - 1);
  const localEntryIdx = candleData?.local_entry_idx ?? entryIdx;
  const localExitIdx = candleData?.local_exit_idx ?? exitIdx;

  const hasBos = shPrice > 0;
  const hasIdm = idmPrice > 0;
  const bosY = hasBos ? getY(shPrice) : 0;
  const idmY = hasIdm ? getY(idmPrice) : 0;

  // FVG (Fair Value Gap) Boundary Zone Calculations
  const fvgTopVal = candleData?.fvg_top ?? trade.fvg_top;
  const fvgBottomVal = candleData?.fvg_bottom ?? trade.fvg_bottom;
  const hasFvg = fvgTopVal !== undefined && fvgBottomVal !== undefined && fvgTopVal > 0 && fvgBottomVal > 0;

  const fvgTopPrice = hasFvg ? Math.max(fvgTopVal, fvgBottomVal) : 0;
  const fvgBottomPrice = hasFvg ? Math.min(fvgTopVal, fvgBottomVal) : 0;

  const rawFvgTopY = hasFvg ? getY(fvgTopPrice) : 0;
  const rawFvgBottomY = hasFvg ? getY(fvgBottomPrice) : 0;
  const rawFvgH = Math.abs(rawFvgBottomY - rawFvgTopY);

  // Anti-Line Guarantee: Maintain minimum 14px visual height so the FVG box is always clearly a box
  const minFvgVisualH = 14;
  const isThinFvg = rawFvgH < minFvgVisualH;
  const fvgCenterY = (rawFvgTopY + rawFvgBottomY) / 2;
  const fvgTopY = isThinFvg ? fvgCenterY - minFvgVisualH / 2 : rawFvgTopY;
  const fvgH = isThinFvg ? minFvgVisualH : rawFvgH;
  const fvgBottomY = isThinFvg ? fvgCenterY + minFvgVisualH / 2 : rawFvgBottomY;
  const displayFvgTopY = fvgTopY;
  const displayFvgH = fvgH;
  const displayFvgBottomY = fvgBottomY;

  // FVG Box Horizontal Boundaries (from C1 wick across wait candles to Entry touch)
  const fvgBoxX1 = Math.min(getX(localC1Idx), getX(localEntryIdx)) - candleBodyWidth / 2;
  const fvgBoxX2 = Math.max(getX(localC1Idx), getX(localEntryIdx)) + candleBodyWidth / 2;
  const fvgBoxW = Math.max(candleSpacing * 2, fvgBoxX2 - fvgBoxX1);

  // Price ticks on right axis
  const priceTicks = useMemo(() => {
    const ticks = [];
    const step = priceRange / 5;
    for (let i = 0; i <= 5; i++) {
      ticks.push(minPrice + i * step);
    }
    return ticks;
  }, [minPrice, priceRange]);

  // Right price axis non-overlapping badges (Clean layout with collision avoidance)
  const rightAxisBadges = useMemo(() => {
    if (!showDrawings) return [];
    interface AxisBadge {
      id: string;
      label: string;
      price: number;
      rawY: number;
      bg: string;
      border: string;
      text: string;
    }

    const list: AxisBadge[] = [
      {
        id: 'tp',
        label: 'TP',
        price: trade.take_profit,
        rawY: tpY,
        bg: '#15803d',
        border: '#86efac',
        text: '#ffffff',
      },
      ...(hasBos ? [{
        id: 'bos',
        label: 'BOS',
        price: shPrice,
        rawY: bosY,
        bg: '#0369a1',
        border: '#7dd3fc',
        text: '#ffffff',
      }] : []),
      ...(hasFvg ? [{
        id: 'fvg_top',
        label: 'FVG TOP',
        price: fvgTopPrice,
        rawY: rawFvgTopY,
        bg: '#d97706',
        border: '#fde68a',
        text: '#ffffff',
      }] : []),
      {
        id: 'entry',
        label: 'ENTRY',
        price: trade.entry_price,
        rawY: entryY,
        bg: '#16a34a',
        border: '#ffffff',
        text: '#ffffff',
      },
      ...(hasFvg ? [{
        id: 'fvg_bot',
        label: 'FVG BOT',
        price: fvgBottomPrice,
        rawY: rawFvgBottomY,
        bg: '#d97706',
        border: '#fde68a',
        text: '#ffffff',
      }] : []),
      ...(hasIdm ? [{
        id: 'idm',
        label: 'IDM',
        price: idmPrice,
        rawY: idmY,
        bg: '#6b21a8',
        border: '#d8b4fe',
        text: '#ffffff',
      }] : []),
      {
        id: 'sl',
        label: 'SL',
        price: trade.stop_loss,
        rawY: slY,
        bg: '#be123c',
        border: '#fda4af',
        text: '#ffffff',
      },
    ];

    // Sort by rawY ascending (top to bottom on screen)
    list.sort((a, b) => a.rawY - b.rawY);

    const minGap = 20;
    const positions = list.map(b => b.rawY);

    // Forward relaxation pass to prevent overlaps
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] < positions[i - 1] + minGap) {
        positions[i] = positions[i - 1] + minGap;
      }
    }

    // Upward clamp pass if bottom badge overflows chart area
    const maxAllowedY = chartHeight - paddingY - 12;
    if (positions.length > 0 && positions[positions.length - 1] > maxAllowedY) {
      positions[positions.length - 1] = maxAllowedY;
      for (let i = positions.length - 2; i >= 0; i--) {
        if (positions[i] > positions[i + 1] - minGap) {
          positions[i] = positions[i + 1] - minGap;
        }
      }
    }

    return list.map((b, idx) => ({
      ...b,
      adjustedY: positions[idx],
      isShifted: Math.abs(positions[idx] - b.rawY) > 3,
    }));
  }, [showDrawings, trade, tpY, hasBos, shPrice, bosY, hasFvg, fvgTopPrice, rawFvgTopY, entryY, fvgBottomPrice, rawFvgBottomY, hasIdm, idmPrice, idmY, slY, chartHeight, paddingY]);

  const activeCandle = hoverIdx !== null && candles[hoverIdx] ? candles[hoverIdx] : null;

  const isGold = trade.symbol === 'XAUUSD';
  const isBtc = trade.symbol === 'BTCUSDT';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col transition-all">
      {/* ── Top Header Bar ── */}
      <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold font-mono text-slate-900 text-sm tracking-tight">
              Trade #{trade.trade_num}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold bg-white border border-slate-200 text-slate-700 shadow-2xs">
              {isGold ? '🥇 Gold (XAU/USD)' : isBtc ? '₿ Bitcoin (BTC)' : '⟠ Ethereum (ETH)'}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-bold bg-indigo-50 border border-indigo-200 text-indigo-700 shadow-2xs flex items-center gap-1">
              <ClockIcon className="w-3 h-3 text-indigo-600" />
              15M Chart
            </span>
          </div>

          <span
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 font-mono ${
              isLong ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            {isLong ? <TrendingUpIcon className="w-3 h-3 text-emerald-600" /> : <TrendingDownIcon className="w-3 h-3 text-rose-600" />}
            {trade.direction}
          </span>

          <span
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 font-mono ${
              isWin ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            {isWin ? <TargetIcon className="w-3 h-3 text-emerald-600" /> : <ShieldCheckIcon className="w-3 h-3 text-rose-600" />}
            {isWin ? 'TAKE PROFIT HIT (+2R)' : 'STOP LOSS HIT (-1R)'}
          </span>

          <span className={`font-mono text-xs font-bold tabular-nums px-2 py-0.5 rounded ${trade.pnl_percent >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {trade.pnl_percent >= 0 ? `+${trade.pnl_percent.toFixed(1)}%` : `${trade.pnl_percent.toFixed(1)}%`} ({trade.pnl_dollar >= 0 ? `+$${trade.pnl_dollar.toFixed(0)}` : `-$${Math.abs(trade.pnl_dollar).toFixed(0)}`})
          </span>

          {/* 4H Trend Direction Badge */}
          {(trade['4h_trend'] || trade.four_h_trend) && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 font-mono ${
                (trade['4h_trend'] || trade.four_h_trend) === 'BULLISH'
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                  : 'bg-rose-100 text-rose-800 border-rose-300'
              }`}
            >
              <span>🧭 4H: {trade['4h_trend'] || trade.four_h_trend}</span>
            </span>
          )}
        </div>

        {/* Navigation & Drawings Controls */}
        <div className="flex items-center gap-2">
          {/* Toggle All Chart Drawings ON / OFF Button */}
          <button
            onClick={() => setShowDrawings(!showDrawings)}
            className={`h-8 px-3.5 rounded-xl text-xs font-mono font-bold border flex items-center gap-2 transition-all shadow-2xs active:scale-95 ${
              showDrawings
                ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 hover:border-slate-400'
            }`}
            title="Click to Hide or Show all SMC Chart Drawings (HH, LL, BOS, IDM, FVG, Entry, SL/TP)"
          >
            <span className={`w-2 h-2 rounded-full ${showDrawings ? 'bg-emerald-300 animate-pulse' : 'bg-slate-400'}`} />
            <span>{showDrawings ? '🎨 Drawings: ON' : '👁️‍🗨️ Drawings: OFF'}</span>
          </button>

          <span className="w-px h-5 bg-slate-200 mx-0.5" />

          <button
            onClick={onPrevTrade}
            disabled={!hasPrev}
            className={`h-8 px-3.5 rounded-xl text-xs font-mono font-semibold border flex items-center gap-1.5 transition-all ${
              !hasPrev
                ? 'border-slate-100 text-slate-300 cursor-not-allowed bg-slate-50'
                : 'border-slate-300 text-slate-700 hover:bg-slate-100 bg-white shadow-sm'
            }`}
          >
            <ChevronLeftIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Prev</span>
          </button>

          <button
            onClick={onNextTrade}
            disabled={!hasNext}
            className={`h-8 px-3.5 rounded-xl text-xs font-mono font-semibold border flex items-center gap-1.5 transition-all ${
              !hasNext
                ? 'border-slate-100 text-slate-300 cursor-not-allowed bg-slate-50'
                : 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700 shadow-sm'
            }`}
          >
            <span>Next</span>
            <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0" />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="ml-1 w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center text-sm font-bold transition-colors"
              title="Close Visualizer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Sub-header: Live Candle Inspection & Setup Info ── */}
      <div className="px-5 py-2.5 bg-slate-50/40 border-b border-slate-100 flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-600 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 font-medium">SMC Setup:</span>
          <span className="text-slate-800 font-semibold">{trade.setup_reason}</span>
          {hasFvg && (
            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-300 font-bold text-[10px] ml-1 shadow-2xs">
              ⚡ FVG GAP: ${fvgBottomPrice.toFixed(2)} – ${fvgTopPrice.toFixed(2)} (15M Touch)
            </span>
          )}
          <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold text-[10px] shadow-2xs">
            🛑 SL: 1st Candle Extreme (Rule #8)
          </span>
        </div>

        <div className="flex items-center gap-3">
          {activeCandle ? (
            <div className="flex items-center gap-3 text-xs tabular-nums bg-white px-3 py-1 rounded-md border border-slate-200 shadow-2xs">
              <span className="text-slate-400">{activeCandle[0]} IST</span>
              <span>O: <strong className="text-slate-900">${activeCandle[1]}</strong></span>
              <span>H: <strong className="text-slate-900">${activeCandle[2]}</strong></span>
              <span>L: <strong className="text-slate-900">${activeCandle[3]}</strong></span>
              <span>C: <strong className={activeCandle[4] >= activeCandle[1] ? 'text-emerald-600' : 'text-rose-600'}>${activeCandle[4]}</strong></span>
            </div>
          ) : (
            <span className="text-slate-400 text-[11px] flex items-center gap-1.5">
              <CrosshairIcon className="w-3 h-3 text-slate-400" />
              Hover crosshair over any candle to inspect 15M OHLC
            </span>
          )}
        </div>
      </div>

      {/* ── SMC 7-Step Structural Pipeline Flow Bar (Matching Exact Infographic) ── */}
      <div className="px-5 py-2.5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700 flex flex-wrap items-center gap-2 text-[11px] font-mono text-white">
        <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Trade Flow:</span>
        <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-semibold">
          ① {isLong ? 'Higher High (1st HH)' : 'Lower Low (1st LL)'}
        </span>
        <span className="text-slate-500">→</span>
        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600 font-semibold">
          ② Pullback (Under {isLong ? 'HH' : 'LL'})
        </span>
        <span className="text-slate-500">→</span>
        <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-700 font-bold">
          ③ 1. Break IDM {hasIdm ? `($${idmPrice?.toLocaleString()})` : ''}
        </span>
        <span className="text-slate-500">→</span>
        <span className="px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-700 font-bold">
          ④ 2. Break {isLong ? 'Higher High (BOS)' : 'Lower Low (BOS)'} {hasBos ? `($${shPrice?.toLocaleString()})` : ''}
        </span>
        <span className="text-slate-500">→</span>
        <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700 font-bold">
          ⑤ FVG Gap Box {hasFvg ? `($${fvgBottomPrice.toFixed(1)}–$${fvgTopPrice.toFixed(1)})` : ''}
        </span>
        <span className="text-slate-500">→</span>
        <span className="px-2 py-0.5 rounded bg-emerald-900 text-emerald-200 border border-emerald-500 font-extrabold shadow-sm">
          ⑥ Entry ({isLong ? 'Buy' : 'Sell'} @ ${trade.entry_price.toLocaleString()})
        </span>
        <span className="text-slate-500">→</span>
        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600 font-semibold">
          ⑦ SL & TP (1:2 R:R)
        </span>
      </div>

      {/* ── Drawn Structure Elements Legend ── */}
      <div className="px-5 py-2 bg-slate-100/70 border-b border-slate-200/80 flex flex-wrap items-center justify-between text-xs font-mono gap-2">
        {showDrawings ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1">Drawn on Chart:</span>
            <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-900 border border-purple-300 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
              🟣 IDM Line (${idmPrice?.toFixed(1)})
            </span>
            <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-300 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
              🔵 BOS Break Line (${shPrice?.toFixed(1)})
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
              📦 FVG Gap Box (${fvgBottomPrice.toFixed(1)} – ${fvgTopPrice.toFixed(1)})
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
              📍 15M Entry Touch (${trade.entry_price.toLocaleString()})
            </span>
            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
              🛑 Stop Loss (${trade.stop_loss.toLocaleString()})
            </span>
            <span className="px-2 py-0.5 rounded bg-green-100 text-green-900 border border-green-300 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
              🎯 Take Profit (${trade.take_profit.toLocaleString()})
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-[11px] font-semibold text-slate-500 italic">
              All SMC Drawings (HH, LL, BOS, IDM, FVG, Entry, SL/TP) are currently <strong>HIDDEN</strong>. Click the <span className="font-bold text-slate-800">"Drawings: OFF"</span> button above to turn them back ON.
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDrawings(!showDrawings)}
            className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border transition-all ${
              showDrawings
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            {showDrawings ? 'Hide Drawings' : 'Show Drawings'}
          </button>
          <span className="text-slate-400 text-[10px] font-medium hidden md:block">
            Zero SL Buffer · 15M Execution
          </span>
        </div>
      </div>

      {/* ── Interactive SVG Candlestick Chart with Click-and-Drag Slide ── */}
      <div
        ref={containerRef}
        className={`relative w-full overflow-hidden bg-white py-1 select-none transition-colors ${
          isDragging ? 'cursor-grabbing bg-slate-50/50' : 'cursor-grab'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
        <svg
          viewBox={`0 0 ${svgWidth} ${chartHeight}`}
          className="w-full h-[350px] select-none block"
        >
          <defs>
            {/* Chart Area ClipPath: Keeps sliding candles from overflowing price axis */}
            <clipPath id="chartAreaClip">
              <rect x={paddingLeft} y={0} width={chartWidth} height={chartHeight} />
            </clipPath>
            {/* Target Green Gradient */}
            <linearGradient id="tpGradientLight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.03" />
            </linearGradient>
            {/* Stop Red Gradient */}
            <linearGradient id="slGradientLight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.14" />
            </linearGradient>
            {/* EVG / FVG Amber Gradient */}
            <linearGradient id="fvgGradientLight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.08" />
            </linearGradient>
            <pattern id="fvgDiagonal" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#f59e0b" strokeWidth="1" strokeOpacity="0.22" />
            </pattern>
          </defs>

          {/* Grid lines (horizontal) */}
          {priceTicks.map((pt, i) => {
            const y = getY(pt);
            return (
              <g key={i}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeDasharray="2 3"
                />
                <text
                  x={svgWidth - paddingRight + 8}
                  y={y + 3.5}
                  fill="#94a3b8"
                  fontSize="9.5"
                  fontFamily="monospace"
                >
                  ${pt.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </text>
              </g>
            );
          })}

          {/* ── Sliding Chart Elements Area (Clipped to prevent spilling over price axis) ── */}
          <g clipPath="url(#chartAreaClip)">
            {showDrawings && candleData && (
              <>
                {/* ── 1. SMC Real-Wick Zigzag (Snaps directly to exact candle wicks) ── */}
                {hasBos && hasIdm && (
                  <g className="smc-real-zigzag" opacity={0.88}>
                    <polyline
                      points={`
                        ${getX(localShIdx)},${getY(shPrice)}
                        ${getX(localIdmIdx)},${getY(idmPrice)}
                        ${getX(localSweepIdx)},${getY(sweepPrice)}
                        ${getX(localBosIdx)},${getY(bosPrice)}
                        ${getX(localEntryIdx)},${getY(trade.entry_price)}
                        ${getX(localExitIdx)},${getY(isWin ? trade.take_profit : trade.stop_loss)}
                      `}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Small vertex dots strictly anchored to real candle coordinates */}
                    <circle cx={getX(localShIdx)} cy={getY(shPrice)} r={3.5} fill="#0284c7" stroke="#ffffff" strokeWidth={1} />
                    <circle cx={getX(localIdmIdx)} cy={getY(idmPrice)} r={3.5} fill="#9333ea" stroke="#ffffff" strokeWidth={1} />
                    <circle cx={getX(localSweepIdx)} cy={getY(sweepPrice)} r={3.5} fill="#a855f7" stroke="#ffffff" strokeWidth={1} />
                    <circle cx={getX(localBosIdx)} cy={getY(bosPrice)} r={3.5} fill="#0284c7" stroke="#ffffff" strokeWidth={1} />
                    <circle cx={getX(localEntryIdx)} cy={getY(trade.entry_price)} r={3.5} fill="#16a34a" stroke="#ffffff" strokeWidth={1} />
                  </g>
                )}

                {/* ── 2. Peak Tag: 1st Higher High / Lower Low ── */}
                {hasBos && (
                  <g transform={`translate(${getX(localShIdx)}, ${getY(shPrice) + (isLong ? -14 : 16)})`}>
                    <rect x={-36} y={-9} width={72} height={18} rx={4} fill="#0f172a" stroke="#ffffff" strokeWidth={1} filter="drop-shadow(0 1px 3px rgba(0,0,0,0.2))" />
                    <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                      {isLong ? '1st HH' : '1st LL'}
                    </text>
                  </g>
                )}

                {/* ── 3. BOS Segment (Begins at 1st HH, ends at BOS Breakout Candle) ── */}
                {hasBos && (
                  <g className="bos-clean-segment">
                    <line
                      x1={getX(localShIdx)}
                      y1={getY(shPrice)}
                      x2={getX(localBosIdx)}
                      y2={getY(shPrice)}
                      stroke="#0284c7"
                      strokeWidth={2}
                    />
                    <g transform={`translate(${(getX(localShIdx) + getX(localBosIdx)) / 2}, ${getY(shPrice) + (isLong ? -12 : 14)})`}>
                      <rect x={-46} y={-9} width={92} height={18} rx={3} fill="#0284c7" stroke="#bae6fd" strokeWidth={0.8} />
                      <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                        BOS ${shPrice.toFixed(1)}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── 4. IDM Segment (Begins at Pullback, ends at Sweep Candle) ── */}
                {hasIdm && (
                  <g className="idm-clean-segment">
                    <line
                      x1={getX(localIdmIdx)}
                      y1={getY(idmPrice)}
                      x2={getX(localSweepIdx)}
                      y2={getY(idmPrice)}
                      stroke="#9333ea"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                    />
                    <g transform={`translate(${(getX(localIdmIdx) + getX(localSweepIdx)) / 2}, ${getY(idmPrice) + (isLong ? 15 : -11)})`}>
                      <rect x={-46} y={-9} width={92} height={18} rx={3} fill="#9333ea" stroke="#e9d5ff" strokeWidth={0.8} />
                      <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                        IDM ${idmPrice.toFixed(1)}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── 5. FVG Imbalance Gap Box (Starts at Candle 1, extends across wait candles to Entry touch) ── */}
                {hasFvg && (
                  <g className="fvg-clean-box">
                    {/* Soft amber highlight box with guaranteed min visual height */}
                    <rect
                      x={fvgBoxX1}
                      y={displayFvgTopY}
                      width={fvgBoxW}
                      height={displayFvgH}
                      fill="url(#fvgGradientLight)"
                      stroke="#d97706"
                      strokeWidth={1.2}
                      strokeDasharray="4 2"
                      rx={3}
                    />
                    {/* Exact Canonical FVG Top Wick Boundary */}
                    <line
                      x1={fvgBoxX1}
                      y1={rawFvgTopY}
                      x2={fvgBoxX2}
                      y2={rawFvgTopY}
                      stroke="#d97706"
                      strokeWidth={1.5}
                      strokeDasharray="2 2"
                    />
                    {/* Exact Canonical FVG Bottom Wick Boundary */}
                    <line
                      x1={fvgBoxX1}
                      y1={rawFvgBottomY}
                      x2={fvgBoxX2}
                      y2={rawFvgBottomY}
                      stroke="#d97706"
                      strokeWidth={1.5}
                      strokeDasharray="2 2"
                    />
                    {/* High-Contrast Pill Tag for FVG Gap */}
                    <g transform={`translate(${fvgBoxX1 + 6}, ${displayFvgTopY + 3})`}>
                      <rect x={0} y={0} width={Math.min(130, fvgBoxW - 12)} height={16} rx={3} fill="#d97706" fillOpacity={0.92} />
                      <text
                        x={6}
                        y={11.5}
                        fill="#ffffff"
                        fontSize="8"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        📦 FVG ${fvgBottomPrice.toFixed(1)}–${fvgTopPrice.toFixed(1)}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── Retrace Waiting Zone between C3 and Entry (Mitigation Wait) ── */}
                {hasFvg && localEntryIdx > localC3Idx && (
                  <g className="smc-retrace-wait-zone" opacity={0.9}>
                    <line
                      x1={getX(localC3Idx) + candleBodyWidth / 2}
                      y1={(rawFvgTopY + rawFvgBottomY) / 2}
                      x2={getX(localEntryIdx) - candleBodyWidth / 2}
                      y2={(rawFvgTopY + rawFvgBottomY) / 2}
                      stroke="#d97706"
                      strokeWidth={1.4}
                      strokeDasharray="3 3"
                    />
                    {localEntryIdx - localC3Idx >= 2 && (
                      <g transform={`translate(${(getX(localC3Idx) + getX(localEntryIdx)) / 2}, ${(rawFvgTopY + rawFvgBottomY) / 2})`}>
                        <rect x={-52} y={-8} width={104} height={16} rx={3} fill="#fffbeb" stroke="#fde68a" strokeWidth={0.8} filter="drop-shadow(0 1px 2px rgba(0,0,0,0.08))" />
                        <text x={0} y={3.5} textAnchor="middle" fill="#92400e" fontSize="7.5" fontFamily="monospace" fontWeight="bold">
                          ⏳ Wait Retrace ({localEntryIdx - localC3Idx}c)
                        </text>
                      </g>
                    )}
                  </g>
                )}

                {/* ── 6. Numbered Candles: ① C1 (Base/SL), ② C2 (BOS Break), ③ C3 (FVG Formed) ── */}
                <g className="smc-candle-number-markers">
                  {/* ① Candle 1: Base candle before breakout & Rule #8 SL Anchor */}
                  {candles[localC1Idx] && (
                    <g transform={`translate(${getX(localC1Idx)}, ${isLong ? getY(candles[localC1Idx][3]) + 15 : getY(candles[localC1Idx][2]) - 13})`}>
                      <rect x={-34} y={-8} width={68} height={16} rx={3} fill="#0f172a" stroke="#94a3b8" strokeWidth={0.8} />
                      <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        ① C1 (Base)
                      </text>
                    </g>
                  )}

                  {/* ② Candle 2: Impulsive BOS Breakout Candle */}
                  {candles[localC2Idx] && (
                    <g transform={`translate(${getX(localC2Idx)}, ${isLong ? getY(candles[localC2Idx][2]) - 13 : getY(candles[localC2Idx][3]) + 15})`}>
                      <rect x={-36} y={-8} width={72} height={16} rx={3} fill="#0284c7" stroke="#7dd3fc" strokeWidth={0.8} />
                      <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        ② C2 (BOS)
                      </text>
                    </g>
                  )}

                  {/* ③ Candle 3: FVG Completion Candle */}
                  {candles[localC3Idx] && (
                    <g transform={`translate(${getX(localC3Idx)}, ${isLong ? getY(candles[localC3Idx][2]) - 13 : getY(candles[localC3Idx][3]) + 15})`}>
                      <rect x={-36} y={-8} width={72} height={16} rx={3} fill="#d97706" stroke="#fde68a" strokeWidth={0.8} />
                      <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        ③ C3 (FVG)
                      </text>
                    </g>
                  )}
                </g>

                {/* ── 7. Stop Loss Segment (Anchored strictly to Candle 1 Low / High - Rule #8) ── */}
                <g className="sl-clean-segment">
                  <line
                    x1={getX(localC1Idx)}
                    y1={slY}
                    x2={getX(localExitIdx)}
                    y2={slY}
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                  />
                  <g transform={`translate(${getX(localC1Idx)}, ${slY + (isLong ? 14 : -6)})`}>
                    <text fill="#ef4444" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                      SL ${trade.stop_loss.toFixed(1)} (C1 {isLong ? 'Low' : 'High'})
                    </text>
                  </g>
                </g>

                {/* ── 8. Take Profit Segment (Begins at Entry, extends to Exit - Rule #9) ── */}
                <g className="tp-clean-segment">
                  <line
                    x1={getX(localEntryIdx)}
                    y1={tpY}
                    x2={getX(localExitIdx)}
                    y2={tpY}
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                  />
                  <g transform={`translate(${getX(localEntryIdx)}, ${tpY + (isLong ? -6 : 14)})`}>
                    <text fill="#10b981" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                      TP ${trade.take_profit.toFixed(1)} (1:2)
                    </text>
                  </g>
                </g>
              </>
            )}

            {/* ── Candlesticks Rendering ── */}
            {candles.map((c, idx) => {
              const [timeStr, o, h, l, cl] = c;
              const x = getX(idx);
              const yO = getY(o);
              const yC = getY(cl);
              const yH = getY(h);
              const yL = getY(l);

              const isBull = cl >= o;
              const bodyColor = isBull ? '#10b981' : '#f43f5e';
              const bodyTop = Math.min(yO, yC);
              const bodyH = Math.max(1.5, Math.abs(yO - yC));

              const isTradeCandle = idx >= entryIdx && idx <= exitIdx;
              const isEntryCandle = idx === entryIdx;
              const isHovered = hoverIdx === idx;

              return (
                <g
                  key={idx}
                  onMouseEnter={() => setHoverIdx(idx)}
                  className="cursor-crosshair"
                >
                  {/* Candle Highlight for Entry */}
                  {showDrawings && isEntryCandle && (
                    <rect
                      x={x - candleBodyWidth - 3}
                      y={paddingY}
                      width={candleBodyWidth * 2 + 6}
                      height={chartHeight - paddingY * 2}
                      fill="#38bdf8"
                      opacity={0.08}
                      rx={4}
                    />
                  )}
                  {/* Wick */}
                  <line
                    x1={x}
                    y1={yH}
                    x2={x}
                    y2={yL}
                    stroke={bodyColor}
                    strokeWidth={isHovered ? 2.5 : isTradeCandle ? 1.6 : 1.2}
                    opacity={isTradeCandle ? 1 : 0.45}
                  />
                  {/* Body */}
                  <rect
                    x={x - candleBodyWidth / 2}
                    y={bodyTop}
                    width={candleBodyWidth}
                    height={bodyH}
                    fill={bodyColor}
                    stroke={isHovered ? '#0f172a' : bodyColor}
                    strokeWidth={isHovered ? 1.5 : 0}
                    opacity={isTradeCandle ? 1 : 0.55}
                    rx={1}
                  />

                  {/* X-axis time label (every 6th candle) */}
                  {idx % 6 === 0 && (
                    <text
                      x={x}
                      y={chartHeight - 12}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="8.5"
                      fontFamily="monospace"
                    >
                      {timeStr.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* ── Entry Marker (Clean TradingView Arrow & Tag) ── */}
            {showDrawings && candleData && (
              <g transform={`translate(${getX(localEntryIdx)}, ${entryY})`}>
                <circle r={4} fill="#16a34a" stroke="#ffffff" strokeWidth={1.5} />
                <path
                  d={isLong ? "M0 10 L0 5 M-3 7 L0 4 L3 7" : "M0 -10 L0 -5 M-3 -7 L0 -4 L3 -7"}
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <g transform={`translate(-45, ${isLong ? 14 : -24})`}>
                  <rect width={90} height={18} rx={3} fill="#16a34a" stroke="#86efac" strokeWidth={0.8} />
                  <text x={45} y={12.5} textAnchor="middle" fill="#ffffff" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                    ↗ Entry ${trade.entry_price.toFixed(1)}
                  </text>
                </g>
              </g>
            )}

            {/* ── Exit Marker (Result & Flag) ── */}
            {showDrawings && candleData && (
              <g transform={`translate(${getX(localExitIdx)}, ${isWin ? tpY : slY})`}>
                <circle r={5} fill={isWin ? '#10b981' : '#f43f5e'} stroke="#ffffff" strokeWidth={1.5} />
                <g transform="translate(8, -10)">
                  <rect
                    width={80}
                    height={20}
                    rx={4}
                    fill={isWin ? '#15803d' : '#be123c'}
                    stroke="#ffffff"
                    strokeWidth={1}
                    filter="drop-shadow(0 1px 3px rgba(0,0,0,0.15))"
                  />
                  <text
                    x={40}
                    y={13.5}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {isWin ? '🏆 WIN (+2R)' : '🛑 LOSS (-1R)'}
                  </text>
                </g>
              </g>
            )}
          </g>
          {/* ── END OF CLIPPED SLIDING CHART AREA ── */}

          {/* ── RIGHT PRICE AXIS (Rendered OUTSIDE clipPath so badges are NEVER cut off!) ── */}
          <g className="right-price-axis-overlay">
            {/* Translucent Axis Background Shield */}
            <rect
              x={svgWidth - paddingRight}
              y={0}
              width={paddingRight}
              height={chartHeight}
              fill="#ffffff"
              opacity={0.88}
            />
            <line
              x1={svgWidth - paddingRight}
              y1={0}
              x2={svgWidth - paddingRight}
              y2={chartHeight}
              stroke="#e2e8f0"
              strokeWidth={1}
            />

            {showDrawings && rightAxisBadges.map(badge => (
              <g key={badge.id} transform={`translate(${svgWidth - paddingRight + 4}, ${badge.adjustedY - 9})`}>
                {badge.isShifted && (
                  <line
                    x1={-4}
                    y1={badge.rawY - badge.adjustedY + 9}
                    x2={0}
                    y2={9}
                    stroke={badge.bg}
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                )}
                <rect
                  width={102}
                  height={18}
                  rx={3}
                  fill={badge.bg}
                  stroke={badge.border}
                  strokeWidth={0.8}
                  filter="drop-shadow(0 1px 2px rgba(0,0,0,0.12))"
                />
                <text
                  x={6}
                  y={12.5}
                  fill={badge.text}
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {badge.label} ${badge.price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </text>
              </g>
            ))}
          </g>

          {/* Hover Crosshair Vertical Line */}
          {hoverIdx !== null && (
            <line
              x1={getX(hoverIdx)}
              y1={paddingY}
              x2={getX(hoverIdx)}
              y2={chartHeight - paddingY}
              stroke="rgba(15, 23, 42, 0.25)"
              strokeDasharray="2 2"
            />
          )}
        </svg>
      </div>

      {/* ── Interactive Chart Slide & Zoom Controls Bar ── */}
      <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        {/* Left: Quick Step / Slide Buttons */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mr-1">
            <span>✋ Chart Slide:</span>
          </span>
          <button
            onClick={() => setPanX(p => p + 180)}
            className="h-7 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold transition-all shadow-2xs flex items-center gap-1 active:scale-95"
            title="Slide Left to inspect Earlier Candles"
          >
            <span>◀ Earlier</span>
          </button>
          <button
            onClick={handleResetPan}
            className="h-7 px-2.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold transition-all shadow-2xs flex items-center gap-1 active:scale-95"
            title="Reset to Entry Setup"
          >
            <span>↺ Center Setup</span>
          </button>
          <button
            onClick={() => setPanX(p => p - 180)}
            className="h-7 px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold transition-all shadow-2xs flex items-center gap-1 active:scale-95"
            title="Slide Right to inspect Later Candles"
          >
            <span>Later ▶</span>
          </button>
        </div>

        {/* Center: Slide Timeline Range Slider */}
        <div className="flex-1 max-w-sm flex items-center gap-2 px-2">
          <span className="text-[10px] text-slate-400 font-bold">Past</span>
          <input
            type="range"
            min={-1500}
            max={1500}
            value={Math.round(panX)}
            onChange={(e) => setPanX(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            title="Slide Timeline"
          />
          <span className="text-[10px] text-slate-400 font-bold">Future</span>
        </div>

        {/* Right: Zoom Scale Controls */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">Zoom:</span>
          <button
            onClick={() => setZoom(z => Math.max(0.65, Number((z - 0.2).toFixed(1))))}
            disabled={zoom <= 0.7}
            className="h-7 w-7 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold flex items-center justify-center disabled:opacity-40 transition-all shadow-2xs"
            title="Zoom Out (Show More Candles)"
          >
            −
          </button>
          <span className="w-10 text-center font-bold text-slate-800 text-xs">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(2.5, Number((z + 0.2).toFixed(1))))}
            disabled={zoom >= 2.4}
            className="h-7 w-7 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold flex items-center justify-center disabled:opacity-40 transition-all shadow-2xs"
            title="Zoom In (Enlarge Candles)"
          >
            +
          </button>
        </div>
      </div>

      {/* ── Bottom Summary Row (IST Timezone) ── */}
      <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 grid grid-cols-2 md:grid-cols-5 gap-4 text-xs font-mono tabular-nums">
        <div>
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Entry (IST Kolkata)</span>
          <span className="text-slate-700">{trade.entry_time_ist || trade.entry_time.slice(0, 16)}</span>
          <span className="text-sky-700 font-bold block">${trade.entry_price.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Exit (IST Kolkata)</span>
          <span className="text-slate-700">{trade.exit_time_ist || trade.exit_time.slice(0, 16)}</span>
          <span className={isWin ? 'text-emerald-600 font-bold block' : 'text-rose-600 font-bold block'}>
            ${trade.exit_price.toLocaleString()}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Stop Loss (1R)</span>
          <span className="text-rose-600 font-medium">${trade.stop_loss.toLocaleString()}</span>
          <span className="text-slate-400 text-[10px] block">Risk: ${trade.risk_distance}</span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Take Profit (2R)</span>
          <span className="text-emerald-600 font-medium">${trade.take_profit.toLocaleString()}</span>
          <span className="text-slate-400 text-[10px] block">Target: ${(trade.risk_distance * 2).toFixed(2)}</span>
        </div>
        <div>
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">Result & Duration</span>
          <span className={`font-bold text-sm block ${isWin ? 'text-emerald-600' : 'text-rose-600'}`}>
            {trade.result} ({trade.pnl_percent >= 0 ? `+${trade.pnl_percent}%` : `${trade.pnl_percent}%`})
          </span>
          <span className="text-slate-500 text-[10px] block">
            {trade.duration_hours ? `${trade.duration_hours}h duration · ` : ''}Bal: ${trade.running_balance.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ── AI Quantitative Post-Mortem & Machine Learning Section ── */}
      <div className="p-6 bg-white border-t border-slate-100 flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrainCircuitIcon className="w-4 h-4 text-slate-800" />
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-900">
              AI Quantitative Trade Post-Mortem
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              Session: {trade.session_name || 'Active Session'}
            </span>
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 font-medium">
              {trade.pattern_type || 'SMC Mitigation'}
            </span>
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-bold">
              IST (UTC+5:30)
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          {/* Card 1: Why it Won or Why it Failed */}
          <div className={`p-4 rounded-xl border flex flex-col gap-2 ${
            isWin ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950' : 'bg-rose-50/70 border-rose-200 text-rose-950'
          }`}>
            <span className={`text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${isWin ? 'text-emerald-800' : 'text-rose-800'}`}>
              {isWin ? <TargetIcon className="w-3.5 h-3.5 text-emerald-600" /> : <ShieldCheckIcon className="w-3.5 h-3.5 text-rose-600" />}
              {isWin ? 'Why this Trade Succeeded' : 'Why this Trade Failed (Root-Cause)'}
            </span>
            <p className="text-xs leading-relaxed text-slate-700 font-sans">
              {trade.why_outcome || (isWin 
                ? 'Clean institutional displacement tapped FVG and order flow expanded smoothly to 1:2 Take Profit.'
                : 'Market experienced liquidity sweep past structural low, triggering invalidation before reversal.'
              )}
            </p>
          </div>

          {/* Card 2: What was Learned */}
          <div className="p-4 rounded-xl border bg-blue-50/70 border-blue-200 flex flex-col gap-2 text-blue-950">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
              <SparklesIcon className="w-3.5 h-3.5 text-blue-600" />
              AI Institutional Lesson
            </span>
            <p className="text-xs leading-relaxed text-slate-700 font-sans">
              {trade.lesson_learned || 'Structure body closes confirm true institutional commitment over wick sweeps.'}
            </p>
          </div>

          {/* Card 3: Adaptive Engine Rule */}
          <div className="p-4 rounded-xl border bg-amber-50/70 border-amber-200 flex flex-col gap-2 text-amber-950">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
              <BrainCircuitIcon className="w-3.5 h-3.5 text-amber-600" />
              Active Rule Ingested
            </span>
            <p className="text-xs leading-relaxed text-slate-700 font-sans">
              {trade.adaptation_rule || 'Rule #AUTO: Require volume confirmation before triggering subsequent mitigations.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

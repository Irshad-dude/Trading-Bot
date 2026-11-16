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
  trade_type?: string;
  bos_level?: number;
  idm_level?: number;
  choch_price?: number;
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
  angle?: number;
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
  local_choch_idx?: number;
  local_choch_break_idx?: number;
  local_c1_idx?: number;
  local_c2_idx?: number;
  local_c3_idx?: number;
  sh_price?: number;
  idm_price?: number;
  sweep_price?: number;
  bos_price?: number;
  bos_level?: number;
  idm_level?: number;
  choch_price?: number;
  trade_type?: string;
  fvg_top?: number;
  fvg_bottom?: number;
  entry_price?: number;
  planned_entry?: number;
  stop_loss?: number;
  take_profit?: number;
  exit_price?: number;
  direction?: string;
  result?: string;
  angle?: number;
  macro_trend?: string;
  timeframe?: string;
  macro_timeframe?: string;
  candles: [string, number, number, number, number][]; // [time, open, high, low, close]
  is_active_trade?: boolean;
  open_trade?: any;
  current_price?: number;
  setup_stage?: string;
  stage_status?: string;
  recent_swing_high?: { index: number; price: number; timestamp?: string } | null;
  recent_swing_low?: { index: number; price: number; timestamp?: string } | null;
}

interface TradeChartVisualizerProps {
  trade: BacktestTradeItem;
  candleData?: TradeCandleData | null;
  onPrevTrade?: () => void;
  onNextTrade?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  onClose?: () => void;
  onViewInGraph?: (tradeNum: number) => void;
}

export default function TradeChartVisualizer({
  trade,
  candleData,
  onPrevTrade,
  onNextTrade,
  hasPrev = true,
  hasNext = true,
  onClose,
  onViewInGraph,
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
  const entryIdx = candleData?.local_entry_idx ?? candleData?.entry_idx ?? 0;
  const exitIdx = candleData?.local_exit_idx ?? candleData?.exit_idx ?? (candles.length > 0 ? candles.length - 1 : 0);

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

  const isInspectingTrade = trade.result === 'WIN' || trade.result === 'LOSS' || trade.result === 'ACTIVE_OPEN';
  const isLiveActive = trade.result === 'ACTIVE_OPEN' || (candleData?.is_active_trade === true && trade.result !== 'LIVE_CANDIDATE');
  const isLiveCandidate = !isInspectingTrade && (trade.result === 'LIVE_CANDIDATE' || candleData?.is_active_trade === false);
  const isBacktest = !isLiveCandidate && !isLiveActive;

  // Auto-center view on the active candles and entry setup
  useEffect(() => {
    const centerIdx = (isLiveCandidate || trade.result === 'ACTIVE_OPEN' || isLiveActive)
      ? Math.max(0, candleCount - 12)
      : (candleData?.local_entry_idx ?? Math.max(0, candleCount - 8));
    const targetCandleX = paddingLeft + centerIdx * candleSpacing + candleSpacing / 2;
    const desiredCenter = paddingLeft + chartWidth * 0.45;
    const targetPan = desiredCenter - targetCandleX;
    setPanX(targetPan);
  }, [trade.trade_num, trade.symbol, entryIdx, candleSpacing, chartWidth, isLiveCandidate, trade.result, isLiveActive, candleCount]);

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
    const centerIdx = isLiveCandidate ? Math.max(0, candleCount - 8) : entryIdx;
    const targetCandleX = paddingLeft + centerIdx * candleSpacing + candleSpacing / 2;
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
    const effSL = candleData?.stop_loss ?? trade.stop_loss;
    const effTP = candleData?.take_profit ?? trade.take_profit;
    const effEP = candleData?.entry_price ?? trade.entry_price;
    if (effSL) min = Math.min(min, effSL);
    if (effTP) max = Math.max(max, effTP);
    if (effEP) {
      min = Math.min(min, effEP);
      max = Math.max(max, effEP);
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

  // Effective price levels (snapped strictly to candle data or explicit trade levels)
  const effectiveEntryPrice = (trade.entry_price && trade.entry_price > 0)
    ? trade.entry_price
    : (candleData?.entry_price && candleData.entry_price > 0 ? candleData.entry_price : 0);
  const effectiveStopLoss = (trade.stop_loss && trade.stop_loss > 0)
    ? trade.stop_loss
    : (candleData?.stop_loss && candleData.stop_loss > 0 ? candleData.stop_loss : 0);
  const effectiveTakeProfit = (trade.take_profit && trade.take_profit > 0)
    ? trade.take_profit
    : (candleData?.take_profit && candleData.take_profit > 0 ? candleData.take_profit : 0);
  const effectiveExitPrice = (trade.exit_price && trade.exit_price > 0)
    ? trade.exit_price
    : (candleData?.exit_price && candleData.exit_price > 0 ? candleData.exit_price : 0);

  // ── True Candle-Snapped Alignment Engine (Anti-Air Guarantee) ──
  // Resolves the REAL candle where entry/touch happened, where C1/FVG formed, and where live position extends
  const realEntryIdx = useMemo(() => {
    if (candles.length === 0 || effectiveEntryPrice <= 0) {
      return isLiveCandidate ? Math.max(0, candleCount - 1) : Math.max(0, candleCount - 8);
    }
    if (candleData?.local_entry_idx != null && candleData.local_entry_idx >= 0 && candleData.local_entry_idx < candleCount) {
      return candleData.local_entry_idx;
    }
    // Search visible candles from newest to oldest for candle touching entry price
    let bestIdx = -1;
    let minDiff = Infinity;
    for (let i = candleCount - 1; i >= 0; i--) {
      const [, , h, l] = candles[i];
      if (effectiveEntryPrice >= l && effectiveEntryPrice <= h) {
        return i; // Exact candle wick/body touch!
      }
      const diff = Math.min(Math.abs(h - effectiveEntryPrice), Math.abs(l - effectiveEntryPrice));
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }
    return bestIdx !== -1 ? bestIdx : Math.max(0, candleCount - 1);
  }, [candles, effectiveEntryPrice, candleData?.local_entry_idx, candleCount, isLiveCandidate]);

  const realC1Idx = useMemo(() => {
    if (candleData?.local_c1_idx != null && candleData.local_c1_idx >= 0 && candleData.local_c1_idx < candleCount) {
      return candleData.local_c1_idx;
    }
    return Math.max(0, realEntryIdx - 3);
  }, [candleData?.local_c1_idx, realEntryIdx, candleCount]);

  const realExitIdx = useMemo(() => {
    if (trade.result === 'ACTIVE_OPEN' || isLiveActive) {
      return Math.max(0, candleCount - 1);
    }
    if (candleData?.local_exit_idx != null && candleData.local_exit_idx >= 0 && candleData.local_exit_idx < candleCount) {
      return candleData.local_exit_idx;
    }
    return Math.min(candleCount - 1, realEntryIdx + 6);
  }, [trade.result, isLiveActive, candleData?.local_exit_idx, candleCount, realEntryIdx]);

  // Positions for Trade Levels
  const entryY = effectiveEntryPrice > 0 ? getY(effectiveEntryPrice) : 0;
  const slY = effectiveStopLoss > 0 ? getY(effectiveStopLoss) : 0;
  const tpY = effectiveTakeProfit > 0 ? getY(effectiveTakeProfit) : 0;

  const entryX = getX(realEntryIdx);
  const exitX = getX(realExitIdx);
  const boxWidth = Math.max(candleSpacing, exitX - entryX);

  const isWin = trade.result === 'WIN';
  const isLong = trade.direction === 'LONG' || trade.direction === 'BUY';

  // Zone Coordinates
  const targetTop = Math.min(entryY, tpY);
  const targetH = Math.abs(entryY - tpY);

  const slTop = Math.min(entryY, slY);
  const slH = Math.abs(entryY - slY);

  const shPrice = (trade.bos_level && trade.bos_level > 0)
    ? trade.bos_level
    : (candleData?.sh_price ?? candleData?.bos_level ?? candleData?.recent_swing_high?.price ?? (trade as any).sh_price ?? 0);

  const idmPrice = (trade.idm_level && trade.idm_level > 0)
    ? trade.idm_level
    : (candleData?.idm_price ?? candleData?.idm_level ?? 0);

  const chochPrice = candleData?.choch_price ?? trade.choch_price ?? 0;
  const hasChoch = chochPrice > 0;
  const chochY = hasChoch ? getY(chochPrice) : 0;
  const isReversal = trade.trade_type === 'REVERSAL_CHOCH' || candleData?.trade_type === 'REVERSAL_CHOCH';

  // Strict BOS Validation matching TradingView SMC Rules
  const hasBos = Boolean(
    shPrice > 0 ||
    ((candleData?.bos_price ?? 0) > 0 || (candleData?.bos_level ?? 0) > 0)
  );

  // IDM is valid whenever identified or swept in the current structural regime
  const hasIdm = Boolean(idmPrice > 0);

  const pendingBosLevel = !hasBos && (candleData?.recent_swing_high?.price ?? (shPrice > 0 ? shPrice : 0));
  const bosDisplayPrice = hasBos ? (shPrice || (candleData?.bos_price ?? 0)) : (pendingBosLevel || 0);
  const bosY = (hasBos || pendingBosLevel > 0) ? getY(bosDisplayPrice) : 0;
  const idmY = hasIdm ? getY(idmPrice) : 0;

  // FVG (Fair Value Gap) Boundary Zone Calculations
  const fvgTopVal = (trade.fvg_top && trade.fvg_top > 0)
    ? trade.fvg_top
    : (candleData?.fvg_top && candleData.fvg_top > 0 ? candleData.fvg_top : undefined);
  const fvgBottomVal = (trade.fvg_bottom && trade.fvg_bottom > 0)
    ? trade.fvg_bottom
    : (candleData?.fvg_bottom && candleData.fvg_bottom > 0 ? candleData.fvg_bottom : undefined);
  const hasFvg = Boolean(fvgTopVal !== undefined && fvgBottomVal !== undefined && fvgTopVal > 0 && fvgBottomVal > 0);

  const hasPlannedLevels = Boolean(effectiveEntryPrice > 0 && effectiveStopLoss > 0 && effectiveTakeProfit > 0);

  const fvgTopPrice = hasFvg && fvgTopVal !== undefined && fvgBottomVal !== undefined ? Math.max(fvgTopVal, fvgBottomVal) : 0;
  const fvgBottomPrice = hasFvg && fvgTopVal !== undefined && fvgBottomVal !== undefined ? Math.min(fvgTopVal, fvgBottomVal) : 0;

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

  // FVG Box Horizontal Boundaries: covers from C1 wick across to real Entry touch candle
  const fvgC1X = getX(realC1Idx);
  const fvgBoxX1 = Math.min(fvgC1X, getX(realEntryIdx)) - candleBodyWidth / 2;
  const fvgBoxX2 = Math.max(fvgC1X, getX(realEntryIdx)) + candleBodyWidth / 2;
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
      ...(hasPlannedLevels ? [{
        id: 'tp',
        label: 'TP',
        price: effectiveTakeProfit,
        rawY: tpY,
        bg: '#15803d',
        border: '#86efac',
        text: '#ffffff',
      }] : []),
      ...(hasBos ? [{
        id: 'bos',
        label: 'BOS',
        price: shPrice || (candleData?.bos_price ?? 0),
        rawY: bosY,
        bg: '#0369a1',
        border: '#7dd3fc',
        text: '#ffffff',
      }] : pendingBosLevel > 0 ? [{
        id: 'bos_pending',
        label: 'BOS TRIGGER',
        price: pendingBosLevel,
        rawY: bosY,
        bg: '#0284c7',
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
      ...(hasPlannedLevels ? [{
        id: 'entry',
        label: isLiveCandidate ? 'PLANNED ENTRY' : 'ENTRY',
        price: effectiveEntryPrice,
        rawY: entryY,
        bg: '#16a34a',
        border: '#ffffff',
        text: '#ffffff',
      }] : []),
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
      ...(hasChoch ? [{
        id: 'choch',
        label: 'CHOCH',
        price: chochPrice,
        rawY: chochY,
        bg: '#ea580c',
        border: '#ffedd5',
        text: '#ffffff',
      }] : []),
      ...(hasPlannedLevels ? [{
        id: 'sl',
        label: 'SL',
        price: effectiveStopLoss,
        rawY: slY,
        bg: '#be123c',
        border: '#fda4af',
        text: '#ffffff',
      }] : []),
      ...(effectiveExitPrice > 0 && (trade.result === 'WIN' || trade.result === 'LOSS' || trade.result === 'BREAKEVEN') ? [{
        id: 'exit',
        label: `EXIT (${trade.result})`,
        price: effectiveExitPrice,
        rawY: getY(effectiveExitPrice),
        bg: trade.result === 'WIN' ? '#065f46' : '#9f1239',
        border: '#ffffff',
        text: '#ffffff',
      }] : []),
      ...(isLiveCandidate && !hasBos && candleData?.recent_swing_high ? [{
        id: 'sh_recent',
        label: 'SWING HIGH',
        price: candleData.recent_swing_high.price,
        rawY: getY(candleData.recent_swing_high.price),
        bg: '#0369a1',
        border: '#7dd3fc',
        text: '#ffffff',
      }] : []),
      ...(isLiveCandidate && !hasBos && candleData?.recent_swing_low ? [{
        id: 'sl_recent',
        label: 'SWING LOW',
        price: candleData.recent_swing_low.price,
        rawY: getY(candleData.recent_swing_low.price),
        bg: '#be123c',
        border: '#fda4af',
        text: '#ffffff',
      }] : []),
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
  }, [showDrawings, isLiveCandidate, hasPlannedLevels, effectiveTakeProfit, tpY, hasBos, shPrice, candleData, bosY, hasFvg, fvgTopPrice, rawFvgTopY, effectiveEntryPrice, entryY, fvgBottomPrice, rawFvgBottomY, hasIdm, idmPrice, idmY, hasChoch, chochPrice, chochY, effectiveStopLoss, slY, chartHeight, paddingY]);

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
              {isLiveCandidate
                ? `Candidate: ${trade.symbol}`
                : isLiveActive
                ? `Active Position: ${trade.symbol}`
                : `Trade #${trade.trade_num}`}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold bg-white border border-slate-200 text-slate-700 shadow-2xs">
              {isGold ? 'Gold (XAU/USD)' : isBtc ? 'Bitcoin (BTC)' : 'Ethereum (ETH)'}
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-mono font-bold bg-indigo-50 border border-indigo-200 text-indigo-700 shadow-2xs flex items-center gap-1">
              <ClockIcon className="w-3 h-3 text-indigo-600" />
              {candleData?.timeframe || '1M'} Chart
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

          {isLiveCandidate ? (
            <>
              {hasBos ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1.5 font-mono bg-amber-50 text-amber-800 border-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span>{candleData?.setup_stage === 'FVG_TOUCH' ? 'Pending FVG Retracement' : (candleData?.setup_stage?.replace(/_/g, ' ') || 'Candidate Setup')}</span>
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1.5 font-mono bg-sky-50 text-sky-800 border-sky-300">
                  <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                  <span>Scanning {candleData?.timeframe || '1M'} Range · Waiting for Breakout</span>
                </span>
              )}
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 font-mono bg-slate-100 text-slate-700 border-slate-300">
                NO POSITION OPEN
              </span>
              {hasPlannedLevels && (
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                  Planned R:R 1:2
                </span>
              )}
            </>
          ) : isLiveActive ? (
            <>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1.5 font-mono bg-cyan-50 text-cyan-800 border-cyan-300">
                <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                <span>ACTIVE POSITION</span>
              </span>
              <span className={`font-mono text-xs font-bold tabular-nums px-2 py-0.5 rounded ${trade.pnl_dollar >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                Unrealized P&amp;L: {trade.pnl_dollar >= 0 ? `+$${trade.pnl_dollar.toFixed(2)}` : `-$${Math.abs(trade.pnl_dollar).toFixed(2)}`}
              </span>
            </>
          ) : (
            <>
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
            </>
          )}

          {/* Chain-of-CHoCH Setup Type Badge */}
          {(trade.trade_type || candleData?.trade_type) && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 font-mono ${
                (trade.trade_type || candleData?.trade_type) === 'REVERSAL_CHOCH'
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-sky-100 text-sky-900 border-sky-300'
              }`}
            >
              <span>{(trade.trade_type || candleData?.trade_type) === 'REVERSAL_CHOCH' ? 'Reversal (CHoCH Break)' : 'Continuation (BOS Break)'}</span>
            </span>
          )}

          {/* Trend Direction Badge */}
          {(trade['4h_trend'] || trade.four_h_trend || candleData?.macro_trend) && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 font-mono ${
                (trade['4h_trend'] || trade.four_h_trend || candleData?.macro_trend) === 'BULLISH'
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                  : 'bg-rose-100 text-rose-800 border-rose-300'
              }`}
            >
              <span>{candleData?.macro_timeframe || '30M'} Trend: {trade['4h_trend'] || trade.four_h_trend || candleData?.macro_trend}</span>
            </span>
          )}

          {/* Impulse Trending Angle Badge (40°-45° Trending Market) */}
          {(trade.angle || candleData?.angle) && (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 font-mono bg-purple-50 text-purple-700 border-purple-200 shadow-2xs">
              <span>Angle: {trade.angle || candleData?.angle}° (Impulse)</span>
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
            <span>{showDrawings ? 'Drawings: On' : 'Drawings: Off'}</span>
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

          {onViewInGraph && (
            <button
              onClick={() => onViewInGraph(trade.trade_num)}
              className="px-2.5 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs"
              title="Inspect trade in Trade Brain (Graph RAG)"
            >
              <BrainCircuitIcon className="w-3.5 h-3.5 text-purple-600" />
              <span className="hidden sm:inline">Brain (Graph RAG)</span>
            </button>
          )}

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
              FVG Gap: ${fvgBottomPrice.toFixed(2)} – ${fvgTopPrice.toFixed(2)} ({candleData?.timeframe || '1M'} Touch)
            </span>
          )}
          <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold text-[10px] shadow-2xs">
            SL: C1 Candle Extreme (Rule #8)
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
              Hover crosshair over any candle to inspect OHLC
            </span>
          )}
        </div>
      </div>

      {/* ── SMC Structural Pipeline Flow Bar ── */}
      <div className="px-5 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center gap-2 text-[11px] font-mono text-white">
        {isLiveCandidate && !hasBos ? (
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-700 font-bold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              {candleData?.timeframe || '1M'} Structure Scanner
            </span>
            <span className="text-slate-500">|</span>
            {candleData?.recent_swing_high && (
              <span className="px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700">
                Range High (HH): ${candleData.recent_swing_high.price.toLocaleString()}
              </span>
            )}
            {candleData?.recent_swing_low && (
              <span className="px-2 py-0.5 rounded bg-slate-800 text-rose-300 border border-slate-700">
                Range Low (LL): ${candleData.recent_swing_low.price.toLocaleString()}
              </span>
            )}
            <span className="text-slate-500">|</span>
            <span className="px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-800 font-medium">
              Waiting for {candleData?.timeframe || '1M'} candle body close beyond swing levels
            </span>
          </div>
        ) : (
          <>
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Trade Flow:</span>
            {isReversal ? (
              <>
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-semibold">
                  ① Prior {isLong ? 'Lower Low (LL)' : 'Higher High (HH)'}
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-700 font-bold">
                  ② IDM Sweep
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-700 font-bold">
                  ③ BOS Confirmed
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-orange-950 text-orange-300 border border-orange-700 font-extrabold shadow-sm">
                  ④ CHoCH Body Break {hasChoch ? `($${chochPrice?.toFixed(1)})` : ''}
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700 font-bold">
                  ⑤ 3-Candle FVG Gap Box
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-emerald-900 text-emerald-200 border border-emerald-500 font-extrabold shadow-sm">
                  ⑥ Retrace Entry ({isLong ? 'Buy' : 'Sell'} @ ${trade.entry_price.toLocaleString()})
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600 font-semibold">
                  ⑦ Rule #8 C1 SL & 1:2 TP
                </span>
              </>
            ) : (
              <>
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-semibold">
                  ① {isLong ? 'Higher High (HH)' : 'Lower Low (LL)'}
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-700 font-bold">
                  ② IDM Sweep {hasIdm ? `($${idmPrice?.toLocaleString()})` : ''}
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-700 font-bold">
                  ③ BOS Break {hasBos ? `($${shPrice?.toLocaleString()})` : ''}
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700 font-bold">
                  ④ 3-Candle FVG Gap Box
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-emerald-900 text-emerald-200 border border-emerald-500 font-extrabold shadow-sm">
                  ⑤ Retrace Entry ({isLong ? 'Buy' : 'Sell'} @ ${trade.entry_price.toLocaleString()})
                </span>
                <span className="text-slate-500">→</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600 font-semibold">
                  ⑥ Rule #8 C1 SL & 1:2 TP
                </span>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Drawn Structure Elements Legend ── */}
      <div className="px-5 py-2 bg-slate-100/70 border-b border-slate-200/80 flex flex-wrap items-center justify-between text-xs font-mono gap-2">
        {showDrawings ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1">Drawn on Chart:</span>
            {isLiveCandidate && !hasBos ? (
              <>
                {candleData?.recent_swing_high && (
                  <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-600" />
                    Swing High (${candleData.recent_swing_high.price.toFixed(1)})
                  </span>
                )}
                {candleData?.recent_swing_low && (
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                    Swing Low (${candleData.recent_swing_low.price.toFixed(1)})
                  </span>
                )}
                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300 font-semibold text-[10px] flex items-center gap-1">
                  No BOS in current range · Waiting for breakout
                </span>
              </>
            ) : (
              <>
                {hasChoch && (
                  <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-900 border border-orange-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-600" />
                    CHoCH Line (${chochPrice?.toFixed(1)})
                  </span>
                )}
                {hasIdm && (
                  <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-900 border border-purple-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-600" />
                    IDM Line (${idmPrice?.toFixed(1)})
                  </span>
                )}
                {(hasBos || pendingBosLevel > 0) && (
                  <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-600" />
                    {hasBos ? `BOS Line ($${shPrice?.toFixed(1)})` : `BOS Trigger ($${bosDisplayPrice?.toFixed(1)})`}
                  </span>
                )}
                {hasFvg && (
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                    FVG Zone (${fvgBottomPrice.toFixed(1)} – ${fvgTopPrice.toFixed(1)})
                  </span>
                )}
                {hasPlannedLevels && (
                  <>
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                      Touching Point (${effectiveEntryPrice.toLocaleString()})
                    </span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                      {isLiveCandidate ? 'Planned Entry' : `${candleData?.timeframe || '1M'} Entry`} (${effectiveEntryPrice.toLocaleString()})
                    </span>
                    <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                      Stop Loss (${effectiveStopLoss.toLocaleString()})
                    </span>
                    <span className="px-2 py-0.5 rounded bg-green-100 text-green-900 border border-green-300 font-bold text-[10px] flex items-center gap-1.5 shadow-2xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-600" />
                      Take Profit (${effectiveTakeProfit.toLocaleString()})
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            <span className="text-[11px] font-semibold text-slate-500">
              Drawings are hidden. Toggle "Drawings: Off" above to display SMC overlays.
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
            Rule #8 SL · {candleData?.timeframe || '1M'} Execution
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
                {/* ── TradingView-style Risk/Reward Position Boxes (Active & Backtest Trades Only) ── */}
                {!isLiveCandidate && (
                  <>
                    {/* Green Target Zone: from realEntryIdx to realExitIdx */}
                    <rect
                      x={getX(realEntryIdx)}
                      y={Math.min(entryY, tpY)}
                      width={Math.max(candleSpacing, getX(realExitIdx) - getX(realEntryIdx))}
                      height={Math.max(2, Math.abs(entryY - tpY))}
                      fill="url(#tpGradientLight)"
                      stroke="#10b981"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      rx={2}
                    />
                    {/* Red Risk Zone: from realEntryIdx to realExitIdx */}
                    <rect
                      x={getX(realEntryIdx)}
                      y={Math.min(entryY, slY)}
                      width={Math.max(candleSpacing, getX(realExitIdx) - getX(realEntryIdx))}
                      height={Math.max(2, Math.abs(entryY - slY))}
                      fill="url(#slGradientLight)"
                      stroke="#ef4444"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      rx={2}
                    />
                  </>
                )}

                {/* ── BOS Horizontal Structure Line (TradingView SMC Reference) ── */}
                {(hasBos || pendingBosLevel > 0) && (
                  <g className="bos-clean-segment">
                    <line
                      x1={paddingLeft}
                      y1={bosY}
                      x2={chartWidth + paddingLeft}
                      y2={bosY}
                      stroke="#0284c7"
                      strokeWidth={1.8}
                      strokeDasharray={hasBos ? "5 3" : "2 2"}
                    />
                    <g transform={`translate(${chartWidth + paddingLeft - 50}, ${bosY + (isLong ? -11 : 13)})`}>
                      <rect x={-45} y={-8} width={90} height={16} rx={3} fill="#0284c7" stroke="#bae6fd" strokeWidth={0.8} />
                      <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        {hasBos ? `BOS $${bosDisplayPrice.toFixed(1)}` : `BOS Trigger $${bosDisplayPrice.toFixed(1)}`}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── IDM Horizontal Inducement Line (TradingView SMC Reference) ── */}
                {hasIdm && idmPrice > 0 && (
                  <g className="idm-clean-segment">
                    <line
                      x1={paddingLeft}
                      y1={idmY}
                      x2={chartWidth + paddingLeft}
                      y2={idmY}
                      stroke="#9333ea"
                      strokeWidth={1.8}
                      strokeDasharray="4 3"
                    />
                    <g transform={`translate(${chartWidth + paddingLeft - 145}, ${idmY + (isLong ? 13 : -11)})`}>
                      <rect x={-40} y={-8} width={80} height={16} rx={3} fill="#9333ea" stroke="#e9d5ff" strokeWidth={0.8} />
                      <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        IDM ${idmPrice.toFixed(1)}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── CHoCH Horizontal Line (Change of Character Reference) ── */}
                {hasChoch && (
                  <g className="choch-clean-segment">
                    <line
                      x1={paddingLeft}
                      y1={chochY}
                      x2={chartWidth + paddingLeft}
                      y2={chochY}
                      stroke="#ea580c"
                      strokeWidth={1.8}
                      strokeDasharray="4 3"
                    />
                    <g transform={`translate(${chartWidth + paddingLeft - 235}, ${chochY + (isLong ? 13 : -11)})`}>
                      <rect x={-45} y={-8} width={90} height={16} rx={3} fill="#ea580c" stroke="#ffedd5" strokeWidth={0.8} />
                      <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        CHoCH ${chochPrice.toFixed(1)}
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
                        FVG ${fvgBottomPrice.toFixed(1)}–${fvgTopPrice.toFixed(1)}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── Retrace Waiting Zone between C1/FVG and Entry (Mitigation Wait) ── */}
                {hasFvg && realEntryIdx > realC1Idx + 2 && (
                  <g className="smc-retrace-wait-zone" opacity={0.9}>
                    <line
                      x1={getX(realC1Idx + 2) + candleBodyWidth / 2}
                      y1={(rawFvgTopY + rawFvgBottomY) / 2}
                      x2={getX(realEntryIdx) - candleBodyWidth / 2}
                      y2={(rawFvgTopY + rawFvgBottomY) / 2}
                      stroke="#d97706"
                      strokeWidth={1.4}
                      strokeDasharray="3 3"
                    />
                    <g transform={`translate(${(getX(realC1Idx + 2) + getX(realEntryIdx)) / 2}, ${(rawFvgTopY + rawFvgBottomY) / 2})`}>
                      <rect x={-52} y={-8} width={104} height={16} rx={3} fill="#fffbeb" stroke="#fde68a" strokeWidth={0.8} filter="drop-shadow(0 1px 2px rgba(0,0,0,0.08))" />
                      <text x={0} y={3.5} textAnchor="middle" fill="#92400e" fontSize="7.5" fontFamily="monospace" fontWeight="bold">
                        Wait Retrace ({realEntryIdx - realC1Idx - 2} bars)
                      </text>
                    </g>
                  </g>
                )}

                {/* ── 6A. Retracement Touching Point Marker (Where Price Retraced into FVG) ── */}
                {hasPlannedLevels && effectiveEntryPrice > 0 && (
                  <g className="touch-point-marker">
                    <circle cx={getX(realEntryIdx)} cy={entryY} r={7} fill="none" stroke="#f59e0b" strokeWidth={2} />
                    <circle cx={getX(realEntryIdx)} cy={entryY} r={3.5} fill="#f59e0b" />
                    <g transform={`translate(${getX(realEntryIdx)}, ${entryY + (isLong ? 18 : -14)})`}>
                      <rect x={-55} y={-8} width={110} height={16} rx={3} fill="#78350f" stroke="#fde68a" strokeWidth={0.8} />
                      <text x={0} y={3.5} textAnchor="middle" fill="#fef3c7" fontSize="7.5" fontFamily="monospace" fontWeight="bold">
                        Touching Point ${effectiveEntryPrice.toFixed(1)}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── 6B. Entry Level Segment ── */}
                {hasPlannedLevels && (
                  <g className="entry-clean-segment">
                    <line
                      x1={isLiveCandidate ? getX(realC1Idx) : getX(realEntryIdx)}
                      y1={entryY}
                      x2={isLiveCandidate ? getX(candleCount - 1) + 40 : getX(realExitIdx)}
                      y2={entryY}
                      stroke={isLiveCandidate ? "#d97706" : "#16a34a"}
                      strokeWidth={1.8}
                      strokeDasharray={isLiveCandidate ? "4 3" : "3 2"}
                    />
                    {!isLiveCandidate && (
                      <circle cx={getX(realEntryIdx)} cy={entryY} r={4} fill="#16a34a" stroke="#ffffff" strokeWidth={1.5} />
                    )}
                    <g transform={`translate(${isLiveCandidate ? Math.max(getX(realC1Idx) + 6, getX(candleCount - 1) - 60) : getX(realEntryIdx) + 6}, ${entryY - 8})`}>
                      <rect x={0} y={0} width={isLiveCandidate ? 116 : 82} height={16} rx={3} fill={isLiveCandidate ? "#d97706" : "#16a34a"} fillOpacity={0.92} />
                      <text x={isLiveCandidate ? 58 : 41} y={11} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        {isLiveCandidate ? `PLANNED ENTRY $${effectiveEntryPrice.toFixed(1)}` : `ENTRY $${effectiveEntryPrice.toFixed(1)}`}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── 7. Stop Loss Segment (Anchored strictly to Candle 1 Low / High - Rule #8) ── */}
                {hasPlannedLevels && (
                  <g className="sl-clean-segment">
                    <circle cx={getX(realC1Idx)} cy={slY} r={4} fill="#ef4444" stroke="#ffffff" strokeWidth={1.5} />
                    <line
                      x1={getX(realC1Idx)}
                      y1={slY}
                      x2={isLiveCandidate ? getX(candleCount - 1) + 40 : getX(realExitIdx)}
                      y2={slY}
                      stroke="#ef4444"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                    />
                    <g transform={`translate(${getX(realC1Idx)}, ${slY + (isLong ? 15 : -8)})`}>
                      <rect x={-4} y={-8} width={isLiveCandidate ? 124 : 102} height={16} rx={3} fill="#be123c" fillOpacity={0.95} />
                      <text x={isLiveCandidate ? 58 : 47} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        {isLiveCandidate ? `PLANNED SL $${effectiveStopLoss.toFixed(1)} (C1)` : `SL $${effectiveStopLoss.toFixed(1)} (C1 ${isLong ? 'Low' : 'High'})`}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── 8. Take Profit Segment (Begins at Entry or C1, extends to Exit or live edge - Rule #9) ── */}
                {hasPlannedLevels && (
                  <g className="tp-clean-segment">
                    <line
                      x1={isLiveCandidate ? getX(realC1Idx) : getX(realEntryIdx)}
                      y1={tpY}
                      x2={isLiveCandidate ? getX(candleCount - 1) + 40 : getX(realExitIdx)}
                      y2={tpY}
                      stroke="#10b981"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                    />
                    {!isLiveCandidate && (
                      <circle cx={getX(realExitIdx)} cy={tpY} r={4} fill="#10b981" stroke="#ffffff" strokeWidth={1.5} />
                    )}
                    <g transform={`translate(${isLiveCandidate ? Math.max(getX(realC1Idx) + 6, getX(candleCount - 1) - 60) : getX(realEntryIdx)}, ${tpY + (isLong ? -8 : 15)})`}>
                      <rect x={0} y={-8} width={isLiveCandidate ? 116 : 96} height={16} rx={3} fill="#15803d" fillOpacity={0.95} />
                      <text x={isLiveCandidate ? 58 : 48} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                        {isLiveCandidate ? `PLANNED TP $${effectiveTakeProfit.toFixed(1)} (1:2)` : `TP $${effectiveTakeProfit.toFixed(1)} (1:2 R:R)`}
                      </text>
                    </g>
                  </g>
                )}

                {/* ── Live Market Trading Range (TradingView SMC style when scanning without BOS) ── */}
                {isLiveCandidate && !hasBos && (
                  <g className="live-market-swing-range">
                    {/* Confirmed Swing High Horizontal Range Boundary */}
                    {candleData?.recent_swing_high && (
                      <g className="recent-swing-high">
                        <line
                          x1={getX(candleData.recent_swing_high.index)}
                          y1={getY(candleData.recent_swing_high.price)}
                          x2={getX(candleCount - 1) + 45}
                          y2={getY(candleData.recent_swing_high.price)}
                          stroke="#0284c7"
                          strokeWidth={1.6}
                          strokeDasharray="4 3"
                        />
                        <circle
                          cx={getX(candleData.recent_swing_high.index)}
                          cy={getY(candleData.recent_swing_high.price)}
                          r={3.5}
                          fill="#0284c7"
                          stroke="#ffffff"
                          strokeWidth={1}
                        />
                        <g transform={`translate(${getX(candleData.recent_swing_high.index)}, ${getY(candleData.recent_swing_high.price) - 13})`}>
                          <rect x={-45} y={-8} width={90} height={16} rx={3} fill="#0284c7" fillOpacity={0.92} />
                          <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                            Swing High ${candleData.recent_swing_high.price.toFixed(1)}
                          </text>
                        </g>
                      </g>
                    )}

                    {/* Confirmed Swing Low Horizontal Range Boundary */}
                    {candleData?.recent_swing_low && (
                      <g className="recent-swing-low">
                        <line
                          x1={getX(candleData.recent_swing_low.index)}
                          y1={getY(candleData.recent_swing_low.price)}
                          x2={getX(candleCount - 1) + 45}
                          y2={getY(candleData.recent_swing_low.price)}
                          stroke="#e11d48"
                          strokeWidth={1.6}
                          strokeDasharray="4 3"
                        />
                        <circle
                          cx={getX(candleData.recent_swing_low.index)}
                          cy={getY(candleData.recent_swing_low.price)}
                          r={3.5}
                          fill="#e11d48"
                          stroke="#ffffff"
                          strokeWidth={1}
                        />
                        <g transform={`translate(${getX(candleData.recent_swing_low.index)}, ${getY(candleData.recent_swing_low.price) + 15})`}>
                          <rect x={-45} y={-8} width={90} height={16} rx={3} fill="#be123c" fillOpacity={0.92} />
                          <text x={0} y={3.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
                            Swing Low ${candleData.recent_swing_low.price.toFixed(1)}
                          </text>
                        </g>
                      </g>
                    )}
                  </g>
                )}
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

              const isTradeCandle = idx >= realEntryIdx && idx <= realExitIdx;
              const isEntryCandle = idx === realEntryIdx;
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
            {showDrawings && candleData && (!isLiveCandidate || isLiveActive) && (
              <g transform={`translate(${getX(realEntryIdx)}, ${entryY})`}>
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
                    ↗ Entry ${effectiveEntryPrice.toFixed(1)}
                  </text>
                </g>
              </g>
            )}

            {/* ── Position Status / Exit Marker ── */}
            {showDrawings && candleData && !isLiveCandidate && (
              <>
                {trade.result === 'ACTIVE_OPEN' || isLiveActive ? (
                  /* Active Open Trade Indicator - Never show false Loss! */
                  <g transform={`translate(${getX(realExitIdx)}, ${entryY})`}>
                    <circle r={5} fill="#0ea5e9" stroke="#ffffff" strokeWidth={1.5} />
                    <g transform="translate(8, -10)">
                      <rect
                        width={124}
                        height={20}
                        rx={4}
                        fill="#0284c7"
                        stroke="#bae6fd"
                        strokeWidth={1}
                        filter="drop-shadow(0 1px 3px rgba(0,0,0,0.15))"
                      />
                      <text
                        x={62}
                        y={13.5}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="8.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        ● IN TRADE (Open)
                      </text>
                    </g>
                  </g>
                ) : (
                  /* Completed Trade Exit Flag (WIN / LOSS / BREAKEVEN) */
                  (trade.result === 'WIN' || trade.result === 'LOSS' || trade.result === 'BREAKEVEN') && (
                    <g transform={`translate(${getX(realExitIdx)}, ${isWin ? tpY : slY})`}>
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
                          {isWin ? '🏆 WIN (+2R)' : trade.result === 'BREAKEVEN' ? '⚖️ BREAKEVEN' : '🛑 LOSS (-1R)'}
                        </text>
                      </g>
                    </g>
                  )
                )}
              </>
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
        {isLiveCandidate && !hasBos ? (
          <>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Confirmed Swing High (HH)
              </span>
              <span className="text-sky-700 font-bold block text-sm">
                {candleData?.recent_swing_high ? `$${candleData.recent_swing_high.price.toLocaleString()}` : 'Scanning'}
              </span>
              <span className="text-slate-400 text-[10px] block">
                {candleData?.recent_swing_high?.timestamp ? candleData.recent_swing_high.timestamp.slice(11, 16) + ' UTC' : '15M Closed Bar'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Confirmed Swing Low (LL)
              </span>
              <span className="text-rose-700 font-bold block text-sm">
                {candleData?.recent_swing_low ? `$${candleData.recent_swing_low.price.toLocaleString()}` : 'Scanning'}
              </span>
              <span className="text-slate-400 text-[10px] block">
                {candleData?.recent_swing_low?.timestamp ? candleData.recent_swing_low.timestamp.slice(11, 16) + ' UTC' : '15M Closed Bar'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Live Price (Last Closed)
              </span>
              <span className="text-slate-900 font-bold block text-sm">
                ${candleData?.current_price ? candleData.current_price.toLocaleString() : (candles[candles.length - 1]?.[4]?.toLocaleString() ?? '—')}
              </span>
              <span className="text-slate-400 text-[10px] block">
                Spread: ${(trade as any)?.spread ? (trade as any).spread.toFixed(2) : '0.01'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Structure Condition
              </span>
              <span className="text-amber-800 font-bold block text-sm">
                In Range (No BOS)
              </span>
              <span className="text-slate-400 text-[10px] block">
                Waiting Candle Body Close
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                Strategy State
              </span>
              <span className="font-bold text-sm block text-sky-700">
                SCANNING 15M
              </span>
              <span className="text-slate-500 text-[10px] block">
                TradingView SMC Synced
              </span>
            </div>
          </>
        ) : (
          <>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                {isLiveCandidate ? 'Planned Entry (FVG Boundary)' : 'Entry (IST Kolkata)'}
              </span>
              <span className="text-slate-700">{trade.entry_time_ist || trade.entry_time.slice(0, 16)}</span>
              <span className="text-sky-700 font-bold block">${effectiveEntryPrice.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                {isLiveCandidate ? 'Planned Take Profit (1:2 RR)' : 'Exit (IST Kolkata)'}
              </span>
              <span className="text-slate-700">{trade.exit_time_ist || trade.exit_time.slice(0, 16)}</span>
              <span className={isWin ? 'text-emerald-600 font-bold block' : 'text-slate-700 font-bold block'}>
                ${effectiveTakeProfit.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                {isLiveCandidate ? 'Planned Stop Loss' : 'Stop Loss (1R)'}
              </span>
              <span className="text-rose-600 font-medium">${effectiveStopLoss.toLocaleString()}</span>
              <span className="text-slate-400 text-[10px] block">Risk: ${trade.risk_distance ? trade.risk_distance.toFixed(1) : '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">Take Profit (2R)</span>
              <span className="text-emerald-600 font-medium">${effectiveTakeProfit.toLocaleString()}</span>
              <span className="text-slate-400 text-[10px] block">R:R {trade.rr_ratio}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                {isLiveCandidate ? 'Setup Status' : 'Result & Duration'}
              </span>
              <span className={`font-bold text-sm block ${isLiveCandidate ? 'text-amber-700' : isWin ? 'text-emerald-600' : 'text-rose-600'}`}>
                {isLiveCandidate ? (candleData?.stage_status || 'WAITING RETRACEMENT') : trade.result}
                {!isLiveCandidate && ` (${trade.pnl_percent >= 0 ? `+${trade.pnl_percent}%` : `${trade.pnl_percent}%`})`}
              </span>
              <span className="text-slate-500 text-[10px] block">
                {isLiveCandidate ? 'No position open · Live monitoring' : (trade.duration_hours ? `${trade.duration_hours}h duration · ` : '') + `Bal: $${trade.running_balance.toLocaleString()}`}
              </span>
            </div>
          </>
        )}
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

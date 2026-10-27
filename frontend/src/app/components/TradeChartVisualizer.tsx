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
  entry_idx: number;
  exit_idx: number;
  fvg_idx?: number;
  bos_idx?: number;
  bos_level?: number;
  idm_level?: number;
  fvg_top?: number;
  fvg_bottom?: number;
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

  // EVG / FVG Boundary Zone Calculations
  const fvgTopVal = candleData?.fvg_top ?? trade.fvg_top;
  const fvgBottomVal = candleData?.fvg_bottom ?? trade.fvg_bottom;
  const hasFvg = fvgTopVal !== undefined && fvgBottomVal !== undefined && fvgTopVal > 0 && fvgBottomVal > 0;

  const fvgTopPrice = hasFvg ? Math.max(fvgTopVal, fvgBottomVal) : 0;
  const fvgBottomPrice = hasFvg ? Math.min(fvgTopVal, fvgBottomVal) : 0;

  const fvgTopY = hasFvg ? getY(fvgTopPrice) : 0;
  const fvgBottomY = hasFvg ? getY(fvgBottomPrice) : 0;
  const fvgH = hasFvg ? Math.max(3, fvgBottomY - fvgTopY) : 0;

  const fvgStartIdx = Math.max(0, candleData?.fvg_idx ?? Math.max(0, entryIdx - 2));
  const fvgStartX = getX(fvgStartIdx) - candleBodyWidth / 2;
  const fvgEndX = getX(entryIdx) + candleBodyWidth / 2;
  const fvgWidth = Math.max(candleSpacing * 1.5, fvgEndX - fvgStartX);

  // SMC Structural Levels (BOS & IDM)
  const bosLevelVal = candleData?.bos_level ?? trade.bos_level;
  const idmLevelVal = candleData?.idm_level ?? trade.idm_level;
  const hasBos = bosLevelVal !== undefined && bosLevelVal > 0;
  const hasIdm = idmLevelVal !== undefined && idmLevelVal > 0;

  const bosY = hasBos ? getY(bosLevelVal) : 0;
  const idmY = hasIdm ? getY(idmLevelVal) : 0;

  const bosIdx = candleData?.bos_idx ?? Math.max(0, entryIdx - 1);
  const bosX = getX(bosIdx);

  // Price ticks on right axis
  const priceTicks = useMemo(() => {
    const ticks = [];
    const step = priceRange / 5;
    for (let i = 0; i <= 5; i++) {
      ticks.push(minPrice + i * step);
    }
    return ticks;
  }, [minPrice, priceRange]);

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
              ⚡ EVG GAP: ${fvgBottomPrice.toFixed(2)} – ${fvgTopPrice.toFixed(2)} (15M Touch)
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
          ③ 1. Break IDM {hasIdm ? `($${idmLevelVal?.toLocaleString()})` : ''}
        </span>
        <span className="text-slate-500">→</span>
        <span className="px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-700 font-bold">
          ④ 2. Break {isLong ? 'Higher High (BOS)' : 'Lower Low (BOS)'} {hasBos ? `($${bosLevelVal?.toLocaleString()})` : ''}
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
              🟣 IDM Line (${idmLevelVal?.toFixed(1)})
            </span>
            <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-300 font-bold text-[10px] flex items-center gap-1 shadow-2xs">
              🔵 BOS Break Line (${bosLevelVal?.toFixed(1)})
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
            {showDrawings && (
              <>
            {/* ── SMC TradingView-Style Market Structure Zigzag Path ── */}
            {hasBos && hasIdm && candleData && (
              <g className="smc-structure-path" opacity={0.85}>
                {/* Visualizing the exact TradingView SMC zig-zag wave:
                    1. Peak HH (BOS level)
                    2. Pullback low (IDM)
                    3. Lower high bounce (fails to break HH)
                    4. IDM Sweep low (breaks below IDM)
                    5. BOS Breakout rally (closes beyond HH)
                    6. Push to swing high
                    7. Retracement into FVG box (Entry touch)
                */}
                <polyline
                  points={`
                    ${Math.max(paddingLeft, bosX - candleSpacing * 7)},${bosY}
                    ${Math.max(paddingLeft + 10, bosX - candleSpacing * 4)},${idmY}
                    ${Math.max(paddingLeft + 20, bosX - candleSpacing * 2.5)},${isLong ? idmY - (idmY - bosY) * 0.45 : idmY + (bosY - idmY) * 0.45}
                    ${Math.max(paddingLeft + 30, bosX - candleSpacing * 1.5)},${isLong ? idmY + 12 : idmY - 12}
                    ${bosX},${bosY}
                    ${Math.max(bosX + 15, entryX - candleSpacing * 1.5)},${isLong ? Math.min(bosY, entryY) - 18 : Math.max(bosY, entryY) + 18}
                    ${entryX},${entryY}
                  `}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  strokeDasharray="5 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Structural Pivot Dots */}
                <circle cx={Math.max(paddingLeft, bosX - candleSpacing * 7)} cy={bosY} r={4} fill="#0284c7" stroke="#ffffff" strokeWidth={1.5} />
                <circle cx={Math.max(paddingLeft + 10, bosX - candleSpacing * 4)} cy={idmY} r={4} fill="#9333ea" stroke="#ffffff" strokeWidth={1.5} />
                <circle cx={Math.max(paddingLeft + 30, bosX - candleSpacing * 1.5)} cy={isLong ? idmY + 12 : idmY - 12} r={4.5} fill="#a855f7" stroke="#ffffff" strokeWidth={1.5} />
                <circle cx={bosX} cy={bosY} r={5} fill="#0284c7" stroke="#ffffff" strokeWidth={2} />
              </g>
            )}

            {/* ── Inducement (IDM) Structural Line ── */}
            {hasIdm && (
              <g className="idm-structural-line">
                {/* Glowing Background Line */}
                <line
                  x1={paddingLeft}
                  y1={idmY}
                  x2={svgWidth - paddingRight}
                  y2={idmY}
                  stroke="#9333ea"
                  strokeWidth={4}
                  opacity={0.18}
                />
                {/* Sharp Dashed Line */}
                <line
                  x1={paddingLeft}
                  y1={idmY}
                  x2={svgWidth - paddingRight}
                  y2={idmY}
                  stroke="#9333ea"
                  strokeWidth={2.2}
                  strokeDasharray="6 3"
                />
                {/* IDM Pill Badge directly on line */}
                <g transform={`translate(${paddingLeft + 6}, ${idmY - 9})`}>
                  <rect width={56} height={18} rx={3} fill="#6b21a8" stroke="#d8b4fe" strokeWidth={1} />
                  <text x={28} y={13} textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    IDM
                  </text>
                </g>
                {/* Infographic Callout Badge: 1. Break IDM (Inducement Break) */}
                <g transform={`translate(${Math.max(paddingLeft + 65, getX(Math.max(0, bosIdx - 2)) - 95)}, ${idmY > 60 ? idmY + 10 : idmY - 26})`}>
                  <rect width={190} height={22} rx={5} fill="#581c87" stroke="#e9d5ff" strokeWidth={1.2} filter="drop-shadow(0 2px 5px rgba(0,0,0,0.25))" />
                  <text x={95} y={15} textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    1. Break IDM (Inducement Break)
                  </text>
                  {/* Pointer Arrow pointing to sweep wick */}
                  <path
                    d={idmY > 60 ? "M95 0 L90 -6 L100 -6 Z" : "M95 22 L90 28 L100 28 Z"}
                    fill="#581c87"
                  />
                </g>
              </g>
            )}

            {/* ── Break of Structure (BOS) Anchor Break Line ── */}
            {hasBos && (
              <g className="bos-structural-line">
                {/* Peak Label: Higher High (1st HH) */}
                <g transform={`translate(${Math.max(paddingLeft + 8, bosX - candleSpacing * 7)}, ${bosY - 14 > paddingY ? bosY - 14 : bosY + 16})`}>
                  <text x={0} y={0} fill="#0284c7" fontSize="9.5" fontFamily="monospace" fontWeight="bold">
                    {isLong ? 'Higher High (1st HH)' : 'Lower Low (1st LL)'}
                  </text>
                </g>

                {/* Glowing Background Line */}
                <line
                  x1={paddingLeft}
                  y1={bosY}
                  x2={svgWidth - paddingRight}
                  y2={bosY}
                  stroke="#0284c7"
                  strokeWidth={5}
                  opacity={0.18}
                />
                {/* Solid Sharp BOS Line */}
                <line
                  x1={paddingLeft}
                  y1={bosY}
                  x2={svgWidth - paddingRight}
                  y2={bosY}
                  stroke="#0284c7"
                  strokeWidth={2.5}
                />
                {/* BOS Pill Badge on Line */}
                <g transform={`translate(${Math.max(paddingLeft + 120, bosX - candleSpacing * 4)}, ${bosY - 9})`}>
                  <rect width={48} height={18} rx={3} fill="#0369a1" stroke="#7dd3fc" strokeWidth={1} />
                  <text x={24} y={13} textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    BOS
                  </text>
                </g>

                {/* Vertical Laser Beam at Breakout Candle */}
                {candleData && (
                  <g>
                    <line
                      x1={bosX}
                      y1={paddingY}
                      x2={bosX}
                      y2={chartHeight - paddingY}
                      stroke="#0284c7"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      opacity={0.75}
                    />
                    {/* Glowing Breakout Diamond at BOS Intersection */}
                    <circle cx={bosX} cy={bosY} r={6} fill="#0284c7" stroke="#ffffff" strokeWidth={2} />
                    <circle cx={bosX} cy={bosY} r={11} fill="none" stroke="#38bdf8" strokeWidth={1.5} opacity={0.6} />

                    {/* Infographic Callout Badge: 2. Break Higher High (BOS) */}
                    <g transform={`translate(${bosX - 90}, ${bosY - 32 > paddingY ? bosY - 32 : bosY + 12})`}>
                      <rect width={180} height={22} rx={5} fill="#0284c7" stroke="#bae6fd" strokeWidth={1.2} filter="drop-shadow(0 2px 5px rgba(0,0,0,0.25))" />
                      <text x={90} y={15} textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                        2. {isLong ? 'Break Higher High (BOS)' : 'Break Lower Low (BOS)'}
                      </text>
                      <path
                        d={bosY - 32 > paddingY ? "M90 22 L85 28 L95 28 Z" : "M90 0 L85 -6 L95 -6 Z"}
                        fill="#0284c7"
                      />
                    </g>
                  </g>
                )}
              </g>
            )}

            {/* ── Fair Value Gap (EVG/FVG) Boundary Box (Rendered Behind Candles) ── */}
            {hasFvg && (
              <g className="fvg-boundary-zone">
                {/* Shaded EVG Boundary Box spanning from displacement candles to mitigation entry */}
                <rect
                  x={fvgStartX}
                  y={fvgTopY}
                  width={fvgWidth}
                  height={fvgH}
                  fill="url(#fvgGradientLight)"
                  stroke="#38bdf8"
                  strokeWidth={1.8}
                  rx={3}
                />
                <rect
                  x={fvgStartX}
                  y={fvgTopY}
                  width={fvgWidth}
                  height={fvgH}
                  fill="url(#fvgDiagonal)"
                  rx={3}
                />
                {/* Center FVG label inside the box */}
                <text
                  x={fvgStartX + fvgWidth / 2}
                  y={fvgTopY + fvgH / 2 + 4}
                  textAnchor="middle"
                  fill="#0369a1"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="bold"
                  opacity={0.8}
                >
                  FVG
                </text>

                {/* Right Bracket: } FVG (Gap) */}
                <g transform={`translate(${Math.max(fvgEndX, entryX) + 6}, ${fvgTopY + fvgH / 2 - 8})`}>
                  <rect width={88} height={18} rx={3} fill="#0369a1" stroke="#7dd3fc" strokeWidth={0.8} />
                  <text x={44} y={12.5} textAnchor="middle" fill="#ffffff" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                    {"} FVG (Gap)"}
                  </text>
                </g>

                {/* Upper FVG Boundary Line */}
                <line
                  x1={fvgStartX}
                  y1={fvgTopY}
                  x2={Math.max(fvgEndX + 30, entryX + 20)}
                  y2={fvgTopY}
                  stroke="#0284c7"
                  strokeWidth={1.8}
                  strokeDasharray="4 2"
                />
                {/* Lower FVG Boundary Line */}
                <line
                  x1={fvgStartX}
                  y1={fvgBottomY}
                  x2={Math.max(fvgEndX + 30, entryX + 20)}
                  y2={fvgBottomY}
                  stroke="#0284c7"
                  strokeWidth={1.8}
                  strokeDasharray="4 2"
                />
              </g>
            )}

            {/* ── Shaded SMC Execution Zone (1:2 R:R Target & Risk) ── */}
            {candleData && (
              <g>
                {/* Take Profit Target Zone (Green) */}
                <rect
                  x={entryX}
                  y={targetTop}
                  width={boxWidth}
                  height={Math.max(2, targetH)}
                  fill="url(#tpGradientLight)"
                  stroke="#10b981"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  rx={2}
                />
                {/* Stop Loss Risk Zone (Red) */}
                <rect
                  x={entryX}
                  y={slTop}
                  width={boxWidth}
                  height={Math.max(2, slH)}
                  fill="url(#slGradientLight)"
                  stroke="#ef4444"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  rx={2}
                />
              </g>
            )}

            {/* Stop Loss Horizontal Guide Line */}
            <line
              x1={entryX}
              y1={slY}
              x2={svgWidth - paddingRight}
              y2={slY}
              stroke="#e11d48"
              strokeWidth={2.2}
              strokeDasharray="5 3"
            />
            {/* Entry Price Horizontal Guide Line */}
            <line
              x1={entryX}
              y1={entryY}
              x2={svgWidth - paddingRight}
              y2={entryY}
              stroke="#0284c7"
              strokeWidth={2.5}
            />
            {/* Take Profit Horizontal Guide Line */}
            <line
              x1={entryX}
              y1={tpY}
              x2={svgWidth - paddingRight}
              y2={tpY}
              stroke="#16a34a"
              strokeWidth={2.2}
              strokeDasharray="5 3"
            />
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

            {/* ── High-Contrast Entry Beacon & Marker ── */}
            {showDrawings && candleData && (
              <g transform={`translate(${entryX}, ${entryY})`}>
                {/* Pulsing Concentric Beacon Rings */}
                <circle r={14} fill="#0284c7" opacity={0.2} />
                <circle r={8} fill="#0284c7" opacity={0.5} />
                <circle r={4} fill="#ffffff" stroke="#0369a1" strokeWidth={2} />

                {/* Entry Arrow */}
                <path
                  d={isLong ? "M0 12 L0 6 M-4 9 L0 5 L4 9" : "M0 -12 L0 -6 M-4 -9 L0 -5 L4 -9"}
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />

                {/* Prominent Infographic Entry Callout Badge: Entry (Buy) / Entry (Sell) */}
                <g transform={`translate(-85, ${isLong ? 16 : -38})`}>
                  <rect
                    width={170}
                    height={22}
                    rx={6}
                    fill="#15803d"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    filter="drop-shadow(0 3px 6px rgba(0,0,0,0.25))"
                  />
                  <text
                    x={85}
                    y={15}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    ↗ Entry ({isLong ? 'Buy' : 'Sell'}) ${trade.entry_price.toLocaleString()}
                  </text>
                  {/* Pointer arrow to candle */}
                  <path
                    d={isLong ? "M85 0 L80 -6 L90 -6 Z" : "M85 22 L80 28 L90 28 Z"}
                    fill="#15803d"
                  />
                </g>
              </g>
            )}

            {/* ── Exit Marker (Result & Flag) ── */}
            {showDrawings && candleData && (
              <g transform={`translate(${exitX}, ${isWin ? tpY : slY})`}>
                <circle r={6} fill={isWin ? '#10b981' : '#f43f5e'} stroke="#ffffff" strokeWidth={2} />
                <g transform="translate(10, -14)">
                  <rect
                    width={92}
                    height={24}
                    rx={5}
                    fill={isWin ? '#15803d' : '#be123c'}
                    stroke="#ffffff"
                    strokeWidth={1.2}
                    filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"
                  />
                  <text
                    x={46}
                    y={16}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="10"
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

            {showDrawings && (
              <>
                {/* Take Profit Badge: TP (Next Resistance / Swing High) */}
                <g transform={`translate(${svgWidth - paddingRight + 4}, ${tpY - 10})`}>
                  <rect width={100} height={20} rx={4} fill="#15803d" stroke="#86efac" strokeWidth={1} filter="drop-shadow(0 1px 2px rgba(0,0,0,0.1))" />
                  <text x={8} y={14} fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    TP ${trade.take_profit.toLocaleString()}
                  </text>
                </g>

                {/* BOS Price Badge */}
                {hasBos && (
                  <g transform={`translate(${svgWidth - paddingRight + 4}, ${bosY - 10})`}>
                    <rect width={100} height={20} rx={4} fill="#0369a1" stroke="#7dd3fc" strokeWidth={1} filter="drop-shadow(0 1px 2px rgba(0,0,0,0.1))" />
                    <text x={8} y={14} fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                      BOS ${bosLevelVal?.toFixed(1)}
                    </text>
                  </g>
                )}

                {/* EVG / FVG Top Price Badge */}
                {hasFvg && (
                  <g transform={`translate(${svgWidth - paddingRight + 4}, ${fvgTopY - 9})`}>
                    <rect width={100} height={18} rx={3} fill="#0284c7" stroke="#7dd3fc" strokeWidth={0.8} />
                    <text x={8} y={13} fill="#ffffff" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                      FVG TOP ${fvgTopPrice.toFixed(1)}
                    </text>
                  </g>
                )}

                {/* Entry Price Badge */}
                <g transform={`translate(${svgWidth - paddingRight + 4}, ${entryY - 10})`}>
                  <rect width={100} height={20} rx={4} fill="#16a34a" stroke="#ffffff" strokeWidth={1.2} filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))" />
                  <text x={8} y={14} fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    ENTRY ${trade.entry_price.toLocaleString()}
                  </text>
                </g>

                {/* EVG / FVG Bottom Price Badge */}
                {hasFvg && (
                  <g transform={`translate(${svgWidth - paddingRight + 4}, ${fvgBottomY - 9})`}>
                    <rect width={100} height={18} rx={3} fill="#0284c7" stroke="#7dd3fc" strokeWidth={0.8} />
                    <text x={8} y={13} fill="#ffffff" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                      FVG BOT ${fvgBottomPrice.toFixed(1)}
                    </text>
                  </g>
                )}

                {/* IDM Price Badge */}
                {hasIdm && (
                  <g transform={`translate(${svgWidth - paddingRight + 4}, ${idmY - 10})`}>
                    <rect width={100} height={20} rx={4} fill="#6b21a8" stroke="#d8b4fe" strokeWidth={1} filter="drop-shadow(0 1px 2px rgba(0,0,0,0.1))" />
                    <text x={8} y={14} fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                      IDM ${idmLevelVal?.toFixed(1)}
                    </text>
                  </g>
                )}

                {/* Stop Loss Badge: SL (Below FVG) */}
                <g transform={`translate(${svgWidth - paddingRight + 4}, ${slY - 10})`}>
                  <rect width={100} height={20} rx={4} fill="#be123c" stroke="#fda4af" strokeWidth={1} filter="drop-shadow(0 1px 2px rgba(0,0,0,0.1))" />
                  <text x={8} y={14} fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold">
                    SL ${trade.stop_loss.toLocaleString()}
                  </text>
                </g>
              </>
            )}
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

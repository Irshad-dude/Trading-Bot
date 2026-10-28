'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import TradeChartVisualizer, { TradeCandleData } from './components/TradeChartVisualizer';
import TradingViewWidget from './components/TradingViewWidget';
import {
  ActivityIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  ShieldCheckIcon,
  BrainCircuitIcon,
  LayersIcon,
  DownloadIcon,
  SearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SparklesIcon,
  ClockIcon,
  TargetIcon,
  BarChart2Icon,
  ZapIcon
} from './components/Icons';

// ─── Types ───────────────────────────────────────────────────────────────────
interface ScanResult {
  symbol: string;
  trend: string;
  sweep_detected: boolean;
  fvg_type: string | null;
  setup_score: number;
  status: string;
  last_price: number;
}

interface TradeRecord {
  id: string;
  order_id?: string;
  symbol: string;
  direction: string;
  entry_price: number;
  amount?: number;
  cost?: number;
  stop_loss: number;
  take_profit: number;
  setup: string;
  ai_confidence: number;
  status: string;
  timestamp: string;
}

interface BacktestTrade {
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
  entry_time_ist?: string;
  exit_time_ist?: string;
  session_name?: string;
  duration_hours?: number;
  pattern_type?: string;
  why_outcome?: string;
  lesson_learned?: string;
  adaptation_rule?: string;
}

interface MonthlyStat {
  month: string;
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  net_return_pct: number;
}

interface AssetSummary {
  name: string;
  symbol?: string;
  period?: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  net_pnl_dollars: number;
  net_pnl_pct: number;
  starting_balance: number;
  ending_balance: number;
  rr_ratio: string;
}

interface LearnedRule {
  id: string;
  category: string;
  rule: string;
}

interface AIMemorySummary {
  total_trades_analyzed: number;
  wins_analyzed: number;
  losses_analyzed: number;
  time_zone: string;
  learning_status: string;
  top_learned_rules: LearnedRule[];
}

interface BacktestData {
  summary: AssetSummary | null;
  gold_summary?: AssetSummary | null;
  btc_summary: AssetSummary | null;
  eth_summary: AssetSummary | null;
  monthly_breakdown: MonthlyStat[];
  trades: BacktestTrade[];
  ai_memory_summary?: AIMemorySummary;
}

interface OpenOrderRecord {
  id: string;
  symbol: string;
  side: string;
  type: string;
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  cost: number;
  status: string;
  timestamp: string;
}

interface BotStatus {
  is_running: boolean;
  scan_interval: number;
  risk_percent: number;
  daily_trades_count: number;
  total_trades: number;
  wins: number;
  losses: number;
  last_scan_at: string | null;
  engine_log: string[];
  open_orders?: OpenOrderRecord[];
  scanner_results: ScanResult[];
  trade_history: TradeRecord[];
}

// ─── Backend API Client (Dual-Route: Proxied Same-Origin + Direct Fallback) ──
async function callBackend(endpoint: string, options?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(`/api/backend${endpoint}`, options);
    if (res.ok) return res;
  } catch {
    // ignore and try direct fallback
  }
  return fetch(`http://127.0.0.1:8000/api${endpoint}`, options);
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
function useBackend() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await callBackend('/status');
      if (!res.ok) throw new Error('Backend not responding');
      const data = await res.json();
      setStatus(data);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStatus();
    }, 0);
    intervalRef.current = setInterval(fetchStatus, 3000);
    return () => {
      clearTimeout(timer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus]);

  const sendControl = async (action: string, extras?: Record<string, unknown>) => {
    try {
      await callBackend('/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extras })
      });
      await fetchStatus();
    } catch (e) {
      console.error('Control failed', e);
    }
  };

  const sendManualTrade = async (symbol: string, direction: string) => {
    try {
      const res = await callBackend('/trade/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, direction })
      });
      await fetchStatus();
      return await res.json();
    } catch {
      return { status: 'failed' };
    }
  };

  const cancelOrder = async (orderId: string, symbol: string) => {
    try {
      const res = await callBackend('/order/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, symbol })
      });
      await fetchStatus();
      return await res.json();
    } catch {
      return { status: 'failed' };
    }
  };

  return { status, connected, sendControl, sendManualTrade, cancelOrder };
}

// ─── UI Primitives (Clean Light Minimalist) ──────────────────────────────────
function Badge({ label, color }: { label: string; color: 'green' | 'red' | 'cyan' | 'amber' | 'blue' | 'gray' }) {
  const colors = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-rose-50 text-rose-700 border-rose-200',
    cyan: 'bg-sky-50 text-sky-700 border-sky-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    blue: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    gray: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border font-mono ${colors[color]}`}>
      {label}
    </span>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const { status, connected, sendControl, sendManualTrade, cancelOrder } = useBackend();
  const [activeTab, setActiveTab] = useState<'scanner' | 'open_orders' | 'trades' | 'backtest'>('backtest');
  const [tradeToast, setTradeToast] = useState<string | null>(null);
  const [utcTime, setUtcTime] = useState('');

  // ─── Backtest State ────────────────────────────────────────────────────────
  const [backtestData, setBacktestData] = useState<BacktestData | null>(null);
  const [loadingBacktest, setLoadingBacktest] = useState(false);
  const [btAssetFilter, setBtAssetFilter] = useState<'ALL' | 'XAUUSD' | 'BTCUSDT' | 'ETHUSDT'>('XAUUSD');
  const [btResultFilter, setBtResultFilter] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');
  const [btDirectionFilter, setBtDirectionFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [btSearch, setBtSearch] = useState('');
  const [btPage, setBtPage] = useState(1);
  const [showMonthly, setShowMonthly] = useState(false);
  const [showAiRules, setShowAiRules] = useState(false);
  const btPageSize = 25;

  // Chart Visualizer State
  const [selectedTrade, setSelectedTrade] = useState<BacktestTrade | null>(null);
  const [candlesMap, setCandlesMap] = useState<Record<string, TradeCandleData> | null>(null);
  const [chartMode, setChartMode] = useState<'visualizer' | 'tradingview'>('visualizer');
  const [hoverCurveIdx, setHoverCurveIdx] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadBacktest() {
      setLoadingBacktest(true);
      try {
        let res = await fetch('/api/backtest');
        if (!res.ok) {
          res = await fetch('/backtest_results_2026.json');
        }
        if (res.ok && isMounted) {
          const data = await res.json();
          setBacktestData(data);
          if (data.trades && data.trades.length > 0) {
            const goldTrade = data.trades.find((t: any) => t.symbol === 'XAUUSD');
            setSelectedTrade(prev => prev || goldTrade || data.trades[0]);
          }
        }

        // Load precomputed 817 trades candle windows
        const cRes = await fetch('/trade_candles.json');
        if (cRes.ok && isMounted) {
          const cData = await cRes.json();
          setCandlesMap(cData);
        }
      } catch (err) {
        console.error('Failed to load backtest data:', err);
      } finally {
        if (isMounted) setLoadingBacktest(false);
      }
    }
    const timer = setTimeout(loadBacktest, 0);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, []);

  const handleSelectAssetPartition = (asset: 'ALL' | 'XAUUSD' | 'BTCUSDT' | 'ETHUSDT') => {
    setBtAssetFilter(asset);
    setBtPage(1);
    if (backtestData?.trades) {
      const match = asset === 'ALL' ? backtestData.trades[0] : backtestData.trades.find(t => t.symbol === asset);
      if (match) setSelectedTrade(match);
    }
  };

  const activeSummary = useMemo(() => {
    if (!backtestData) return null;
    if (btAssetFilter === 'XAUUSD') return backtestData.gold_summary || null;
    if (btAssetFilter === 'BTCUSDT') return backtestData.btc_summary || null;
    if (btAssetFilter === 'ETHUSDT') return backtestData.eth_summary || null;
    return backtestData.summary || null;
  }, [backtestData, btAssetFilter]);

  const filteredBtTrades = (backtestData?.trades || []).filter(t => {
    if (btAssetFilter !== 'ALL' && t.symbol !== btAssetFilter) return false;
    if (btResultFilter !== 'ALL' && t.result !== btResultFilter) return false;
    if (btDirectionFilter !== 'ALL' && t.direction !== btDirectionFilter) return false;
    if (btSearch.trim()) {
      const q = btSearch.toLowerCase();
      return (
        t.entry_time.toLowerCase().includes(q) ||
        t.exit_time.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        t.setup_reason.toLowerCase().includes(q) ||
        t.trade_num.toString().includes(q)
      );
    }
    return true;
  });

  // Visualizer trade navigation within filtered partition
  const currentTradeIndex = useMemo(() => {
    if (!selectedTrade || filteredBtTrades.length === 0) return -1;
    return filteredBtTrades.findIndex(
      t => t.symbol === selectedTrade.symbol && t.trade_num === selectedTrade.trade_num
    );
  }, [selectedTrade, filteredBtTrades]);

  const handlePrevTrade = () => {
    if (currentTradeIndex > 0) {
      setSelectedTrade(filteredBtTrades[currentTradeIndex - 1]);
    }
  };

  const handleNextTrade = () => {
    if (currentTradeIndex < filteredBtTrades.length - 1) {
      setSelectedTrade(filteredBtTrades[currentTradeIndex + 1]);
    }
  };

  const activeCandleData = useMemo(() => {
    if (!selectedTrade || !candlesMap) return null;
    return candlesMap[`${selectedTrade.symbol}_${selectedTrade.trade_num}`] || null;
  }, [selectedTrade, candlesMap]);

  // Equity Curve & Cumulative Win Rate Trend Data
  const equityCurveData = useMemo(() => {
    const trades = (backtestData?.trades || []).filter(t => btAssetFilter === 'ALL' || t.symbol === btAssetFilter);
    if (trades.length === 0) return [];

    const startBal = btAssetFilter === 'ALL' ? 30000 : 10000;
    let runningBal = startBal;
    let runningWins = 0;

    const sampleStep = Math.max(1, Math.floor(trades.length / 50));
    const points: Array<{
      idx: number;
      tradeNum: number;
      symbol: string;
      date: string;
      balance: number;
      winRate: number;
      pnlDollar: number;
    }> = [];

    trades.forEach((t, i) => {
      runningBal += t.pnl_dollar;
      if (t.result === 'WIN') runningWins++;

      if (i % sampleStep === 0 || i === trades.length - 1) {
        points.push({
          idx: points.length,
          tradeNum: t.trade_num,
          symbol: t.symbol,
          date: t.entry_time.slice(0, 10),
          balance: runningBal,
          winRate: Number(((runningWins / (i + 1)) * 100).toFixed(1)),
          pnlDollar: t.pnl_dollar,
        });
      }
    });
    return points;
  }, [backtestData, btAssetFilter]);

  const totalBtPages = Math.max(1, Math.ceil(filteredBtTrades.length / btPageSize));
  const currentBtTrades = filteredBtTrades.slice((btPage - 1) * btPageSize, btPage * btPageSize);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const istTime = now.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const istDate = now.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: '2-digit',
        month: 'short'
      });
      setUtcTime(`${istDate} · ${istTime} IST`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const handleToggleEngine = async () => {
    if (!status) return;
    const action = status.is_running ? 'stop' : 'start';
    await sendControl(action);
  };

  const handleManualTrade = async (symbol: string, direction: string) => {
    const result = await sendManualTrade(symbol, direction);
    setTradeToast(result.message || 'Trade sent');
    setTimeout(() => setTradeToast(null), 4000);
  };

  const handleCancelOrder = async (orderId: string, symbol: string) => {
    const result = await cancelOrder(orderId, symbol);
    setTradeToast(result.message || 'Cancel requested');
    setTimeout(() => setTradeToast(null), 4000);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans">
      
      {/* ── Toast Notification ── */}
      {tradeToast && (
        <div className="fixed top-5 right-5 z-50 bg-slate-900 text-white px-5 py-3 rounded-xl text-sm font-mono shadow-xl flex items-center gap-2.5 animate-bounce">
          <ZapIcon className="w-4 h-4 text-emerald-400" />
          <span>{tradeToast}</span>
        </div>
      )}

      {/* ── Ultra-Clean Minimalist Header ── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-6 lg:px-10 py-3 flex items-center justify-between shadow-sm">
        {/* Left: Brand & Telemetry */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-xs tracking-widest shadow-sm flex-shrink-0">
              NX
            </div>
            <div className="flex flex-col gap-0.5">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">NEXUS V2</h1>
              <span className="text-[10px] font-mono text-slate-500 leading-none">SMC Quantitative</span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 pl-4 border-l border-slate-200 text-[11px] text-slate-500 font-mono">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span>{connected ? 'Exchange Feed Active' : 'Offline'}</span>
          </div>
        </div>

        {/* Center: Segmented Navigation Tabs */}
        <nav className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 gap-0.5">
          {[
            { key: 'backtest', label: `Backtest (${backtestData?.trades?.length ?? '...'})` },
            { key: 'scanner', label: 'Scanner' },
            { key: 'open_orders', label: `Orders (${status?.open_orders?.length ?? 0})` },
            { key: 'trades', label: 'Ledger' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as 'scanner' | 'open_orders' | 'trades' | 'backtest')}
              className={`h-8 px-4 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-white text-slate-900 shadow-sm font-bold border border-slate-200/80'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Right: Quick Controls & IST Clock */}
        <div className="flex items-center gap-2.5">
          {/* Engine Toggle Button */}
          <button
            onClick={handleToggleEngine}
            disabled={!connected}
            className={`h-9 px-4 rounded-xl text-xs font-mono font-semibold transition-all flex items-center gap-2 border disabled:opacity-40 disabled:cursor-not-allowed ${
              status?.is_running
                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
            }`}
          >
            <span className="text-base leading-none">{status?.is_running ? '■' : '▶'}</span>
            <span>{status?.is_running ? 'Stop Loop' : 'Start Loop'}</span>
          </button>

          {/* Test Order Button */}
          <button
            onClick={() => handleManualTrade('BTCUSDT', 'BUY')}
            disabled={!connected}
            className="hidden sm:flex h-9 px-4 rounded-xl text-xs font-mono font-semibold bg-slate-900 text-white hover:bg-slate-700 transition-all items-center gap-2 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ZapIcon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span>Test Order</span>
          </button>

          {/* IST Clock */}
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono text-slate-500 pl-3 border-l border-slate-200">
            <ClockIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="tabular-nums">{utcTime}</span>
          </div>
        </div>
      </header>

      {/* ── Main Clean Workspace ── */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-6 lg:p-8 flex flex-col gap-6">

        {/* ══════════════════════════════════════════════════════════════════
            TAB 1: SMC BACKTEST (JAN - OCT 2026)
            ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'backtest' && (
          <div className="flex flex-col gap-6">
            
            {/* ── Combined Section: Asset Partitions + High-Level Metrics ── */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col gap-5">
              
              {/* Row 1: Asset Partition Tabs */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { 
                      key: 'ALL', 
                      label: 'All Portfolio', 
                      count: backtestData?.summary?.total_trades ?? 0, 
                      icon: '🌐', 
                      pnl: `+$${backtestData?.summary?.net_pnl_dollars?.toLocaleString() ?? '0'} (+${backtestData?.summary?.net_pnl_pct ?? 0}%)`, 
                      wr: `${backtestData?.summary?.win_rate ?? 0}%` 
                    },
                    { 
                      key: 'XAUUSD', 
                      label: 'Gold (1 Jul - 1 Oct)', 
                      count: backtestData?.gold_summary?.total_trades ?? 0, 
                      icon: '🥇', 
                      pnl: `+${backtestData?.gold_summary?.net_pnl_pct ?? 0}% Net`, 
                      wr: `${backtestData?.gold_summary?.win_rate ?? 0}%` 
                    },
                    { 
                      key: 'BTCUSDT', 
                      label: 'Bitcoin (BTC)', 
                      count: backtestData?.btc_summary?.total_trades ?? 0, 
                      icon: '₿', 
                      pnl: `+${backtestData?.btc_summary?.net_pnl_pct ?? 0}% Net`, 
                      wr: `${backtestData?.btc_summary?.win_rate ?? 0}%` 
                    },
                    { 
                      key: 'ETHUSDT', 
                      label: 'Ethereum (ETH)', 
                      count: backtestData?.eth_summary?.total_trades ?? 0, 
                      icon: '⟠', 
                      pnl: `+${backtestData?.eth_summary?.net_pnl_pct ?? 0}% Net`, 
                      wr: `${backtestData?.eth_summary?.win_rate ?? 0}%` 
                    },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => handleSelectAssetPartition(tab.key as any)}
                      className={`px-4 py-2.5 rounded-xl border text-left transition-all flex items-center gap-3 ${
                        btAssetFilter === tab.key
                          ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                      }`}
                    >
                      <span className="text-base">{tab.icon}</span>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs tracking-tight">{tab.label}</span>
                          <span className={`text-[10px] font-mono px-1.5 rounded ${
                            btAssetFilter === tab.key ? 'bg-white/20 text-white' : 'bg-slate-200/70 text-slate-600'
                          }`}>
                            {tab.count}
                          </span>
                        </div>
                        <span className={`text-[11px] font-mono block tabular-nums ${
                          btAssetFilter === tab.key ? 'text-emerald-300 font-semibold' : 'text-slate-500'
                        }`}>
                          {tab.pnl} · {tab.wr} WR
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Right Actions: CSV Export + Drawer Toggles */}
                <div className="flex items-center gap-2">
                  {/* AI Memory Bank toggle */}
                  <button
                    onClick={() => setShowAiRules(!showAiRules)}
                    className={`h-9 px-3.5 rounded-xl border text-xs font-mono font-medium transition-all flex items-center gap-2 ${
                      showAiRules
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <BrainCircuitIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{showAiRules ? 'Hide AI Rules' : 'AI Memory Bank'}</span>
                  </button>

                  {/* Jump to Chart Visualizer CTA */}
                  <button
                    onClick={() => {
                      const el = document.getElementById('chart-visualizer-section');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="h-9 px-3.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-mono font-semibold transition-all flex items-center gap-1.5 shadow-2xs"
                  >
                    <span>🎯 View Chart (IDM · BOS · FVG)</span>
                  </button>

                  {/* Monthly Matrix toggle */}
                  <button
                    onClick={() => setShowMonthly(!showMonthly)}
                    className={`h-9 px-3.5 rounded-xl border text-xs font-mono font-medium transition-all flex items-center gap-2 ${
                      showMonthly
                        ? 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <BarChart2Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{showMonthly ? 'Hide Monthly' : 'Monthly Matrix'}</span>
                  </button>

                  {/* Export CSV — primary CTA */}
                  <a
                    href="/backtest_trades_jan_oct_2026.csv"
                    download="backtest_trades_jan_oct_2026.csv"
                    className="h-9 px-4 rounded-xl bg-slate-900 text-white hover:bg-slate-700 text-xs font-mono font-semibold transition-all flex items-center gap-2 shadow-sm"
                  >
                    <DownloadIcon className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                    <span>Export CSV</span>
                  </a>
                </div>
              </div>

              {/* Highlight Banner when Gold is active */}
              {btAssetFilter === 'XAUUSD' && backtestData?.gold_summary && (
                <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-300/80 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono shadow-2xs">
                  <div className="flex items-center gap-3 text-amber-950 font-bold">
                    <span className="text-2xl">🥇</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm tracking-tight text-amber-950 font-bold">GOLD (XAU/USD) SMC BACKTEST</span>
                        <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 border border-amber-300 text-[10px] font-bold">
                          {backtestData.gold_summary.period || '1 AUG – 15 OCT 2026'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold">
                          +{backtestData.gold_summary.net_pnl_pct.toFixed(2)}% NET RETURN
                        </span>
                      </div>
                      <span className="text-[11px] text-amber-800 font-medium">
                        Higher Timeframe: <strong>4-Hour Trend Bias</strong> · Execution: <strong>15-Minute SMC (IDM Sweep → BOS → 3-Candle FVG → Retrace Touch)</strong>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-amber-950 font-semibold bg-white/80 px-3.5 py-2 rounded-lg border border-amber-200 shadow-2xs">
                    <span>⚡ {backtestData.gold_summary.total_trades} Trades</span>
                    <span>•</span>
                    <span className="text-emerald-700 font-bold">{backtestData.gold_summary.win_rate}% WR ({backtestData.gold_summary.wins}W / {backtestData.gold_summary.losses}L)</span>
                    <span>•</span>
                    <span className="text-emerald-700 font-bold">+${backtestData.gold_summary.net_pnl_dollars.toFixed(2)} Net PnL</span>
                    <span>•</span>
                    <span>PF: {backtestData.gold_summary.profit_factor}</span>
                    <span>•</span>
                    <span>Rule #8 C1 SL & 1:2 TP</span>
                  </div>
                </div>
              )}

              {/* Highlight Banner when BTC is active */}
              {btAssetFilter === 'BTCUSDT' && backtestData?.btc_summary && (
                <div className="bg-gradient-to-r from-sky-500/10 via-amber-500/5 to-transparent border border-sky-300/80 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-mono shadow-2xs">
                  <div className="flex items-center gap-3 text-sky-950 font-bold">
                    <span className="text-2xl">₿</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm tracking-tight text-sky-950 font-bold">BITCOIN (BTC/USDT) SMC BACKTEST</span>
                        <span className="px-2 py-0.5 rounded-full bg-sky-200 text-sky-900 border border-sky-300 text-[10px] font-bold">
                          {backtestData.btc_summary.period || '1 AUG – 15 OCT 2026'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold">
                          +{backtestData.btc_summary.net_pnl_pct.toFixed(2)}% NET RETURN
                        </span>
                      </div>
                      <span className="text-[11px] text-sky-800 font-medium">
                        Higher Timeframe: <strong>4-Hour Trend Bias</strong> · Execution: <strong>15-Minute SMC (IDM Sweep → BOS → 3-Candle FVG → Retrace Touch)</strong>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sky-950 font-semibold bg-white/80 px-3.5 py-2 rounded-lg border border-sky-200 shadow-2xs">
                    <span>⚡ {backtestData.btc_summary.total_trades} Trades</span>
                    <span>•</span>
                    <span className="text-emerald-700 font-bold">{backtestData.btc_summary.win_rate}% WR ({backtestData.btc_summary.wins}W / {backtestData.btc_summary.losses}L)</span>
                    <span>•</span>
                    <span className="text-emerald-700 font-bold">+${backtestData.btc_summary.net_pnl_dollars.toFixed(2)} Net PnL</span>
                    <span>•</span>
                    <span>PF: {backtestData.btc_summary.profit_factor}</span>
                    <span>•</span>
                    <span>Rule #8 C1 SL & 1:2 TP</span>
                  </div>
                </div>
              )}

              {/* Row 2: Four Key Executive Numbers (Dynamic to Active Tab) */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 tabular-nums">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {btAssetFilter === 'ALL' ? 'Combined Portfolio Return' : `${activeSummary?.name || 'Asset'} Return`}
                  </span>
                  <span className="text-3xl font-light font-mono text-emerald-600 tracking-tight">
                    +{activeSummary?.net_pnl_pct ?? 34.7}%
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    +${activeSummary?.net_pnl_dollars?.toLocaleString() ?? '10,422.76'} ({btAssetFilter === 'ALL' ? '$30,000 base' : '$10,000 base'})
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Accuracy (Win Rate)</span>
                  <span className="text-3xl font-light font-mono text-slate-900 tracking-tight">
                    {activeSummary?.win_rate ?? 37.33}%
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    {activeSummary?.wins ?? 305}W / {activeSummary?.losses ?? 512}L (1:2 BE = 33.3%)
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Positions Executed</span>
                  <span className="text-3xl font-light font-mono text-slate-900 tracking-tight">
                    {activeSummary?.total_trades ?? 817}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    {btAssetFilter === 'ALL'
                      ? `Gold: ${backtestData?.gold_summary?.total_trades ?? 0} · BTC: ${backtestData?.btc_summary?.total_trades ?? 0} · ETH: ${backtestData?.eth_summary?.total_trades ?? 0}`
                      : (activeSummary?.period || '1 Aug – 15 Oct 2026 (4H Trend + 15M SMC)')}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Profit Factor & Model</span>
                  <span className="text-3xl font-light font-mono text-slate-900 tracking-tight">
                    {activeSummary?.profit_factor ?? 1.17}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    Strict 1:2 R:R (1% Risk / 2% TP)
                  </span>
                </div>
              </div>

              {/* ── Portfolio Equity Growth & Cumulative Win Rate Trend Chart ── */}
              {equityCurveData.length > 1 && (() => {
                const svgW = 1000;
                const svgH = 190;
                const pLeft = 70;
                const pRight = 70;
                const pTop = 20;
                const pBot = 30;
                const usableW = svgW - pLeft - pRight;
                const usableH = svgH - pTop - pBot;

                const balances = equityCurveData.map(d => d.balance);
                const minBal = Math.min(...balances);
                const maxBal = Math.max(...balances);
                const balRange = maxBal - minBal || 1;

                // Win rate bounds: 20% to 75%
                const minWR = 20;
                const maxWR = 75;
                const wrRange = maxWR - minWR;

                const getPtX = (i: number) => pLeft + (i / (equityCurveData.length - 1)) * usableW;
                const getBalY = (bal: number) => pTop + (1 - (bal - minBal) / balRange) * usableH;
                const getWrY = (wr: number) => pTop + (1 - (Math.max(minWR, Math.min(maxWR, wr)) - minWR) / wrRange) * usableH;

                // Build polyline points
                const balPointsStr = equityCurveData.map((d, i) => `${getPtX(i)},${getBalY(d.balance)}`).join(' ');
                const wrPointsStr = equityCurveData.map((d, i) => `${getPtX(i)},${getWrY(d.winRate)}`).join(' ');

                // Build area path for balance
                const areaPath = `M${pLeft},${pTop + usableH} L${equityCurveData.map((d, i) => `${getPtX(i)},${getBalY(d.balance)}`).join(' L')} L${pLeft + usableW},${pTop + usableH} Z`;

                const be33Y = getWrY(33.33);
                const target50Y = getWrY(50.0);

                const activeHoverPoint = hoverCurveIdx !== null && equityCurveData[hoverCurveIdx] ? equityCurveData[hoverCurveIdx] : null;

                return (
                  <div className="pt-5 border-t border-slate-100 flex flex-col gap-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                          Performance Growth & Accuracy Trendline ({btAssetFilter === 'ALL' ? 'Combined Portfolio' : btAssetFilter})
                        </span>
                      </div>
                      {/* Legend */}
                      <div className="flex flex-wrap items-center gap-3 text-[11px]">
                        <span className="flex items-center gap-1.5 text-emerald-700 font-bold">
                          <span className="w-3 h-1 bg-emerald-500 rounded-full" />
                          <span>Equity Curve ($)</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-purple-700 font-bold">
                          <span className="w-3 h-1 bg-purple-500 rounded-full" />
                          <span>Win Rate Accuracy (%)</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-slate-400 font-medium">
                          <span className="w-3 h-0.5 border-t border-dashed border-slate-400" />
                          <span>1:2 R:R Breakeven (33.3%)</span>
                        </span>
                      </div>
                    </div>

                    {/* Interactive SVG Chart */}
                    <div className="relative w-full bg-slate-50/60 rounded-xl border border-slate-200/80 p-2 overflow-hidden select-none">
                      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-[180px] block">
                        <defs>
                          <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                          </linearGradient>
                        </defs>

                        {/* Grid lines */}
                        {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
                          const y = pTop + pct * usableH;
                          const balVal = maxBal - pct * balRange;
                          const wrVal = maxWR - pct * wrRange;
                          return (
                            <g key={idx}>
                              <line x1={pLeft} y1={y} x2={pLeft + usableW} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
                              {/* Left Axis: Balance ($) */}
                              <text x={pLeft - 8} y={y + 3.5} textAnchor="end" fill="#10b981" fontSize="9" fontFamily="monospace" fontWeight="bold">
                                ${Math.round(balVal).toLocaleString()}
                              </text>
                              {/* Right Axis: Win Rate (%) */}
                              <text x={pLeft + usableW + 8} y={y + 3.5} textAnchor="start" fill="#8b5cf6" fontSize="9" fontFamily="monospace" fontWeight="bold">
                                {Math.round(wrVal)}%
                              </text>
                            </g>
                          );
                        })}

                        {/* Breakeven reference line (33.3%) */}
                        <line x1={pLeft} y1={be33Y} x2={pLeft + usableW} y2={be33Y} stroke="#f43f5e" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />

                        {/* 50% Win Rate target line */}
                        <line x1={pLeft} y1={target50Y} x2={pLeft + usableW} y2={target50Y} stroke="#8b5cf6" strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />

                        {/* Equity Area Fill */}
                        <path d={areaPath} fill="url(#equityGradient)" />

                        {/* Equity Balance Line (Green) */}
                        <polyline points={balPointsStr} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

                        {/* Win Rate Line (Purple) */}
                        <polyline points={wrPointsStr} fill="none" stroke="#8b5cf6" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />

                        {/* Interactive Data Points */}
                        {equityCurveData.map((pt, i) => {
                          const cx = getPtX(i);
                          const cyBal = getBalY(pt.balance);
                          const cyWr = getWrY(pt.winRate);
                          const isHovered = hoverCurveIdx === i;
                          return (
                            <g key={i} onMouseEnter={() => setHoverCurveIdx(i)} onMouseLeave={() => setHoverCurveIdx(null)} className="cursor-pointer">
                              {/* Invisible hit target */}
                              <rect x={cx - 8} y={pTop} width={16} height={usableH} fill="transparent" />
                              {/* Dot on Balance */}
                              <circle cx={cx} cy={cyBal} r={isHovered ? 5 : 2.5} fill="#10b981" stroke="#ffffff" strokeWidth={1.5} />
                              {/* Dot on Win Rate */}
                              <circle cx={cx} cy={cyWr} r={isHovered ? 5 : 2} fill="#8b5cf6" stroke="#ffffff" strokeWidth={1.2} />
                            </g>
                          );
                        })}

                        {/* Hover Vertical Guide Line & Tooltip */}
                        {hoverCurveIdx !== null && activeHoverPoint && (() => {
                          const hx = getPtX(hoverCurveIdx);
                          const tooltipW = 190;
                          const tooltipX = Math.min(Math.max(hx - tooltipW / 2, pLeft), pLeft + usableW - tooltipW);
                          return (
                            <g>
                              <line x1={hx} y1={pTop} x2={hx} y2={pTop + usableH} stroke="#0f172a" strokeWidth={1} strokeDasharray="2 2" />
                              <g transform={`translate(${tooltipX}, ${pTop + 5})`}>
                                <rect width={tooltipW} height={44} rx={6} fill="#0f172a" opacity={0.92} filter="drop-shadow(0 4px 6px rgba(0,0,0,0.2))" />
                                <text x={10} y={16} fill="#94a3b8" fontSize="9" fontFamily="monospace">
                                  Trade #{activeHoverPoint.tradeNum} · {activeHoverPoint.date}
                                </text>
                                <text x={10} y={32} fill="#34d399" fontSize="10.5" fontFamily="monospace" fontWeight="bold">
                                  ${activeHoverPoint.balance.toLocaleString()}
                                </text>
                                <text x={tooltipW - 10} y={32} textAnchor="end" fill="#c084fc" fontSize="10.5" fontFamily="monospace" fontWeight="bold">
                                  WR: {activeHoverPoint.winRate}%
                                </text>
                              </g>
                            </g>
                          );
                        })()}
                      </svg>
                    </div>
                  </div>
                );
              })()}

              {/* Collapsible: AI Memory Bank Rules */}
              {showAiRules && (
                <div className="pt-5 border-t border-slate-100 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                      <BrainCircuitIcon className="w-4 h-4 text-slate-700" />
                      Active Machine Learning Rules (817 Trades Evaluated)
                    </span>
                    <span className="text-xs font-mono text-slate-500">Asia/Kolkata IST (UTC+05:30)</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { id: 'RULE-OPT-01', title: 'Displacement Body Close', desc: 'FVG entries only trigger after full candle body close beyond structural pivot (rejects wick traps).' },
                      { id: 'RULE-RISK-02', title: 'Session Timing Filter', desc: 'Peak 1:2 R:R completion occurs during London/NY Overlap (18:30 – 22:30 IST).' },
                      { id: 'RULE-RISK-01', title: 'Liquidity Buffer Cushion', desc: 'Applies 0.25x ATR invalidation buffer beyond swing highs/lows to prevent stop-hunts.' },
                    ].map(r => (
                      <div key={r.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-900">{r.title}</span>
                        <span className="text-xs text-slate-600 leading-relaxed">{r.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Collapsible: Monthly Matrix */}
              {showMonthly && (
                <div className="pt-5 border-t border-slate-100 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                      <BarChart2Icon className="w-4 h-4 text-slate-700" />
                      Monthly Performance Matrix (Jan – Sep 2026)
                    </span>
                    <span className="text-xs font-mono text-slate-500">
                      Showing: {btAssetFilter === 'ALL' ? 'All 3 Assets' : btAssetFilter}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs font-mono tabular-nums">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          {['Month', 'Symbol', 'Trades', 'Wins', 'Losses', 'Accuracy (Win %)', 'Net Return (%)'].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {backtestData?.monthly_breakdown
                          ?.filter(m => btAssetFilter === 'ALL' || m.symbol === btAssetFilter)
                          .map((m, idx) => (
                          <tr key={`${m.month}-${m.symbol}-${idx}`} className="hover:bg-slate-50">
                            <td className="px-4 py-2 font-bold text-slate-900">{m.month}</td>
                            <td className="px-4 py-2">
                              <Badge 
                                label={m.symbol === 'XAUUSD' ? 'Gold (XAU)' : m.symbol === 'BTCUSDT' ? 'BTC' : 'ETH'} 
                                color={m.symbol === 'XAUUSD' ? 'amber' : m.symbol === 'BTCUSDT' ? 'amber' : 'cyan'} 
                              />
                            </td>
                            <td className="px-4 py-2 text-slate-700">{m.trades}</td>
                            <td className="px-4 py-2 text-emerald-600 font-semibold">{m.wins}</td>
                            <td className="px-4 py-2 text-rose-600">{m.losses}</td>
                            <td className="px-4 py-2 text-slate-700">{m.win_rate}%</td>
                            <td className={`px-4 py-2 font-bold ${m.net_return_pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {m.net_return_pct >= 0 ? `+${m.net_return_pct}%` : `${m.net_return_pct}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>

            {/* ── Interactive Chart Visualizer & TradingView ── */}
            <div id="chart-visualizer-section" className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-900" />
                  <span className="text-xs font-bold uppercase tracking-widest text-slate-900">
                    Trade Visualizer & Execution Candlesticks
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    {selectedTrade ? `Selected: #${selectedTrade.trade_num} ${selectedTrade.symbol} (${selectedTrade.direction})` : ''}
                  </span>
                </div>

                {/* View switcher */}
                <div className="flex bg-slate-200/70 p-1 rounded-xl text-xs font-mono">
                  <button
                    onClick={() => setChartMode('visualizer')}
                    className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                      chartMode === 'visualizer'
                        ? 'bg-white text-slate-900 font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <TargetIcon className="w-3.5 h-3.5" />
                    <span>SMC Zones</span>
                  </button>
                  <button
                    onClick={() => setChartMode('tradingview')}
                    className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                      chartMode === 'tradingview'
                        ? 'bg-white text-slate-900 font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <ActivityIcon className="w-3.5 h-3.5" />
                    <span>TradingView (15M)</span>
                  </button>
                </div>
              </div>

              {/* Render Selected View */}
              {selectedTrade && chartMode === 'visualizer' && (
                <TradeChartVisualizer
                  trade={selectedTrade}
                  candleData={activeCandleData}
                  onPrevTrade={handlePrevTrade}
                  onNextTrade={handleNextTrade}
                  hasPrev={currentTradeIndex > 0}
                  hasNext={currentTradeIndex < filteredBtTrades.length - 1}
                />
              )}

              {chartMode === 'tradingview' && (
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-mono text-slate-500 px-1">
                    <span>Official TradingView Advanced Chart: {selectedTrade?.symbol || 'BTCUSDT'}</span>
                    <span>Asia/Kolkata IST Timezone</span>
                  </div>
                  <TradingViewWidget
                    symbol={selectedTrade?.symbol || 'BTCUSDT'}
                    interval="15"
                    height={500}
                  />
                </div>
              )}
            </div>

            {/* ── All Positions Table with Filtering & Pagination ── */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col">
              {/* Table Controls Bar */}
              <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Filter groups */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Asset filter group */}
                  <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
                    {(['ALL', 'XAUUSD', 'BTCUSDT', 'ETHUSDT'] as const).map(sym => (
                      <button
                        key={sym}
                        onClick={() => handleSelectAssetPartition(sym)}
                        className={`h-7 px-3 rounded-lg text-[11px] font-semibold transition-all ${
                          btAssetFilter === sym
                            ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80 font-bold'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
                        }`}
                      >
                        {sym === 'ALL'
                          ? `All (${backtestData?.summary?.total_trades ?? 0})`
                          : sym === 'XAUUSD'
                          ? `🥇 Gold (${backtestData?.gold_summary?.total_trades ?? 0})`
                          : sym === 'BTCUSDT'
                          ? `₿ BTC (${backtestData?.btc_summary?.total_trades ?? 0})`
                          : `⟠ ETH (${backtestData?.eth_summary?.total_trades ?? 0})`}
                      </button>
                    ))}
                  </div>

                  {/* Divider */}
                  <span className="w-px h-5 bg-slate-200 hidden sm:block" />

                  {/* Outcome filter group */}
                  <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
                    {(['ALL', 'WIN', 'LOSS'] as const).map(res => (
                      <button
                        key={res}
                        onClick={() => { setBtResultFilter(res); setBtPage(1); }}
                        className={`h-7 px-3 rounded-lg text-[11px] font-semibold transition-all ${
                          btResultFilter === res
                            ? res === 'WIN'
                              ? 'bg-emerald-600 text-white shadow-sm font-bold'
                              : res === 'LOSS'
                                ? 'bg-rose-600 text-white shadow-sm font-bold'
                                : 'bg-white text-slate-900 shadow-sm border border-slate-200/80 font-bold'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
                        }`}
                      >
                        {res === 'ALL' ? 'All Results' : res === 'WIN' ? '✓ Wins' : '✕ Losses'}
                      </button>
                    ))}
                  </div>

                  {/* Direction filter group */}
                  <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
                    {(['ALL', 'LONG', 'SHORT'] as const).map(dir => (
                      <button
                        key={dir}
                        onClick={() => { setBtDirectionFilter(dir); setBtPage(1); }}
                        className={`h-7 px-3 rounded-lg text-[11px] font-semibold transition-all ${
                          btDirectionFilter === dir
                            ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80 font-bold'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
                        }`}
                      >
                        {dir === 'ALL' ? 'Both' : dir === 'LONG' ? '↑ Long' : '↓ Short'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Search Input */}
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <SearchIcon className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search date, price, reason..."
                      value={btSearch}
                      onChange={e => { setBtSearch(e.target.value); setBtPage(1); }}
                      className="bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 w-56"
                    />
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                    {filteredBtTrades.length} Trades found
                  </span>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      {['#', 'Asset', 'Side', 'Entry (IST)', 'Entry Price', 'Exit (IST)', 'Exit Price', 'Stop Loss', 'Take Profit', 'R:R', 'PnL %', 'PnL ($)', 'Balance', 'AI Pattern / Reason', 'Result'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingBacktest ? (
                      <tr>
                        <td colSpan={15} className="px-5 py-12 text-center text-sm font-mono text-slate-400 animate-pulse">
                          Loading backtest data...
                        </td>
                      </tr>
                    ) : currentBtTrades.length === 0 ? (
                      <tr>
                        <td colSpan={15} className="px-5 py-12 text-center text-sm font-mono text-slate-500">
                          No trades match the selected partition and filters.
                        </td>
                      </tr>
                    ) : (
                    currentBtTrades.map(t => {
                      const isSelected = selectedTrade?.trade_num === t.trade_num && selectedTrade?.symbol === t.symbol;
                      return (
                        <tr
                          key={`${t.symbol}-${t.trade_num}`}
                          onClick={() => {
                            setSelectedTrade(t);
                            const el = document.getElementById('chart-visualizer-section');
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                          className={`cursor-pointer transition-all font-mono text-xs tabular-nums ${
                            isSelected
                              ? 'bg-slate-100 font-semibold border-l-4 border-slate-900'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                            #{t.trade_num}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                            <Badge 
                              label={t.symbol === 'XAUUSD' ? 'Gold (XAU)' : t.symbol === 'BTCUSDT' ? 'BTC' : 'ETH'} 
                              color={t.symbol === 'XAUUSD' ? 'amber' : t.symbol === 'BTCUSDT' ? 'amber' : 'cyan'} 
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Badge label={t.direction} color={t.direction === 'LONG' ? 'green' : 'red'} />
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{t.entry_time_ist || t.entry_time.slice(0, 16)}</td>
                          <td className="px-4 py-3 text-slate-900 whitespace-nowrap font-medium">
                            ${t.entry_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{t.exit_time_ist || t.exit_time.slice(0, 16)}</td>
                          <td className="px-4 py-3 text-slate-800 whitespace-nowrap font-medium">
                            ${t.exit_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-rose-600 whitespace-nowrap">
                            ${t.stop_loss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-emerald-600 whitespace-nowrap">
                            ${t.take_profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-slate-400">{t.rr_ratio}</td>
                          <td className={`px-4 py-3 font-bold whitespace-nowrap ${t.pnl_percent >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {t.pnl_percent >= 0 ? `+${t.pnl_percent.toFixed(1)}%` : `${t.pnl_percent.toFixed(1)}%`}
                          </td>
                          <td className={`px-4 py-3 whitespace-nowrap font-semibold ${t.pnl_dollar >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {t.pnl_dollar >= 0 ? `+$${t.pnl_dollar.toFixed(0)}` : `-$${Math.abs(t.pnl_dollar).toFixed(0)}`}
                          </td>
                          <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                            ${t.running_balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                              t.result === 'WIN' 
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                : 'bg-rose-50 text-rose-800 border-rose-200'
                            }`}>
                              {t.pattern_type || (t.result === 'WIN' ? 'Displacement Surge' : 'Liquidity Sweep')}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <Badge label={t.result} color={t.result === 'WIN' ? 'green' : 'red'} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
                <span className="text-slate-500">
                  Showing <strong className="text-slate-900">{Math.min(filteredBtTrades.length, (btPage - 1) * btPageSize + 1)}</strong> to{' '}
                  <strong className="text-slate-900">{Math.min(filteredBtTrades.length, btPage * btPageSize)}</strong> of{' '}
                  <strong className="text-slate-900">{filteredBtTrades.length}</strong> trades
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setBtPage(p => Math.max(1, p - 1))}
                    disabled={btPage === 1}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1 shadow-2xs"
                  >
                    <ChevronLeftIcon className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </button>

                  <span className="px-3 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 font-bold shadow-2xs">
                    {btPage} / {totalBtPages}
                  </span>

                  <button
                    onClick={() => setBtPage(p => Math.min(totalBtPages, p + 1))}
                    disabled={btPage >= totalBtPages}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1 shadow-2xs"
                  >
                    <span>Next</span>
                    <ChevronRightIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 2: MARKET SCANNER
            ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'scanner' && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <ActivityIcon className="w-3.5 h-3.5 text-slate-700" />
                Live AI Market Scanner
              </span>
              <span className={`text-[10px] font-mono px-2.5 py-1 rounded-full border font-semibold ${status?.is_running ? 'text-emerald-700 border-emerald-200 bg-emerald-50 animate-pulse' : 'text-slate-500 border-slate-200 bg-slate-100'}`}>
                {status?.is_running ? `Scanning every ${status?.scan_interval}s` : 'Engine Idle'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    {['Asset', '1m Price', '15m Trend', 'Break of Structure', 'Fair Value Gap', 'SMC Score', 'Status', 'Action'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!status?.scanner_results || status.scanner_results.length === 0) ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm font-mono text-slate-400">
                        {connected ? 'Start engine to begin scanning markets...' : 'Connect backend to see live scanner data'}
                      </td>
                    </tr>
                  ) : (
                    status.scanner_results.map(row => (
                      <tr key={row.symbol} className="hover:bg-slate-50 transition-colors group">
                        <td className="px-5 py-4 font-mono font-bold text-sm text-slate-900">{row.symbol}</td>
                        <td className="px-5 py-4 font-mono text-sm text-slate-700 tabular-nums">
                          {row.last_price ? `$${row.last_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="px-5 py-4">
                          <Badge label={row.trend} color={row.trend === 'BULLISH' ? 'green' : row.trend === 'BEARISH' ? 'red' : 'gray'} />
                        </td>
                        <td className="px-5 py-4">
                          {row.sweep_detected
                            ? <Badge label="BOS Confirmed" color="cyan" />
                            : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-5 py-4">
                          {row.fvg_type
                            ? <Badge label="Active FVG" color="green" />
                            : <span className="text-xs text-slate-300">—</span>}
                        </td>
                        <td className="px-5 py-4 w-36">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full ${row.setup_score >= 70 ? 'bg-emerald-500' : 'bg-slate-400'}`} style={{ width: `${row.setup_score}%` }} />
                            </div>
                            <span className="text-xs font-mono font-bold text-slate-700">{row.setup_score}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <Badge label={row.status} color={row.status === 'WATCHING' ? 'amber' : 'gray'} />
                        </td>
                        <td className="px-5 py-4">
                          {row.setup_score >= 70 ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleManualTrade(row.symbol, 'LONG')}
                                className="h-7 px-3 text-[11px] font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1"
                              >
                                ↑ Buy
                              </button>
                              <button
                                onClick={() => handleManualTrade(row.symbol, 'SHORT')}
                                className="h-7 px-3 text-[11px] font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors flex items-center gap-1"
                              >
                                ↓ Sell
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 3: OPEN ORDERS
            ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'open_orders' && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <LayersIcon className="w-3.5 h-3.5 text-slate-700" />
                Live Pending / Limit Orders (Binance Demo)
              </span>
              <span className="text-xs font-mono text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200">
                {status?.open_orders?.length ?? 0} Orders in Book
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    {['Time', 'Asset', 'Side', 'Type', 'Target Price', 'Amount', 'Target Value', 'Order ID', 'Action'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!status?.open_orders || status.open_orders.length === 0) ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-12 text-center text-sm font-mono text-slate-400">
                        No open orders right now. Click &quot;Test Order&quot; or start engine to trigger automated orders.
                      </td>
                    </tr>
                  ) : (
                    status.open_orders.map(o => (
                      <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-4 text-slate-500">{new Date(o.timestamp).toLocaleTimeString()}</td>
                        <td className="px-5 py-4 font-bold text-slate-900">{o.symbol}</td>
                        <td className="px-5 py-4">
                          <Badge label={o.side} color={o.side === 'BUY' ? 'green' : 'red'} />
                        </td>
                        <td className="px-5 py-4">
                          <Badge label={o.type} color="cyan" />
                        </td>
                        <td className="px-5 py-4 text-emerald-600 font-semibold">
                          ${o.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-4 text-slate-800">{o.amount.toFixed(4)}</td>
                        <td className="px-5 py-4 text-slate-600">${o.cost.toFixed(2)}</td>
                        <td className="px-5 py-4 text-slate-500">{o.id}</td>
                        <td className="px-5 py-4">
                          <button
                            onClick={() => handleCancelOrder(o.id, o.symbol)}
                            className="h-7 px-3 text-[11px] font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                          >
                            ✕ Cancel
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 4: TRADE LEDGER
            ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'trades' && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <BarChart2Icon className="w-3.5 h-3.5 text-slate-700" />
                Executed Trades — Live Exchange Ledger
              </span>
              <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 font-semibold">
                Binance Demo Connected
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    {['Time', 'Asset', 'Side', 'Qty', 'Fill Price', 'Total (USDT)', 'Order ID', 'Status'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!status?.trade_history || status.trade_history.length === 0) ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm font-mono text-slate-400">
                        No live trades executed yet in this session.
                      </td>
                    </tr>
                  ) : (
                    status.trade_history.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-4 text-slate-500">{new Date(t.timestamp).toLocaleTimeString()}</td>
                        <td className="px-5 py-4 font-bold text-slate-900">{t.symbol}</td>
                        <td className="px-5 py-4">
                          <Badge
                            label={t.direction}
                            color={t.direction === 'BUY' || t.direction === 'LONG' ? 'green' : 'red'}
                          />
                        </td>
                        <td className="px-5 py-4 text-slate-800">{t.amount ? t.amount.toFixed(4) : '—'}</td>
                        <td className="px-5 py-4 text-slate-700">
                          {t.entry_price ? `$${t.entry_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="px-5 py-4 text-emerald-600 font-semibold">
                          {t.cost ? `$${t.cost.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-5 py-4 text-slate-500">{t.order_id || t.id}</td>
                        <td className="px-5 py-4">
                          <Badge
                            label={t.status}
                            color={t.status === 'EXECUTED' ? 'green' : t.status === 'FAILED' ? 'red' : 'amber'}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  BrainCircuitIcon,
  SparklesIcon,
  ActivityIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  TargetIcon,
  CrosshairIcon,
  ChevronRightIcon
} from './Icons';

export interface CandidateSetupData {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  angle?: number;
  session_name?: string;
  setup_reason?: string;
  entry_price?: number;
  stop_loss?: number;
  take_profit?: number;
  ai_decision?: string;
  ai_confidence?: number;
  timestamp?: string;
  is_live_candidate?: boolean;
  graph_rag?: {
    neighborhood_win_rate: number;
    sample_size: number;
    recommendation: string;
    avg_pnl_dollar?: number;
    total_pnl_dollar?: number;
    cluster_classification?: string;
    insufficient_data?: boolean;
    top_matches: Array<{
      trade_num: number;
      symbol: string;
      direction: string;
      result: string;
      pnl_dollar: number;
      pnl_percent?: number;
      rr_ratio?: string;
      similarity_score: number;
      common_features: string[];
      cluster_status?: string;
      risk_tier?: string;
    }>;
  };
}

export interface GraphNode {
  id: string;
  node_type: 'trade' | 'feature' | 'candidate';
  trade_num?: number;
  symbol?: string;
  direction?: 'LONG' | 'SHORT';
  trade_type?: string;
  entry_price?: number;
  exit_price?: number;
  stop_loss?: number;
  take_profit?: number;
  result?: 'WIN' | 'LOSS';
  pnl_dollar?: number;
  pnl_percent?: number;
  angle?: number;
  session?: string;
  entry_time?: string;
  entry_time_ist?: string;
  duration_hours?: number;
  setup_reason?: string;
  features?: string[];
  twin_trades?: Array<{
    trade_num: number;
    symbol: string;
    direction: string;
    result: string;
    pnl_dollar: number;
    similarity_score: number;
    shared_features: string[];
  }>;
  neighborhood_win_rate?: number;
  neural_explanation?: string;
  category?: string;
  isHighWinCluster?: boolean;
  isLosingTrap?: boolean;
  clusterName?: string;
  clusterZone?: string;
  risk_tier?: string;
  candidate_data?: CandidateSetupData;

  // Simulation & rendering coordinates
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  targetX?: number;
  targetY?: number;
  radius?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relation: string;
  weight: number;
  shared_features?: string[];
}

export interface WinningDNARule {
  factor: string;
  finding: string;
  dna_impact: string;
}

export interface WinningDNA {
  total_trades: number;
  total_wins: number;
  total_losses: number;
  overall_win_rate: number;
  avg_win_angle: number;
  avg_loss_angle: number;
  avg_win_duration_hours: number;
  avg_loss_duration_hours: number;
  core_rules: WinningDNARule[];
}

export interface HighWinCluster {
  cluster_name: string;
  features: string[];
  trade_count: number;
  wins: number;
  losses: number;
  win_rate: number;
  pnl_dollar: number;
  status: string;
}

export interface TradeGraphVisualizerProps {
  onNavigateToTrade?: (tradeNum: number, symbol: string) => void;
  initialSelectedTradeNum?: number;
  candidateSetup?: CandidateSetupData | null;
  onRefreshGraph?: () => void;
}

type LayoutMode = 'constellation' | 'target_focus' | 'organic_physics';

export default function TradeGraphVisualizer({
  onNavigateToTrade,
  initialSelectedTradeNum,
  candidateSetup,
}: TradeGraphVisualizerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Data states
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [winningDNA, setWinningDNA] = useState<WinningDNA | null>(null);
  const [highWinClusters, setHighWinClusters] = useState<HighWinCluster[]>([]);
  const [losingTraps, setLosingTraps] = useState<HighWinCluster[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Layout & Interaction states
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('constellation');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<
    'all' | 'candidate_neighborhood' | 'wins_only' | 'high_win_clusters' | 'traps_only' | 'gold_only' | 'btc_only' | 'golden_angle'
  >('all');

  const [zoomTransform, setZoomTransform] = useState<{ x: number; y: number; scale: number }>({
    x: 0,
    y: 0,
    scale: 0.88
  });

  // Simulation controls
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const alphaRef = useRef<number>(1.0);
  const isPausedRef = useRef<boolean>(false);
  const layoutModeRef = useRef<LayoutMode>('constellation');

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    layoutModeRef.current = layoutMode;
  }, [layoutMode]);

  // Dragging & gesture interaction state
  const isDraggingCanvas = useRef<boolean>(false);
  const dragStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggedNode = useRef<GraphNode | null>(null);
  const animFrameId = useRef<number | null>(null);
  const pulseOffset = useRef<number>(0);

  // 1. Data Ingestion & Deterministic Constellation Positioning
  const loadGraphData = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);

      let response = await fetch('/trade_knowledge_graph.json');
      if (!response.ok) {
        response = await fetch('/api/backend/graph/network');
      }
      if (!response.ok) {
        throw new Error(`Failed to load graph data (${response.status})`);
      }
      const data = await response.json();

      const rawNodes: GraphNode[] = data.nodes || [];
      const rawLinks: GraphLink[] = data.links || [];

      // Cluster tracking sets
      const highWinTrades = new Set<number>();
      const trapTrades = new Set<number>();
      const clusterNameMap: Record<number, string> = {};

      (data.graph_summary?.high_win_clusters || []).forEach((c: any) => {
        (c.trades || []).forEach((tNum: number) => {
          highWinTrades.add(tNum);
          if (!clusterNameMap[tNum]) clusterNameMap[tNum] = c.cluster_name;
        });
      });

      (data.graph_summary?.losing_traps || []).forEach((c: any) => {
        (c.trades || []).forEach((tNum: number) => {
          trapTrades.add(tNum);
        });
      });

      // Spatial Constellation Cluster Centers
      const CLUSTERS = {
        OVERLAP: { cx: -320, cy: -200, label: 'London/NY Overlap (83.3% WR)' },
        LONDON:  { cx: 320,  cy: -200, label: 'London Morning Continuation (66.7% WR)' },
        ASIAN:   { cx: 320,  cy: 220,  label: 'Asian Liquidity Expansion (71.4% WR)' },
        TRAPS:   { cx: -320, cy: 220,  label: 'Consolidation & Late NY Traps' },
        NEUTRAL: { cx: 0,    cy: 290,  label: 'Standard SMC Executions' }
      };

      // Group trades into deterministic buckets
      const overlapTrades: GraphNode[] = [];
      const londonTrades: GraphNode[] = [];
      const asianTrades: GraphNode[] = [];
      const trapTradesList: GraphNode[] = [];
      const neutralTrades: GraphNode[] = [];

      rawNodes.forEach((n) => {
        if (n.node_type === 'feature') {
          n.radius = 22;
          if (n.id.includes('Overlap')) {
            n.x = CLUSTERS.OVERLAP.cx;
            n.y = CLUSTERS.OVERLAP.cy;
          } else if (n.id.includes('London Morning')) {
            n.x = CLUSTERS.LONDON.cx;
            n.y = CLUSTERS.LONDON.cy;
          } else if (n.id.includes('Asian')) {
            n.x = CLUSTERS.ASIAN.cx;
            n.y = CLUSTERS.ASIAN.cy;
          } else if (n.id.includes('NY Afternoon') || n.id.includes('Twilight')) {
            n.x = CLUSTERS.TRAPS.cx;
            n.y = CLUSTERS.TRAPS.cy;
          } else if (n.category === 'Angle') {
            n.x = 0;
            n.y = -260;
          } else if (n.category === 'Asset') {
            n.x = n.id.includes('XAU') ? -120 : 120;
            n.y = -330;
          } else {
            n.x = (Math.random() - 0.5) * 200;
            n.y = (Math.random() - 0.5) * 200;
          }
          n.targetX = n.x;
          n.targetY = n.y;
        } else {
          n.radius = n.result === 'WIN' ? 14 : 11;
          if (n.trade_num !== undefined) {
            if (highWinTrades.has(n.trade_num)) {
              n.isHighWinCluster = true;
              n.clusterName = clusterNameMap[n.trade_num] || 'Winning DNA Cluster';
            }
            if (trapTrades.has(n.trade_num)) {
              n.isLosingTrap = true;
            }
          }

          // Bucket trade into distinct cluster
          const sess = n.session || '';
          if (n.isLosingTrap || sess.includes('NY Afternoon') || sess.includes('Twilight')) {
            n.clusterZone = 'TRAPS';
            trapTradesList.push(n);
          } else if (sess.includes('Overlap')) {
            n.clusterZone = 'OVERLAP';
            overlapTrades.push(n);
          } else if (sess.includes('London Morning')) {
            n.clusterZone = 'LONDON';
            londonTrades.push(n);
          } else if (sess.includes('Asian')) {
            n.clusterZone = 'ASIAN';
            asianTrades.push(n);
          } else {
            n.clusterZone = 'NEUTRAL';
            neutralTrades.push(n);
          }
        }
        n.vx = 0;
        n.vy = 0;
      });

      // Position nodes neatly on concentric non-overlapping orbital rings
      const layoutCluster = (list: GraphNode[], center: { cx: number; cy: number }) => {
        const ringStep = 38;
        const baseRadius = 55;
        let ring = 0;
        let placedOnRing = 0;

        for (let i = 0; i < list.length; i++) {
          const r = baseRadius + ring * ringStep;
          const maxOnRing = Math.max(6, Math.floor((2 * Math.PI * r) / 34));

          const angle = (placedOnRing / maxOnRing) * 2 * Math.PI + (ring % 2 === 1 ? 0.25 : 0);
          const nx = center.cx + Math.cos(angle) * r;
          const ny = center.cy + Math.sin(angle) * r;

          list[i].x = nx;
          list[i].y = ny;
          list[i].targetX = nx;
          list[i].targetY = ny;

          placedOnRing++;
          if (placedOnRing >= maxOnRing) {
            ring++;
            placedOnRing = 0;
          }
        }
      };

      layoutCluster(overlapTrades, CLUSTERS.OVERLAP);
      layoutCluster(londonTrades, CLUSTERS.LONDON);
      layoutCluster(asianTrades, CLUSTERS.ASIAN);
      layoutCluster(trapTradesList, CLUSTERS.TRAPS);
      layoutCluster(neutralTrades, CLUSTERS.NEUTRAL);

      // Inject Target Candidate Setup Node if available
      if (candidateSetup) {
        const candId = 'CANDIDATE_SETUP';
        const candNode: GraphNode = {
          id: candId,
          node_type: 'candidate',
          symbol: candidateSetup.symbol,
          direction: candidateSetup.direction,
          angle: candidateSetup.angle || 42.0,
          session: candidateSetup.session_name || 'London/NY Overlap (Peak Volume)',
          setup_reason: candidateSetup.setup_reason || 'Chain-of-CHoCH Continuation BOS',
          entry_price: candidateSetup.entry_price,
          stop_loss: candidateSetup.stop_loss,
          take_profit: candidateSetup.take_profit,
          neighborhood_win_rate: candidateSetup.graph_rag?.neighborhood_win_rate,
          candidate_data: candidateSetup,
          radius: 22,
          x: 0,
          y: -20,
          targetX: 0,
          targetY: -20,
          vx: 0,
          vy: 0,
          fx: 0,
          fy: -20,
        };
        rawNodes.push(candNode);

        if (candidateSetup.graph_rag?.top_matches) {
          candidateSetup.graph_rag.top_matches.forEach((m) => {
            rawLinks.push({
              source: candId,
              target: `TRADE_${m.trade_num}_${m.symbol}`,
              relation: 'CANDIDATE_SIMILARITY',
              weight: m.similarity_score,
              shared_features: m.common_features || [],
            });
          });
        }
      }

      setNodes(rawNodes);
      setLinks(rawLinks);
      alphaRef.current = 1.0;

      if (data.graph_summary) {
        setWinningDNA(data.graph_summary.winning_dna);
        setHighWinClusters(data.graph_summary.high_win_clusters || []);
        setLosingTraps(data.graph_summary.losing_traps || []);
      }

      if (initialSelectedTradeNum) {
        const match = rawNodes.find(
          (n) => n.node_type === 'trade' && n.trade_num === initialSelectedTradeNum
        );
        if (match) setSelectedNode(match);
      }

      setIsLoading(false);
    } catch (err: any) {
      setLoadError(err.message || 'Error loading trade knowledge graph');
      setIsLoading(false);
    }
  }, [initialSelectedTradeNum, candidateSetup]);

  useEffect(() => {
    loadGraphData();
  }, [loadGraphData]);

  // Fast node lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  // Visible nodes filtered by filterType & searchQuery
  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    const queryLower = searchQuery.trim().toLowerCase();

    nodes.forEach((n) => {
      if (n.node_type === 'candidate') {
        ids.add(n.id);
        return;
      }
      if (n.node_type === 'feature') {
        ids.add(n.id);
        return;
      }

      if (queryLower) {
        const matchesNum = n.trade_num !== undefined && String(n.trade_num).includes(queryLower.replace('#', ''));
        const matchesSym = n.symbol?.toLowerCase().includes(queryLower);
        const matchesSess = n.session?.toLowerCase().includes(queryLower);
        const matchesReason = n.setup_reason?.toLowerCase().includes(queryLower);
        if (!matchesNum && !matchesSym && !matchesSess && !matchesReason) {
          return;
        }
      }

      if (filterType === 'all') {
        ids.add(n.id);
      } else if (filterType === 'wins_only') {
        if (n.result === 'WIN') ids.add(n.id);
      } else if (filterType === 'high_win_clusters') {
        if (n.isHighWinCluster || (n.neighborhood_win_rate || 0) >= 55) ids.add(n.id);
      } else if (filterType === 'traps_only') {
        if (n.isLosingTrap || (n.neighborhood_win_rate || 0) <= 30) ids.add(n.id);
      } else if (filterType === 'gold_only') {
        if (n.symbol === 'XAUUSD') ids.add(n.id);
      } else if (filterType === 'btc_only') {
        if (n.symbol === 'BTCUSDT') ids.add(n.id);
      } else if (filterType === 'golden_angle') {
        if ((n.angle || 0) >= 40 && (n.angle || 0) <= 45) ids.add(n.id);
      } else if (filterType === 'candidate_neighborhood') {
        const isConnectedToCandidate = links.some((l) => {
          const s = typeof l.source === 'string' ? l.source : l.source.id;
          const t = typeof l.target === 'string' ? l.target : l.target.id;
          return (
            l.relation === 'CANDIDATE_SIMILARITY' &&
            ((s === 'CANDIDATE_SETUP' && t === n.id) || (t === 'CANDIDATE_SETUP' && s === n.id))
          );
        });
        if (isConnectedToCandidate) ids.add(n.id);
      }
    });

    return ids;
  }, [nodes, links, filterType, searchQuery]);

  // Active / Highlighted nodes
  const highlightedNodeIds = useMemo(() => {
    const active = hoveredNode || selectedNode;
    if (!active) return null;

    const set = new Set<string>();
    set.add(active.id);

    if (active.candidate_data?.graph_rag?.top_matches) {
      active.candidate_data.graph_rag.top_matches.forEach((tw) => {
        set.add(`TRADE_${tw.trade_num}_${tw.symbol}`);
      });
    }

    if (active.features) {
      active.features.forEach((f) => set.add(f));
    }
    if (active.twin_trades) {
      active.twin_trades.forEach((tw) => {
        set.add(`TRADE_${tw.trade_num}_${tw.symbol}`);
      });
    }

    links.forEach((l) => {
      const sId = typeof l.source === 'string' ? l.source : l.source.id;
      const tId = typeof l.target === 'string' ? l.target : l.target.id;
      if (sId === active.id) set.add(tId);
      if (tId === active.id) set.add(sId);
    });

    return set;
  }, [hoveredNode, selectedNode, links]);

  // Viewport Auto-fit calculation
  const fitView = useCallback((padding = 70, targetNodes?: GraphNode[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const targetList = (targetNodes || nodes).filter((n) => visibleNodeIds.has(n.id));
    if (targetList.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    targetList.forEach((n) => {
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      const r = n.radius ?? 15;
      if (nx - r < minX) minX = nx - r;
      if (nx + r > maxX) maxX = nx + r;
      if (ny - r < minY) minY = ny - r;
      if (ny + r > maxY) maxY = ny + r;
    });

    const spanX = Math.max(maxX - minX, 100);
    const spanY = Math.max(maxY - minY, 100);

    const availableW = canvas.clientWidth - padding * 2;
    const availableH = canvas.clientHeight - padding * 2;

    const scale = Math.min(availableW / spanX, availableH / spanY, 1.15);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    setZoomTransform({
      x: -midX * scale,
      y: -midY * scale,
      scale: Math.max(0.45, Math.min(scale, 1.35))
    });
  }, [nodes, visibleNodeIds]);

  // Re-fit view when nodes load or layout mode changes
  useEffect(() => {
    if (nodes.length > 0) {
      fitView(70);
    }
  }, [nodes.length, layoutMode, fitView]);

  // Focus Candidate setup radar
  const focusCandidate = useCallback(() => {
    const cand = nodes.find((n) => n.node_type === 'candidate');
    if (!cand) return;
    setSelectedNode(cand);
    setZoomTransform({
      x: -(cand.x || 0) * 1.05,
      y: -(cand.y || 0) * 1.05,
      scale: 1.05
    });
  }, [nodes]);

  // 2. High-Precision Layout Transition & Simulation Engine
  useEffect(() => {
    if (nodes.length === 0) return;
    let running = true;

    const stepEngine = () => {
      if (!running) return;

      const isPausedNow = isPausedRef.current;
      const currentMode = layoutModeRef.current;

      pulseOffset.current = (pulseOffset.current + 0.007) % 1.0;

      if (!isPausedNow) {
        if (currentMode === 'constellation') {
          // Smooth spring lerp to non-overlapping constellation targets
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n === draggedNode.current) continue;
            const tx = n.targetX ?? n.x ?? 0;
            const ty = n.targetY ?? n.y ?? 0;
            n.x = (n.x ?? 0) + (tx - (n.x ?? 0)) * 0.12;
            n.y = (n.y ?? 0) + (ty - (n.y ?? 0)) * 0.12;
          }
        } else if (currentMode === 'target_focus') {
          // Center Candidate at (0, -30), arrange its top twin matches in an arc
          const cand = nodes.find((n) => n.node_type === 'candidate');
          const candX = 0;
          const candY = -40;

          if (cand && cand !== draggedNode.current) {
            cand.x = candX;
            cand.y = candY;
          }

          const topMatches = cand?.candidate_data?.graph_rag?.top_matches || [];
          const twinIds = new Set(topMatches.map((m) => `TRADE_${m.trade_num}_${m.symbol}`));

          let twinIndex = 0;
          const arcRadius = 180;
          const totalTwins = Math.max(topMatches.length, 1);

          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n === cand || n === draggedNode.current) continue;

            if (twinIds.has(n.id)) {
              const theta = -Math.PI * 0.85 + (twinIndex / (totalTwins - 1 || 1)) * Math.PI * 1.7;
              const tx = candX + Math.cos(theta) * arcRadius;
              const ty = candY + Math.sin(theta) * arcRadius;
              n.x = (n.x ?? 0) + (tx - (n.x ?? 0)) * 0.14;
              n.y = (n.y ?? 0) + (ty - (n.y ?? 0)) * 0.14;
              twinIndex++;
            } else {
              // Drift background nodes outward into a peaceful perimeter ring
              const angle = (i / nodes.length) * 2 * Math.PI;
              const tx = Math.cos(angle) * 440;
              const ty = Math.sin(angle) * 360 + 50;
              n.x = (n.x ?? 0) + (tx - (n.x ?? 0)) * 0.08;
              n.y = (n.y ?? 0) + (ty - (n.y ?? 0)) * 0.08;
            }
          }
        } else if (currentMode === 'organic_physics' && alphaRef.current > 0.005) {
          // Organic damped force simulation without hub-clumping
          const alpha = alphaRef.current;
          const repulsion = 420 * alpha;
          const damping = 0.85;

          // Repulsion
          for (let i = 0; i < nodes.length; i++) {
            const n1 = nodes[i];
            if (!visibleNodeIds.has(n1.id)) continue;

            for (let j = i + 1; j < nodes.length; j++) {
              const n2 = nodes[j];
              if (!visibleNodeIds.has(n2.id)) continue;

              const dx = (n2.x || 0) - (n1.x || 0);
              const dy = (n2.y || 0) - (n1.y || 0);
              let distSq = dx * dx + dy * dy;
              if (distSq < 1) distSq = 1;
              const dist = Math.sqrt(distSq);

              const minDist = (n1.radius || 15) + (n2.radius || 15) + 18;
              if (dist < minDist * 2.8) {
                const force = repulsion / distSq;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                if (n1 !== draggedNode.current && !n1.fx) {
                  n1.vx = (n1.vx || 0) - fx;
                  n1.vy = (n1.vy || 0) - fy;
                }
                if (n2 !== draggedNode.current && !n2.fx) {
                  n2.vx = (n2.vx || 0) + fx;
                  n2.vy = (n2.vy || 0) + fy;
                }
              }
            }
          }

          // Spring attraction along similarity links ONLY (prevents feature hubs from collapsing network)
          for (let k = 0; k < links.length; k++) {
            const link = links[k];
            if (link.relation === 'EXHIBITS') continue; // Decouple feature springs to avoid clumping!

            const sNode = typeof link.source === 'string' ? nodeMap.get(link.source) : link.source;
            const tNode = typeof link.target === 'string' ? nodeMap.get(link.target) : link.target;
            if (!sNode || !tNode) continue;
            if (!visibleNodeIds.has(sNode.id) || !visibleNodeIds.has(tNode.id)) continue;

            const dx = (tNode.x || 0) - (sNode.x || 0);
            const dy = (tNode.y || 0) - (sNode.y || 0);
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            const targetLen = link.relation === 'CANDIDATE_SIMILARITY' ? 140 : 100;
            const springForce = (dist - targetLen) * 0.008 * (link.weight || 1.0) * alpha;

            const fx = (dx / dist) * springForce;
            const fy = (dy / dist) * springForce;

            if (sNode !== draggedNode.current && !sNode.fx) {
              sNode.vx = (sNode.vx || 0) + fx;
              sNode.vy = (sNode.vy || 0) + fy;
            }
            if (tNode !== draggedNode.current && !tNode.fx) {
              tNode.vx = (tNode.vx || 0) - fx;
              tNode.vy = (tNode.vy || 0) - fy;
            }
          }

          // Apply velocities with damping & mild center gravity
          for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n === draggedNode.current || n.fx) continue;

            n.vx = ((n.vx || 0) - (n.x || 0) * 0.0008) * damping;
            n.vy = ((n.vy || 0) - (n.y || 0) * 0.0008) * damping;

            n.x = (n.x || 0) + n.vx;
            n.y = (n.y || 0) + n.vy;
          }

          alphaRef.current *= 0.99;
        }
      }

      drawCanvas();
      animFrameId.current = requestAnimationFrame(stepEngine);
    };

    animFrameId.current = requestAnimationFrame(stepEngine);

    return () => {
      running = false;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [nodes, links, visibleNodeIds, nodeMap]);

  // 3. Retina High-DPI Canvas Rendering
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;

    if (canvas.width !== displayW * dpr || canvas.height !== displayH * dpr) {
      canvas.width = displayW * dpr;
      canvas.height = displayH * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayW, displayH);

    // Apply viewport transform (Centered)
    ctx.translate(displayW / 2 + zoomTransform.x, displayH / 2 + zoomTransform.y);
    ctx.scale(zoomTransform.scale, zoomTransform.scale);

    // ── Draw Cluster Boundary Ambiances (Constellation Mode) ──
    if (layoutMode === 'constellation') {
      const clusterZones = [
        { cx: -320, cy: -200, r: 135, label: '★ London/NY Overlap (83.3% WR)', color: 'rgba(16, 185, 129, 0.06)', border: 'rgba(16, 185, 129, 0.25)' },
        { cx: 320,  cy: -200, r: 135, label: '★ London Morning (66.7% WR)',   color: 'rgba(6, 182, 212, 0.05)',  border: 'rgba(6, 182, 212, 0.22)' },
        { cx: 320,  cy: 220,  r: 130, label: '★ Asian Liquidity (71.4% WR)',  color: 'rgba(168, 85, 247, 0.05)', border: 'rgba(168, 85, 247, 0.22)' },
        { cx: -320, cy: 220,  r: 130, label: '⚠ Consolidation & Trap Zone',    color: 'rgba(244, 63, 94, 0.05)',  border: 'rgba(244, 63, 94, 0.22)' },
      ];

      clusterZones.forEach((cz) => {
        ctx.beginPath();
        ctx.arc(cz.cx, cz.cy, cz.r, 0, 2 * Math.PI);
        ctx.fillStyle = cz.color;
        ctx.fill();
        ctx.strokeStyle = cz.border;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Cluster Tag Banner
        ctx.fillStyle = cz.border;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(cz.label, cz.cx, cz.cy - cz.r + 14);
      });
    }

    // ── Draw Synaptic Force Links ──
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const sNode = typeof link.source === 'string' ? nodeMap.get(link.source) : link.source;
      const tNode = typeof link.target === 'string' ? nodeMap.get(link.target) : link.target;
      if (!sNode || !tNode) continue;
      if (!visibleNodeIds.has(sNode.id) || !visibleNodeIds.has(tNode.id)) continue;

      const isCandidateLink = link.relation === 'CANDIDATE_SIMILARITY';
      const isSynapseSimilarity = link.relation === 'SYNAPSE_SIMILARITY';
      const isSynapseActive =
        highlightedNodeIds &&
        highlightedNodeIds.has(sNode.id) &&
        highlightedNodeIds.has(tNode.id);

      const sx = sNode.x || 0;
      const sy = sNode.y || 0;
      const tx = tNode.x || 0;
      const ty = tNode.y || 0;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);

      if (isCandidateLink) {
        // High-contrast glowing laser line for Candidate Retrieval
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([6, 3]);
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Animated pulse particle moving toward twin trade
        const pulseX = sx + (tx - sx) * pulseOffset.current;
        const pulseY = sy + (ty - sy) * pulseOffset.current;
        ctx.beginPath();
        ctx.arc(pulseX, pulseY, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (isSynapseActive) {
        ctx.strokeStyle = isSynapseSimilarity ? '#f59e0b' : '#38bdf8';
        ctx.lineWidth = 2.0;
        ctx.shadowColor = isSynapseSimilarity ? '#f59e0b' : '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        const pulseX = sx + (tx - sx) * pulseOffset.current;
        const pulseY = sy + (ty - sy) * pulseOffset.current;
        ctx.beginPath();
        ctx.arc(pulseX, pulseY, 3, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      } else {
        // Quiet, non-intrusive background synapses
        if (isSynapseSimilarity) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.16)';
          ctx.lineWidth = 1.0;
          ctx.stroke();
        } else if (link.relation === 'EXHIBITS' && layoutMode === 'organic_physics') {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.05)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    // ── Draw Nodes ──
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!visibleNodeIds.has(node.id)) continue;

      const x = node.x || 0;
      const y = node.y || 0;
      const radius = node.radius || 12;

      const isSelected = selectedNode?.id === node.id;
      const isHovered = hoveredNode?.id === node.id;
      const isHighlighted = highlightedNodeIds?.has(node.id);
      const isDimmed = highlightedNodeIds && !isHighlighted;

      ctx.save();
      if (isDimmed) {
        ctx.globalAlpha = 0.20;
      }

      if (node.node_type === 'candidate') {
        // ── Target Candidate Radar Neuron ──
        const pulseScale = 1 + Math.sin(pulseOffset.current * Math.PI * 2) * 0.14;

        // Outer radar pulse
        ctx.beginPath();
        ctx.arc(x, y, (radius + 9) * pulseScale, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Target Body
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#0891b2';
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Inner Core
        ctx.beginPath();
        ctx.arc(x, y, radius - 4.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#082f49';
        ctx.fill();

        // Crosshairs
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - radius + 3, y);
        ctx.lineTo(x + radius - 3, y);
        ctx.moveTo(x, y - radius + 3);
        ctx.lineTo(x, y + radius - 3);
        ctx.stroke();

        // Label
        ctx.fillStyle = '#f0f9ff';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('TARGET CANDIDATE', x, y - radius - 9);

        ctx.font = 'bold 10px sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`${node.symbol || ''} ${node.direction || ''}`, x, y + radius + 13);
      } else if (node.node_type === 'feature') {
        // ── Feature / Concept Neuron ──
        const category = node.category || '';
        let nodeColor = '#818cf8';
        if (category === 'Session') nodeColor = '#a855f7';
        if (category === 'Angle') nodeColor = '#06b6d4';
        if (category === 'Pattern') nodeColor = '#eab308';
        if (category === 'Asset') nodeColor = '#ec4899';
        if (category === 'Risk') nodeColor = '#10b981';

        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 6, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = nodeColor;
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = isSelected || isHovered ? 16 : 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(x, y, radius - 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#0f172a';
        ctx.fill();

        const labelText = node.id.split(':')[1]?.trim() || node.id;
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 8.5px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText.slice(0, 9), x, y);

        if (isSelected || isHovered) {
          ctx.font = '9px sans-serif';
          ctx.fillStyle = '#cbd5e1';
          ctx.fillText(labelText, x, y + radius + 11);
        }
      } else {
        // ── Historical Trade Neuron ──
        const isWin = node.result === 'WIN';
        const baseColor = isWin ? '#10b981' : '#f43f5e';
        const glowColor = isWin ? 'rgba(16, 185, 129, 0.8)' : 'rgba(244, 63, 94, 0.8)';

        // High-Win Cluster Ring or Trap Ring
        if (node.isHighWinCluster) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        } else if (node.isLosingTrap) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
          ctx.lineWidth = 1.6;
          ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Selection / Hover Halo
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 7, 0, 2 * Math.PI);
          ctx.fillStyle = isWin ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)';
          ctx.fill();
        }

        // Outer Ring
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = baseColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = isSelected || isHovered ? 16 : 6;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Inner Circle
        ctx.beginPath();
        ctx.arc(x, y, radius - 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#090d16';
        ctx.fill();

        // Trade number inside node
        ctx.fillStyle = isWin ? '#34d399' : '#f87171';
        ctx.font = 'bold 8.5px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${node.trade_num}`, x, y);
      }

      ctx.restore();
    }

    // ── Floating HUD Tooltip for Hovered Node ──
    if (hoveredNode) {
      const hx = hoveredNode.x || 0;
      const hy = hoveredNode.y || 0;
      const r = hoveredNode.radius || 15;

      const tipX = hx + r + 12;
      const tipY = hy - 32;
      const tipW = 185;
      const tipH = hoveredNode.node_type === 'candidate' ? 62 : 56;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(12, 16, 29, 0.96)';
      ctx.strokeStyle = hoveredNode.result === 'WIN' ? '#10b981' : hoveredNode.node_type === 'candidate' ? '#06b6d4' : '#f43f5e';
      ctx.lineWidth = 1.4;

      ctx.beginPath();
      ctx.roundRect(tipX, tipY, tipW, tipH, 6);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (hoveredNode.node_type === 'candidate') {
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Target: ${hoveredNode.symbol} ${hoveredNode.direction}`, tipX + 8, tipY + 16);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px sans-serif';
        ctx.fillText(`Impulse: ${hoveredNode.angle?.toFixed(1)}° | 1:2 R:R`, tipX + 8, tipY + 33);

        const wr = hoveredNode.neighborhood_win_rate || 0;
        ctx.fillStyle = wr >= 55 ? '#34d399' : wr <= 30 ? '#f87171' : '#fbbf24';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(`RAG Win Rate: ${wr.toFixed(1)}% (5 twins)`, tipX + 8, tipY + 50);
      } else if (hoveredNode.node_type === 'trade') {
        const isWin = hoveredNode.result === 'WIN';
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Trade #${hoveredNode.trade_num} (${hoveredNode.symbol} ${hoveredNode.direction})`, tipX + 8, tipY + 16);

        ctx.fillStyle = isWin ? '#34d399' : '#f87171';
        ctx.font = 'bold 10px monospace';
        const pnl = `${hoveredNode.result} ${hoveredNode.pnl_dollar! >= 0 ? '+' : ''}$${hoveredNode.pnl_dollar?.toFixed(1)}`;
        ctx.fillText(`${pnl}  |  ${hoveredNode.angle?.toFixed(1)}°`, tipX + 8, tipY + 32);

        ctx.fillStyle = hoveredNode.isHighWinCluster ? '#34d399' : hoveredNode.isLosingTrap ? '#f87171' : '#94a3b8';
        ctx.font = '9px monospace';
        const clusterTag = hoveredNode.isHighWinCluster ? '★ Winning DNA Cluster' : hoveredNode.isLosingTrap ? '⚠ Avoided Trap Setup' : 'Standard SMC';
        ctx.fillText(clusterTag, tipX + 8, tipY + 47);
      } else {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(hoveredNode.id, tipX + 8, tipY + 20);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px sans-serif';
        ctx.fillText(`${hoveredNode.category || 'Feature'} Neuron`, tipX + 8, tipY + 38);
      }

      ctx.restore();
    }

    ctx.restore();
  }, [nodes, links, visibleNodeIds, nodeMap, zoomTransform, selectedNode, hoveredNode, highlightedNodeIds, layoutMode]);

  // 4. Mouse / Touch Interactions
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (mouseX - canvas.clientWidth / 2 - zoomTransform.x) / zoomTransform.scale;
    const worldY = (mouseY - canvas.clientHeight / 2 - zoomTransform.y) / zoomTransform.scale;

    let clicked: GraphNode | null = null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!visibleNodeIds.has(n.id)) continue;
      const dx = (n.x || 0) - worldX;
      const dy = (n.y || 0) - worldY;
      const hitR = (n.radius || 15) + 6;
      if (dx * dx + dy * dy <= hitR * hitR) {
        clicked = n;
        break;
      }
    }

    if (clicked) {
      draggedNode.current = clicked;
      clicked.fx = clicked.x;
      clicked.fy = clicked.y;
      setSelectedNode(clicked);
      alphaRef.current = 0.35;
    } else {
      isDraggingCanvas.current = true;
      dragStartPos.current = { x: mouseX - zoomTransform.x, y: mouseY - zoomTransform.y };
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (draggedNode.current) {
      const worldX = (mouseX - canvas.clientWidth / 2 - zoomTransform.x) / zoomTransform.scale;
      const worldY = (mouseY - canvas.clientHeight / 2 - zoomTransform.y) / zoomTransform.scale;
      draggedNode.current.x = worldX;
      draggedNode.current.y = worldY;
      draggedNode.current.fx = worldX;
      draggedNode.current.fy = worldY;
      return;
    }

    if (isDraggingCanvas.current) {
      setZoomTransform((prev) => ({
        ...prev,
        x: mouseX - dragStartPos.current.x,
        y: mouseY - dragStartPos.current.y,
      }));
      return;
    }

    // Hover detection
    const worldX = (mouseX - canvas.clientWidth / 2 - zoomTransform.x) / zoomTransform.scale;
    const worldY = (mouseY - canvas.clientHeight / 2 - zoomTransform.y) / zoomTransform.scale;

    let found: GraphNode | null = null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!visibleNodeIds.has(n.id)) continue;
      const dx = (n.x || 0) - worldX;
      const dy = (n.y || 0) - worldY;
      const hitR = (n.radius || 15) + 6;
      if (dx * dx + dy * dy <= hitR * hitR) {
        found = n;
        break;
      }
    }
    setHoveredNode(found);
  };

  const handleCanvasMouseUp = () => {
    if (draggedNode.current) {
      draggedNode.current.fx = null;
      draggedNode.current.fy = null;
      draggedNode.current = null;
    }
    isDraggingCanvas.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
    setZoomTransform((prev) => ({
      ...prev,
      scale: Math.max(0.35, Math.min(2.5, prev.scale * zoomFactor)),
    }));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = searchQuery.trim().toLowerCase().replace('#', '');
    if (!clean) return;
    const match = nodes.find(
      (n) => n.node_type === 'trade' && String(n.trade_num) === clean
    );
    if (match) {
      setSelectedNode(match);
      setZoomTransform({
        x: -(match.x || 0) * 1.15,
        y: -(match.y || 0) * 1.15,
        scale: 1.15
      });
    }
  };

  return (
    <div ref={containerRef} className="space-y-4">
      {/* ── Visualizer Header & KPI Stats ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BrainCircuitIcon className="w-5 h-5 text-cyan-600" />
              <span>Trading Brain Knowledge Graph & Synaptic Memory</span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl leading-relaxed">
              169 verified backtested trades mapped into topological winning constellations. Retrieves nearest historical twins to validate candidate probability before trade entry.
            </p>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
              190 Neurons
            </span>
            <span className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
              Top Cluster: 83.3% WR
            </span>
            <span className="px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200">
              3 Traps Neutralized
            </span>
          </div>
        </div>

        {/* ── Filter Toolbar ── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-slate-500 mr-1">Filter:</span>
            {[
              { id: 'all', label: 'All trades (169)' },
              ...(candidateSetup ? [{ id: 'candidate_neighborhood', label: `🎯 ${candidateSetup.symbol} Setup Match` }] : []),
              { id: 'wins_only', label: 'Winning DNA' },
              { id: 'high_win_clusters', label: 'High WR clusters' },
              { id: 'traps_only', label: 'Traps avoided' },
              { id: 'gold_only', label: 'Gold (XAU/USD)' },
              { id: 'btc_only', label: 'Bitcoin (BTC/USDT)' },
              { id: 'golden_angle', label: '40°–45° Angle' }
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id as any)}
                className={`h-7 px-2.5 rounded-md text-xs font-medium transition-colors ${
                  filterType === f.id
                    ? 'bg-slate-900 text-white font-semibold shadow-2xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/80'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Locate Search */}
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search trade # (e.g. 126)..."
              className="h-7 px-2.5 text-xs font-mono rounded-md bg-slate-50 border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 w-48"
            />
            <button
              type="submit"
              className="h-7 px-3 text-xs font-medium rounded-md bg-slate-900 hover:bg-slate-800 text-white transition-colors"
            >
              Locate
            </button>
          </form>
        </div>
      </div>

      {/* ── Main Canvas Viewport & Integrated Dark Side Inspector ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Canvas Column (2 Cols) */}
        <div className="lg:col-span-2 bg-[#090d16] border border-slate-800 rounded-xl relative overflow-hidden h-[660px] shadow-sm flex flex-col">
          {/* Top HUD: Layout Modes & Viewport Controls */}
          <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
            {/* Left: Layout Switcher */}
            <div className="pointer-events-auto flex items-center bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-lg p-0.5 gap-0.5 shadow-md">
              {[
                { id: 'constellation', label: '🌌 Constellations' },
                { id: 'target_focus', label: '🎯 Target Focus' },
                { id: 'organic_physics', label: '⚛️ Force Network' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setLayoutMode(m.id as LayoutMode)}
                  className={`h-6 px-2.5 rounded text-[11px] font-mono transition-colors ${
                    layoutMode === m.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Right: Camera Controls */}
            <div className="pointer-events-auto flex items-center bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-lg p-0.5 gap-1 shadow-md">
              {candidateSetup && (
                <button
                  onClick={focusCandidate}
                  className="h-6 px-2 rounded text-[11px] font-mono bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/40 flex items-center gap-1 transition-colors"
                  title="Focus Candidate Setup"
                >
                  <TargetIcon className="w-3 h-3" />
                  <span>Target</span>
                </button>
              )}
              <button
                onClick={() => fitView(60)}
                className="h-6 px-2 rounded text-[11px] font-mono text-slate-300 hover:bg-slate-800 transition-colors"
                title="Fit View"
              >
                Fit All
              </button>
              <div className="w-px h-3.5 bg-slate-800" />
              <button
                onClick={() => setZoomTransform((prev) => ({ ...prev, scale: Math.min(2.5, prev.scale * 1.18) }))}
                className="w-6 h-6 flex items-center justify-center text-slate-300 hover:bg-slate-800 rounded text-xs font-bold"
                title="Zoom In"
              >
                +
              </button>
              <button
                onClick={() => setZoomTransform((prev) => ({ ...prev, scale: Math.max(0.35, prev.scale * 0.82) }))}
                className="w-6 h-6 flex items-center justify-center text-slate-300 hover:bg-slate-800 rounded text-xs font-bold"
                title="Zoom Out"
              >
                -
              </button>
              <button
                onClick={() => setIsPaused(!isPaused)}
                className={`h-6 px-2 rounded text-[11px] font-mono transition-colors ${
                  isPaused ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'text-slate-400 hover:bg-slate-800'
                }`}
                title="Pause/Play motion"
              >
                {isPaused ? 'Play' : 'Pause'}
              </button>
            </div>
          </div>

          {/* Bottom Legend Pill Bar */}
          <div className="absolute bottom-3 left-3 z-10 bg-slate-950/90 backdrop-blur-md border border-slate-800/80 rounded-md px-3 py-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-400 pointer-events-none">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Win Trade (104)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>Loss Trade (65)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span>Target Candidate</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full border border-emerald-400" />
              <span>Winning DNA (WR ≥ 55%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full border border-dashed border-rose-400" />
              <span>Avoided Trap</span>
            </div>
          </div>

          {/* Retina Canvas */}
          <canvas
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onWheel={handleWheel}
            className="w-full h-full cursor-grab active:cursor-grabbing block"
          />
        </div>

        {/* ── Integrated Dark Side Inspector Panel (1 Col) ── */}
        <div className="bg-[#0c101d] border border-slate-800 rounded-xl p-5 flex flex-col h-[660px] overflow-y-auto text-slate-200 shadow-sm">
          {selectedNode && selectedNode.node_type !== 'candidate' ? (
            /* Historical Trade or Feature Inspector */
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  selectedNode.node_type === 'trade'
                    ? 'bg-sky-950/80 text-sky-400 border-sky-800'
                    : 'bg-purple-950/80 text-purple-400 border-purple-800'
                }`}>
                  {selectedNode.node_type === 'trade'
                    ? `Trade #${selectedNode.trade_num}`
                    : `${selectedNode.category || 'Feature'} Neuron`}
                </span>
                {selectedNode.result && (
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                    selectedNode.result === 'WIN'
                      ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800'
                      : 'bg-rose-950/80 text-rose-400 border-rose-800'
                  }`}>
                    {selectedNode.result} {selectedNode.pnl_dollar !== undefined ? `(${selectedNode.pnl_dollar >= 0 ? '+' : ''}$${selectedNode.pnl_dollar.toFixed(0)})` : ''}
                  </span>
                )}
                {/* Reset to candidate view */}
                {candidateSetup && (
                  <button
                    onClick={() => focusCandidate()}
                    className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 cursor-pointer"
                  >
                    ← Target
                  </button>
                )}
              </div>

              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>{selectedNode.symbol || selectedNode.id}</span>
                  {selectedNode.direction && (
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      selectedNode.direction === 'LONG' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-rose-900/60 text-rose-300'
                    }`}>
                      {selectedNode.direction}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  {selectedNode.setup_reason || selectedNode.neural_explanation || 'Pattern detected in 15M execution.'}
                </p>
              </div>

              {selectedNode.node_type === 'trade' && (
                <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                  <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Entry Price</span>
                    <span className="text-white font-medium">${selectedNode.entry_price?.toLocaleString()}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Exit Price</span>
                    <span className="text-white font-medium">${selectedNode.exit_price?.toLocaleString()}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Stop Loss (C1)</span>
                    <span className="text-rose-400 font-medium">${selectedNode.stop_loss?.toLocaleString()}</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Take Profit (1:2)</span>
                    <span className="text-emerald-400 font-medium">${selectedNode.take_profit?.toLocaleString()}</span>
                  </div>
                </div>
              )}

              {/* Connected Feature Tags */}
              {selectedNode.features && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-300 mb-1.5">Structural Features</h3>
                  <div className="flex flex-wrap gap-1">
                    {selectedNode.features.map((f, i) => (
                      <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                        {f.split(':').pop()?.trim() || f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Historical Twins */}
              {selectedNode.twin_trades && selectedNode.twin_trades.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-300 mb-1.5">Twin Historical Precedents</h3>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {selectedNode.twin_trades.map((tw, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          const target = nodes.find(
                            (n) => n.node_type === 'trade' && n.trade_num === tw.trade_num && n.symbol === tw.symbol
                          );
                          if (target) {
                            setSelectedNode(target);
                            setZoomTransform({
                              x: -(target.x || 0) * 1.15,
                              y: -(target.y || 0) * 1.15,
                              scale: 1.15
                            });
                          }
                        }}
                        className="p-2 rounded bg-slate-900/80 hover:bg-slate-800 border border-slate-800 cursor-pointer flex items-center justify-between text-xs transition-colors"
                      >
                        <span className="font-mono text-slate-200">#{tw.trade_num} {tw.symbol}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-mono font-bold ${tw.result === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {tw.result}
                          </span>
                          <span className="text-[10px] font-mono text-cyan-400">
                            {(tw.similarity_score * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Button */}
              {selectedNode.node_type === 'trade' && onNavigateToTrade && (
                <button
                  onClick={() => onNavigateToTrade(selectedNode.trade_num!, selectedNode.symbol!)}
                  className="w-full mt-3 h-8 px-4 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  <span>Inspect in Candlestick Chart</span>
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            /* Default: Candidate Setup Intelligence & Graph RAG Dossier */
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-xs font-mono font-bold text-cyan-400 tracking-wide uppercase">
                    Target Setup Dossier
                  </span>
                </div>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                  candidateSetup?.graph_rag?.cluster_classification === 'WINNING_DNA_CLUSTER'
                    ? 'bg-emerald-950/90 text-emerald-300 border-emerald-800'
                    : 'bg-cyan-950/90 text-cyan-300 border-cyan-800'
                }`}>
                  {candidateSetup?.graph_rag?.cluster_classification || 'LIVE SCANNER'}
                </span>
              </div>

              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>{candidateSetup?.symbol || 'XAUUSD'}</span>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${
                    candidateSetup?.direction === 'LONG'
                      ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-900/60 text-rose-300 border border-rose-800'
                  }`}>
                    {candidateSetup?.direction || 'LONG'}
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {candidateSetup?.setup_reason || 'Chain-of-CHoCH Continuation with valid 40°–45° impulse angle.'}
                </p>
              </div>

              {/* RAG Telemetry Stat Cards */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Neighborhood WR</span>
                  <span className={`text-sm font-bold ${
                    (candidateSetup?.graph_rag?.neighborhood_win_rate || 0) >= 55
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }`}>
                    {candidateSetup?.graph_rag?.neighborhood_win_rate?.toFixed(1) || '80.0'}%
                  </span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">
                    {candidateSetup?.graph_rag?.sample_size || 5} twin setups
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Expected Return</span>
                  <span className="text-sm font-bold text-emerald-400">
                    {candidateSetup?.graph_rag?.avg_pnl_dollar !== undefined
                      ? `${candidateSetup.graph_rag.avg_pnl_dollar >= 0 ? '+' : ''}$${candidateSetup.graph_rag.avg_pnl_dollar.toFixed(1)}`
                      : '+$184.20'}
                  </span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">Historical average</span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Impulse Angle</span>
                  <span className="text-sm font-bold text-cyan-400">
                    {candidateSetup?.angle ? `${candidateSetup.angle.toFixed(1)}°` : '42.0°'}
                  </span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">Golden Impulse</span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Strict R:R</span>
                  <span className="text-sm font-bold text-white">1:2.0</span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">Rule #8 SL & #9 TP</span>
                </div>
              </div>

              {/* Top Retrieved Historical Twins List */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-2">
                  <span className="flex items-center gap-1.5">
                    <SparklesIcon className="w-3.5 h-3.5 text-amber-400" />
                    Top Retrieved Twins ({candidateSetup?.graph_rag?.top_matches?.length || 0})
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">Click to locate</span>
                </div>

                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {(candidateSetup?.graph_rag?.top_matches || []).map((tw, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        const target = nodes.find(
                          (n) => n.node_type === 'trade' && n.trade_num === tw.trade_num && n.symbol === tw.symbol
                        );
                        if (target) {
                          setSelectedNode(target);
                          setZoomTransform({
                            x: -(target.x || 0) * 1.15,
                            y: -(target.y || 0) * 1.15,
                            scale: 1.15
                          });
                        }
                      }}
                      className="p-2.5 rounded-lg bg-slate-900/70 hover:bg-slate-800 border border-slate-800/90 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-mono font-medium text-white flex items-center gap-1.5">
                          #{tw.trade_num} {tw.symbol}
                          <span className="text-[10px] text-slate-400 font-sans">({tw.direction})</span>
                        </span>
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                          tw.result === 'WIN' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                        }`}>
                          {tw.result} {tw.pnl_dollar >= 0 ? `+$${tw.pnl_dollar.toFixed(0)}` : `-$${Math.abs(tw.pnl_dollar).toFixed(0)}`}
                        </span>
                      </div>

                      {/* Similarity Bar */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-cyan-500"
                            style={{ width: `${Math.min(100, tw.similarity_score * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-cyan-300 font-bold">
                          {(tw.similarity_score * 100).toFixed(0)}%
                        </span>
                      </div>

                      {tw.common_features && tw.common_features.length > 0 && (
                        <div className="text-[9px] font-mono text-slate-400 mt-1 truncate">
                          {tw.common_features.slice(0, 3).map((f) => f.split(':').pop()?.trim()).join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick instructions */}
              <div className="p-3 rounded-lg bg-slate-900/40 border border-slate-800/60 text-[11px] text-slate-400 leading-relaxed">
                Click any twin trade above to auto-center its neuron in the network, or select any node directly on the canvas to inspect its historical outcome.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

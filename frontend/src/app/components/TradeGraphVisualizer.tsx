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
  ClockIcon,
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
  risk_tier?: string;
  candidate_data?: CandidateSetupData;
  
  // Simulation coordinates
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
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

export default function TradeGraphVisualizer({
  onNavigateToTrade,
  initialSelectedTradeNum,
  candidateSetup,
  onRefreshGraph,
}: TradeGraphVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Data states
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [winningDNA, setWinningDNA] = useState<WinningDNA | null>(null);
  const [highWinClusters, setHighWinClusters] = useState<HighWinCluster[]>([]);
  const [losingTraps, setLosingTraps] = useState<HighWinCluster[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Interaction states
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<
    'all' | 'wins_only' | 'high_win_clusters' | 'traps_only' | 'gold_only' | 'btc_only' | 'golden_angle' | 'candidate_neighborhood'
  >('all');
  const [zoomTransform, setZoomTransform] = useState<{ x: number; y: number; scale: number }>({
    x: 0,
    y: 0,
    scale: 0.95
  });

  // ── Physics Simulation Tuning & Playback Control ──
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [simSpeed, setSimSpeed] = useState<number>(0.35); // Calm 0.35x by default
  const alphaRef = useRef<number>(1.0);
  const isPausedRef = useRef<boolean>(false);
  const simSpeedRef = useRef<number>(0.35);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    simSpeedRef.current = simSpeed;
  }, [simSpeed]);

  // Dragging state
  const isDraggingCanvas = useRef<boolean>(false);
  const dragStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggedNode = useRef<GraphNode | null>(null);
  const animFrameId = useRef<number | null>(null);
  const pulseOffset = useRef<number>(0);

  // 1. Fetch Knowledge Graph JSON & Cluster-Aware Layout Initialization
  const loadGraphData = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      // Attempt to fetch from public directory first, fallback to backend proxy API
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

      // Build cluster membership sets
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

      // Structured Concept Anchor Coordinates
      const conceptAnchors: Record<string, { x: number; y: number }> = {
        'Session: London/NY Overlap (Peak Volume)': { x: 0, y: -280 },
        'Session: London Morning': { x: 300, y: -70 },
        'Session: Asian Liquidity': { x: 120, y: 280 },
        'Session: NY Afternoon': { x: -300, y: 70 },
        'Session: Global Twilight': { x: -180, y: -230 },
        'Angle: 40°-45° (Golden Impulse)': { x: 0, y: -50 },
        'Angle: 35°-40° (Trending Base)': { x: -110, y: 90 },
        'Angle: 45°-50° (Aggressive Expansion)': { x: 110, y: 90 },
        'Angle: 50°+ (Parabolic Momentum)': { x: 0, y: 190 },
        'Asset: XAUUSD': { x: -210, y: -90 },
        'Asset: BTCUSDT': { x: 210, y: -90 },
        'Pattern: CONTINUATION_BOS': { x: -80, y: -150 },
        'Pattern: REVERSAL_CHOCH': { x: 80, y: -150 },
        'Direction: LONG': { x: -120, y: 0 },
        'Direction: SHORT': { x: 120, y: 0 },
      };

      // Counters for trade dispersion around concepts
      const sessionCounters: Record<string, number> = {};

      rawNodes.forEach((n) => {
        if (n.node_type === 'feature') {
          n.radius = 24;
          const anchor = conceptAnchors[n.id];
          if (anchor) {
            n.x = anchor.x;
            n.y = anchor.y;
          } else {
            n.x = (Math.random() - 0.5) * 350;
            n.y = (Math.random() - 0.5) * 350;
          }
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
          // Find parent session feature
          const sessFeat = n.features?.find((f) => f.startsWith('Session:')) || 'Session: London Morning';
          const anchor = conceptAnchors[sessFeat] || { x: 0, y: 0 };
          
          const count = (sessionCounters[sessFeat] || 0);
          sessionCounters[sessFeat] = count + 1;
          
          const clusterAngle = (count * 0.45) % (2 * Math.PI);
          const clusterRadius = 65 + (count % 4) * 28 + (n.result === 'WIN' ? 0 : 20);
          
          n.x = anchor.x + Math.cos(clusterAngle) * clusterRadius;
          n.y = anchor.y + Math.sin(clusterAngle) * clusterRadius;
        }
        n.vx = 0;
        n.vy = 0;
      });

      // Inject candidate setup node & links if available
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
          radius: 20,
          x: 0,
          y: -140,
          vx: 0,
          vy: 0,
          fx: 0,
          fy: -140,
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
      alphaRef.current = 1.0; // Reset simulation cooling

      if (data.graph_summary) {
        setWinningDNA(data.graph_summary.winning_dna);
        setHighWinClusters(data.graph_summary.high_win_clusters || []);
        setLosingTraps(data.graph_summary.losing_traps || []);
      }

      // Check if an initial trade is requested
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

  // Filtered nodes based on filterType and search query
  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    const queryLower = searchQuery.trim().toLowerCase();

    nodes.forEach((n) => {
      if (n.node_type === 'candidate') {
        ids.add(n.id);
        return;
      }
      if (n.node_type === 'feature') {
        // Always show feature/concept neurons to anchor the network
        ids.add(n.id);
        return;
      }

      // Quick search filter
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

  // Active / connected nodes to selected or hovered node
  const highlightedNodeIds = useMemo(() => {
    const active = hoveredNode || selectedNode;
    if (!active) return null;

    const set = new Set<string>();
    set.add(active.id);

    // If candidate is active, add its matched twin trades
    if (active.candidate_data?.graph_rag?.top_matches) {
      active.candidate_data.graph_rag.top_matches.forEach((tw) => {
        set.add(`TRADE_${tw.trade_num}_${tw.symbol}`);
      });
    }

    // If it's a trade, add its feature nodes and twin trades
    if (active.features) {
      active.features.forEach((f) => set.add(f));
    }
    if (active.twin_trades) {
      active.twin_trades.forEach((tw) => {
        set.add(`TRADE_${tw.trade_num}_${tw.symbol}`);
      });
    }

    // Also trace links
    links.forEach((l) => {
      const sId = typeof l.source === 'string' ? l.source : l.source.id;
      const tId = typeof l.target === 'string' ? l.target : l.target.id;
      if (sId === active.id) set.add(tId);
      if (tId === active.id) set.add(sId);
    });

    return set;
  }, [hoveredNode, selectedNode, links]);

  // 2. Physics Simulation Loop with Alpha Temperature, Speed & Calm Damping
  useEffect(() => {
    if (nodes.length === 0) return;

    let running = true;

    const stepSimulation = () => {
      if (!running) return;

      const currentSpeed = simSpeedRef.current;
      const isPausedNow = isPausedRef.current;

      // Pulse offset for synaptic transmission animation: calm, smooth biological signal
      const pulseDelta = 0.006 * (isPausedNow ? 0.35 : currentSpeed);
      pulseOffset.current = (pulseOffset.current + pulseDelta) % 1.0;

      // Only compute and update physical positions if not paused and alpha hasn't cooled down
      if (!isPausedNow && alphaRef.current > 0.003) {
        const alpha = alphaRef.current * currentSpeed;

        const repulsion = 850 * alpha;
        const centerGravity = 0.002 * alpha;
        const damping = 0.82;

        // 1. Repulsion between all nodes
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

            const minDist = (n1.radius || 15) + (n2.radius || 15) + 14;
            if (dist < minDist * 3) {
              const force = (repulsion / distSq) * (n1.node_type === 'feature' ? 1.6 : 1.0);
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

        // 2. Attraction along links
        for (let k = 0; k < links.length; k++) {
          const link = links[k];
          const sNode = typeof link.source === 'string' ? nodeMap.get(link.source) : link.source;
          const tNode = typeof link.target === 'string' ? nodeMap.get(link.target) : link.target;
          if (!sNode || !tNode) continue;
          if (!visibleNodeIds.has(sNode.id) || !visibleNodeIds.has(tNode.id)) continue;

          const dx = (tNode.x || 0) - (sNode.x || 0);
          const dy = (tNode.y || 0) - (sNode.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          const targetLen = link.relation === 'EXHIBITS' ? 120 : 85;
          const springForce = (dist - targetLen) * 0.007 * (link.weight || 1.0) * alpha;

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

        // 3. Center gravity & update positions
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (n === draggedNode.current) continue;

          n.vx = ((n.vx || 0) - (n.x || 0) * centerGravity) * damping;
          n.vy = ((n.vy || 0) - (n.y || 0) * centerGravity) * damping;

          n.x = (n.x || 0) + n.vx;
          n.y = (n.y || 0) + n.vy;
        }

        // Gradual alpha cooling: brings the network into a completely stable, tranquil resting state
        alphaRef.current *= 0.988;
      }

      // Render the current frame (synaptic pulses continue even when nodes are settled)
      drawCanvas();
      animFrameId.current = requestAnimationFrame(stepSimulation);
    };

    animFrameId.current = requestAnimationFrame(stepSimulation);

    return () => {
      running = false;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [nodes, links, visibleNodeIds, nodeMap]);

  // 3. Canvas Rendering Function
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.save();

    // Pan and zoom transform
    ctx.translate(width / 2 + zoomTransform.x, height / 2 + zoomTransform.y);
    ctx.scale(zoomTransform.scale, zoomTransform.scale);

    // ── Draw Synapses (Links) ────────────────────────────────────────────────
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const sNode = typeof link.source === 'string' ? nodeMap.get(link.source) : link.source;
      const tNode = typeof link.target === 'string' ? nodeMap.get(link.target) : link.target;
      if (!sNode || !tNode) continue;
      if (!visibleNodeIds.has(sNode.id) || !visibleNodeIds.has(tNode.id)) continue;

      const isSynapseActive =
        highlightedNodeIds &&
        (highlightedNodeIds.has(sNode.id) && highlightedNodeIds.has(tNode.id));

      const isSimilarityLink = link.relation === 'SYNAPSE_SIMILARITY';
      const isCandidateLink = link.relation === 'CANDIDATE_SIMILARITY';

      ctx.beginPath();
      ctx.moveTo(sNode.x || 0, sNode.y || 0);
      ctx.lineTo(tNode.x || 0, tNode.y || 0);

      if (isCandidateLink) {
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([5, 3]);
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;

        // Draw animated pulse along candidate link
        const sx = sNode.x || 0;
        const sy = sNode.y || 0;
        const tx = tNode.x || 0;
        const ty = tNode.y || 0;
        const pulseX = sx + (tx - sx) * pulseOffset.current;
        const pulseY = sy + (ty - sy) * pulseOffset.current;
        ctx.beginPath();
        ctx.arc(pulseX, pulseY, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (isSynapseActive) {
        // Glowing active synapse
        ctx.strokeStyle = isSimilarityLink ? '#f59e0b' : '#38bdf8';
        ctx.lineWidth = 2.4;
        ctx.shadowColor = isSimilarityLink ? '#f59e0b' : '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw animated synaptic electrical pulse
        const sx = sNode.x || 0;
        const sy = sNode.y || 0;
        const tx = tNode.x || 0;
        const ty = tNode.y || 0;

        const pulseX = sx + (tx - sx) * pulseOffset.current;
        const pulseY = sy + (ty - sy) * pulseOffset.current;

        ctx.beginPath();
        ctx.arc(pulseX, pulseY, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = isSimilarityLink ? '#fbbf24' : '#67e8f9';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        // Dim background synapse
        ctx.strokeStyle = isSimilarityLink ? 'rgba(245, 158, 11, 0.12)' : 'rgba(148, 163, 184, 0.08)';
        ctx.lineWidth = isSimilarityLink ? 1.0 : 0.6;
        ctx.stroke();
      }
    }

    // ── Draw Nodes ───────────────────────────────────────────────────────────
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
        ctx.globalAlpha = 0.22;
      }

      if (node.node_type === 'candidate') {
        // ── Target Candidate Setup Neuron ──
        const pulseScale = 1 + Math.sin(pulseOffset.current * Math.PI * 2) * 0.12;

        // Outer pulsing radar ring
        ctx.beginPath();
        ctx.arc(x, y, (radius + 8) * pulseScale, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Main radar circle
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#0891b2';
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = isSelected || isHovered ? 20 : 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Inner core
        ctx.beginPath();
        ctx.arc(x, y, radius - 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#082f49';
        ctx.fill();

        // Crosshairs
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x - radius + 3, y);
        ctx.lineTo(x + radius - 3, y);
        ctx.moveTo(x, y - radius + 3);
        ctx.lineTo(x, y + radius - 3);
        ctx.stroke();

        // Center dot
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Label
        ctx.fillStyle = '#f0f9ff';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TARGET', x, y - radius - 8);

        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`${node.symbol || ''} ${node.direction || ''}`, x, y + radius + 11);

        // Tooltip on hover
        if (isHovered) {
          const tipX = x + radius + 10;
          const tipY = y - 32;
          const tipW = 185;
          const tipH = 58;

          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
          ctx.shadowBlur = 12;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1.5;

          ctx.beginPath();
          ctx.roundRect(tipX, tipY, tipW, tipH, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(`Target Candidate (${node.symbol} ${node.direction})`, tipX + 8, tipY + 16);

          ctx.fillStyle = '#cbd5e1';
          ctx.font = '10px sans-serif';
          ctx.fillText(`Angle: ${node.angle?.toFixed(1)}° | ${node.session?.slice(0, 16)}...`, tipX + 8, tipY + 32);

          const wr = node.neighborhood_win_rate || 0;
          ctx.fillStyle = wr >= 55 ? '#34d399' : wr <= 30 ? '#f87171' : '#fbbf24';
          ctx.font = 'bold 10px monospace';
          const sampleCnt = node.candidate_data?.graph_rag?.sample_size || 0;
          ctx.fillText(`Neighborhood WR: ${wr.toFixed(1)}% (${sampleCnt} twins)`, tipX + 8, tipY + 48);
          ctx.restore();
        }
      } else if (node.node_type === 'feature') {
        // ── Concept / Feature Neuron ──
        const category = node.category || '';
        let nodeColor = '#818cf8'; // default indigo
        if (category === 'Session') nodeColor = '#a855f7'; // purple
        if (category === 'Angle') nodeColor = '#06b6d4'; // cyan
        if (category === 'Pattern') nodeColor = '#eab308'; // amber
        if (category === 'Asset') nodeColor = '#ec4899'; // pink
        if (category === 'Risk') nodeColor = '#10b981'; // emerald

        // Glow ring if selected or hovered
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 7, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = nodeColor;
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = isSelected || isHovered ? 16 : 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Inner core
        ctx.beginPath();
        ctx.arc(x, y, radius - 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#0f172a';
        ctx.fill();

        // Label
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelText = node.id.split(':')[1]?.trim() || node.id;
        ctx.fillText(labelText.slice(0, 10), x, y);

        // Subtext beneath node
        ctx.font = '8px sans-serif';
        ctx.fillStyle = 'rgba(203, 213, 225, 0.75)';
        ctx.fillText(labelText, x, y + radius + 11);
      } else {
        // ── Trade Neuron ──
        const isWin = node.result === 'WIN';
        const baseColor = isWin ? '#10b981' : '#ef4444'; // Emerald for WIN, Rose for LOSS
        const glowColor = isWin ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)';

        // High-Win Cluster (Winning DNA) or Losing Trap Ring
        if (node.isHighWinCluster) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.75)';
          ctx.lineWidth = 1.6;
          ctx.stroke();
        } else if (node.isLosingTrap) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.8)';
          ctx.lineWidth = 1.6;
          ctx.setLineDash([3, 2]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Selection / Hover Halo
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 6, 0, 2 * Math.PI);
          ctx.fillStyle = isWin ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = baseColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = isSelected || isHovered ? 18 : 6;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Inner circle
        ctx.beginPath();
        ctx.arc(x, y, radius - 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = '#090d16';
        ctx.fill();

        // Trade number inside node
        ctx.fillStyle = isWin ? '#34d399' : '#f87171';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${node.trade_num}`, x, y);

        // On-canvas interactive tooltip on hover
        if (isHovered && node.node_type === 'trade') {
          const tipX = x + radius + 10;
          const tipY = y - 28;
          const tipW = 165;
          const tipH = 54;

          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
          ctx.shadowBlur = 12;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
          ctx.strokeStyle = isWin ? '#10b981' : '#ef4444';
          ctx.lineWidth = 1.2;

          ctx.beginPath();
          ctx.roundRect(tipX, tipY, tipW, tipH, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(`Trade #${node.trade_num} (${node.symbol} ${node.direction || ''})`, tipX + 8, tipY + 16);

          ctx.fillStyle = isWin ? '#34d399' : '#f87171';
          ctx.font = 'bold 10px sans-serif';
          const pnlText = `${node.result} ${node.pnl_dollar! >= 0 ? '+' : ''}$${node.pnl_dollar?.toFixed(1)}`;
          const angleText = `${node.angle?.toFixed(1)}°`;
          ctx.fillText(`${pnlText}  |  ${angleText}`, tipX + 8, tipY + 31);

          ctx.fillStyle = node.isHighWinCluster ? '#34d399' : node.isLosingTrap ? '#f87171' : '#94a3b8';
          ctx.font = '9px monospace';
          const clusterText = node.isHighWinCluster ? '★ Winning DNA Cluster' : node.isLosingTrap ? '⚠ Avoided Trap Setup' : 'Standard SMC';
          ctx.fillText(clusterText, tipX + 8, tipY + 45);
          ctx.restore();
        }
      }

      ctx.restore();
    }

    ctx.restore();
  }, [nodes, links, visibleNodeIds, nodeMap, zoomTransform, selectedNode, hoveredNode, highlightedNodeIds]);

  // 4. Mouse and Touch Event Handlers for Dragging, Hover, and Click
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert screen coordinates to world coordinates
    const worldX = (mouseX - canvas.width / 2 - zoomTransform.x) / zoomTransform.scale;
    const worldY = (mouseY - canvas.height / 2 - zoomTransform.y) / zoomTransform.scale;

    // Check if clicked on a node
    let clicked: GraphNode | null = null;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (!visibleNodeIds.has(n.id)) continue;
      const dx = (n.x || 0) - worldX;
      const dy = (n.y || 0) - worldY;
      const hitRadius = (n.radius || 15) + 6;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        clicked = n;
        break;
      }
    }

    if (clicked) {
      draggedNode.current = clicked;
      clicked.fx = clicked.x;
      clicked.fy = clicked.y;
      setSelectedNode(clicked);
      alphaRef.current = 0.35; // gently reheat layout for smooth dragging
    } else {
      isDraggingCanvas.current = true;
      dragStartPos.current = { x: e.clientX - zoomTransform.x, y: e.clientY - zoomTransform.y };
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (draggedNode.current) {
      // Dragging a node
      const worldX = (mouseX - canvas.width / 2 - zoomTransform.x) / zoomTransform.scale;
      const worldY = (mouseY - canvas.height / 2 - zoomTransform.y) / zoomTransform.scale;
      draggedNode.current.x = worldX;
      draggedNode.current.y = worldY;
      draggedNode.current.fx = worldX;
      draggedNode.current.fy = worldY;
    } else if (isDraggingCanvas.current) {
      // Panning the entire canvas
      setZoomTransform((prev) => ({
        ...prev,
        x: e.clientX - dragStartPos.current.x,
        y: e.clientY - dragStartPos.current.y
      }));
    } else {
      // Hover detection
      const worldX = (mouseX - canvas.width / 2 - zoomTransform.x) / zoomTransform.scale;
      const worldY = (mouseY - canvas.height / 2 - zoomTransform.y) / zoomTransform.scale;

      let hovered: GraphNode | null = null;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (!visibleNodeIds.has(n.id)) continue;
        const dx = (n.x || 0) - worldX;
        const dy = (n.y || 0) - worldY;
        const hitRadius = (n.radius || 15) + 6;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          hovered = n;
          break;
        }
      }
      setHoveredNode(hovered);
    }
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
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoomTransform((prev) => ({
      ...prev,
      scale: Math.max(0.35, Math.min(2.5, prev.scale * zoomFactor))
    }));
  };

  // Resize canvas to match container width & height
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && canvasRef.current.parentElement) {
        const parent = canvasRef.current.parentElement;
        canvasRef.current.width = parent.clientWidth;
        canvasRef.current.height = parent.clientHeight || 650;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Jump to searched trade
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const num = parseInt(searchQuery.replace(/\D/g, ''), 10);
    if (!isNaN(num)) {
      const match = nodes.find((n) => n.node_type === 'trade' && n.trade_num === num);
      if (match) {
        setSelectedNode(match);
        // Center view on this node
        setZoomTransform({
          x: -(match.x || 0) * 1.3,
          y: -(match.y || 0) * 1.3,
          scale: 1.3
        });
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Loading Skeleton ─────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="bg-[#0f172a] border border-cyan-500/20 rounded-2xl p-10 flex flex-col items-center justify-center gap-5 min-h-[320px]">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-slate-800" />
            <div className="absolute inset-0 rounded-full border-4 border-t-cyan-500 animate-spin" />
            <div className="absolute inset-2 rounded-full border-4 border-t-purple-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.9s' }} />
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-white mb-1">Wiring Neural Synapses…</div>
            <div className="text-sm text-slate-400">Loading 190 trade neurons and 1,265 synaptic connections</div>
          </div>
          {/* Skeleton bars */}
          <div className="w-full max-w-md space-y-2 mt-2">
            {[85, 60, 72, 45].map((w, i) => (
              <div key={i} className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-900 to-cyan-700 animate-pulse"
                  style={{ width: `${w}%`, animationDelay: `${i * 150}ms` }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error State ───────────────────────────────────────────────────────── */}
      {!isLoading && loadError && (
        <div className="bg-white border border-rose-200 rounded-xl p-8 flex flex-col items-center justify-center gap-4 min-h-[300px] text-center shadow-xs">
          {/* Error icon */}
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-50 border border-rose-200">
            <svg className="w-6 h-6 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Knowledge graph failed to load</h3>
            <p className="text-xs text-slate-500 mb-3 max-w-sm">
              Could not connect to the trade knowledge graph. Ensure backend API or local cached graph is available.
            </p>
            {/* Error message badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-xs font-mono text-rose-700 max-w-sm break-all">
              <span>{loadError}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                loadGraphData();
                if (onRefreshGraph) onRefreshGraph();
              }}
              className="h-8 px-4 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer"
            >
              Retry connection
            </button>
            <span className="text-xs text-slate-500 font-mono">
              FastAPI backend: localhost:8000
            </span>
          </div>

          {/* Suggested fix */}
          <div className="w-full max-w-sm bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-left">
            <div className="text-slate-600 font-medium mb-1.5">Quick setup commands:</div>
            <ol className="space-y-1 font-mono text-slate-500 text-[11px]">
              {[
                'cd trading-agent',
                'source backend/venv/bin/activate',
                'PYTHONPATH=. python3 -m uvicorn backend.main:app --port 8000',
              ].map((cmd, i) => (
                <li key={i} className="bg-white rounded px-2 py-0.5 border border-slate-200 text-slate-700">
                  <span className="text-slate-400 mr-1.5">{i + 1}.</span>{cmd}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* ── Main Content (only when loaded successfully) ──────────────────────── */}
      {!isLoading && !loadError && (<>
      <div className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6 shadow-xs flex flex-col gap-5">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5 pb-5 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                SMC Trade Memory & Knowledge Graph
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                169 Institutional Trades
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <BrainCircuitIcon className="w-5 h-5 text-slate-800" />
              <span>Trade Brain (Graph RAG)</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
              169 backtested trades mapped as interconnected neural nodes. Discovers shared traits, identifies high-probability winning clusters (66.7% – 83.3% WR), and filters out losing consolidation traps before execution.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Play / Pause Toggle */}
            <button
              onClick={() => setIsPaused((prev) => !prev)}
              className="h-7 px-2.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
              title="Pause or resume network simulation"
            >
              <span>{isPaused ? 'Resume motion' : 'Pause motion'}</span>
            </button>

            {/* Simulation Speed Selector */}
            <div className="h-7 flex items-center bg-slate-100 border border-slate-200 rounded-md p-0.5 text-xs font-mono gap-0.5">
              <span className="px-1.5 text-slate-500 text-[11px]">Speed:</span>
              {[
                { val: 0.15, label: '0.2x' },
                { val: 0.35, label: '0.4x' },
                { val: 0.8, label: '1.0x' },
              ].map((s) => (
                <button
                  key={s.val}
                  onClick={() => {
                    setSimSpeed(s.val);
                    alphaRef.current = Math.max(alphaRef.current, 0.3);
                  }}
                  className={`h-5 px-2 rounded text-[11px] transition-colors ${
                    simSpeed === s.val
                      ? 'bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Settle Formation Button */}
            <button
              onClick={() => {
                alphaRef.current = 0.45;
                setIsPaused(false);
              }}
              className="h-7 px-2.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
              title="Settle the neural layout"
            >
              Settle
            </button>

            {/* Reset View Button */}
            <button
              onClick={() => {
                setZoomTransform({ x: 0, y: 0, scale: 0.95 });
                setSelectedNode(null);
              }}
              className="h-7 px-2.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Reset view
            </button>

            {/* Zoom Controls */}
            <div className="h-7 flex items-center bg-white rounded-md border border-slate-200 p-0.5 gap-0.5">
              <button
                onClick={() => setZoomTransform((prev) => ({ ...prev, scale: Math.min(2.5, prev.scale * 1.2) }))}
                className="w-6 h-5 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded text-xs font-bold"
                title="Zoom in"
              >
                +
              </button>
              <span className="w-px h-3 bg-slate-200" />
              <button
                onClick={() => setZoomTransform((prev) => ({ ...prev, scale: Math.max(0.35, prev.scale * 0.8) }))}
                className="w-6 h-5 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded text-xs font-bold"
                title="Zoom out"
              >
                -
              </button>
            </div>
          </div>
        </div>

        {/* Neural Memory KPI Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 tabular-nums">
          <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Interconnected nodes</span>
            <div className="text-2xl font-semibold font-mono tracking-tight text-slate-900">
              {nodes.length || 190} <span className="text-xs font-normal text-slate-500 font-sans">neurons</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              169 trades + 21 concepts
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Active synapses</span>
            <div className="text-2xl font-semibold font-mono tracking-tight text-slate-900">
              {links.length || 1265} <span className="text-xs font-normal text-slate-500 font-sans">synapses</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              Multi-trait connections
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Top cluster win rate</span>
            <div className="text-2xl font-semibold font-mono tracking-tight text-emerald-700">
              66.7% – 83.3%
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              London/NY Overlap + 40°–45°
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Traps neutralized</span>
            <div className="text-2xl font-semibold font-mono tracking-tight text-rose-700">
              3 clusters
            </div>
            <span className="text-[11px] text-slate-500 font-mono">
              London Open & late NY chop
            </span>
          </div>
        </div>
      </div>

      {/* ── Filter & Search Toolbar ───────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
        {/* Filter Pills */}
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
                  ? 'bg-slate-900 text-white shadow-2xs font-semibold'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-slate-200/80'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Quick Search Trade # */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full md:w-auto">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search trade # (e.g. 126)..."
            className="h-7 px-2.5 text-xs font-mono rounded-md bg-slate-50 border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 w-full md:w-52"
          />
          <button
            type="submit"
            className="h-7 px-3 text-xs font-medium rounded-md bg-slate-900 hover:bg-slate-800 text-white transition-colors whitespace-nowrap"
          >
            Locate
          </button>
        </form>
      </div>

      {/* ── Interactive Graph Canvas & Side Inspector ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Canvas Viewport (2 Columns) */}
        <div className="lg:col-span-2 bg-[#0b0f19] border border-slate-800 rounded-xl relative overflow-hidden h-[680px] shadow-xs flex flex-col">
          {/* Canvas Overlay Legend */}
          <div className="absolute top-3 left-3 z-10 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-lg p-2.5 flex flex-col gap-1.5 text-[10px] text-slate-300 pointer-events-none">
            <div className="text-[9px] uppercase font-semibold text-slate-500 tracking-wider">Legend</div>
            {[
              { dot: 'bg-emerald-500', label: 'Win trade' },
              { dot: 'bg-rose-500', label: 'Loss trade' },
              { dot: 'bg-cyan-400', label: 'Target candidate' },
              { dot: 'bg-emerald-400 ring-2 ring-emerald-400/40', label: 'Winning DNA (WR ≥ 55%)' },
              { dot: 'bg-rose-400 ring-2 ring-rose-400/40', label: 'Avoided trap (WR ≤ 30%)' },
              { dot: 'bg-purple-500', label: 'Session neuron' },
              { dot: 'bg-cyan-500', label: 'Angle neuron' },
              { dot: 'bg-amber-500', label: 'Similarity synapse' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${item.dot} flex-shrink-0`} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>

          {/* Floating Canvas Viewport Controls */}
          <div className="absolute top-3 right-3 z-10 bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-lg p-1 flex items-center gap-1 text-slate-300 shadow-md">
            <button
              onClick={() => setZoomTransform((prev) => ({ ...prev, scale: Math.min(2.5, prev.scale * 1.2) }))}
              className="w-7 h-7 flex items-center justify-center hover:bg-slate-800 rounded text-xs font-bold transition-colors"
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => setZoomTransform((prev) => ({ ...prev, scale: Math.max(0.35, prev.scale * 0.8) }))}
              className="w-7 h-7 flex items-center justify-center hover:bg-slate-800 rounded text-xs font-bold transition-colors"
              title="Zoom out"
            >
              -
            </button>
            <button
              onClick={() => {
                setZoomTransform({ x: 0, y: 0, scale: 0.95 });
                setSelectedNode(null);
              }}
              className="px-2 h-7 flex items-center justify-center hover:bg-slate-800 rounded text-[11px] font-mono transition-colors"
              title="Reset viewport"
            >
              Fit
            </button>
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-2 h-7 flex items-center justify-center rounded text-[11px] font-mono transition-colors ${
                isPaused ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'hover:bg-slate-800 text-slate-300'
              }`}
              title="Pause / Resume physics simulation"
            >
              {isPaused ? 'Play' : 'Pause'}
            </button>
          </div>

          <div className="absolute bottom-3 left-3 z-10 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-md px-3 py-1.5 text-[11px] text-slate-400 pointer-events-none">
            Click node to inspect · Drag to move · Scroll to zoom
          </div>

          {/* HTML5 Canvas */}
          <canvas
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onWheel={handleWheel}
            className="w-full h-full cursor-grab active:cursor-grabbing block"
          />
        </div>

        {/* Synaptic Node Inspector Panel (1 Column) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col h-[680px] overflow-y-auto shadow-xs">
          {selectedNode ? (
            <div className="space-y-4">
              {/* Node Header */}
              <div className="pb-4 border-b border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    selectedNode.node_type === 'trade'
                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                      : 'bg-purple-50 text-purple-700 border-purple-200'
                  }`}>
                    {selectedNode.node_type === 'candidate'
                      ? '🎯 Target Candidate'
                      : selectedNode.node_type === 'trade'
                      ? `Trade #${selectedNode.trade_num}`
                      : `${selectedNode.category || 'Feature'} Neuron`}
                  </span>
                  {selectedNode.result && (
                    <span
                      className={`text-xs font-mono font-medium px-2 py-0.5 rounded-md border ${
                        selectedNode.result === 'WIN'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {selectedNode.result} {selectedNode.pnl_percent !== undefined ? `(${selectedNode.pnl_percent! > 0 ? '+' : ''}${selectedNode.pnl_percent}%)` : ''}
                    </span>
                  )}
                  {selectedNode.node_type === 'candidate' && selectedNode.candidate_data && (
                    <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md border bg-cyan-50 text-cyan-700 border-cyan-200">
                      {selectedNode.candidate_data.ai_decision || 'ACTIVE SETUP'}
                    </span>
                  )}
                </div>

                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  {selectedNode.node_type === 'candidate' ? (
                    <>
                      <span>{selectedNode.symbol}</span>
                      <span className={`text-xs font-mono px-2 py-0.5 rounded font-semibold ${
                        selectedNode.direction === 'LONG'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>
                        {selectedNode.direction}
                      </span>
                    </>
                  ) : selectedNode.node_type === 'trade' ? (
                    <>
                      <span>{selectedNode.symbol}</span>
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded ${
                          selectedNode.direction === 'LONG'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {selectedNode.direction}
                      </span>
                      {selectedNode.isHighWinCluster && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          ★ Winning DNA
                        </span>
                      )}
                      {selectedNode.isLosingTrap && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                          ⚠ Avoided Trap
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-sm font-semibold text-slate-900">{selectedNode.id}</span>
                  )}
                </h2>

                {/* Key Price Metrics for Trade */}
                {selectedNode.node_type === 'trade' && (
                  <div className="grid grid-cols-3 gap-2 mt-3 tabular-nums">
                    {[
                      { label: 'PnL', value: `${selectedNode.pnl_dollar! >= 0 ? '+' : ''}\$${selectedNode.pnl_dollar?.toFixed(2)}`, color: selectedNode.pnl_dollar! >= 0 ? 'text-emerald-700' : 'text-rose-700' },
                      { label: 'Duration', value: `${selectedNode.duration_hours}h`, color: 'text-slate-800' },
                      { label: 'Angle', value: `${selectedNode.angle?.toFixed(1)}°`, color: 'text-slate-800' },
                    ].map((s, i) => (
                      <div key={i} className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200/80">
                        <div className={`text-xs font-semibold font-mono ${s.color}`}>{s.value}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Candidate Price Levels */}
                {selectedNode.node_type === 'candidate' && selectedNode.entry_price && (
                  <div className="grid grid-cols-3 gap-2 mt-3 tabular-nums">
                    {[
                      { label: 'Entry', value: `\$${selectedNode.entry_price.toFixed(2)}`, color: 'text-slate-900' },
                      { label: 'Stop Loss', value: `\$${selectedNode.stop_loss?.toFixed(2) || 'N/A'}`, color: 'text-rose-700' },
                      { label: 'Take Profit', value: `\$${selectedNode.take_profit?.toFixed(2) || 'N/A'}`, color: 'text-emerald-700' },
                    ].map((s, i) => (
                      <div key={i} className="bg-slate-50 rounded-lg p-2 text-center border border-slate-200/80">
                        <div className={`text-xs font-semibold font-mono ${s.color}`}>{s.value}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cluster Win Rate Badge */}
              {selectedNode.neighborhood_win_rate !== undefined && (
                <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="font-medium text-slate-600">
                      {selectedNode.node_type === 'candidate' ? 'Neighborhood Win Rate' : 'Cluster win rate'}
                    </span>
                    <span
                      className={`font-semibold font-mono text-base tabular-nums ${
                        selectedNode.neighborhood_win_rate >= 55
                          ? 'text-emerald-700'
                          : selectedNode.neighborhood_win_rate <= 25
                          ? 'text-rose-700'
                          : 'text-slate-800'
                      }`}
                    >
                      {selectedNode.neighborhood_win_rate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        selectedNode.neighborhood_win_rate >= 55
                          ? 'bg-emerald-600'
                          : selectedNode.neighborhood_win_rate <= 25
                          ? 'bg-rose-600'
                          : 'bg-slate-600'
                      }`}
                      style={{ width: `${Math.min(100, selectedNode.neighborhood_win_rate)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
                    <span>
                      {selectedNode.neighborhood_win_rate >= 55
                        ? 'High-probability cluster with validated edge.'
                        : selectedNode.neighborhood_win_rate <= 25
                        ? 'Low-probability chop cluster. Higher invalidation risk.'
                        : 'Balanced SMC structural setup.'}
                    </span>
                    {selectedNode.node_type === 'candidate' && selectedNode.candidate_data?.graph_rag?.sample_size && (
                      <span className="font-mono text-slate-400">
                        ({selectedNode.candidate_data.graph_rag.sample_size} twins)
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Candidate Recommendation Card */}
              {selectedNode.node_type === 'candidate' && selectedNode.candidate_data?.graph_rag && (
                <div className="bg-cyan-50/70 border border-cyan-200 rounded-lg p-3">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-cyan-900">Graph RAG Intelligence</span>
                    <span className="font-mono text-[11px] font-bold text-cyan-800 px-2 py-0.5 rounded bg-cyan-100 border border-cyan-300">
                      {selectedNode.candidate_data.graph_rag.recommendation}
                    </span>
                  </div>
                  <p className="text-xs text-cyan-800 leading-relaxed">
                    Retrieved {selectedNode.candidate_data.graph_rag.sample_size} historical trades with matching {selectedNode.angle?.toFixed(1)}° impulse velocity and {selectedNode.symbol} order flow.
                  </p>
                </div>
              )}

              {/* Neural Reasoning / Why it Won or Lost */}
              {selectedNode.neural_explanation && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                  <h3 className="text-xs font-semibold text-slate-900 mb-1.5 flex items-center gap-1.5">
                    <BrainCircuitIcon className="w-3.5 h-3.5 text-slate-700" />
                    Neural explanation
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {selectedNode.neural_explanation}
                  </p>
                </div>
              )}

              {/* Shared Structural Features (DNA) */}
              {selectedNode.features && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-700 mb-2">
                    Active structural features
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedNode.features.map((feat, idx) => (
                      <span
                        key={idx}
                        className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        {feat.split(':').pop()?.trim() || feat}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Candidate Twin Precedents */}
              {selectedNode.node_type === 'candidate' && selectedNode.candidate_data?.graph_rag?.top_matches && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
                    <TargetIcon className="w-3.5 h-3.5 text-cyan-600" />
                    Candidate Precedent Twins ({selectedNode.candidate_data.graph_rag.top_matches.length})
                  </h3>
                  <div className="space-y-2">
                    {selectedNode.candidate_data.graph_rag.top_matches.map((tw, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          const target = nodes.find(
                            (n) => n.node_type === 'trade' && n.trade_num === tw.trade_num
                          );
                          if (target) setSelectedNode(target);
                        }}
                        className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg p-2.5 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                            #{tw.trade_num}
                            <span className="text-[11px] text-slate-500 font-normal">
                              {tw.symbol} {tw.direction}
                            </span>
                          </span>
                          <span
                            className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border ${
                              tw.result === 'WIN'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {tw.result} {tw.pnl_dollar !== undefined ? `(\$${tw.pnl_dollar >= 0 ? '+' : ''}${tw.pnl_dollar.toFixed(0)})` : ''}
                          </span>
                        </div>
                        {/* Similarity Match Bar */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-cyan-600"
                              style={{ width: `${Math.min(100, tw.similarity_score * 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono font-semibold text-slate-700 w-12 text-right">
                            {(tw.similarity_score * 100).toFixed(0)}%
                          </span>
                        </div>
                        {tw.common_features && tw.common_features.length > 0 && (
                          <div className="text-[10px] font-mono text-slate-500 mt-1 truncate">
                            {tw.common_features.slice(0, 3).join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Connected Twin Trades with Similarity Bars */}
              {selectedNode.node_type === 'trade' && selectedNode.twin_trades && selectedNode.twin_trades.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
                    <TargetIcon className="w-3.5 h-3.5 text-slate-600" />
                    Twin trade precedents
                  </h3>
                  <div className="space-y-2">
                    {selectedNode.twin_trades.map((tw, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          const target = nodes.find(
                            (n) => n.node_type === 'trade' && n.trade_num === tw.trade_num
                          );
                          if (target) setSelectedNode(target);
                        }}
                        className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg p-2.5 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                            #{tw.trade_num}
                            <span className="text-[11px] text-slate-500 font-normal">
                              {tw.symbol} {tw.direction}
                            </span>
                          </span>
                          <span
                            className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border ${
                              tw.result === 'WIN'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {tw.result}
                          </span>
                        </div>
                        {/* Similarity Match Bar */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-slate-200 h-1 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-slate-800"
                              style={{ width: `${Math.min(100, tw.similarity_score * 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-slate-600 w-12 text-right">
                            {(tw.similarity_score * 100).toFixed(0)}%
                          </span>
                        </div>
                        {tw.shared_features && tw.shared_features.length > 0 && (
                          <div className="text-[10px] font-mono text-slate-500 mt-1 truncate">
                            {tw.shared_features.slice(0, 2).join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Connected Trades for Feature Neuron */}
              {selectedNode.node_type === 'feature' && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
                    <TargetIcon className="w-3.5 h-3.5 text-purple-600" />
                    Connected Trades ({
                      nodes.filter(
                        (n) => n.node_type === 'trade' && n.features?.includes(selectedNode.id)
                      ).length
                    })
                  </h3>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {nodes
                      .filter((n) => n.node_type === 'trade' && n.features?.includes(selectedNode.id))
                      .slice(0, 20)
                      .map((t, idx) => (
                        <div
                          key={idx}
                          onClick={() => setSelectedNode(t)}
                          className="flex items-center justify-between p-2 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 cursor-pointer text-xs transition-colors"
                        >
                          <span className="font-mono font-medium text-slate-800">
                            #{t.trade_num} {t.symbol} {t.direction}
                          </span>
                          <span
                            className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border ${
                              t.result === 'WIN'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {t.result} {t.pnl_dollar !== undefined ? `(\$${t.pnl_dollar >= 0 ? '+' : ''}${t.pnl_dollar.toFixed(0)})` : ''}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Action: Open in Candlestick Chart */}
              {selectedNode.node_type === 'trade' && onNavigateToTrade && (
                <button
                  onClick={() =>
                    onNavigateToTrade(selectedNode.trade_num!, selectedNode.symbol!)
                  }
                  className="w-full mt-2 h-8 px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                >
                  <span>Inspect in candlestick chart</span>
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-500">
              <BrainCircuitIcon className="w-10 h-10 text-slate-400 mb-3" />
              <h3 className="text-xs font-semibold text-slate-800 mb-1">Click a neuron to inspect</h3>
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed mb-4">
                Select any green (WIN) or red (LOSS) trade node in the network to inspect its twin precedents, cluster win rate, and neural explanation.
              </p>
              <div className="w-full space-y-1.5 text-left text-xs">
                {[
                  { dot: 'bg-emerald-500', label: 'Win trade' },
                  { dot: 'bg-rose-500', label: 'Loss trade' },
                  { dot: 'bg-purple-500', label: 'Session concept' },
                  { dot: 'bg-cyan-500', label: 'Angle node' },
                  { dot: 'bg-amber-500', label: 'Synapse connection' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-slate-600 bg-slate-50 rounded-md px-2.5 py-1.5 border border-slate-200">
                    <span className={`w-2 h-2 rounded-full ${item.dot} flex-shrink-0`} />
                    <span className="text-[11px] font-mono">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Winning DNA, High-Win Clusters & Trap Avoidance ────────────────────── */}
      {winningDNA && (
        <div className="space-y-6">

          {/* ─── WINNING DNA: Hero Section ─────────────────────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6 shadow-xs flex flex-col gap-5">
            {/* Section Header */}
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700">
                <SparklesIcon className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Winning DNA</span>
                  <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Knowledge Graph Discovery
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">Structural traits common to winning trades across Gold and Bitcoin.</p>
              </div>
            </div>

            {/* Stat Bar */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 tabular-nums">
              {[
                { label: 'Total trades', value: winningDNA.total_trades, color: 'text-slate-900', sub: 'Backtested' },
                { label: 'Total wins', value: winningDNA.total_wins, color: 'text-emerald-700', sub: 'Profitable' },
                { label: 'Total losses', value: winningDNA.total_losses, color: 'text-rose-700', sub: 'SL Hit' },
                { label: 'Overall win rate', value: `${winningDNA.overall_win_rate.toFixed(1)}%`, color: winningDNA.overall_win_rate >= 50 ? 'text-emerald-700' : 'text-amber-700', sub: 'Accuracy' },
                { label: 'Avg win angle', value: `${winningDNA.avg_win_angle.toFixed(1)}°`, color: 'text-slate-900', sub: 'Trending impulse' },
              ].map((stat, i) => (
                <div key={i} className="text-center">
                  <div className={`text-2xl font-semibold font-mono tracking-tight ${stat.color}`}>{stat.value}</div>
                  <div className="text-[11px] text-slate-500 font-medium mt-0.5">{stat.label}</div>
                  <div className="text-[10px] text-slate-400 font-mono">{stat.sub}</div>
                </div>
              ))}
            </div>

            {/* Win Rate Progress Bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-600 font-medium">Portfolio win rate</span>
                <span className="font-semibold font-mono tabular-nums text-emerald-700">{winningDNA.overall_win_rate.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-600"
                  style={{ width: `${Math.min(100, winningDNA.overall_win_rate)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-1">
                <span>0%</span><span>50%</span><span>100%</span>
              </div>
            </div>

            {/* Core Rules: DNA Cards */}
            <div className={`grid grid-cols-1 ${winningDNA.core_rules.length > 3 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'} gap-3`}>
              {winningDNA.core_rules.map((rule, idx) => (
                <div key={idx} className="border border-slate-200 bg-slate-50 rounded-lg p-4 flex flex-col justify-between gap-2.5 hover:border-slate-300 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded border bg-white text-slate-700 border-slate-200">
                      Rule {idx + 1}
                    </span>
                    {rule.factor.includes('Unslop') && (
                      <span className="text-[10px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">
                        UI System
                      </span>
                    )}
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900 mb-1">{rule.factor}</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">{rule.finding}</p>
                  </div>
                  <div className="text-[11px] rounded px-2.5 py-1.5 border font-mono bg-emerald-50 border-emerald-200 text-emerald-800">
                    <span className="font-semibold text-emerald-900">Impact: </span>{rule.dna_impact}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ─── TWO-COLUMN: High Win Clusters + Losing Traps ─────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

            {/* HIGH-WIN CLUSTERS: Leaderboard */}
            {highWinClusters.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-4">
                <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700">
                    <TrendingUpIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>High win rate clusters</span>
                      <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                        WR ≥ 55%
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500">Highest probability setups identified across 169 backtested trades</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {highWinClusters.slice(0, 5).map((cl, idx) => (
                    <div key={idx} className="bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-lg p-3 transition-colors">
                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded bg-white border border-slate-200 text-slate-700 text-xs font-mono font-medium flex items-center justify-center flex-shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <h4 className="text-xs font-semibold text-slate-900 truncate pr-2">{cl.cluster_name}</h4>
                            <span className="text-base font-semibold font-mono tabular-nums text-emerald-700 flex-shrink-0">{cl.win_rate.toFixed(0)}%</span>
                          </div>
                          {/* WR Progress Bar */}
                          <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mb-2">
                            <div
                              className="h-full rounded-full bg-emerald-600"
                              style={{ width: `${Math.min(100, cl.win_rate)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <div className="flex items-center gap-1.5 text-slate-500">
                              <span className="text-emerald-700 font-semibold">{cl.wins}W</span>
                              <span>/</span>
                              <span className="text-rose-700 font-semibold">{cl.losses}L</span>
                              <span className="text-slate-400">({cl.trade_count} trades)</span>
                            </div>
                            <span className="font-semibold text-emerald-700">
                              +${cl.pnl_dollar.toFixed(0)}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Feature pills */}
                      {cl.features && cl.features.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2 pl-7.5">
                          {cl.features.slice(0, 4).map((feat, fi) => (
                            <span key={fi} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
                              {feat.split(':').pop()?.trim() || feat}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* LOSING TRAPS: Avoidance Radar */}
            {losingTraps.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-4">
                <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">
                    <ShieldCheckIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>Traps avoided</span>
                      <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">
                        WR ≤ 30%
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-500">Losing market setups blocked by the model</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {losingTraps.slice(0, 5).map((trap, idx) => {
                    const savedLoss = Math.abs(trap.pnl_dollar);
                    return (
                      <div key={idx} className="bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-lg p-3 transition-colors">
                        <div className="flex items-start gap-2.5">
                          <span className="w-5 h-5 rounded bg-white border border-rose-200 text-rose-700 text-xs font-mono font-medium flex items-center justify-center flex-shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1.5">
                              <h4 className="text-xs font-semibold text-slate-900 truncate pr-2">{trap.cluster_name}</h4>
                              <span className="text-base font-semibold font-mono tabular-nums text-rose-700 flex-shrink-0">{trap.win_rate.toFixed(0)}%</span>
                            </div>
                            {/* Danger bar */}
                            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mb-2">
                              <div
                                className="h-full rounded-full bg-rose-600"
                                style={{ width: `${Math.min(100, trap.win_rate)}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[11px] font-mono">
                              <div className="flex items-center gap-1.5 text-slate-500">
                                <span className="text-slate-600 font-medium">{trap.wins}W</span>
                                <span>/</span>
                                <span className="text-rose-700 font-semibold">{trap.losses}L</span>
                                <span className="text-slate-400">({trap.trade_count} trades)</span>
                              </div>
                              <span className="font-semibold text-rose-700">
                                Saved ${savedLoss.toFixed(0)}
                              </span>
                            </div>
                          </div>
                        </div>
                        {/* What to avoid */}
                        {trap.features && trap.features.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2 pl-7.5">
                            {trap.features.slice(0, 4).map((feat, fi) => (
                              <span key={fi} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200">
                                {feat.split(':').pop()?.trim() || feat}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Avoidance summary */}
                <div className="mt-1 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500">Total loss exposure blocked</span>
                  <span className="font-semibold text-rose-700">
                    ${losingTraps.reduce((s, t) => s + Math.abs(t.pnl_dollar), 0).toFixed(0)}
                  </span>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

    </>)}
    </div>
  );
}

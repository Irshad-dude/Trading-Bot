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

export interface GraphNode {
  id: string;
  node_type: 'trade' | 'feature';
  trade_num?: number;
  symbol?: string;
  direction?: 'LONG' | 'SHORT';
  trade_type?: string;
  entry_price?: number;
  exit_price?: number;
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

interface TradeGraphVisualizerProps {
  onNavigateToTrade?: (tradeNum: number, symbol: string) => void;
  initialSelectedTradeNum?: number;
}

export default function TradeGraphVisualizer({
  onNavigateToTrade,
  initialSelectedTradeNum
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
    'all' | 'wins_only' | 'high_win_clusters' | 'traps_only' | 'gold_only' | 'btc_only' | 'golden_angle'
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
  useEffect(() => {
    let isMounted = true;
    async function loadGraphData() {
      try {
        setIsLoading(true);
        // Attempt to fetch from public directory first, fallback to API
        let response = await fetch('/trade_knowledge_graph.json');
        if (!response.ok) {
          response = await fetch('/api/graph/network');
        }
        if (!response.ok) {
          throw new Error(`Failed to load graph data (${response.status})`);
        }
        const data = await response.json();
        if (!isMounted) return;

        const rawNodes: GraphNode[] = data.nodes || [];
        const rawLinks: GraphLink[] = data.links || [];

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
        if (!isMounted) return;
        setLoadError(err.message || 'Error loading trade knowledge graph');
        setIsLoading(false);
      }
    }

    loadGraphData();
    return () => {
      isMounted = false;
    };
  }, [initialSelectedTradeNum]);

  // Fast node lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  // Filtered nodes based on filterType
  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();

    nodes.forEach((n) => {
      if (n.node_type === 'feature') {
        // Always show feature/concept neurons to anchor the network
        ids.add(n.id);
        return;
      }

      if (filterType === 'all') {
        ids.add(n.id);
      } else if (filterType === 'wins_only') {
        if (n.result === 'WIN') ids.add(n.id);
      } else if (filterType === 'high_win_clusters') {
        if ((n.neighborhood_win_rate || 0) >= 50) ids.add(n.id);
      } else if (filterType === 'traps_only') {
        if ((n.neighborhood_win_rate || 0) <= 25) ids.add(n.id);
      } else if (filterType === 'gold_only') {
        if (n.symbol === 'XAUUSD') ids.add(n.id);
      } else if (filterType === 'btc_only') {
        if (n.symbol === 'BTCUSDT') ids.add(n.id);
      } else if (filterType === 'golden_angle') {
        if ((n.angle || 0) >= 40 && (n.angle || 0) <= 45) ids.add(n.id);
      }
    });

    return ids;
  }, [nodes, filterType]);

  // Active / connected nodes to selected or hovered node
  const highlightedNodeIds = useMemo(() => {
    const active = hoveredNode || selectedNode;
    if (!active) return null;

    const set = new Set<string>();
    set.add(active.id);

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

      ctx.beginPath();
      ctx.moveTo(sNode.x || 0, sNode.y || 0);
      ctx.lineTo(tNode.x || 0, tNode.y || 0);

      if (isSynapseActive) {
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

      if (node.node_type === 'feature') {
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
          const tipY = y - 24;
          const tipW = 155;
          const tipH = 46;

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
          ctx.fillText(`Trade #${node.trade_num} (${node.symbol})`, tipX + 8, tipY + 16);

          ctx.fillStyle = isWin ? '#34d399' : '#f87171';
          ctx.font = 'bold 10px sans-serif';
          const pnlText = `${node.result} ${node.pnl_dollar! >= 0 ? '+' : ''}$${node.pnl_dollar?.toFixed(1)}`;
          const angleText = `📐 ${node.angle?.toFixed(1)}°`;
          ctx.fillText(`${pnlText}  |  ${angleText}`, tipX + 8, tipY + 33);
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
      {/* ── Top Header & Neural Metrics ────────────────────────────────────────── */}
      <div className="bg-[#0f172a] border border-cyan-500/20 rounded-2xl p-6 relative overflow-hidden backdrop-blur-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl -z-10" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl -z-10" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
              </span>
              <span className="text-xs uppercase tracking-widest font-semibold px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                SMC Trade Memory & Knowledge Graph
              </span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                Biological Synapse Architecture
              </span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <BrainCircuitIcon className="w-8 h-8 text-cyan-400 animate-pulse" />
              Trade Brain (Graph RAG)
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl">
              169 Backtested trades mapped as interconnected neural nodes. Discovers what trades share in
              common, identifies high-probability winning clusters (66.7% - 83.3% WR), and filters out losing
              consolidation traps before live trade execution.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Play / Pause Toggle */}
            <button
              onClick={() => setIsPaused((prev) => !prev)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition border ${
                isPaused
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20'
              }`}
              title="Pause or Resume Network Movement"
            >
              <span className="text-sm leading-none">{isPaused ? '▶' : '⏸'}</span>
              <span>{isPaused ? 'Resume Motion' : 'Pause Motion'}</span>
            </button>

            {/* Simulation Speed Selector */}
            <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-lg p-0.5 text-xs font-mono">
              <span className="px-2 text-slate-400 font-sans text-[11px]">Speed:</span>
              {[
                { val: 0.15, label: '0.2x Slow' },
                { val: 0.35, label: '0.4x Calm' },
                { val: 0.8, label: '1x Normal' },
              ].map((s) => (
                <button
                  key={s.val}
                  onClick={() => {
                    setSimSpeed(s.val);
                    alphaRef.current = Math.max(alphaRef.current, 0.3);
                  }}
                  className={`px-2 py-1 rounded transition text-[11px] ${
                    simSpeed === s.val
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-2xs'
                      : 'text-slate-400 hover:text-slate-200'
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
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition flex items-center gap-1"
              title="Gently re-float and settle the neural layout"
            >
              <span>🔄 Settle</span>
            </button>

            {/* Reset View Button */}
            <button
              onClick={() => {
                setZoomTransform({ x: 0, y: 0, scale: 0.95 });
                setSelectedNode(null);
              }}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            >
              Reset View
            </button>

            {/* Zoom Controls */}
            <div className="flex items-center bg-slate-800/80 rounded-lg p-1 border border-slate-700">
              <button
                onClick={() => setZoomTransform((prev) => ({ ...prev, scale: Math.min(2.5, prev.scale * 1.2) }))}
                className="w-7 h-6 flex items-center justify-center text-slate-300 hover:text-white font-bold text-xs"
                title="Zoom In"
              >
                +
              </button>
              <div className="w-[1px] h-3.5 bg-slate-700" />
              <button
                onClick={() => setZoomTransform((prev) => ({ ...prev, scale: Math.max(0.35, prev.scale * 0.8) }))}
                className="w-7 h-6 flex items-center justify-center text-slate-300 hover:text-white font-bold text-xs"
                title="Zoom Out"
              >
                -
              </button>
            </div>
          </div>
        </div>

        {/* Neural Memory KPI Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-slate-400 font-medium">Interconnected Nodes</span>
            <div className="text-2xl font-black text-white mt-1 flex items-center gap-2">
              <span>{nodes.length || 190}</span>
              <span className="text-xs font-normal text-slate-400">Neurons</span>
            </div>
            <span className="text-[11px] text-cyan-400/80 mt-1 block">
              169 Trades + 21 Market Concepts
            </span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
            <span className="text-xs text-slate-400 font-medium">Active Synapses</span>
            <div className="text-2xl font-black text-cyan-400 mt-1 flex items-center gap-2">
              <span>{links.length || 1265}</span>
              <span className="text-xs font-normal text-slate-400">Synapses</span>
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">
              Multi-trait structural connections
            </span>
          </div>

          <div className="bg-slate-900/80 border border-emerald-500/20 rounded-xl p-4">
            <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
              <SparklesIcon className="w-3.5 h-3.5" />
              Top Winning Cluster WR
            </span>
            <div className="text-2xl font-black text-emerald-400 mt-1 flex items-center gap-2">
              <span>66.7% - 83.3%</span>
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">
              London/NY Overlap + 40°-45° Angle
            </span>
          </div>

          <div className="bg-slate-900/80 border border-rose-500/20 rounded-xl p-4">
            <span className="text-xs text-rose-400 font-medium flex items-center gap-1">
              <ShieldCheckIcon className="w-3.5 h-3.5" />
              Losing Traps Neutralized
            </span>
            <div className="text-2xl font-black text-rose-400 mt-1 flex items-center gap-2">
              <span>3 Trap Clusters</span>
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">
              London Open Longs & Late NY Chop
            </span>
          </div>
        </div>
      </div>

      {/* ── Filter & Search Toolbar ───────────────────────────────────────────── */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 mr-1">Filter Network:</span>
          {[
            { id: 'all', label: 'All Trades (169)' },
            { id: 'wins_only', label: '🏆 Winning DNA (Wins)' },
            { id: 'high_win_clusters', label: '🔥 High WR Clusters (>50%)' },
            { id: 'traps_only', label: '⚠️ Traps Avoided (<25%)' },
            { id: 'gold_only', label: 'Gold (XAUUSD)' },
            { id: 'btc_only', label: 'Bitcoin (BTCUSDT)' },
            { id: 'golden_angle', label: '📐 40°-45° Golden Angle' }
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                filterType === f.id
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-lg shadow-cyan-500/25'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700 border border-slate-700/60'
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
            placeholder="Search Trade # (e.g. 126)..."
            className="px-3.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-full md:w-52"
          />
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition whitespace-nowrap"
          >
            Locate
          </button>
        </form>
      </div>

      {/* ── Interactive Graph Canvas & Side Inspector ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Canvas Viewport (2 Columns) */}
        <div className="lg:col-span-2 bg-[#0b0f19] border border-slate-800 rounded-2xl relative overflow-hidden h-[680px] shadow-2xl flex flex-col">
          {/* Canvas Overlay Legend */}
          <div className="absolute top-4 left-4 z-10 bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-xl p-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-300 pointer-events-none">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500" />
              <span>Win Trade (+2%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-500" />
              <span>Loss Trade (-1%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-sm shadow-purple-500" />
              <span>Session Concept</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-sm shadow-cyan-500" />
              <span>Angle Range</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500" />
              <span>Twin Synapse</span>
            </div>
          </div>

          <div className="absolute bottom-4 left-4 z-10 bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-lg px-3 py-1.5 text-[11px] text-slate-400 pointer-events-none">
            💡 <strong className="text-slate-200">Tip:</strong> Click any trade node to inspect its twin trades & winning reason. Drag nodes to reshape the neural web. Scroll to zoom.
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
        <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-6 flex flex-col h-[680px] overflow-y-auto shadow-xl">
          {selectedNode ? (
            <div className="space-y-5">
              {/* Node Header */}
              <div className="pb-4 border-b border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase font-mono tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {selectedNode.node_type === 'trade'
                      ? `TRADE #${selectedNode.trade_num}`
                      : 'CONCEPT NEURON'}
                  </span>
                  {selectedNode.result && (
                    <span
                      className={`text-xs font-black px-2.5 py-0.5 rounded-full ${
                        selectedNode.result === 'WIN'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {selectedNode.result} ({selectedNode.pnl_percent! > 0 ? '+' : ''}
                      {selectedNode.pnl_percent}%)
                    </span>
                  )}
                </div>

                <h2 className="text-xl font-black text-white mt-2 flex items-center gap-2">
                  {selectedNode.node_type === 'trade' ? (
                    <>
                      <span>{selectedNode.symbol}</span>
                      <span
                        className={`text-sm px-2 py-0.5 rounded ${
                          selectedNode.direction === 'LONG'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}
                      >
                        {selectedNode.direction}
                      </span>
                    </>
                  ) : (
                    <span>{selectedNode.id}</span>
                  )}
                </h2>

                {selectedNode.node_type === 'trade' && (
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                    <span>PnL: <strong className={selectedNode.pnl_dollar! >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {selectedNode.pnl_dollar! >= 0 ? '+' : ''}${selectedNode.pnl_dollar?.toFixed(2)}
                    </strong></span>
                    <span>•</span>
                    <span>Duration: <strong className="text-slate-200">{selectedNode.duration_hours}h</strong></span>
                    <span>•</span>
                    <span>Angle: <strong className="text-cyan-400">📐 {selectedNode.angle?.toFixed(1)}°</strong></span>
                  </div>
                )}
              </div>

              {/* Cluster Win Rate Badge */}
              {selectedNode.neighborhood_win_rate !== undefined && (
                <div
                  className={`p-3.5 rounded-xl border ${
                    selectedNode.neighborhood_win_rate >= 55
                      ? 'bg-emerald-950/30 border-emerald-500/30'
                      : selectedNode.neighborhood_win_rate <= 25
                      ? 'bg-rose-950/30 border-rose-500/30'
                      : 'bg-slate-900 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">Neighborhood Cluster WR:</span>
                    <span
                      className={`font-black text-sm ${
                        selectedNode.neighborhood_win_rate >= 55
                          ? 'text-emerald-400'
                          : selectedNode.neighborhood_win_rate <= 25
                          ? 'text-rose-400'
                          : 'text-slate-200'
                      }`}
                    >
                      {selectedNode.neighborhood_win_rate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        selectedNode.neighborhood_win_rate >= 55
                          ? 'bg-emerald-400'
                          : selectedNode.neighborhood_win_rate <= 25
                          ? 'bg-rose-500'
                          : 'bg-cyan-500'
                      }`}
                      style={{ width: `${Math.min(100, selectedNode.neighborhood_win_rate)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1.5 block">
                    {selectedNode.neighborhood_win_rate >= 55
                      ? '🚀 High-probability cluster! Model gives maximum execution confidence.'
                      : selectedNode.neighborhood_win_rate <= 25
                      ? '⚠️ High-risk chop/trap cluster! Model applies extra invalidation scrutiny.'
                      : 'Balanced SMC structural setup.'}
                  </span>
                </div>
              )}

              {/* Neural Reasoning / Why it Won or Lost */}
              {selectedNode.neural_explanation && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                  <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <BrainCircuitIcon className="w-4 h-4" />
                    Neural Explanation (Reason for Outcome)
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {selectedNode.neural_explanation}
                  </p>
                </div>
              )}

              {/* Shared Structural Features (DNA) */}
              {selectedNode.features && (
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Active Structural Features
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedNode.features.map((feat, idx) => (
                      <span
                        key={idx}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-slate-800/80 text-cyan-300 border border-slate-700/60"
                      >
                        {feat}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Connected Twin Trades */}
              {selectedNode.twin_trades && selectedNode.twin_trades.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <TargetIcon className="w-3.5 h-3.5" />
                    Connected Twin Trades (Nearest Precedents)
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
                        className="bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-amber-500/40 p-2.5 rounded-lg cursor-pointer transition"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-white flex items-center gap-1.5">
                            Trade #{tw.trade_num}
                            <span className="text-[10px] text-slate-400 font-normal">
                              ({tw.symbol} {tw.direction})
                            </span>
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-black px-1.5 py-0.2 rounded ${
                                tw.result === 'WIN'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {tw.result}
                            </span>
                            <span className="text-[11px] font-semibold text-amber-400">
                              {(tw.similarity_score * 100).toFixed(0)}% Match
                            </span>
                          </div>
                        </div>

                        {tw.shared_features && tw.shared_features.length > 0 && (
                          <div className="text-[10px] text-slate-400 mt-1 line-clamp-1">
                            Shared: {tw.shared_features.slice(0, 3).join(', ')}
                          </div>
                        )}
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
                  className="w-full mt-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-600/20 transition"
                >
                  <span>📈 Inspect in Candlestick Chart</span>
                  <ChevronRightIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-500">
              <BrainCircuitIcon className="w-12 h-12 text-slate-600 mb-3 animate-pulse" />
              <h3 className="text-sm font-bold text-slate-300">Select Any Neuron</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Click on any trade node (Green/Red) or concept node (Purple/Cyan) in the neural canvas to inspect its twin trades, win cluster, and neural reasoning.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Winning DNA & High-Win Clusters Analysis ───────────────────────────── */}
      {winningDNA && (
        <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <SparklesIcon className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white tracking-tight">
              Knowledge Graph Discovery: The "Winning DNA"
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {winningDNA.core_rules.map((rule, idx) => (
              <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider block mb-1">
                  Rule {idx + 1}: {rule.factor}
                </span>
                <p className="text-xs text-slate-300 font-medium mb-2">{rule.finding}</p>
                <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-md p-2">
                  <strong>DNA Impact:</strong> {rule.dna_impact}
                </div>
              </div>
            ))}
          </div>

          {/* High-Win Clusters Table */}
          {highWinClusters.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Top High-Probability Subgraph Clusters (WR ≥ 55%)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {highWinClusters.slice(0, 6).map((cl, idx) => (
                  <div
                    key={idx}
                    className="bg-slate-900/80 border border-emerald-500/20 rounded-xl p-3.5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-emerald-400">
                          {cl.win_rate.toFixed(1)}% Win Rate
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {cl.wins}W / {cl.losses}L ({cl.trade_count}T)
                        </span>
                      </div>
                      <h4 className="text-xs font-semibold text-white line-clamp-2">
                        {cl.cluster_name}
                      </h4>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Total Net PnL:</span>
                      <span className="font-bold text-emerald-400">+${cl.pnl_dollar.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

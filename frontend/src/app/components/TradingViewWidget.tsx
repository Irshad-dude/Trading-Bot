'use client';

import React, { useEffect, useRef } from 'react';

interface TradingViewWidgetProps {
  symbol?: string; // e.g. "BTCUSDT", "ETHUSDT", "XAUUSD"
  interval?: string;
  height?: number;
}

export default function TradingViewWidget({
  symbol = 'BTCUSDT',
  interval = '15',
  height = 520,
}: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';

    const formattedSymbol = symbol === 'XAUUSD' ? 'OANDA:XAUUSD' : `BINANCE:${symbol}`;

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: formattedSymbol,
      interval: interval,
      timezone: 'Asia/Kolkata',
      theme: 'light',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      backgroundColor: '#ffffff',
      gridColor: 'rgba(0, 0, 0, 0.04)',
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      studies: ['STD;EMA@tv-basicstudies', 'STD;EMA@tv-basicstudies'],
    });

    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container__widget';
    widgetContainer.style.height = `${height}px`;
    widgetContainer.style.width = '100%';

    container.appendChild(widgetContainer);
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
    };
  }, [symbol, interval, height]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container rounded-xl overflow-hidden border border-slate-200"
      style={{ height: `${height}px`, width: '100%' }}
    />
  );
}

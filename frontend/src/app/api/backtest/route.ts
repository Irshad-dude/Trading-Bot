import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    let filePath = path.join(process.cwd(), '../backend/data/backtest_results.json');
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), 'public/backtest_results_2026.json');
    }
    if (!fs.existsSync(filePath)) {
      filePath = path.join(process.cwd(), '../backtest_results_2026.json');
    }
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ summary: null, trades: [] });
    }
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const raw = JSON.parse(fileContents);

    // Reshape: the JSON has summary: { XAUUSD: {...}, BTCUSDT: {...} }
    // Frontend expects: gold_summary, btc_summary, eth_summary, summary (combined)
    const summaryMap = raw.summary || {};
    const goldSummary = summaryMap['XAUUSD'] || null;
    const btcSummary = summaryMap['BTCUSDT'] || null;
    const ethSummary = summaryMap['ETHUSDT'] || null;

    // Build combined summary
    const allSummaries = [goldSummary, btcSummary, ethSummary].filter(Boolean) as any[];
    let combinedSummary = null;
    if (allSummaries.length > 0) {
      const totalTrades = allSummaries.reduce((s, a) => s + (a.total_trades || 0), 0);
      const totalWins = allSummaries.reduce((s, a) => s + (a.wins || 0), 0);
      const totalLosses = allSummaries.reduce((s, a) => s + (a.losses || 0), 0);
      const totalPnl = allSummaries.reduce((s, a) => s + (a.net_pnl_dollars || 0), 0);
      const totalStartBal = allSummaries.reduce((s, a) => s + (a.starting_balance || 0), 0);
      const maxDD = Math.max(...allSummaries.map(a => a.max_drawdown_pct || 0));
      combinedSummary = {
        name: 'All Assets Combined',
        total_trades: totalTrades,
        wins: totalWins,
        losses: totalLosses,
        win_rate: totalTrades > 0 ? Math.round((totalWins / totalTrades) * 10000) / 100 : 0,
        profit_factor: totalLosses > 0 ? Math.round((totalWins * 2 / totalLosses) * 100) / 100 : 0,
        net_pnl_dollars: Math.round(totalPnl * 100) / 100,
        net_pnl_pct: totalStartBal > 0 ? Math.round((totalPnl / totalStartBal) * 10000) / 100 : 0,
        starting_balance: totalStartBal,
        ending_balance: totalStartBal + totalPnl,
        rr_ratio: '1:2',
        max_drawdown_pct: maxDD,
        period: raw.period ? `${raw.period.start} - ${raw.period.end}` : '',
      };
    }

    // Collect monthly breakdowns
    const monthlyBreakdown = [
      ...(goldSummary?.monthly_breakdown || []),
      ...(btcSummary?.monthly_breakdown || []),
      ...(ethSummary?.monthly_breakdown || []),
    ];

    const data = {
      summary: combinedSummary,
      gold_summary: goldSummary,
      btc_summary: btcSummary,
      eth_summary: ethSummary,
      monthly_breakdown: monthlyBreakdown,
      trades: raw.trades || [],
    };

    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ summary: null, trades: [], error: msg }, { status: 500 });
  }
}

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
    const data = JSON.parse(fileContents);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ summary: null, trades: [], error: msg }, { status: 500 });
  }
}

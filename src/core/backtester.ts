/**
 * Backtesting Framework - Тестирование стратегий на исторических данных
 * 
 * Возможности:
 * - Загрузка исторических данных о рынках
 * - Симуляция торговли с учётом проскальзывания
 * - Расчёт метрик: Sharpe, Sortino, Max Drawdown, Win Rate
 * - Сравнение стратегий
 * - Визуализация результатов
 */

import fs from 'fs/promises';
import type { TradeHistory } from '../core/state-manager.js';

// ============================================================================
// TYPES
// ============================================================================

export interface HistoricalMarket {
  id: string;
  question: string;
  outcome: 'YES' | 'NO';
  resolvedPrice: number; // 0 или 1
  priceHistory: Array<{
    timestamp: number;
    price: number;
    volume: number;
  }>;
  closeDate: number;
  category: string;
}

export interface BacktestConfig {
  initialCapital: number;
  startDate: number;
  endDate: number;
  strategies: string[];
  
  // Параметры симуляции
  slippagePercent: number;  // 0.03 = 3%
  commissionPercent: number; // 0.01 = 1%
  maxPositionSize: number;
  
  // Риск-менеджмент
  stopLoss: number;
  takeProfit: number;
  maxDrawdown: number;
}

export interface BacktestResult {
  strategy: string;
  config: BacktestConfig;
  
  // Основные метрики
  finalCapital: number;
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  
  // Статистика сделок
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  
  // Риск-метрики
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number; // В днях
  volatility: number;
  
  // Временные ряды
  equityCurve: Array<{
    timestamp: number;
    capital: number;
    drawdown: number;
  }>;
  
  trades: TradeHistory[];
}

export interface StrategySignal {
  timestamp: number;
  marketId: string;
  signal: 'BUY' | 'SELL';
  outcome: 'YES' | 'NO';
  confidence: number;
  positionSize: number;
}

// ============================================================================
// BACKTESTER
// ============================================================================

export class Backtester {
  private historicalData: HistoricalMarket[] = [];
  
  /**
   * Загрузить исторические данные
   */
  async loadHistoricalData(filePath: string): Promise<void> {
    try {
      const json = await fs.readFile(filePath, 'utf-8');
      this.historicalData = JSON.parse(json);
      console.log(`Loaded ${this.historicalData.length} historical markets`);
    } catch (error) {
      console.error('Failed to load historical data:', error);
      this.historicalData = [];
    }
  }

  /**
   * Запустить бэктест
   */
  async runBacktest(
    config: BacktestConfig,
    signalGenerator: (market: HistoricalMarket, timestamp: number) => StrategySignal | null
  ): Promise<BacktestResult> {
    console.log('Starting backtest...');
    console.log(`  Initial Capital: $${config.initialCapital}`);
    console.log(`  Period: ${new Date(config.startDate).toLocaleDateString()} - ${new Date(config.endDate).toLocaleDateString()}`);
    console.log(`  Slippage: ${config.slippagePercent * 100}%`);
    console.log(`  Commission: ${config.commissionPercent * 100}%`);

    let capital = config.initialCapital;
    const trades: TradeHistory[] = [];
    const equityCurve: BacktestResult['equityCurve'] = [];
    const dailyReturns: number[] = [];
    
    let peakCapital = capital;
    let maxDrawdown = 0;
    let maxDrawdownStart = 0;
    let maxDrawdownDuration = 0;
    
    // Симуляция торговли
    const markets = this.historicalData.filter(m =>
      m.closeDate >= config.startDate && m.closeDate <= config.endDate
    );

    console.log(`Testing on ${markets.length} markets`);

    for (const market of markets) {
      // Генерировать сигнал
      const signal = signalGenerator(market, market.closeDate);
      if (!signal) continue;

      // Рассчитать размер позиции с учётом риска
      const positionSize = Math.min(signal.positionSize, capital * config.maxPositionSize);
      
      // Применить проскальзывание
      const entryPrice = signal.signal === 'BUY'
        ? market.priceHistory[0].price * (1 + config.slippagePercent)
        : market.priceHistory[0].price * (1 - config.slippagePercent);
      
      // Комиссия
      const commission = positionSize * config.commissionPercent;
      const netPositionSize = positionSize - commission;

      // Цена выхода (resolved price)
      const exitPrice = market.resolvedPrice;
      
      // Рассчитать PnL
      const pnlPercent = signal.outcome === 'YES'
        ? ((exitPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - exitPrice) / entryPrice) * 100;
      
      const pnl = (netPositionSize * pnlPercent) / 100;

      // Проверить Stop-Loss / Take-Profit
      const finalPnl = this.applyRiskManagement(pnl, config, entryPrice, exitPrice);

      // Обновить капитал
      capital += finalPnl;
      
      // Обновить drawdown
      if (capital > peakCapital) {
        peakCapital = capital;
        maxDrawdownStart = market.closeDate;
      }
      
      const currentDrawdown = ((peakCapital - capital) / peakCapital) * 100;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
        maxDrawdownDuration = (market.closeDate - maxDrawdownStart) / (1000 * 60 * 60 * 24);
      }

      // Записать сделку
      const trade: TradeHistory = {
        positionId: `backtest_${market.id}`,
        marketId: market.id,
        marketQuestion: market.question,
        outcome: signal.outcome,
        strategy: 'backtest',
        entryPrice,
        exitPrice,
        size: netPositionSize,
        pnl: finalPnl,
        pnlPercent: (finalPnl / netPositionSize) * 100,
        openTime: market.closeDate,
        closeTime: market.closeDate,
        holdDuration: 0,
        reason: 'expiry',
      };
      
      trades.push(trade);
      
      // Обновить equity curve
      equityCurve.push({
        timestamp: market.closeDate,
        capital,
        drawdown: currentDrawdown,
      });

      // Daily returns для Sharpe/Sortino
      if (trades.length > 0) {
        const dailyReturn = trades.length > 1
          ? (trades[trades.length - 1].pnl - trades[trades.length - 2].pnl) / capital
          : 0;
        dailyReturns.push(dailyReturn);
      }
    }

    // Рассчитать метрики
    const winningTrades = trades.filter(t => t.pnl >= 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    
    const totalReturn = capital - config.initialCapital;
    const totalReturnPercent = (totalReturn / config.initialCapital) * 100;
    
    const daysInRange = (config.endDate - config.startDate) / (1000 * 60 * 60 * 24);
    const annualizedReturn = (Math.pow(capital / config.initialCapital, 365 / daysInRange) - 1) * 100;

    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length
      : 0;
    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length)
      : 0;

    const largestWin = winningTrades.length > 0
      ? Math.max(...winningTrades.map(t => t.pnl))
      : 0;
    const largestLoss = losingTrades.length > 0
      ? Math.min(...losingTrades.map(t => t.pnl))
      : 0;

    // Sharpe Ratio (annualized)
    const avgReturn = dailyReturns.length > 0
      ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
      : 0;
    const stdDev = dailyReturns.length > 1
      ? Math.sqrt(dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length - 1))
      : 0;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365) : 0;

    // Sortino Ratio (only downside deviation)
    const downsideReturns = dailyReturns.filter(r => r < 0);
    const downsideDev = downsideReturns.length > 1
      ? Math.sqrt(downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length)
      : 0;
    const sortinoRatio = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(365) : 0;

    // Volatility
    const volatility = stdDev * Math.sqrt(365) * 100;

    console.log('\n=== BACKTEST RESULTS ===');
    console.log(`Total Trades: ${trades.length}`);
    console.log(`Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`Total Return: ${totalReturnPercent.toFixed(2)}%`);
    console.log(`Final Capital: $${capital.toFixed(2)}`);
    console.log(`Sharpe Ratio: ${sharpeRatio.toFixed(2)}`);
    console.log(`Max Drawdown: ${maxDrawdown.toFixed(2)}%`);

    return {
      strategy: 'backtest',
      config,
      finalCapital: capital,
      totalReturn,
      totalReturnPercent,
      annualizedReturn,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      maxDrawdownDuration,
      volatility,
      equityCurve,
      trades,
    };
  }

  /**
   * Применить риск-менеджмент
   */
  private applyRiskManagement(
    pnl: number,
    config: BacktestConfig,
    entryPrice: number,
    exitPrice: number
  ): number {
    let finalPnl = pnl;

  // Stop-Loss
    const lossPercent = Math.abs(Math.min(0, ((exitPrice - entryPrice) / entryPrice) * 100));
    if (lossPercent >= config.stopLoss * 100) {
      finalPnl = -(config.stopLoss * Math.abs(pnl));
    }

    // Take-Profit
    const profitPercent = Math.max(0, ((exitPrice - entryPrice) / entryPrice) * 100);
    if (profitPercent >= config.takeProfit * 100) {
      finalPnl = config.takeProfit * Math.abs(pnl);
    }

    return finalPnl;
  }

  /**
   * Сравнить несколько стратегий
   */
  async compareStrategies(
    config: BacktestConfig,
    strategies: Array<{
      name: string;
      signalGenerator: (market: HistoricalMarket, timestamp: number) => StrategySignal | null;
    }>
  ): Promise<BacktestResult[]> {
    const results: BacktestResult[] = [];

    for (const strategy of strategies) {
      console.log(`\n=== Testing: ${strategy.name} ===`);
      const result = await this.runBacktest(config, strategy.signalGenerator);
      result.strategy = strategy.name;
      results.push(result);
    }

    // Вывести сравнение
    console.log('\n=== STRATEGY COMPARISON ===');
    console.log('Strategy\t\tReturn\tWinRate\tSharpe\tMaxDD');
    console.log('-'.repeat(60));
    
    for (const result of results) {
      console.log(
        `${result.strategy.padEnd(20)}\t` +
        `${result.totalReturnPercent.toFixed(2)}%\t` +
        `${result.winRate.toFixed(1)}%\t` +
        `${result.sharpeRatio.toFixed(2)}\t` +
        `${result.maxDrawdown.toFixed(2)}%`
      );
    }

    return results;
  }

  /**
   * Сохранить результаты бэктеста
   */
  async saveResults(result: BacktestResult, filePath: string): Promise<void> {
    const json = JSON.stringify(result, null, 2);
    await fs.writeFile(filePath, json, 'utf-8');
    console.log(`Backtest results saved to ${filePath}`);
  }
}

// ============================================================================
// ПРИМЕР ИСПОЛЬЗОВАНИЯ
// ============================================================================

/**
 * Пример: Простая стратегия RSI
 */
export function createRSIStrategy(oversold: number = 30, overbought: number = 70) {
  return (market: HistoricalMarket, timestamp: number): StrategySignal | null => {
    const prices = market.priceHistory.map(p => p.price);
    
    if (prices.length < 14) return null;
    
    // Рассчитать RSI
    let gains = 0, losses = 0;
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    
    const rs = losses === 0 ? 100 : gains / losses;
    const rsi = 100 - (100 / (1 + rs));
    
    // Сигнал
    if (rsi <= oversold) {
      return {
        timestamp,
        marketId: market.id,
        signal: 'BUY',
        outcome: 'YES',
        confidence: 70 + (oversold - rsi),
        positionSize: 10,
      };
    }
    
    if (rsi >= overbought) {
      return {
        timestamp,
        marketId: market.id,
        signal: 'SELL',
        outcome: 'NO',
        confidence: 70 + (rsi - overbought),
        positionSize: 10,
      };
    }
    
    return null;
  };
}

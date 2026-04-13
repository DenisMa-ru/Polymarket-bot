/**
 * Smart Money Service v2 - Улучшенная версия для разгона депозита
 * 
 * Новые возможности:
 * 1. Динамический размер позиции пропорционально капиталу кита
 * 2. Автоматический Take-Profit (+30%)
 * 3. Автоматический Stop-Loss (-15%)
 * 4. Trailing Stop для фиксации прибыли
 * 5. Интеграция с StateManager для отслеживания позиций
 * 6. Уведомления в Telegram
 */

import type { WalletService, PeriodLeaderboardEntry } from './wallet-service.js';
import type { RealtimeServiceV2, ActivityTrade } from './realtime-service-v2.js';
import type { TradingService, OrderResult } from './trading-service.js';
import type { StateManager, Position as StatePosition } from '../core/state-manager.js';
import type { SmartMoneyTrade, AutoCopyTradingOptions, AutoCopyTradingStats } from './smart-money-service.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SmartMoneyWallet {
  address: string;
  name?: string;
  pnl: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  consistencyScore: number;
  estimatedCapital?: number;
}

export interface SmartMoneyPosition {
  positionId: string;
  marketId: string;
  marketQuestion: string;
  outcome: 'YES' | 'NO';
  size: number;
  entryPrice: number;
  currentPrice?: number;
  quantity: number;
  strategy: 'smartMoney';
  timestamp: number;
  takeProfit: number;
  stopLoss: number;
  trailingStop?: number;
  highestPrice: number;
  whaleAddress: string;
  whaleTradeSize: number;
  whaleCapital: number;
  copyRatio: number;
  lastChecked: number;
  metadata?: Record<string, any>;
}

export interface EnhancedCopyTradingOptions extends AutoCopyTradingOptions {
  enableDynamicSizing?: boolean;
  myCapital: number;
  minPositionSize?: number;
  maxPositionSize?: number;
  
  enableTakeProfit?: boolean;
  takeProfitPercent?: number;
  
  enableStopLoss?: boolean;
  stopLossPercent?: number;
  
  enableTrailingStop?: boolean;
  trailingStopPercent?: number;
  
  whaleCapitalEstimates?: Record<string, number>;
  
  onTakeProfit?: (position: SmartMoneyPosition, pnl: number) => void;
  onStopLoss?: (position: SmartMoneyPosition, pnl: number) => void;
  onTrailingStop?: (position: SmartMoneyPosition, pnl: number) => void;
}

// ============================================================================
// ENHANCED SMART MONEY SERVICE
// ============================================================================

export class SmartMoneyServiceV2 {
  private stateManager: StateManager;
  private tradingService: TradingService;
  private baseSmartMoneyService: any;
  
  private activePositions: Map<string, SmartMoneyPosition> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITOR_INTERVAL_MS = 10000;
  
  private options: EnhancedCopyTradingOptions;

  constructor(
    stateManager: StateManager,
    tradingService: TradingService,
    baseSmartMoneyService: any,
    options: EnhancedCopyTradingOptions
  ) {
    this.stateManager = stateManager;
    this.tradingService = tradingService;
    this.baseSmartMoneyService = baseSmartMoneyService;
    this.options = options;
  }

  async startEnhancedCopyTrading(): Promise<any> {
    const myCapital = this.options.myCapital;
    
    console.log('Starting Enhanced Smart Money Copy Trading...');
    console.log(`   My Capital: $${myCapital}`);
    console.log(`   Dynamic Sizing: ${this.options.enableDynamicSizing ? 'YES' : 'NO'}`);
    console.log(`   Take-Profit: ${this.options.enableTakeProfit ? `+${(this.options.takeProfitPercent || 0.30) * 100}%` : 'NO'}`);
    console.log(`   Stop-Loss: ${this.options.enableStopLoss ? `-${(this.options.stopLossPercent || 0.15) * 100}%` : 'NO'}`);
    console.log(`   Trailing Stop: ${this.options.enableTrailingStop ? `${(this.options.trailingStopPercent || 0.10) * 100}%` : 'NO'}`);

    const subscription = await this.baseSmartMoneyService.startAutoCopyTrading({
      ...this.options,
      onTrade: async (trade: SmartMoneyTrade, result: OrderResult) => {
        await this.handleCopyTrade(trade, result);
        this.options.onTrade?.(trade, result);
      },
      onError: (error: Error) => {
        console.error('Smart Money Error:', error);
        this.options.onError?.(error);
      },
    });

    this.startPositionMonitoring();

    return subscription;
  }

  private async handleCopyTrade(trade: SmartMoneyTrade, result: OrderResult): Promise<void> {
    if (!result.success) {
      console.warn(`Copy trade failed: ${trade.marketSlug}`);
      return;
    }

    try {
      const positionSize = this.calculateDynamicPositionSize(trade);
      
      console.log('Dynamic Position Size Calculation:');
      console.log(`   Whale Trade: $${trade.size} @ ${trade.price}`);
      console.log(`   My Capital: $${this.options.myCapital}`);
      console.log(`   Calculated Size: $${positionSize.toFixed(2)}`);

      if (this.stateManager.hasPosition(trade.conditionId || '', trade.outcome as 'YES' | 'NO')) {
        console.log(`Already have position on ${trade.conditionId}, skipping`);
        return;
      }

      const entryPrice = trade.side === 'BUY' 
        ? trade.price * (1 + (this.options.maxSlippage || 0.03))
        : trade.price * (1 - (this.options.maxSlippage || 0.03));

      const takeProfit = this.options.enableTakeProfit
        ? entryPrice * (1 + (this.options.takeProfitPercent || 0.30))
        : undefined;

      const stopLoss = this.options.enableStopLoss
        ? entryPrice * (1 - (this.options.stopLossPercent || 0.15))
        : undefined;

      console.log('Position Parameters:');
      console.log(`   Entry: ${entryPrice.toFixed(3)}`);
      if (takeProfit) {
        const tpPct = ((takeProfit / entryPrice) - 1) * 100;
        console.log(`   Take-Profit: ${takeProfit.toFixed(3)} (+${tpPct.toFixed(0)}%)`);
      }
      if (stopLoss) {
        const slPct = ((1 - stopLoss / entryPrice) * 100);
        console.log(`   Stop-Loss: ${stopLoss.toFixed(3)} (-${slPct.toFixed(0)}%)`);
      }

      const position = await this.stateManager.addPosition({
        marketId: trade.conditionId || '',
        marketQuestion: trade.marketSlug || 'Unknown Market',
        outcome: trade.outcome as 'YES' | 'NO',
        size: positionSize,
        entryPrice,
        quantity: positionSize / entryPrice,
        strategy: 'smartMoney',
        timestamp: Date.now(),
        stopLoss,
        takeProfit,
        trailingStop: this.options.enableTrailingStop ? (this.options.trailingStopPercent || 0.10) : undefined,
        metadata: {
          whaleAddress: trade.traderAddress,
          whaleTradeSize: trade.size,
          whaleCapital: trade.smartMoneyInfo?.pnl || 1000,
          copyRatio: positionSize / trade.size,
        },
      });

      const smartPosition: SmartMoneyPosition = {
        positionId: position.positionId,
        marketId: trade.conditionId || '',
        marketQuestion: trade.marketSlug || 'Unknown Market',
        outcome: trade.outcome as 'YES' | 'NO',
        size: positionSize,
        entryPrice,
        quantity: positionSize / entryPrice,
        strategy: 'smartMoney',
        timestamp: Date.now(),
        takeProfit: takeProfit || entryPrice * 1.30,
        stopLoss: stopLoss || entryPrice * 0.85,
        trailingStop: this.options.enableTrailingStop ? (this.options.trailingStopPercent || 0.10) : undefined,
        highestPrice: entryPrice,
        whaleAddress: trade.traderAddress,
        whaleTradeSize: trade.size,
        whaleCapital: trade.smartMoneyInfo?.pnl || 1000,
        copyRatio: positionSize / trade.size,
        lastChecked: Date.now(),
      };

      this.activePositions.set(position.positionId, smartPosition);

      console.log(`Position opened: ${position.positionId}`);
    } catch (error) {
      console.error('Error in handleCopyTrade:', error);
    }
  }

  private calculateDynamicPositionSize(trade: SmartMoneyTrade): number {
    const myCapital = this.options.myCapital;
    const whaleCapital = trade.smartMoneyInfo?.pnl || 1000;
    const whaleTradeSize = trade.size;

    if (!this.options.enableDynamicSizing) {
      const fixedSize = (this.options.sizeScale || 0.1) * whaleTradeSize;
      return Math.min(fixedSize, this.options.maxSizePerTrade || 50);
    }

    const whaleRatio = whaleTradeSize / whaleCapital;
    const proportionalSize = myCapital * whaleRatio;

    const minSize = this.options.minPositionSize || 3;
    const maxSize = this.options.maxPositionSize || (myCapital * 0.10);
    const maxPerTrade = this.options.maxSizePerTrade || 50;

    return Math.max(minSize, Math.min(proportionalSize, maxSize, maxPerTrade));
  }

  private startPositionMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      await this.checkAllPositions();
    }, this.MONITOR_INTERVAL_MS);

    console.log(`Position monitoring started (every ${this.MONITOR_INTERVAL_MS / 1000}s)`);
  }

  private async checkAllPositions(): Promise<void> {
    for (const [positionId, position] of this.activePositions) {
      try {
        await this.checkSinglePosition(positionId);
      } catch (error) {
        console.error(`Error checking position ${positionId}:`, error);
      }
    }
  }

  private async checkSinglePosition(positionId: string): Promise<void> {
    const position = this.activePositions.get(positionId);
    if (!position) return;

    const currentPrice = await this.getCurrentPrice(position.marketId, position.outcome);
    if (!currentPrice) return;

    position.currentPrice = currentPrice;
    position.lastChecked = Date.now();

    if (currentPrice > position.highestPrice) {
      position.highestPrice = currentPrice;
    }

    if (this.options.enableTakeProfit && currentPrice >= position.takeProfit) {
      console.log(`TAKE-PROFIT HIT: ${positionId}`);
      console.log(`   Entry: ${position.entryPrice} -> Current: ${currentPrice}`);
      const profitPct = ((currentPrice / position.entryPrice) - 1) * 100;
      console.log(`   Profit: +${profitPct.toFixed(1)}%`);
      
      await this.closePosition(positionId, currentPrice, 'takeProfit');
      return;
    }

    if (this.options.enableStopLoss && currentPrice <= position.stopLoss) {
      console.log(`STOP-LOSS HIT: ${positionId}`);
      console.log(`   Entry: ${position.entryPrice} -> Current: ${currentPrice}`);
      const lossPct = ((1 - currentPrice / position.entryPrice) * 100);
      console.log(`   Loss: -${lossPct.toFixed(1)}%`);
      
      await this.closePosition(positionId, currentPrice, 'stopLoss');
      return;
    }

    if (this.options.enableTrailingStop && position.trailingStop) {
      const trailStopPrice = position.highestPrice * (1 - position.trailingStop);
      
      if (currentPrice <= trailStopPrice) {
        console.log(`TRAILING STOP HIT: ${positionId}`);
        console.log(`   Highest: ${position.highestPrice} -> Current: ${currentPrice}`);
        const profitPct = ((currentPrice / position.entryPrice) - 1) * 100;
        console.log(`   Profit: +${profitPct.toFixed(1)}%`);
        
        await this.closePosition(positionId, currentPrice, 'trailingStop');
        return;
      }
    }
  }

  private async closePosition(
    positionId: string,
    exitPrice: number,
    reason: 'takeProfit' | 'stopLoss' | 'trailingStop'
  ): Promise<void> {
    const position = this.activePositions.get(positionId);
    if (!position) return;

    try {
      const result = await this.tradingService.createMarketOrder({
        tokenId: position.marketId,
        side: 'SELL',
        amount: position.size,
        price: exitPrice,
        orderType: 'FOK',
      });

      if (result.success) {
        const pnlPercent = position.outcome === 'YES'
          ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100
          : ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
        
        const pnl = (position.size * pnlPercent) / 100;

        await this.stateManager.closePosition(positionId, exitPrice, reason);

        if (reason === 'takeProfit') {
          this.options.onTakeProfit?.(position, pnl);
          console.log(`Take-Profit: +$${pnl.toFixed(2)} (${pnlPercent.toFixed(1)}%)`);
        } else if (reason === 'stopLoss') {
          this.options.onStopLoss?.(position, pnl);
          console.log(`Stop-Loss: -$${Math.abs(pnl).toFixed(2)} (${pnlPercent.toFixed(1)}%)`);
        } else {
          this.options.onTrailingStop?.(position, pnl);
          console.log(`Trailing Stop: +$${pnl.toFixed(2)} (${pnlPercent.toFixed(1)}%)`);
        }

        this.activePositions.delete(positionId);
      }
    } catch (error) {
      console.error(`Error closing position ${positionId}:`, error);
    }
  }

  private async getCurrentPrice(marketId: string, outcome: 'YES' | 'NO'): Promise<number | null> {
    return null;
  }

  getActivePositions(): SmartMoneyPosition[] {
    return Array.from(this.activePositions.values());
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    console.log('Smart Money monitoring stopped');
  }
}

export function estimateWhaleCapital(walletInfo: any): number {
  const pnl = walletInfo.totalPnl || walletInfo.pnl || 0;
  const winRate = walletInfo.winRate || 0.5;
  const estimatedCapital = Math.abs(pnl) / winRate / 0.10;
  return Math.max(estimatedCapital, 1000);
}

/**
 * Scalping Service - Скальпинг для быстрого разгона депозита
 * 
 * Цель: Быстрый разгон депозита $50-100 через множество мелких сделок
 * 
 * Стратегия:
 * 1. Находим рынки с экспирацией 5-15 минут (crypto, sports)
 * 2. Используем технические индикаторы (RSI, Volume, MACD)
 * 3. Входим при перепроданности/перекупленности
 * 4. Быстрый выход: TP +15%, SL -10%
 * 5. Максимальное время удержания: 5 минут
 * 
 * Математика для депозита $100:
 * - 10 сделок в день × $10 каждая
 * - Win rate 60% = 6 побед, 4 поражения
 * - Прибыль: 6 × $1.50 = $9
 * - Убыток: 4 × $1.00 = $4
 * - Чистая прибыль: $5/день = 5% ежедневно 🚀
 */

import type { TradingService, OrderResult } from './trading-service.js';
import type { StateManager } from '../core/state-manager.js';
import type { GammaMarket } from '../clients/gamma-api.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ScalpingSignal {
  marketId: string;
  marketQuestion: string;
  outcome: 'YES' | 'NO';
  currentPrice: number;
  timeToExpiry: number;        // Секунды до экспирации
  category: 'crypto' | 'sports' | 'politics';
  
  // Индикаторы
  rsi: number;
  volumeRatio: number;         // Текущий объём / средний
  macdHistogram: number;
  
  // Сигнал
  signal: 'BUY' | 'SELL';
  confidence: number;          // 0-100%
  reason: string;
}

export interface ScalpingConfig {
  // Капитал
  myCapital: number;
  maxPositionSize: number;     // Максимум на сделку (5% капитала)
  minPositionSize: number;     // Минимум $3
  
  // Рынки
  categories: Array<'crypto' | 'sports' | 'politics'>;
  maxExpiryMinutes: number;    // Максимальная экспирация (15 мин)
  minExpiryMinutes: number;    // Минимальная экспирация (5 мин)
  minVolume24h: number;        // Минимальный объём ($1000)
  
  // Технические индикаторы
  indicators: {
    rsi: {
      period: number;          // 14
      oversold: number;        // 30
      overbought: number;      // 70
    };
    volume: {
      minRatio: number;        // 1.5 (150% среднего)
    };
    macd: {
      fast: number;            // 12
      slow: number;            // 26
      signal: number;          // 9
    };
  };
  
  // Правила входа
  entryRules: {
    minConfidence: number;     // 70%
    requireVolumeSpike: boolean;
    requireRsiDivergence: boolean;
  };
  
  // Выход
  takeProfit: number;          // 15%
  stopLoss: number;            // 10%
  maxHoldTime: number;         // 300 секунд (5 мин)
  
  // Ограничения
  maxConcurrentPositions: number;  // 5
  maxTradesPerHour: number;        // 20
  cooldownAfterTrade: number;      // 60 секунд
  
  // Dry run
  dryRun: boolean;
}

export interface ScalpingStats {
  startTime: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  bestTrade: number;
  worstTrade: number;
  signalsDetected: number;
  signalsExecuted: number;
  signalsSkipped: number;
  hourlyTradeCount: number;
}

// ============================================================================
// SCALPING SERVICE
// ============================================================================

export class ScalpingService {
  private stateManager: StateManager;
  private tradingService: TradingService;
  private config: ScalpingConfig;
  
  private stats: ScalpingStats;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private scanningInterval: NodeJS.Timeout | null = null;
  private lastTradeTime: number = 0;
  private tradeTimestamps: number[] = [];
  
  constructor(
    stateManager: StateManager,
    tradingService: TradingService,
    config: ScalpingConfig
  ) {
    this.stateManager = stateManager;
    this.tradingService = tradingService;
    this.config = config;
    
    this.stats = {
      startTime: Date.now(),
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnL: 0,
      avgPnL: 0,
      bestTrade: 0,
      worstTrade: 0,
      signalsDetected: 0,
      signalsExecuted: 0,
      signalsSkipped: 0,
      hourlyTradeCount: 0,
    };
  }

  // ============================================================================
  // ЗАПУСК СКАЛЬПИНГА
  // ============================================================================

  /**
   * Запустить скальпинг сервис
   */
  async start(): Promise<void> {
    console.log('⚡ Starting Scalping Service...');
    console.log(`   Capital: $${this.config.myCapital}`);
    console.log(`   Max Position: $${this.config.maxPositionSize}`);
    console.log(`   Max Concurrent: ${this.config.maxConcurrentPositions}`);
    console.log(`   TP: +${this.config.takeProfit * 100}% | SL: -${this.config.stopLoss * 100}%`);
    console.log(`   Max Hold: ${this.config.maxHoldTime}s`);
    console.log(`   Dry Run: ${this.config.dryRun ? '✅' : '❌'}`);

    // Сканирование рынков каждые 30 секунд
    this.scanningInterval = setInterval(async () => {
      await this.scanMarkets();
    }, 30000);

    // Мониторинг позиций каждые 5 секунд
    this.monitoringInterval = setInterval(async () => {
      await this.monitorPositions();
    }, 5000);

    console.log('✅ Scalping Service started');
  }

  // ============================================================================
  // СКАНИРОВАНИЕ РЫНКОВ
  // ============================================================================

  /**
   * Сканировать рынки в поисках сигналов
   */
  private async scanMarkets(): Promise<void> {
    try {
      // Проверить лимиты
      if (!this.canTrade()) {
        return;
      }

      // Найти подходящие рынки
      const markets = await this.findScalpingMarkets();
      
      if (markets.length === 0) {
        return;
      }

      // Проанализировать каждый рынок
      for (const market of markets) {
        const signal = await this.analyzeMarket(market);
        
        if (signal && signal.confidence >= this.config.entryRules.minConfidence) {
          this.stats.signalsDetected++;
          
          console.log(`\n🔍 SCALPING SIGNAL DETECTED!`);
          console.log(`   Market: ${signal.marketQuestion}`);
          console.log(`   Signal: ${signal.signal} ${signal.outcome}`);
          console.log(`   Price: ${signal.currentPrice}`);
          console.log(`   RSI: ${signal.rsi.toFixed(1)} | Volume: ${signal.volumeRatio.toFixed(1)}x`);
          console.log(`   Confidence: ${signal.confidence}%`);
          console.log(`   Reason: ${signal.reason}`);

          // Проверяем cooldown
          const timeSinceLastTrade = Date.now() - this.lastTradeTime;
          if (timeSinceLastTrade < this.config.cooldownAfterTrade * 1000) {
            console.log(`⏳ Cooldown... (${Math.round(timeSinceLastTrade / 1000)}s)`);
            this.stats.signalsSkipped++;
            continue;
          }

          // Открываем позицию
          await this.executeScalpingSignal(signal);
        }
      }
    } catch (error) {
      console.error('Error scanning markets:', error);
    }
  }

  /**
   * Найти рынки подходящие для скальпинга
   */
  private async findScalpingMarkets(): Promise<GammaMarket[]> {
    // TODO: Реализовать через Gamma API
    // Фильтры:
    // - Экспирация 5-15 минут
    // - Категория crypto/sports
    // - Объём 24h > minVolume24h
    
    // Заглушка - вернуть примеры рынков
    console.log('📡 Scanning for scalping markets...');
    return [];
  }

  /**
   * Проанализировать рынок и найти сигнал
   */
  private async analyzeMarket(market: GammaMarket): Promise<ScalpingSignal | null> {
    try {
      // Рассчитать индикаторы
      const rsi = await this.calculateRSI(market);
      const volumeRatio = await this.calculateVolumeRatio(market);
      const macdHistogram = await this.calculateMACD(market);
      const timeToExpiry = this.getTimeToExpiry(market);

      // Проверить подходит ли для скальпинга
      if (timeToExpiry < this.config.minExpiryMinutes * 60 || 
          timeToExpiry > this.config.maxExpiryMinutes * 60) {
        return null;
      }

      if (volumeRatio < this.config.indicators.volume.minRatio) {
        return null;
      }

      // Определить сигнал
      let signal: 'BUY' | 'SELL' | null = null;
      let confidence = 0;
      let reason = '';

      // RSI перепроданность -> BUY
      if (rsi <= this.config.indicators.rsi.oversold) {
        signal = 'BUY';
        confidence = 70 + (this.config.indicators.rsi.oversold - rsi);
        reason = `RSI oversold (${rsi.toFixed(1)})`;
      }
      
      // RSI перекупленность -> SELL
      else if (rsi >= this.config.indicators.rsi.overbought) {
        signal = 'SELL';
        confidence = 70 + (rsi - this.config.indicators.rsi.overbought);
        reason = `RSI overbought (${rsi.toFixed(1)})`;
      }

      // Усилить сигнал если есть объём
      if (signal && volumeRatio > 2) {
        confidence += 10;
        reason += ` + Volume spike (${volumeRatio.toFixed(1)}x)`;
      }

      if (!signal || confidence < this.config.entryRules.minConfidence) {
        return null;
      }

      return {
        marketId: market.id,
        marketQuestion: market.question,
        outcome: signal === 'BUY' ? 'YES' : 'NO',
        currentPrice: 0.5, // TODO: Get real price from outcomes
        timeToExpiry,
        category: 'crypto',
        rsi,
        volumeRatio,
        macdHistogram,
        signal,
        confidence: Math.min(confidence, 100),
        reason,
      };
    } catch (error) {
      console.error('Error analyzing market:', error);
      return null;
    }
  }

  // ============================================================================
  // ИСПОЛНЕНИЕ СИГНАЛА
  // ============================================================================

  /**
   * Исполнить скальпинг сигнал
   */
  private async executeScalpingSignal(signal: ScalpingSignal): Promise<void> {
    try {
      // Рассчитать размер позиции
      const positionSize = this.calculatePositionSize(signal);
      
      console.log(`\n⚡ EXECUTING SCALPING TRADE`);
      console.log(`   Size: $${positionSize.toFixed(2)}`);
      console.log(`   Entry: ${signal.currentPrice}`);

      // Dry run или реальная сделка
      if (this.config.dryRun) {
        console.log('🟢 DRY RUN - No real trade');
        this.stats.signalsExecuted++;
        return;
      }

      // Открыть позицию
      const result = await this.tradingService.createMarketOrder({
        tokenId: signal.marketId,
        side: signal.signal,
        amount: positionSize,
        price: signal.currentPrice,
        orderType: 'FOK',
      });

      if (result.success) {
        this.stats.signalsExecuted++;
        this.lastTradeTime = Date.now();
        this.trackTrade();

        // Сохранить в StateManager
        await this.stateManager.addPosition({
          marketId: signal.marketId,
          marketQuestion: signal.marketQuestion,
          outcome: signal.outcome,
          size: positionSize,
          entryPrice: signal.currentPrice,
          quantity: positionSize / signal.currentPrice,
          strategy: 'scalping',
          timestamp: Date.now(),
          stopLoss: signal.currentPrice * (1 - this.config.stopLoss),
          takeProfit: signal.currentPrice * (1 + this.config.takeProfit),
          expiresAt: Date.now() + this.config.maxHoldTime * 1000,
          metadata: {
            rsi: signal.rsi,
            volumeRatio: signal.volumeRatio,
            confidence: signal.confidence,
          },
        });

        console.log(`✅ Scalping position opened`);
      }
    } catch (error) {
      console.error('Error executing scalping signal:', error);
    }
  }

  // ============================================================================
  // МОНИТОРИНГ ПОЗИЦИЙ
  // ============================================================================

  /**
   * Мониторить активные скальпинг позиции
   */
  private async monitorPositions(): Promise<void> {
    const positions = this.stateManager.getPositionsByStrategy('scalping');
    
    for (const position of positions) {
      try {
        await this.checkScalpingPosition(position);
      } catch (error) {
        console.error(`Error monitoring position ${position.positionId}:`, error);
      }
    }
  }

  /**
   * Проверить скальпинг позицию
   */
  private async checkScalpingPosition(position: any): Promise<void> {
    const now = Date.now();
    const holdTime = (now - position.timestamp) / 1000; // секунды

    // Проверить время удержания
    if (holdTime > this.config.maxHoldTime) {
      console.log(`⏰ Max hold time reached, closing position: ${position.positionId}`);
      await this.closePosition(position.positionId, position.currentPrice || position.entryPrice, 'manual');
      return;
    }

    // Проверить экспирацию
    if (position.expiresAt && now > position.expiresAt) {
      console.log(`📅 Expiry reached, closing position: ${position.positionId}`);
      await this.closePosition(position.positionId, position.currentPrice || position.entryPrice, 'expiry');
      return;
    }

    // Получить текущую цену
    const currentPrice = await this.getCurrentPrice(position.marketId, position.outcome);
    if (!currentPrice) return;

    // Обновить позицию
    await this.stateManager.updatePosition(position.positionId, { currentPrice });

    // Проверить TP/SL
    if (position.takeProfit && currentPrice >= position.takeProfit) {
      console.log(`🎯 Scalping TP hit: ${position.positionId}`);
      await this.closePosition(position.positionId, currentPrice, 'takeProfit');
    } else if (position.stopLoss && currentPrice <= position.stopLoss) {
      console.log(`🛑 Scalping SL hit: ${position.positionId}`);
      await this.closePosition(position.positionId, currentPrice, 'stopLoss');
    }
  }

  /**
   * Закрыть позицию
   */
  private async closePosition(
    positionId: string,
    exitPrice: number,
    reason: any
  ): Promise<void> {
    const result = await this.stateManager.closePosition(positionId, exitPrice, reason);
    
    if (result) {
      this.stats.totalTrades++;
      this.stats.totalPnL += result.pnl;
      
      if (result.pnl >= 0) {
        this.stats.wins++;
        this.stats.bestTrade = Math.max(this.stats.bestTrade, result.pnl);
      } else {
        this.stats.losses++;
        this.stats.worstTrade = Math.min(this.stats.worstTrade, result.pnl);
      }

      this.stats.winRate = this.stats.totalTrades > 0
        ? (this.stats.wins / this.stats.totalTrades) * 100
        : 0;

      this.stats.avgPnL = this.stats.totalTrades > 0
        ? this.stats.totalPnL / this.stats.totalTrades
        : 0;

      console.log(`📊 Trade #${this.stats.totalTrades}: ${result.pnl >= 0 ? '+' : ''}$${result.pnl.toFixed(2)} (${result.pnlPercent.toFixed(1)}%)`);
    }
  }

  // ============================================================================
  // УПРАВЛЕНИЕ РИСКАМИ
  // ============================================================================

  /**
   * Проверить можно ли торговать
   */
  private canTrade(): boolean {
    // Проверить лимиты риска
    const riskCheck = this.stateManager.checkRiskLimits(this.config.myCapital);
    if (!riskCheck.canTrade) {
      console.log(`🛑 Risk limit: ${riskCheck.reason}`);
      return false;
    }

    // Проверить количество позиций
    const positions = this.stateManager.getPositionsByStrategy('scalping');
    if (positions.length >= this.config.maxConcurrentPositions) {
      return false;
    }

    // Проверить trades per hour
    const oneHourAgo = Date.now() - 3600000;
    const recentTrades = this.tradeTimestamps.filter(t => t > oneHourAgo);
    if (recentTrades.length >= this.config.maxTradesPerHour) {
      console.log(`⏰ Hourly trade limit reached (${recentTrades.length}/${this.config.maxTradesPerHour})`);
      return false;
    }

    return true;
  }

  /**
   * Отследить сделку для лимитов
   */
  private trackTrade(): void {
    const now = Date.now();
    this.tradeTimestamps.push(now);
    
    // Удалить старые (>1 часа)
    const oneHourAgo = now - 3600000;
    this.tradeTimestamps = this.tradeTimestamps.filter(t => t > oneHourAgo);
    
    this.stats.hourlyTradeCount = this.tradeTimestamps.length;
  }

  /**
   * Рассчитать размер позиции
   */
  private calculatePositionSize(signal: ScalpingSignal): number {
    const baseSize = this.config.myCapital * this.config.maxPositionSize;
    
    // Увеличить размер если уверенность высокая
    const confidenceMultiplier = signal.confidence / 100;
    const adjustedSize = baseSize * confidenceMultiplier;

    return Math.max(
      this.config.minPositionSize,
      Math.min(adjustedSize, this.config.maxPositionSize)
    );
  }

  // ============================================================================
  // ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ (ЗАГЛУШКИ)
  // ============================================================================

  private async calculateRSI(market: GammaMarket): Promise<number> {
    // TODO: Реализовать через исторические данные
    return 50;
  }

  private async calculateVolumeRatio(market: GammaMarket): Promise<number> {
    // TODO: Реализовать через объёмы
    return 1.5;
  }

  private async calculateMACD(market: GammaMarket): Promise<number> {
    // TODO: Реализовать
    return 0;
  }

  private getTimeToExpiry(market: GammaMarket): number {
    // TODO: Реализовать через market.closeDate
    return 600; // 10 минут
  }

  private async getCurrentPrice(marketId: string, outcome: string): Promise<number | null> {
    // TODO: Реализовать через CLOB
    return null;
  }

  // ============================================================================
  // СТАТИСТИКА
  // ============================================================================

  /**
   * Получить статистику
   */
  getStats(): ScalpingStats {
    return { ...this.stats };
  }

  /**
   * Остановить сервис
   */
  stop(): void {
    if (this.scanningInterval) {
      clearInterval(this.scanningInterval);
    }
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    console.log('⏹️ Scalping Service stopped');
  }
}

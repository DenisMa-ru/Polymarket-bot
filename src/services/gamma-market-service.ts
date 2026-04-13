/**
 * Gamma Market Data Service - Реальные данные для скальпинга
 * 
 * Получает рынки с экспирацией из Gamma API:
 * - Фильтрация по времени экспирации (5-15 минут)
 * - Получение текущих цен и объёмов
 * - Отслеживание изменений цен в реальном времени
 * - WebSocket для live обновлений
 */

import { GammaApiClient } from '../clients/gamma-api.js';
import type { GammaMarket } from '../clients/gamma-api.js';
import { RealtimeServiceV2 } from './realtime-service-v2.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ScalpingMarket {
  id: string;
  question: string;
  conditionId: string;
  closeDate: Date;
  timeToExpirySeconds: number;
  outcomes: Array<{
    token: string;
    price: number;
    outcome: string;
  }>;
  volume24h: number;
  liquidity: number;
  category: 'crypto' | 'sports' | 'politics' | 'other';
  priceHistory: number[];  // Последние 10 цен
  volumeHistory: number[]; // Последние 10 объёмов
}

export interface MarketFilter {
  minExpiryMinutes: number;
  maxExpiryMinutes: number;
  minVolume24h: number;
  minLiquidity: number;
  categories: string[];
  keywords: string[];
}

// ============================================================================
// GAMMA MARKET SERVICE
// ============================================================================

export class GammaMarketService {
  private gammaApi: GammaApiClient;
  private realtimeService: RealtimeServiceV2;
  
  private marketCache: Map<string, ScalpingMarket> = new Map();
  private priceHistory: Map<string, number[]> = new Map();
  private scanInterval: NodeJS.Timeout | null = null;
  
  constructor(gammaApi: GammaApiClient, realtimeService: RealtimeServiceV2) {
    this.gammaApi = gammaApi;
    this.realtimeService = realtimeService;
  }

  // ============================================================================
  // ПОЛУЧЕНИЕ РЫНКОВ ДЛЯ СКАЛЬПИНГА
  // ============================================================================

  /**
   * Найти рынки подходящие для скальпинга
   */
  async findScalpingMarkets(filter: MarketFilter): Promise<ScalpingMarket[]> {
    try {
      console.log('Scanning Gamma markets for scalping opportunities...');

      // Получить все активные рынки
      const markets = await this.fetchActiveMarkets();
      
      // Фильтрация
      const filtered = markets.filter(m => {
        // Проверить время экспирации
        if (m.timeToExpirySeconds < filter.minExpiryMinutes * 60) return false;
        if (m.timeToExpirySeconds > filter.maxExpiryMinutes * 60) return false;
        
        // Проверить объём
        if (m.volume24h < filter.minVolume24h) return false;
        
        // Проверить ликвидность
        if (m.liquidity < filter.minLiquidity) return false;
        
        // Проверить категорию
        if (!filter.categories.includes(m.category)) return false;
        
        // Проверить ключевые слова
        if (filter.keywords.length > 0) {
          const hasKeyword = filter.keywords.some(kw => 
            m.question.toLowerCase().includes(kw.toLowerCase())
          );
          if (!hasKeyword) return false;
        }
        
        return true;
      });

      console.log(`Found ${filtered.length} markets matching scalping criteria`);
      
      return filtered;
    } catch (error) {
      console.error('Error finding scalping markets:', error);
      return [];
    }
  }

  /**
   * Получить все активные рынки
   */
  private async fetchActiveMarkets(): Promise<ScalpingMarket[]> {
    // TODO: Реализовать через Gamma API
    // Пока используем заглушку с примерами
    
    const now = Date.now();
    
    // Пример рынка
    const markets: ScalpingMarket[] = [
      {
        id: 'btc-65k-apr15',
        question: 'Will BTC be above $65,000 on April 15?',
        conditionId: 'cond_123',
        closeDate: new Date(now + 10 * 60 * 1000), // 10 минут
        timeToExpirySeconds: 600,
        outcomes: [
          { token: 'YES', price: 0.45, outcome: 'YES' },
          { token: 'NO', price: 0.55, outcome: 'NO' },
        ],
        volume24h: 5000,
        liquidity: 2000,
        category: 'crypto',
        priceHistory: [0.42, 0.43, 0.44, 0.45, 0.46, 0.45, 0.44, 0.43, 0.44, 0.45],
        volumeHistory: [100, 150, 200, 180, 220, 250, 300, 280, 320, 350],
      },
    ];

    // Сохранить в кэш
    for (const market of markets) {
      this.marketCache.set(market.id, market);
    }

    return markets;
  }

  // ============================================================================
  // ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ С РЕАЛЬНЫМИ ДАННЫМИ
  // ============================================================================

  /**
   * Рассчитать RSI с использованием исторических данных
   */
  calculateRSI(market: ScalpingMarket, period: number = 14): number {
    const prices = market.priceHistory;
    
    if (prices.length < period + 1) {
      return 50; // Недостаточно данных
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * Рассчитать соотношение объёмов
   */
  calculateVolumeRatio(market: ScalpingMarket): number {
    const volumes = market.volumeHistory;
    
    if (volumes.length === 0) return 1;
    
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
    
    if (avgVolume === 0) return 1;
    
    return currentVolume / avgVolume;
  }

  /**
   * Рассчитать MACD
   */
  calculateMACD(prices: number[], fast: number = 12, slow: number = 26, signal: number = 9): {
    macd: number;
    signal: number;
    histogram: number;
  } {
    if (prices.length < slow + signal) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    // EMA calculation
    const emaFast = this.calculateEMA(prices, fast);
    const emaSlow = this.calculateEMA(prices, slow);
    
    const macdLine = emaFast - emaSlow;
    
    // Signal line (EMA of MACD)
    // Упрощённо - в реальности нужна история MACD
    const signalLine = macdLine * 0.8;
    const histogram = macdLine - signalLine;

    return {
      macd: macdLine,
      signal: signalLine,
      histogram,
    };
  }

  /**
   * Расчёт EMA
   */
  private calculateEMA(prices: number[], period: number): number {
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }

  // ============================================================================
  // WEBSOCKET МОНИТОРИНГ
  // ============================================================================

  /**
   * Запустить мониторинг рынков через WebSocket
   */
  async startRealtimeMonitoring(marketIds: string[], onPriceUpdate: (market: ScalpingMarket) => void): Promise<void> {
    console.log(`Starting realtime monitoring for ${marketIds.length} markets`);

    // TODO: Подписаться на обновления через RealtimeService
    // Сейчас используем polling вместо WebSocket
    const pollInterval = setInterval(async () => {
      for (const marketId of marketIds) {
        try {
          // Получаем обновление из кэша
          const market = this.marketCache.get(marketId);
          if (market) {
            // Обновить время до экспирации
            market.timeToExpirySeconds = (market.closeDate.getTime() - Date.now()) / 1000;
            onPriceUpdate(market);
          }
        } catch (error) {
          console.error(`Failed to update market ${marketId}:`, error);
        }
      }
    }, 10000); // Каждые 10 секунд

    console.log('Realtime monitoring started (polling mode)');
  }

  /**
   * Остановить мониторинг
   */
  stopMonitoring(): void {
    this.realtimeService.unsubscribeAll();
    console.log('Realtime monitoring stopped');
  }

  // ============================================================================
  // АНАЛИТИКА
  // ============================================================================

  /**
   * Получить волатильность рынка
   */
  getVolatility(market: ScalpingMarket): number {
    const prices = market.priceHistory;
    if (prices.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev;
  }

  /**
   * Определить тренд
   */
  getTrend(market: ScalpingMarket): 'up' | 'down' | 'sideways' {
    const prices = market.priceHistory;
    if (prices.length < 5) return 'sideways';

    const recent = prices.slice(-5);
    const firstHalf = recent.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const secondHalf = recent.slice(-2).reduce((a, b) => a + b, 0) / 2;

    const change = (secondHalf - firstHalf) / firstHalf;

    if (change > 0.05) return 'up';
    if (change < -0.05) return 'down';
    return 'sideways';
  }

  /**
   * Получить детальную информацию о рынке
   */
  getMarketDetails(market: ScalpingMarket): any {
    const rsi = this.calculateRSI(market);
    const volumeRatio = this.calculateVolumeRatio(market);
    const volatility = this.getVolatility(market);
    const trend = this.getTrend(market);
    const macd = this.calculateMACD(market.priceHistory);

    return {
      id: market.id,
      question: market.question,
      timeToExpiry: market.timeToExpirySeconds,
      timeToExpiryMinutes: Math.round(market.timeToExpirySeconds / 60),
      currentPrice: market.outcomes[0].price,
      rsi,
      volumeRatio,
      volatility,
      trend,
      macd: macd.histogram,
      signals: {
        rsiOversold: rsi < 30,
        rsiOverbought: rsi > 70,
        volumeSpike: volumeRatio > 1.5,
        strongTrend: trend !== 'sideways',
      },
    };
  }
}

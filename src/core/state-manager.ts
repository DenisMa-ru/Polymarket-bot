/**
 * State Manager - Сохранение и восстановление состояния бота
 * 
 * Позволяет боту корректно восстановиться после перезапуска:
 * - Активные позиции
 * - Pending ордера
 * - PnL статистика
 * - Параметры риск-менеджмента
 * 
 * Автосохранение: каждые 30 секунд + при каждом изменении
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

// ============================================================================
// TYPES
// ============================================================================

export interface Position {
  positionId: string;           // Уникальный ID позиции
  marketId: string;
  marketQuestion: string;
  outcome: 'YES' | 'NO';
  size: number;                 // Размер в USD
  entryPrice: number;           // Цена входа
  currentPrice?: number;        // Текущая цена
  quantity: number;             // Количество акций
  strategy: 'smartMoney' | 'arbitrage' | 'dipArb' | 'scalping' | 'direct';
  timestamp: number;            // Время открытия
  stopLoss?: number;            // Stop-loss цена
  takeProfit?: number;          // Take-profit цена
  trailingStop?: number;        // Trailing stop %
  highestPrice?: number;        // Максимальная цена (для trailing stop)
  targetMarketId?: string;      // Для арбитража - связанный рынок
  expiresAt?: number;           // Время экспирации
  metadata?: Record<string, any>;
}

export interface PendingOrder {
  orderId: string;
  marketId: string;
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  strategy: string;
  timestamp: number;
  expiresAt?: number;
}

export interface DailyStats {
  date: string;                 // YYYY-MM-DD
  startingBalance: number;
  currentBalance: number;
  dailyPnL: number;
  tradesCount: number;
  wins: number;
  losses: number;
  winRate: number;
  bestTrade: number;
  worstTrade: number;
  strategyPnL: Record<string, number>;
}

export interface TradeHistory {
  positionId: string;
  marketId: string;
  marketQuestion: string;
  outcome: 'YES' | 'NO';
  strategy: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  openTime: number;
  closeTime: number;
  holdDuration: number;         // В секундах
  reason: 'takeProfit' | 'stopLoss' | 'trailingStop' | 'manual' | 'expiry' | 'arbitrage';
}

export interface BotState {
  // Основная информация
  version: string;
  lastUpdated: number;
  
  // Позиции и ордера
  activePositions: Position[];
  pendingOrders: PendingOrder[];
  
  // PnL и статистика
  peakCapital: number;
  totalPnL: number;
  dailyPnL: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  
  // Дневная статистика
  dailyStats: DailyStats;
  
  // История сделок (последние 100)
  tradeHistory: TradeHistory[];
  
  // Настройки риска
  riskState: {
    currentPositionSize: number;
    dailyMaxLossReached: boolean;
    monthlyMaxLossReached: boolean;
    drawdownLimitReached: boolean;
    totalLossHalt: boolean;
    lastResetDate: string;
  };
  
  // Состояние стратегий
  strategyStates: Record<string, any>;
}

// ============================================================================
// STATE MANAGER CLASS
// ============================================================================

export class StateManager {
  private statePath: string;
  private backupPath: string;
  private currentState: BotState | null = null;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private readonly AUTO_SAVE_MS = 30 * 1000; // 30 секунд
  private readonly MAX_TRADE_HISTORY = 100;

  constructor(basePath: string = './bot-state') {
    this.statePath = path.join(basePath, 'state.json');
    this.backupPath = path.join(basePath, 'state.backup.json');
  }

  // ============================================================================
  // ИНИЦИАЛИЗАЦИЯ
  // ============================================================================

  /**
   * Инициализация StateManager
   * Создаёт директорию и загружает состояние если существует
   */
  async initialize(): Promise<BotState> {
    // Создаём директорию
    const dir = path.dirname(this.statePath);
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Пробуем загрузить состояние
    const savedState = await this.loadState();
    
    if (savedState) {
      console.log(`✅ State loaded from ${this.statePath}`);
      console.log(`   Positions: ${savedState.activePositions.length}`);
      console.log(`   Pending orders: ${savedState.pendingOrders.length}`);
      console.log(`   Total PnL: $${savedState.totalPnL.toFixed(2)}`);
      
      this.currentState = savedState;
    } else {
      console.log('🆕 Creating new bot state');
      this.currentState = this.createInitialState();
    }

    // Запускаем автосохранение
    this.startAutoSave();

    return this.currentState;
  }

  /**
   * Создание начального состояния
   */
  private createInitialState(): BotState {
    const today = new Date().toISOString().split('T')[0];
    
    return {
      version: '3.2',
      lastUpdated: Date.now(),
      activePositions: [],
      pendingOrders: [],
      peakCapital: 0,
      totalPnL: 0,
      dailyPnL: 0,
      consecutiveLosses: 0,
      consecutiveWins: 0,
      dailyStats: {
        date: today,
        startingBalance: 0,
        currentBalance: 0,
        dailyPnL: 0,
        tradesCount: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        bestTrade: 0,
        worstTrade: 0,
        strategyPnL: {},
      },
      tradeHistory: [],
      riskState: {
        currentPositionSize: 0,
        dailyMaxLossReached: false,
        monthlyMaxLossReached: false,
        drawdownLimitReached: false,
        totalLossHalt: false,
        lastResetDate: today,
      },
      strategyStates: {},
    };
  }

  // ============================================================================
  // СОХРАНЕНИЕ И ЗАГРУЗКА
  // ============================================================================

  /**
   * Сохранение состояния в файл
   */
  async saveState(state?: Partial<BotState>): Promise<void> {
    if (!this.currentState) return;

    // Обновляем состояние если переданы новые данные
    if (state) {
      this.currentState = { ...this.currentState, ...state };
    }

    this.currentState.lastUpdated = Date.now();

    try {
      // Создаём бэкап текущего файла
      if (fsSync.existsSync(this.statePath)) {
        await fs.copyFile(this.statePath, this.backupPath);
      }

      // Сохраняем новое состояние
      const json = JSON.stringify(this.currentState, null, 2);
      await fs.writeFile(this.statePath, json, 'utf-8');
    } catch (error) {
      console.error('❌ Failed to save state:', error);
      // Пробуем восстановить из бэкапа при следующей загрузке
    }
  }

  /**
   * Загрузка состояния из файла
   */
  private async loadState(): Promise<BotState | null> {
    try {
      // Пробуем основной файл
      if (fsSync.existsSync(this.statePath)) {
        const json = await fs.readFile(this.statePath, 'utf-8');
        return JSON.parse(json);
      }

      // Если не существует, пробуем бэкап
      if (fsSync.existsSync(this.backupPath)) {
        console.log('⚠️ Main state file not found, loading from backup...');
        const json = await fs.readFile(this.backupPath, 'utf-8');
        return JSON.parse(json);
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to load state:', error);
      return null;
    }
  }

  /**
   * Автосохранение каждые 30 секунд
   */
  private startAutoSave(): void {
    this.autoSaveInterval = setInterval(() => {
      this.saveState().catch(console.error);
    }, this.AUTO_SAVE_MS);
  }

  /**
   * Остановка автосохранения
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  // ============================================================================
  // УПРАВЛЕНИЕ ПОЗИЦИЯМИ
  // ============================================================================

  /**
   * Добавить новую позицию
   */
  async addPosition(position: Omit<Position, 'positionId'>): Promise<Position> {
    if (!this.currentState) throw new Error('State not initialized');

    const newPosition: Position = {
      ...position,
      positionId: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    this.currentState.activePositions.push(newPosition);
    await this.saveState();

    console.log(`📊 Position added: ${newPosition.positionId}`);
    console.log(`   Market: ${position.marketQuestion}`);
    console.log(`   Outcome: ${position.outcome} @ $${position.entryPrice}`);
    console.log(`   Size: $${position.size}`);

    return newPosition;
  }

  /**
   * Обновить позицию (например, текущую цену)
   */
  async updatePosition(positionId: string, updates: Partial<Position>): Promise<void> {
    if (!this.currentState) throw new Error('State not initialized');

    const index = this.currentState.activePositions.findIndex(p => p.positionId === positionId);
    if (index === -1) {
      console.warn(`⚠️ Position not found: ${positionId}`);
      return;
    }

    this.currentState.activePositions[index] = {
      ...this.currentState.activePositions[index],
      ...updates,
    };

    await this.saveState();
  }

  /**
   * Закрыть позицию и переместить в историю
   */
  async closePosition(
    positionId: string,
    exitPrice: number,
    reason: TradeHistory['reason']
  ): Promise<TradeHistory | null> {
    if (!this.currentState) throw new Error('State not initialized');

    const index = this.currentState.activePositions.findIndex(p => p.positionId === positionId);
    if (index === -1) {
      console.warn(`⚠️ Position not found: ${positionId}`);
      return null;
    }

    const position = this.currentState.activePositions[index];
    const closeTime = Date.now();
    
    // Рассчитываем PnL
    const pnlPercent = position.outcome === 'YES'
      ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100
      : ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
    
    const pnl = (position.size * pnlPercent) / 100;

    // Создаём запись в истории
    const tradeRecord: TradeHistory = {
      positionId: position.positionId,
      marketId: position.marketId,
      marketQuestion: position.marketQuestion,
      outcome: position.outcome,
      strategy: position.strategy,
      entryPrice: position.entryPrice,
      exitPrice,
      size: position.size,
      pnl,
      pnlPercent,
      openTime: position.timestamp,
      closeTime,
      holdDuration: closeTime - position.timestamp,
      reason,
    };

    // Удаляем из активных позиций
    this.currentState.activePositions.splice(index, 1);

    // Добавляем в историю
    this.currentState.tradeHistory.unshift(tradeRecord);
    if (this.currentState.tradeHistory.length > this.MAX_TRADE_HISTORY) {
      this.currentState.tradeHistory.pop();
    }

    // Обновляем статистику
    this.updatePnLStats(pnl);
    this.updateDailyStats(tradeRecord);

    await this.saveState();

    const emoji = pnl >= 0 ? '✅' : '❌';
    console.log(`${emoji} Position closed: ${positionId}`);
    console.log(`   PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`);
    console.log(`   Reason: ${reason}`);

    return tradeRecord;
  }

  /**
   * Получить все активные позиции
   */
  getActivePositions(): Position[] {
    return this.currentState?.activePositions || [];
  }

  /**
   * Получить позиции по стратегии
   */
  getPositionsByStrategy(strategy: string): Position[] {
    return this.currentState?.activePositions.filter(p => p.strategy === strategy) || [];
  }

  /**
   * Проверить существует ли позиция на этом рынке
   */
  hasPosition(marketId: string, outcome?: 'YES' | 'NO'): boolean {
    const positions = this.currentState?.activePositions || [];
    return positions.some(p => 
      p.marketId === marketId && (!outcome || p.outcome === outcome)
    );
  }

  // ============================================================================
  // УПРАВЛЕНИЕ ОРДЕРАМИ
  // ============================================================================

  /**
   * Добавить pending ордер
   */
  async addPendingOrder(order: Omit<PendingOrder, 'orderId'>): Promise<PendingOrder> {
    if (!this.currentState) throw new Error('State not initialized');

    const newOrder: PendingOrder = {
      ...order,
      orderId: `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    this.currentState.pendingOrders.push(newOrder);
    await this.saveState();

    return newOrder;
  }

  /**
   * Удалить executed/cancelled ордер
   */
  async removePendingOrder(orderId: string): Promise<void> {
    if (!this.currentState) throw new Error('State not initialized');

    const index = this.currentState.pendingOrders.findIndex(o => o.orderId === orderId);
    if (index === -1) return;

    this.currentState.pendingOrders.splice(index, 1);
    await this.saveState();
  }

  /**
   * Получить все pending ордера
   */
  getPendingOrders(): PendingOrder[] {
    return this.currentState?.pendingOrders || [];
  }

  // ============================================================================
  // PNl И СТАТИСТИКА
  // ============================================================================

  /**
   * Обновить PnL статистику
   */
  private updatePnLStats(pnl: number): void {
    if (!this.currentState) return;

    this.currentState.totalPnL += pnl;
    this.currentState.dailyPnL += pnl;

    if (pnl >= 0) {
      this.currentState.consecutiveWins++;
      this.currentState.consecutiveLosses = 0;
    } else {
      this.currentState.consecutiveLosses++;
      this.currentState.consecutiveWins = 0;
    }
  }

  /**
   * Обновить дневную статистику
   */
  private updateDailyStats(trade: TradeHistory): void {
    if (!this.currentState) return;

    const stats = this.currentState.dailyStats;
    
    stats.tradesCount++;
    stats.currentBalance += trade.pnl;
    stats.dailyPnL += trade.pnl;

    if (trade.pnl >= 0) {
      stats.wins++;
      stats.bestTrade = Math.max(stats.bestTrade, trade.pnl);
    } else {
      stats.losses++;
      stats.worstTrade = Math.min(stats.worstTrade, trade.pnl);
    }

    stats.winRate = stats.tradesCount > 0 
      ? (stats.wins / stats.tradesCount) * 100 
      : 0;

    // PnL по стратегиям
    if (!stats.strategyPnL[trade.strategy]) {
      stats.strategyPnL[trade.strategy] = 0;
    }
    stats.strategyPnL[trade.strategy] += trade.pnl;
  }

  /**
   * Сбросить дневную статистику (новый день)
   */
  async resetDailyStats(newBalance: number): Promise<void> {
    if (!this.currentState) return;

    const today = new Date().toISOString().split('T')[0];

    this.currentState.dailyStats = {
      date: today,
      startingBalance: newBalance,
      currentBalance: newBalance,
      dailyPnL: 0,
      tradesCount: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      bestTrade: 0,
      worstTrade: 0,
      strategyPnL: {},
    };

    this.currentState.dailyPnL = 0;
    this.currentState.riskState.dailyMaxLossReached = false;
    this.currentState.riskState.lastResetDate = today;

    await this.saveState();
    console.log('📅 Daily stats reset');
  }

  // ============================================================================
  // РИСК-МЕНЕДЖМЕНТ
  // ============================================================================

  /**
   * Проверить лимиты риска
   */
  checkRiskLimits(capital: number): { canTrade: boolean; reason?: string } {
    if (!this.currentState) return { canTrade: true };

    const { riskState, dailyStats } = this.currentState;

    // Total loss halt
    if (riskState.totalLossHalt) {
      return { canTrade: false, reason: 'Total loss limit reached (40%)' };
    }

    // Daily max loss
    const dailyLossPercent = Math.abs(Math.min(0, dailyStats.dailyPnL)) / dailyStats.startingBalance;
    if (dailyLossPercent >= 0.05) { // 5%
      return { canTrade: false, reason: `Daily loss limit reached (${(dailyLossPercent * 100).toFixed(1)}%)` };
    }

    // Monthly max loss
    const monthlyPnL = this.getMontlyPnL();
    if (Math.abs(Math.min(0, monthlyPnL)) >= capital * 0.15) { // 15%
      return { canTrade: false, reason: 'Monthly loss limit reached' };
    }

    // Drawdown from peak
    if (riskState.drawdownLimitReached) {
      return { canTrade: false, reason: 'Drawdown limit reached' };
    }

    return { canTrade: true };
  }

  /**
   * Обновить peak capital
   */
  async updatePeakCapital(balance: number): Promise<void> {
    if (!this.currentState) return;

    if (balance > this.currentState.peakCapital) {
      this.currentState.peakCapital = balance;
      await this.saveState();
    }
  }

  /**
   * Активировать total loss halt
   */
  async activateTotalLossHalt(): Promise<void> {
    if (!this.currentState) return;

    this.currentState.riskState.totalLossHalt = true;
    await this.saveState();
    console.error('🛑 TOTAL LOSS HALT ACTIVATED - Trading stopped permanently');
  }

  /**
   * Получить месячный PnL
   */
  getMontlyPnL(): number {
    // Упрощённо: текущий daily PnL * дни в месяце
    // В полной версии нужно хранить историю за месяц
    return this.currentState?.totalPnL || 0;
  }

  // ============================================================================
  // АНАЛИТИКА
  // ============================================================================

  /**
   * Получить полную статистику
   */
  getStats(): any {
    if (!this.currentState) return null;

    const state = this.currentState;
    const totalTrades = state.tradeHistory.length;
    const winningTrades = state.tradeHistory.filter(t => t.pnl >= 0).length;
    const overallWinRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    // Средняя прибыль на сделку
    const avgPnL = totalTrades > 0
      ? state.tradeHistory.reduce((sum, t) => sum + t.pnl, 0) / totalTrades
      : 0;

    // PnL по стратегиям
    const strategyStats: Record<string, any> = {};
    const strategies = [...new Set(state.tradeHistory.map(t => t.strategy))];
    
    for (const strategy of strategies) {
      const stratTrades = state.tradeHistory.filter(t => t.strategy === strategy);
      const stratWins = stratTrades.filter(t => t.pnl >= 0);
      
      strategyStats[strategy] = {
        totalTrades: stratTrades.length,
        wins: stratWins.length,
        losses: stratTrades.length - stratWins.length,
        winRate: stratTrades.length > 0 ? (stratWins.length / stratTrades.length) * 100 : 0,
        totalPnL: stratTrades.reduce((sum, t) => sum + t.pnl, 0),
        avgPnL: stratTrades.length > 0 ? stratTrades.reduce((sum, t) => sum + t.pnl, 0) / stratTrades.length : 0,
      };
    }

    return {
      activePositions: state.activePositions.length,
      pendingOrders: state.pendingOrders.length,
      totalPnL: state.totalPnL,
      dailyPnL: state.dailyPnL,
      peakCapital: state.peakCapital,
      consecutiveWins: state.consecutiveWins,
      consecutiveLosses: state.consecutiveLosses,
      overallWinRate,
      avgPnL,
      totalTrades,
      strategyStats,
      todayStats: state.dailyStats,
    };
  }

  /**
   * Получить последние сделки
   */
  getRecentTrades(count: number = 10): TradeHistory[] {
    return this.currentState?.tradeHistory.slice(0, count) || [];
  }

  // ============================================================================
  // УТИЛИТЫ
  // ============================================================================

  /**
   * Очистить состояние (сброс)
   */
  async clearState(): Promise<void> {
    this.stopAutoSave();
    
    if (fsSync.existsSync(this.statePath)) {
      await fs.unlink(this.statePath);
    }
    if (fsSync.existsSync(this.backupPath)) {
      await fs.unlink(this.backupPath);
    }

    this.currentState = this.createInitialState();
    this.startAutoSave();
    
    console.log('🗑️ State cleared');
  }

  /**
   * Валидация состояния при загрузке
   * Проверяем что позиции всё ещё актуальны
   */
  async validatePositions(): Promise<{ valid: Position[], invalid: Position[] }> {
    if (!this.currentState) return { valid: [], invalid: [] };

    const now = Date.now();
    const valid: Position[] = [];
    const invalid: Position[] = [];

    for (const position of this.currentState.activePositions) {
      // Проверяем не истекла ли экспирация
      if (position.expiresAt && now > position.expiresAt) {
        invalid.push(position);
        continue;
      }

      // Проверяем что цена входа валидна
      if (position.entryPrice <= 0 || position.entryPrice >= 1) {
        invalid.push(position);
        continue;
      }

      valid.push(position);
    }

    if (invalid.length > 0) {
      console.warn(`⚠️ Found ${invalid.length} invalid positions, removing...`);
      
      // Удаляем невалидные позиции
      this.currentState.activePositions = valid;
      await this.saveState();
    }

    return { valid, invalid };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.stopAutoSave();
    await this.saveState();
    console.log('💾 State saved (graceful shutdown)');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const stateManager = new StateManager();

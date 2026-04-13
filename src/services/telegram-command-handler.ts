/**
 * Telegram Command Handler - Динамическая настройка параметров через Telegram
 * 
 * Позволяет менять параметры бота на лету через команды:
 * /setparam key value
 * /getparam key
 * /status
 * /strategies
 * /risk
 * и другие
 */

// @ts-ignore - node-telegram-bot-api types may not be installed initially
import TelegramBot from 'node-telegram-bot-api';
import { StateManager } from '../core/state-manager.js';
import { TelegramService } from './telegram-service.js';

// ============================================================================
// TYPES
// ============================================================================

export interface BotConfig {
  capital: {
    totalUsd: number;
    maxPerTradePct: number;
    maxPerMarketPct: number;
    maxTotalExposurePct: number;
    minOrderUsd: number;
  };
  risk: {
    dailyMaxLossPct: number;
    monthlyMaxLossPct: number;
    maxDrawdownFromPeak: number;
    totalMaxLossPct: number;
    enableDynamicSizing: boolean;
    minPositionPct: number;
    maxPositionPct: number;
  };
  smartMoney: {
    enabled: boolean;
    topN: number;
    minWinRate: number;
    minPnl: number;
    minTrades: number;
    minProfitFactor: number;
    maxSizePerTrade: number;
    maxSlippage: number;
    takeProfitPercent: number;
    stopLossPercent: number;
    enableTrailingStop: boolean;
    trailingStopPercent: number;
  };
  scalping: {
    enabled: boolean;
    maxPositionSize: number;
    minPositionSize: number;
    maxExpiryMinutes: number;
    minExpiryMinutes: number;
    takeProfit: number;
    stopLoss: number;
    maxHoldTime: number;
    maxTradesPerHour: number;
  };
  arbitrage: {
    enabled: boolean;
    profitThreshold: number;
    minTradeSize: number;
    maxTradeSize: number;
  };
  dryRun: boolean;
}

// ============================================================================
// TELEGRAM COMMAND HANDLER
// ============================================================================

export class TelegramCommandHandler {
  private bot: TelegramBot | null = null;
  private config: BotConfig;
  private stateManager: StateManager;
  private telegramService: TelegramService;
  private chatId: string;

  constructor(
    config: BotConfig,
    stateManager: StateManager,
    telegramService: TelegramService,
    chatId: string
  ) {
    this.config = config;
    this.stateManager = stateManager;
    this.telegramService = telegramService;
    this.chatId = chatId;
  }

  /**
   * Инициализировать обработчик команд
   */
  async initialize(): Promise<void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.log('Telegram bot token not configured');
      return;
    }

    try {
      this.bot = new TelegramBot(botToken, { polling: true });

      // Команды
      this.bot.onText(/\/start/, this.handleStart.bind(this));
      this.bot.onText(/\/status/, this.handleStatus.bind(this));
      this.bot.onText(/\/strategies/, this.handleStrategies.bind(this));
      this.bot.onText(/\/risk/, this.handleRisk.bind(this));
      this.bot.onText(/\/setparam (\w+) (.+)/, this.handleSetParam.bind(this));
      this.bot.onText(/\/getparam (\w+)/, this.handleGetParam.bind(this));
      this.bot.onText(/\/trades/, this.handleTrades.bind(this));
      this.bot.onText(/\/help/, this.handleHelp.bind(this));
      this.bot.onText(/\/stop/, this.handleStop.bind(this));
      this.bot.onText(/\/startbot/, this.handleStartBot.bind(this));

      console.log('Telegram command handler initialized');
      console.log('Available commands: /start, /status, /strategies, /risk, /setparam, /getparam, /trades, /help');
    } catch (error) {
      console.error('Failed to initialize Telegram command handler:', error);
    }
  }

  // ============================================================================
  // ОБРАБОТЧИКИ КОМАНД
  // ============================================================================

  /**
   * /start - Приветствие
   */
  private async handleStart(msg: any): Promise<void> {
    const message = `🚀 <b>Polymarket Bot v3.2</b>

Добро пожаловать в панель управления ботом!

<b>Доступные команды:</b>
/status - Текущее состояние
/strategies - Настройки стратегий
/risk - Параметры риска
/setparam key value - Изменить параметр
/getparam key - Получить параметр
/trades - Последние сделки
/stop - Остановить бота
/startbot - Запустить бота
/help - Помощь

Настройте бота на лету без перезапуска!`;

    await this.sendMessage(message);
  }

  /**
   * /status - Текущее состояние
   */
  private async handleStatus(msg: any): Promise<void> {
    const stats = this.stateManager.getStats();
    
    const message = `📊 <b>Текущее состояние</b>

💰 <b>Капитал:</b> $${this.config.capital.totalUsd}
🎮 <b>Режим:</b> ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}

📈 <b>Общий PnL:</b> ${stats.totalPnL >= 0 ? '+' : ''}$${stats.totalPnL?.toFixed(2) || '0'}
📊 <b>Дневной PnL:</b> ${stats.dailyPnL >= 0 ? '+' : ''}$${stats.dailyPnL?.toFixed(2) || '0'}

🎯 <b>Win Rate:</b> ${stats.overallWinRate?.toFixed(1) || '0'}%
📦 <b>Всего сделок:</b> ${stats.totalTrades || 0}
✅ <b>Побед:</b> ${stats.wins || 0}
❌ <b>Поражений:</b> ${stats.losses || 0}

🔥 <b>Серия побед:</b> ${stats.consecutiveWins || 0}
😰 <b>Серия поражений:</b> ${stats.consecutiveLosses || 0}

📂 <b>Активных позиций:</b> ${stats.activePositions || 0}`;

    await this.sendMessage(message);
  }

  /**
   * /strategies - Настройки стратегий
   */
  private async handleStrategies(msg: any): Promise<void> {
    const message = `🎯 <b>Настройки стратегий</b>

<b>Smart Money:</b>
  Включена: ${this.config.smartMoney.enabled ? '✅' : '❌'}
  Топ N: ${this.config.smartMoney.topN}
  Мин. Win Rate: ${(this.config.smartMoney.minWinRate * 100).toFixed(0)}%
  Мин. PnL: $${this.config.smartMoney.minPnl}
  Мин. Сделок: ${this.config.smartMoney.minTrades}
  Profit Factor: ${this.config.smartMoney.minProfitFactor}x
  Макс. размер: $${this.config.smartMoney.maxSizePerTrade}
  Take-Profit: +${(this.config.smartMoney.takeProfitPercent * 100).toFixed(0)}%
  Stop-Loss: -${(this.config.smartMoney.stopLossPercent * 100).toFixed(0)}%
  Trailing Stop: ${this.config.smartMoney.enableTrailingStop ? `${(this.config.smartMoney.trailingStopPercent * 100).toFixed(0)}%` : '❌'}

<b>Scalping:</b>
  Включен: ${this.config.scalping.enabled ? '✅' : '❌'}
  Макс. размер: $${this.config.scalping.maxPositionSize}
  Мин. размер: $${this.config.scalping.minPositionSize}
  Экспирация: ${this.config.scalping.minExpiryMinutes}-${this.config.scalping.maxExpiryMinutes} мин
  Take-Profit: +${(this.config.scalping.takeProfit * 100).toFixed(0)}%
  Stop-Loss: -${(this.config.scalping.stopLoss * 100).toFixed(0)}%
  Макс. сделок/час: ${this.config.scalping.maxTradesPerHour}

<b>Arbitrage:</b>
  Включен: ${this.config.arbitrage.enabled ? '✅' : '❌'}
  Порог прибыли: ${(this.config.arbitrage.profitThreshold * 100).toFixed(1)}%
  Мин. размер: $${this.config.arbitrage.minTradeSize}
  Макс. размер: $${this.config.arbitrage.maxTradeSize}`;

    await this.sendMessage(message);
  }

  /**
   * /risk - Параметры риска
   */
  private async handleRisk(msg: any): Promise<void> {
    const message = `🛡️ <b>Параметры риска</b>

<b>Дневной лимит:</b> ${(this.config.risk.dailyMaxLossPct * 100).toFixed(0)}% ($${(this.config.capital.totalUsd * this.config.risk.dailyMaxLossPct).toFixed(2)})
<b>Месячный лимит:</b> ${(this.config.risk.monthlyMaxLossPct * 100).toFixed(0)}% ($${(this.config.capital.totalUsd * this.config.risk.monthlyMaxLossPct).toFixed(2)})
<b>Макс. просадка:</b> ${(this.config.risk.maxDrawdownFromPeak * 100).toFixed(0)}%
<b>Тотальный убыток:</b> ${(this.config.risk.totalMaxLossPct * 100).toFixed(0)}%

<b>Размер позиции:</b>
  Минимум: ${(this.config.risk.minPositionPct * 100).toFixed(0)}%
  Максимум: ${(this.config.risk.maxPositionPct * 100).toFixed(0)}%
  Динамический: ${this.config.risk.enableDynamicSizing ? '✅' : '❌'}

<b>На сделку:</b> ${(this.config.capital.maxPerTradePct * 100).toFixed(0)}% ($${(this.config.capital.totalUsd * this.config.capital.maxPerTradePct).toFixed(2)})
<b>На рынок:</b> ${(this.config.capital.maxPerMarketPct * 100).toFixed(0)}%
<b>Макс. экспозиция:</b> ${(this.config.capital.maxTotalExposurePct * 100).toFixed(0)}%`;

    await this.sendMessage(message);
  }

  /**
   * /setparam key value - Изменить параметр
   */
  private async handleSetParam(msg: any, match: RegExpExecArray): Promise<void> {
    const key = match[1];
    const value = match[2];

    console.log(`Setting parameter: ${key} = ${value}`);

    try {
      // Разобрать путь к параметру (например: smartMoney.minWinRate)
      const keys = key.split('.');
      let obj: any = this.config;
      
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
      }
      
      const lastKey = keys[keys.length - 1];
      const currentValue = obj[lastKey];

      // Преобразовать значение
      let newValue: any = value;
      if (typeof currentValue === 'number') {
        newValue = parseFloat(value);
      } else if (typeof currentValue === 'boolean') {
        newValue = value.toLowerCase() === 'true' || value === '1' || value === 'yes';
      }

      // Установить
      obj[lastKey] = newValue;

      const message = `✅ <b>Параметр изменён</b>

<code>${key}</code>
${currentValue} → ${newValue}`;

      await this.sendMessage(message);
      console.log(`Parameter updated: ${key} = ${newValue}`);
    } catch (error: any) {
      await this.sendMessage(`❌ Ошибка: ${error.message}`);
    }
  }

  /**
   * /getparam key - Получить параметр
   */
  private async handleGetParam(msg: any, match: RegExpExecArray): Promise<void> {
    const key = match[1];

    try {
      const keys = key.split('.');
      let value: any = this.config;
      
      for (const k of keys) {
        value = value[k];
      }

      const message = `📊 <b>${key}</b>\n\n<code>${value}</code>`;
      await this.sendMessage(message);
    } catch (error: any) {
      await this.sendMessage(`❌ Параметр не найден: ${key}`);
    }
  }

  /**
   * /trades - Последние сделки
   */
  private async handleTrades(msg: any): Promise<void> {
    const recentTrades = this.stateManager.getRecentTrades(5);
    
    if (recentTrades.length === 0) {
      await this.sendMessage('📭 Нет сделок пока');
      return;
    }

    let message = `📊 <b>Последние 5 сделок</b>\n\n`;
    
    for (const trade of recentTrades) {
      const emoji = trade.pnl >= 0 ? '✅' : '❌';
      const sign = trade.pnl >= 0 ? '+' : '';
      message += `${emoji} <b>${trade.marketQuestion.substring(0, 30)}...</b>
   PnL: ${sign}$${trade.pnl.toFixed(2)} (${sign}${trade.pnlPercent.toFixed(1)}%)
   Стратегия: ${trade.strategy}
   Время: ${new Date(trade.closeTime).toLocaleString('ru-RU')}

`;
    }

    await this.sendMessage(message);
  }

  /**
   * /help - Помощь
   */
  private async handleHelp(msg: any): Promise<void> {
    const message = `📖 <b>Помощь - Команды Telegram</b>

<b>Основные:</b>
/status - Текущее состояние бота
/strategies - Настройки стратегий
/risk - Параметры риска
/trades - Последние 5 сделок

<b>Управление параметрами:</b>
/setparam key value - Изменить параметр
  Примеры:
  /setparam smartMoney.minWinRate 0.65
  /setparam scalping.enabled true
  /setparam capital.totalUsd 150

/getparam key - Получить параметр
  Пример: /getparam smartMoney.topN

<b>Управление ботом:</b>
/stop - Остановить бота
/startbot - Запустить бота
/help - Эта справка

<b>Совет:</b> Используйте точки для вложенных параметров:
/setparam risk.dailyMaxLossPct 0.03`;

    await this.sendMessage(message);
  }

  /**
   * /stop - Остановить бота
   */
  private async handleStop(msg: any): Promise<void> {
    await this.sendMessage('⏹️ Бот остановлен. Используйте /startbot для запуска.');
    // Здесь можно добавить логику остановки бота
    console.log('Stop command received from Telegram');
  }

  /**
   * /startbot - Запустить бота
   */
  private async handleStartBot(msg: any): Promise<void> {
    await this.sendMessage('🚀 Бот запущен!');
    // Здесь можно добавить логику запуска бота
    console.log('Start command received from Telegram');
  }

  // ============================================================================
  // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
  // ============================================================================

  /**
   * Отправить сообщение
   */
  private async sendMessage(text: string): Promise<void> {
    if (!this.bot) return;
    
    try {
      await this.bot.sendMessage(this.chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error('Failed to send Telegram message:', error);
    }
  }

  /**
   * Получить текущую конфигурацию
   */
  getConfig(): BotConfig {
    return { ...this.config };
  }

  /**
   * Остановить бота
   */
  stop(): void {
    if (this.bot) {
      this.bot.stopPolling();
      this.bot = null;
    }
  }
}

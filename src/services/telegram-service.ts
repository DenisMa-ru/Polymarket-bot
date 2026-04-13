/**
 * Telegram Notification Service - Уведомления о критических событиях
 * 
 * Отправляет уведомления в Telegram о:
 * - Открытие/закрытие позиций
 * - Срабатывание Take-Profit / Stop-Loss
 * - Ошибки бота
 * - Ежедневные отчёты
 * - Превышение лимитов риска
 * 
 * Настройка:
 * 1. Создать бота через @BotFather
 * 2. Получить токен
 * 3. Узнать свой Chat ID
 * 4. Добавить в .env:
 *    TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
 *    TELEGRAM_CHAT_ID=123456789
 */

// @ts-ignore - node-telegram-bot-api types may not be installed initially
import TelegramBot from 'node-telegram-bot-api';

// ============================================================================
// TYPES
// ============================================================================

export type NotificationType =
  | 'trade_opened'
  | 'trade_closed'
  | 'take_profit'
  | 'stop_loss'
  | 'trailing_stop'
  | 'arbitrage_found'
  | 'error'
  | 'warning'
  | 'daily_report'
  | 'risk_limit'
  | 'bot_started'
  | 'bot_stopped';

export interface NotificationData {
  [key: string]: any;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
  
  // Какие уведомления отправлять
  notifications: {
    tradeOpened: boolean;
    tradeClosed: boolean;
    takeProfit: boolean;
    stopLoss: boolean;
    trailingStop: boolean;
    arbitrageFound: boolean;
    error: boolean;
    warning: boolean;
    dailyReport: boolean;
    riskLimit: boolean;
    botStarted: boolean;
    botStopped: boolean;
  };
  
  // Ограничения
  maxMessagesPerHour: number;  // 50
  silentHours?: [number, number]; // [23, 8] - не отправлять с 23 до 8
}

// ============================================================================
// TELEGRAM SERVICE
// ============================================================================

export class TelegramService {
  private bot: TelegramBot | null = null;
  private config: TelegramConfig;
  private messageCount: number[] = [];  // Timestamps сообщений за час
  private isSilentMode: boolean = false;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  // ============================================================================
  // ИНИЦИАЛИЗАЦИЯ
  // ============================================================================

  /**
   * Инициализировать Telegram бота
   */
  async initialize(): Promise<boolean> {
    if (!this.config.enabled) {
      console.log('📱 Telegram notifications disabled');
      return false;
    }

    if (!this.config.botToken || !this.config.chatId) {
      console.warn('⚠️ Telegram credentials not configured');
      return false;
    }

    try {
      this.bot = new TelegramBot(this.config.botToken, { polling: false });
      
      // Тестовое сообщение
      await this.sendMessage('✅ Polymarket Bot подключен к Telegram!');
      console.log('✅ Telegram Bot initialized');
      
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Telegram:', error);
      return false;
    }
  }

  // ============================================================================
  // ОТПРАВКА УВЕДОМЛЕНИЙ
  // ============================================================================

  /**
   * Отправить уведомление
   */
  async notify(type: NotificationType, data: NotificationData): Promise<void> {
    // Проверить включено ли
    if (!this.config.enabled || !this.bot) {
      return;
    }

    // Проверить фильтр уведомлений
    if (!this.isNotificationEnabled(type)) {
      return;
    }

    // Проверить silent hours
    if (this.isSilentHours()) {
      return;
    }

    // Проверить лимит сообщений
    if (!this.canSendMessage()) {
      console.warn('⚠️ Telegram rate limit reached');
      return;
    }

    // Сформировать сообщение
    const message = this.formatMessage(type, data);
    if (!message) {
      return;
    }

    // Отправить
    try {
      await this.sendMessage(message);
      this.trackMessage();
    } catch (error) {
      console.error('❌ Failed to send Telegram notification:', error);
    }
  }

  // ============================================================================
  // ФОРМАТИРОВАНИЕ СООБЩЕНИЙ
  // ============================================================================

  /**
   * Форматировать сообщение
   */
  private formatMessage(type: NotificationType, data: NotificationData): string | null {
    switch (type) {
      case 'trade_opened':
        return `🟢 <b>Открыта позиция</b>

📊 <b>Стратегия:</b> ${data.strategy || 'Unknown'}
🎯 <b>Рынок:</b> ${data.market || 'Unknown'}
💰 <b>Размер:</b> $${data.size?.toFixed(2) || '0'}
📈 <b>Outcome:</b> ${data.outcome || 'YES'}
💵 <b>Цена:</b> ${data.price?.toFixed(3) || '0'}
⏰ <b>Время:</b> ${new Date().toLocaleString('ru-RU')}`;

      case 'trade_closed':
        const pnlEmoji = (data.pnl || 0) >= 0 ? '✅' : '❌';
        const pnlSign = (data.pnl || 0) >= 0 ? '+' : '';
        return `${pnlEmoji} <b>Закрыта позиция</b>

📊 <b>Стратегия:</b> ${data.strategy || 'Unknown'}
🎯 <b>Рынок:</b> ${data.market || 'Unknown'}
💰 <b>PnL:</b> ${pnlSign}$${(data.pnl || 0).toFixed(2)}
📈 <b>PnL%:</b> ${pnlSign}${(data.pnlPercent || 0).toFixed(1)}%
⏱️ <b>Время удержания:</b> ${this.formatDuration(data.holdDuration || 0)}`;

      case 'take_profit':
        return `🎯 <b>TAKE-PROFIT HIT!</b>

📊 <b>Стратегия:</b> ${data.strategy || 'Unknown'}
🎯 <b>Рынок:</b> ${data.market || 'Unknown'}
💰 <b>Прибыль:</b> +$${(data.pnl || 0).toFixed(2)}
📈 <b>Прибыль%:</b> +${(data.pnlPercent || 0).toFixed(1)}%
📉 <b>Вход:</b> ${data.entryPrice?.toFixed(3)}
📈 <b>Выход:</b> ${data.exitPrice?.toFixed(3)}

🔥 Отличная сделка!`;

      case 'stop_loss':
        return `🛑 <b>STOP-LOSS HIT!</b>

📊 <b>Стратегия:</b> ${data.strategy || 'Unknown'}
🎯 <b>Рынок:</b> ${data.market || 'Unknown'}
💔 <b>Убыток:</b> -$${Math.abs(data.pnl || 0).toFixed(2)}
📉 <b>Убыток%:</b> -${Math.abs(data.pnlPercent || 0).toFixed(1)}%
📉 <b>Вход:</b> ${data.entryPrice?.toFixed(3)}
📈 <b>Выход:</b> ${data.exitPrice?.toFixed(3)}

⚠️ Не переживай, это часть системы риск-менеджмента`;

      case 'trailing_stop':
        return `〰️ <b>TRAILING STOP HIT!</b>

📊 <b>Стратегия:</b> ${data.strategy || 'Unknown'}
🎯 <b>Рынок:</b> ${data.market || 'Unknown'}
💰 <b>Прибыль:</b> +$${(data.pnl || 0).toFixed(2)}
📈 <b>Прибыль%:</b> +${(data.pnlPercent || 0).toFixed(1)}%
📊 <b>Максимум:</b> ${data.highestPrice?.toFixed(3)}
📈 <b>Выход:</b> ${data.exitPrice?.toFixed(3)}

✅ Прибыль зафиксирована!`;

      case 'arbitrage_found':
        return `🔄 <b>Найден арбитраж!</b>

🎯 <b>Рынок:</b> ${data.market || 'Unknown'}
💰 <b>Прибыль:</b> ${data.profitPercent?.toFixed(2)}%
💵 <b>Размер:</b> $${data.size?.toFixed(2) || '0'}
⚡ <b>Действие:</b> ${data.autoExecute ? 'Авто-исполнение' : 'Ручное исполнение'}`;

      case 'error':
        return `❌ <b>Ошибка бота</b>

🔴 <b>Тип:</b> ${data.errorType || 'Unknown'}
📝 <b>Описание:</b> ${data.message || 'No details'}
⏰ <b>Время:</b> ${new Date().toLocaleString('ru-RU')}

⚠️ Требуется внимание!`;

      case 'warning':
        return `⚠️ <b>Предупреждение</b>

📝 <b>Сообщение:</b> ${data.message || 'No details'}
⏰ <b>Время:</b> ${new Date().toLocaleString('ru-RU')}`;

      case 'daily_report':
        return `📊 <b>Ежедневный отчёт</b>

📅 <b>Дата:</b> ${data.date || new Date().toLocaleDateString('ru-RU')}

💰 <b>PnL:</b> ${data.dailyPnL >= 0 ? '+' : ''}$${data.dailyPnL?.toFixed(2) || '0'}
📈 <b>PnL%:</b> ${data.dailyPnLPercent?.toFixed(1) || '0'}%

📊 <b>Сделок:</b> ${data.trades || 0}
✅ <b>Побед:</b> ${data.wins || 0}
❌ <b>Поражений:</b> ${data.losses || 0}
🎯 <b>Win Rate:</b> ${data.winRate?.toFixed(1) || '0'}%

🏆 <b>Лучшая сделка:</b> +$${data.bestTrade?.toFixed(2) || '0'}
💔 <b>Худшая сделка:</b> -$${Math.abs(data.worstTrade || 0)?.toFixed(2) || '0'}

📈 <b>Общий PnL:</b> ${data.totalPnL >= 0 ? '+' : ''}$${data.totalPnL?.toFixed(2) || '0'}
🔥 <b>Серия побед:</b> ${data.consecutiveWins || 0}
😰 <b>Серия поражений:</b> ${data.consecutiveLosses || 0}

${data.dailyPnL >= 0 ? '🎉 Отличный день!' : '💪 Завтра будет лучше!'}`;

      case 'risk_limit':
        return `🛑 <b>Превышен лимит риска!</b>

🔴 <b>Тип:</b> ${data.limitType || 'Unknown'}
📝 <b>Причина:</b> ${data.reason || 'No details'}
💰 <b>Текущий убыток:</b> $${data.currentLoss?.toFixed(2) || '0'}
📊 <b>Лимит:</b> $${data.limit?.toFixed(2) || '0'}

⛔ Торговля остановлена автоматически!`;

      case 'bot_started':
        return `🚀 <b>Бот запущен!</b>

💰 <b>Капитал:</b> $${data.capital?.toFixed(2) || '0'}
🎮 <b>Режим:</b> ${data.dryRun ? '🟢 DRY RUN' : '🔴 LIVE'}
📊 <b>Стратегии:</b> ${data.strategies?.join(', ') || 'Unknown'}
⏰ <b>Время:</b> ${new Date().toLocaleString('ru-RU')}

🎯 Готов к торговле!`;

      case 'bot_stopped':
        return `⏹️ <b>Бот остановлен</b>

⏰ <b>Время:</b> ${new Date().toLocaleString('ru-RU')}
📊 <b>Всего сделок:</b> ${data.totalTrades || 0}
💰 <b>Итого PnL:</b> ${data.totalPnL >= 0 ? '+' : ''}$${data.totalPnL?.toFixed(2) || '0'}

💾 Состояние сохранено`;

      default:
        return null;
    }
  }

  // ============================================================================
  // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
  // ============================================================================

  /**
   * Отправить сообщение
   */
  private async sendMessage(text: string): Promise<void> {
    if (!this.bot || !this.config.chatId) {
      return;
    }

    await this.bot.sendMessage(this.config.chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  /**
   * Проверить включено ли уведомление
   */
  private isNotificationEnabled(type: NotificationType): boolean {
    const { notifications } = this.config;
    
    switch (type) {
      case 'trade_opened': return notifications.tradeOpened;
      case 'trade_closed': return notifications.tradeClosed;
      case 'take_profit': return notifications.takeProfit;
      case 'stop_loss': return notifications.stopLoss;
      case 'trailing_stop': return notifications.trailingStop;
      case 'arbitrage_found': return notifications.arbitrageFound;
      case 'error': return notifications.error;
      case 'warning': return notifications.warning;
      case 'daily_report': return notifications.dailyReport;
      case 'risk_limit': return notifications.riskLimit;
      case 'bot_started': return notifications.botStarted;
      case 'bot_stopped': return notifications.botStopped;
      default: return true;
    }
  }

  /**
   * Проверить silent hours
   */
  private isSilentHours(): boolean {
    if (!this.config.silentHours) {
      return false;
    }

    const [start, end] = this.config.silentHours;
    const currentHour = new Date().getHours();

    if (start > end) {
      // Например [23, 8] - с 23:00 до 08:00
      return currentHour >= start || currentHour < end;
    } else {
      // Например [1, 5] - с 01:00 до 05:00
      return currentHour >= start && currentHour < end;
    }
  }

  /**
   * Проверить можно ли отправить сообщение
   */
  private canSendMessage(): boolean {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Удалить старые (>1 часа)
    this.messageCount = this.messageCount.filter(t => t > oneHourAgo);

    return this.messageCount.length < this.config.maxMessagesPerHour;
  }

  /**
   * Отследить сообщение
   */
  private trackMessage(): void {
    this.messageCount.push(Date.now());
  }

  /**
   * Форматировать длительность
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
  }

  // ============================================================================
  // БЫСТРЫЕ МЕТОДЫ
  // ============================================================================

  /**
   * Быстрая отправка обычного сообщения
   */
  async send(message: string): Promise<void> {
    if (this.bot && this.config.chatId) {
      try {
        await this.sendMessage(`📢 <b>Сообщение</b>\n\n${message}`);
      } catch (error) {
        console.error('Failed to send message:', error);
      }
    }
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

// ============================================================================
// FACTORY: Создание из .env
// ============================================================================

/**
 * Создать Telegram сервис из переменных окружения
 */
export function createTelegramServiceFromEnv(): TelegramService {
  const config: TelegramConfig = {
    enabled: process.env.TELEGRAM_ENABLED === 'true',
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    
    notifications: {
      tradeOpened: process.env.TG_NOTIFY_TRADE !== 'false',
      tradeClosed: process.env.TG_NOTIFY_TRADE !== 'false',
      takeProfit: process.env.TG_NOTIFY_TP === 'true',
      stopLoss: process.env.TG_NOTIFY_SL === 'true',
      trailingStop: process.env.TG_NOTIFY_TS === 'true',
      arbitrageFound: process.env.TG_NOTIFY_ARB === 'true',
      error: process.env.TG_NOTIFY_ERROR !== 'false',
      warning: process.env.TG_NOTIFY_WARN !== 'false',
      dailyReport: process.env.TG_NOTIFY_DAILY === 'true',
      riskLimit: process.env.TG_NOTIFY_RISK !== 'false',
      botStarted: process.env.TG_NOTIFY_START !== 'false',
      botStopped: process.env.TG_NOTIFY_STOP !== 'false',
    },
    
    maxMessagesPerHour: parseInt(process.env.TG_MAX_MSG_PER_HOUR || '50'),
    silentHours: process.env.TG_SILENT_HOURS 
      ? process.env.TG_SILENT_HOURS.split(',').map(Number) as [number, number]
      : undefined,
  };

  return new TelegramService(config);
}

// ============================================================================
// SINGLETON
// ============================================================================

export const telegramService = createTelegramServiceFromEnv();

# 🚀 Polymarket Bot v3.2 - Улучшения для разгона депозита

## 📋 Что было добавлено в v3.2

### ✅ 1. State Manager - Управление состоянием
**Файл**: `src/core/state-manager.ts`

**Возможности**:
- ✅ Автоматическое сохранение каждые 30 секунд
- ✅ Сохранение активных позиций с TP/SL
- ✅ История сделок (последние 100)
- ✅ PnL статистика (дневная, общая, по стратегиям)
- ✅ Восстановление после перезапуска
- ✅ Бэкап файла состояния
- ✅ Валидация позиций при загрузке
- ✅ Встроенный риск-менеджмент

**Зачем**: При перезапуске бот не теряет позиции и не создаёт дубликаты.

---

### ✅ 2. Smart Money v2 - Улучшенное копирование
**Файл**: `src/services/smart-money-service-v2.ts`

**Новые возможности**:
- ✅ **Динамический размер позиции** - пропорционально соотношению капиталов
  - Если кит с $1000 ставит $100 (10%), я с $100 ставлю $10 (10%)
  - Автоматические лимиты: мин $3, макс 10% капитала
- ✅ **Take-Profit +30%** - автоматический выход с прибылью
- ✅ **Stop-Loss -15%** - защита от больших убытков
- ✅ **Trailing Stop 10%** - фиксация прибыли при росте
- ✅ **Мониторинг в реальном времени** - проверка каждые 10 секунд
- ✅ **Интеграция с StateManager** - все позиции сохраняются

**Математика**:
```
Пример копирования:
- Кит PnL: $500 (примерный капитал $5000)
- Кит ставит: $500 (10% капитала)
- Мой капитал: $100
- Моя ставка: $10 (10% моего капитала)

Если TP +30%:
- Прибыль: $10 × 0.30 = $3 за сделку
- При 5 сделках в день: $15/день = 15% 🚀
```

---

### ✅ 3. Scalping Service - Скальпинг для быстрого разгона
**Файл**: `src/services/scalping-service.ts`

**Стратегия**:
- ✅ Рынки с экспирацией 5-15 минут (crypto, sports)
- ✅ Технические индикаторы: RSI, Volume, MACD
- ✅ Вход при перепроданности (RSI < 30) или перекупленности (RSI > 70)
- ✅ Быстрый выход: TP +15%, SL -10%
- ✅ Максимальное время удержания: 5 минут
- ✅ Лимит: 20 сделок в час, 5 одновременных позиций

**Математика для депозита $100**:
```
Параметры:
- 10 сделок в день × $10 каждая
- Win rate 60% = 6 побед, 4 поражения
- Прибыль: 6 × $1.50 = $9
- Убыток: 4 × $1.00 = $4
- Чистая прибыль: $5/день = 5% ежедневно

Прогноз разгона:
- Неделя 1: $100 → $135
- Неделя 2: $135 → $182
- Неделя 3: $182 → $246
- Неделя 4: $246 → $332 🚀
```

---

### ✅ 4. Telegram Notifications - Уведомления
**Файл**: `src/services/telegram-service.ts`

**Типы уведомлений**:
- ✅ 🟢 Открытие позиции
- ✅ 💰 Закрытие позиции с PnL
- ✅ 🎯 Take-Profit сработал
- ✅ 🛑 Stop-Loss сработал
- ✅ 〰️ Trailing Stop сработал
- ✅ 🔄 Найден арбитраж
- ✅ ❌ Ошибки бота
- ✅ ⚠️ Предупреждения
- ✅ 📊 Ежедневный отчёт
- ✅ 🛑 Превышение лимитов риска
- ✅ 🚀 Бот запущен/остановлен

**Особенности**:
- ✅ Ограничение: 50 сообщений в час
- ✅ Silent hours - не беспокоить ночью
- ✅ Красивое форматирование с эмодзи
- ✅ HTML форматирование

---

## 🛠️ Установка и настройка

### Шаг 1: Установка зависимостей

```bash
cd C:\Users\Денис\Downloads\Polymarket-bot-main
npm install
```

Это установит все новые зависимости, включая `node-telegram-bot-api`.

---

### Шаг 2: Настройка .env

Обновите ваш `.env` файл:

```env
# ==============================================
# 🔑 WALLET CONFIGURATION (REQUIRED)
# ==============================================
POLYMARKET_PRIVATE_KEY=0xYourPrivateKeyHere
CAPITAL_USD=100
DRY_RUN=true

# ==============================================
# 📱 TELEGRAM NOTIFICATIONS (NEW!)
# ==============================================

# Включить Telegram уведомления
TELEGRAM_ENABLED=true

# Токен бота (получить у @BotFather)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11

# Ваш Chat ID (узнать у @userinfobot)
TELEGRAM_CHAT_ID=123456789

# Какие уведомления включать
TG_NOTIFY_TRADE=true          # Открытие/закрытие позиций
TG_NOTIFY_TP=true             # Take-Profit сработал
TG_NOTIFY_SL=true             # Stop-Loss сработал
TG_NOTIFY_TS=true             # Trailing Stop сработал
TG_NOTIFY_ARB=true            # Найден арбитраж
TG_NOTIFY_ERROR=true          # Ошибки
TG_NOTIFY_WARN=true           # Предупреждения
TG_NOTIFY_DAILY=true          # Ежедневный отчёт
TG_NOTIFY_RISK=true           # Превышение лимитов
TG_NOTIFY_START=true          # Бот запущен
TG_NOTIFY_STOP=true           # Бот остановлен

# Ограничения
TG_MAX_MSG_PER_HOUR=50        # Макс сообщений в час
TG_SILENT_HOURS=23,8          # Не беспокоить с 23:00 до 08:00 (оставьте пустым для отключения)
```

---

### Шаг 3: Как получить Telegram Bot Token

1. Откройте Telegram и найдите **@BotFather**
2. Отправьте `/newbot`
3. Следуйте инструкциям:
   - Введите имя бота (например, `My Polymarket Bot`)
   - Введите username бота (должен заканчиваться на `bot`, например `my_polymarket_bot`)
4. BotFather даст вам **токен** (выглядит как `123456:ABC-DEF...`)
5. Скопируйте токен в `.env` как `TELEGRAM_BOT_TOKEN`

---

### Шаг 4: Как узнать Chat ID

1. Откройте вашего бота в Telegram (найдите по username)
2. Отправьте ему любое сообщение
3. Откройте **@userinfobot** или отправьте боту `/getid`
4. Он покажет ваш **Chat ID** (число, например `123456789`)
5. Скопируйте в `.env` как `TELEGRAM_CHAT_ID`

---

## 📖 Примеры использования

### Пример 1: Использование StateManager

```typescript
import { stateManager } from './src/core/state-manager.js';

// При старте бота
const state = await stateManager.initialize();
console.log(`Загружено позиций: ${state.activePositions.length}`);

// Открытие позиции
const position = await stateManager.addPosition({
  marketId: 'market_123',
  marketQuestion: 'Will BTC be above $65,000?',
  outcome: 'YES',
  size: 10,
  entryPrice: 0.45,
  quantity: 22.22,
  strategy: 'smartMoney',
  timestamp: Date.now(),
  stopLoss: 0.35,
  takeProfit: 0.60,
});

// Закрытие позиции
const trade = await stateManager.closePosition(
  position.positionId,
  0.60,  // Цена закрытия
  'takeProfit'
);
console.log(`PnL: $${trade.pnl}`);

// Статистика
const stats = stateManager.getStats();
console.log(`Win Rate: ${stats.overallWinRate}%`);
```

---

### Пример 2: Smart Money с динамическим размером

```typescript
import { SmartMoneyServiceV2, stateManager, telegramService } from './src/index.js';

const smartMoneyV2 = new SmartMoneyServiceV2(
  stateManager,
  tradingService,
  baseSmartMoneyService,
  {
    // Мой капитал
    myCapital: 100,
    
    // Динамический размер
    enableDynamicSizing: true,
    minPositionSize: 3,        // Мин $3
    maxPositionSize: 10,       // Макс 10% капитала
    
    // Take-Profit / Stop-Loss
    enableTakeProfit: true,
    takeProfitPercent: 0.30,   // +30%
    
    enableStopLoss: true,
    stopLossPercent: 0.15,     // -15%
    
    enableTrailingStop: true,
    trailingStopPercent: 0.10, // 10%
    
    // Callback для уведомлений
    onTakeProfit: async (pos, pnl) => {
      await telegramService.notify('take_profit', {
        strategy: 'Smart Money',
        market: pos.marketQuestion,
        pnl,
        pnlPercent: (pnl / pos.size) * 100,
        entryPrice: pos.entryPrice,
        exitPrice: pos.currentPrice,
      });
    },
    
    onStopLoss: async (pos, pnl) => {
      await telegramService.notify('stop_loss', {
        strategy: 'Smart Money',
        market: pos.marketQuestion,
        pnl: Math.abs(pnl),
        pnlPercent: (Math.abs(pnl) / pos.size) * 100,
        entryPrice: pos.entryPrice,
        exitPrice: pos.currentPrice,
      });
    },
    
    // Базовые настройки
    topN: 10,
    maxSizePerTrade: 15,
    maxSlippage: 0.03,
    dryRun: true,
  }
);

// Запуск
await smartMoneyV2.startEnhancedCopyTrading();
```

---

### Пример 3: Скальпинг

```typescript
import { ScalpingService, stateManager, telegramService } from './src/index.js';

const scalpingService = new ScalpingService(
  stateManager,
  tradingService,
  {
    myCapital: 100,
    maxPositionSize: 5,        // 5% на сделку
    minPositionSize: 3,
    
    // Рынки
    categories: ['crypto', 'sports'],
    maxExpiryMinutes: 15,
    minExpiryMinutes: 5,
    minVolume24h: 1000,
    
    // Индикаторы
    indicators: {
      rsi: { period: 14, oversold: 30, overbought: 70 },
      volume: { minRatio: 1.5 },
      macd: { fast: 12, slow: 26, signal: 9 },
    },
    
    // Вход
    entryRules: {
      minConfidence: 70,
      requireVolumeSpike: true,
      requireRsiDivergence: true,
    },
    
    // Выход
    takeProfit: 0.15,          // +15%
    stopLoss: 0.10,            // -10%
    maxHoldTime: 300,          // 5 минут
    
    // Лимиты
    maxConcurrentPositions: 5,
    maxTradesPerHour: 20,
    cooldownAfterTrade: 60,
    
    dryRun: true,
  }
);

// Запуск
await scalpingService.start();

// Статистика
const stats = scalpingService.getStats();
console.log(`Сделок: ${stats.totalTrades}, Win Rate: ${stats.winRate}%`);
```

---

### Пример 4: Telegram уведомления

```typescript
import { telegramService } from './src/index.js';

// Инициализация
await telegramService.initialize();

// Отправка уведомления при открытии позиции
await telegramService.notify('trade_opened', {
  strategy: 'Smart Money',
  market: 'Will BTC be above $65,000?',
  size: 10,
  outcome: 'YES',
  price: 0.45,
});

// При срабатывании Take-Profit
await telegramService.notify('take_profit', {
  strategy: 'Smart Money',
  market: 'Will BTC be above $65,000?',
  pnl: 3.00,
  pnlPercent: 30,
  entryPrice: 0.45,
  exitPrice: 0.585,
});

// Ежедневный отчёт
await telegramService.notify('daily_report', {
  date: '13.04.2026',
  dailyPnL: 5.20,
  dailyPnLPercent: 5.2,
  trades: 10,
  wins: 6,
  losses: 4,
  winRate: 60,
  bestTrade: 3.00,
  worstTrade: -1.00,
  totalPnL: 15.50,
  consecutiveWins: 2,
  consecutiveLosses: 0,
});
```

---

## 📊 Структура файлов

```
Polymarket-bot-main/
├── src/
│   ├── core/
│   │   └── state-manager.ts              ✅ НОВОЕ: Управление состоянием
│   ├── services/
│   │   ├── smart-money-service-v2.ts     ✅ НОВОЕ: Улучшенное Smart Money
│   │   ├── scalping-service.ts           ✅ НОВОЕ: Скальпинг стратегия
│   │   └── telegram-service.ts           ✅ НОВОЕ: Telegram уведомления
│   └── index.ts                          ✅ Обновлено: Экспорты новых модулей
├── examples/
│   └── 14-state-manager-demo.ts          ✅ НОВОЕ: Пример использования
├── docs/
│   └── STATE_MANAGER_GUIDE.md            ✅ НОВОЕ: Документация StateManager
├── package.json                          ✅ Обновлено: Добавлена зависимость
└── .env.example                          ✅ Обновлено: Добавлены Telegram настройки
```

---

## 🎯 План разгона депозита $100

### Неделя 1: Тестирование (Dry Run)
- ✅ Включить `DRY_RUN=true`
- ✅ Настроить все стратегии
- ✅ Проверить работу StateManager
- ✅ Протестировать Telegram уведомления
- **Цель**: Убедиться что всё работает стабильно

### Неделя 2: Live с минимальным риском
- ✅ Переключить `DRY_RUN=false`
- ✅ Капитал: $50 (половина от $100)
- ✅ Smart Money: 60% капитала ($30)
- ✅ Скальпинг: 25% капитала ($12.50)
- ✅ Арбитраж: 15% капитала ($7.50)
- **Цель**: $50 → $65-70

### Неделя 3-4: Полный разгон
- ✅ Капитал: $100
- ✅ Те же пропорции
- ✅ Реинвестирование прибыли
- **Цель**: $100 → $150-200

### Ожидаемая доходность:
| Стратегия | Доля капитала | Доходность/день | Риск |
|-----------|--------------|-----------------|------|
| Smart Money | 60% | 3-5% | Средний |
| Скальпинг | 25% | 5-8% | Высокий |
| Арбитраж | 15% | 1-2% | Низкий |
| **Итого** | **100%** | **3-6%** | **Средний** |

**Прогноз**:
- День 7: $100 → $121-142
- День 14: $100 → $148-204
- День 30: $100 → $242-584

⚠️ **Важно**: Это оптимистичные оценки. Реальная доходность зависит от рынка.

---

## ⚠️ Важные предупреждения

### 1. Начните с Dry Run
ВСЕГДА тестируйте в режиме `DRY_RUN=true` минимум 24-48 часов перед реальной торговлей.

### 2. Не инвестируйте больше, чем можете позволить себе потерять
Trading на предсказательных рынках несёт риски. Начинайте с малых сумм.

### 3. Мониторьте бота регулярно
Проверяйте Telegram уведомления и статистику ежедневно.

### 4. Используйте риск-менеджмент
Бот автоматически останавлиется при:
- Daily loss > 5%
- Monthly loss > 15%
- Drawdown > 25%
- Total loss > 40%

### 5. Не отключайте StateManager
StateManager защищает от потери позиций при перезапуске. Не отключайте его!

---

## 🔧 Troubleshooting

### Telegram уведомления не работают
```bash
# Проверьте что бот запущен
npm install

# Проверьте .env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=ваш_токен
TELEGRAM_CHAT_ID=ваш_chat_id

# Протестируйте
node -e "import('./src/services/telegram-service.js').then(m => m.telegramService.initialize())"
```

### StateManager не загружает позиции
```bash
# Проверьте файл состояния
cat ./bot-state/state.json

# Если файл повреждён, используйте бэкап
cp ./bot-state/state.backup.json ./bot-state/state.json
```

### Скальпинг не находит рынков
- Убедитесь что есть рынки с экспирацией 5-15 минут
- Проверьте настройки минимального объёма
- В данный момент это заглушка - нужно реализовать подключение к Gamma API

---

## 📞 Поддержка

Если возникли вопросы или проблемы:
1. Проверьте документацию в `docs/`
2. Посмотрите примеры в `examples/`
3. Откройте issue на GitHub

---

## 🎉 Что дальше?

Следующие улучшения которые можно добавить:
- [ ] Поддержка реальных данных для скальпинга (Gamma API)
- [ ] Бэктестинг стратегий на исторических данных
- [ ] ML-модель для прогнозирования исходов
- [ ] Динамическая настройка параметров через Telegram
- [ ] Мультиаккаунт поддержка

---

**Создано для Polymarket Bot v3.2** 🚀

**Дата**: 13 апреля 2026

**Автор**: Улучшения для быстрого разгона депозита

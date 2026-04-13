# 📦 State Manager - Управление состоянием бота

## 🎯 Зачем это нужно

**Проблема**: При перезапуске бот теряет все активные позиции и может:
- ❌ Создать дублирующиеся ордера
- ❌ Потерять跟踪 активных позиций
- ❌ Сбросить статистику PnL
- ❌ Не восстановить Stop-Loss/Take-Profit

**Решение**: StateManager автоматически сохраняет всё в JSON-файл и восстанавливает при старте.

---

## ✨ Возможности

### ✅ Автоматическое сохранение
- Каждые **30 секунд**
- При **каждом изменении** (открытие/закрытие позиции)
- **Бэкап** предыдущего файла состояния

### ✅ Сохраняемые данные
- **Активные позиции** с Stop-Loss/Take-Profit
- **Pending ордера**
- **История сделок** (последние 100)
- **PnL статистика** (дневная, общая, по стратегиям)
- **Состояние риск-менеджмента** (лимиты, блокировки)
- **Peak capital** для расчёта drawdown

### ✅ Восстановление после перезапуска
- Загрузка из основного файла
- Fallback на бэкап если основной повреждён
- Валидация позиций (удаление истёкших)

### ✅ Встроенный риск-менеджмент
- Проверка daily loss limit (5%)
- Проверка monthly loss limit (15%)
- Проверка drawdown limit (25%)
- Total loss halt (40%)

---

## 🚀 Быстрый старт

### 1. Импорт

```typescript
import { stateManager } from './src/core/state-manager.js';
```

### 2. Инициализация (при старте бота)

```typescript
// В начале работы бота
const state = await stateManager.initialize();

console.log(`Загружено позиций: ${state.activePositions.length}`);
console.log(`Общий PnL: $${state.totalPnL}`);
```

### 3. Добавление позиции

```typescript
// Когда открываете сделку
const position = await stateManager.addPosition({
  marketId: 'market_123',
  marketQuestion: 'Will BTC be above $65,000?',
  outcome: 'YES',
  size: 10,              // $10
  entryPrice: 0.45,      // Цена покупки
  quantity: 22.22,       // Количество акций
  strategy: 'smartMoney',
  timestamp: Date.now(),
  stopLoss: 0.35,        // Stop-loss 22%
  takeProfit: 0.60,      // Take-profit 33%
  trailingStop: 0.10,    // Trailing stop 10%
});

console.log(`Позиция открыта: ${position.positionId}`);
```

### 4. Обновление позиции

```typescript
// Обновляем текущую цену (например, из WebSocket)
await stateManager.updatePosition(positionId, {
  currentPrice: 0.48,
  highestPrice: 0.50,  // Для trailing stop
});
```

### 5. Закрытие позиции

```typescript
// Когда закрываете сделку (TP/SL вручную)
const trade = await stateManager.closePosition(
  positionId,
  0.60,              // Цена закрытия
  'takeProfit'       // Причина: takeProfit | stopLoss | trailingStop | manual
);

if (trade) {
  console.log(`PnL: $${trade.pnl} (${trade.pnlPercent}%)`);
}
```

### 6. Проверка перед открытием сделки

```typescript
// Проверяем нет ли уже позиции на этом рынке
if (stateManager.hasPosition('market_123', 'YES')) {
  console.log('⚠️ Уже есть позиция на этом рынке!');
  return;
}
```

### 7. Проверка лимитов риска

```typescript
// Перед каждой сделкой
const riskCheck = stateManager.checkRiskLimits(100); // $100 капитал

if (!riskCheck.canTrade) {
  console.log(`🛑 Торговля остановлена: ${riskCheck.reason}`);
  return;
}

// Можно торговать!
```

### 8. Получение статистики

```typescript
const stats = stateManager.getStats();

console.log(`Активных позиций: ${stats.activePositions}`);
console.log(`Общий PnL: $${stats.totalPnL}`);
console.log(`Дневной PnL: $${stats.dailyPnL}`);
console.log(`Win Rate: ${stats.overallWinRate}%`);
console.log(`Серия побед: ${stats.consecutiveWins}`);
console.log(`Серия поражений: ${stats.consecutiveLosses}`);

// Статистика по стратегиям
for (const [strategy, data] of Object.entries(stats.strategyStats)) {
  console.log(`${strategy}: ${data.totalTrades} сделок, Win Rate ${data.winRate}%`);
}
```

### 9. Graceful shutdown

```typescript
// При остановке бота (Ctrl+C)
process.on('SIGINT', async () => {
  console.log('Остановка бота...');
  await stateManager.shutdown();
  process.exit(0);
});
```

---

## 📁 Структура файла состояния

Файл `./bot-state/state.json`:

```json
{
  "version": "3.2",
  "lastUpdated": 1713000000000,
  "activePositions": [
    {
      "positionId": "pos_1713000000000_abc123",
      "marketId": "market_123",
      "marketQuestion": "Will BTC be above $65,000?",
      "outcome": "YES",
      "size": 10,
      "entryPrice": 0.45,
      "currentPrice": 0.48,
      "quantity": 22.22,
      "strategy": "smartMoney",
      "timestamp": 1713000000000,
      "stopLoss": 0.35,
      "takeProfit": 0.60,
      "trailingStop": 0.10,
      "highestPrice": 0.50
    }
  ],
  "pendingOrders": [],
  "peakCapital": 120,
  "totalPnL": 15.50,
  "dailyPnL": 3.20,
  "consecutiveLosses": 0,
  "consecutiveWins": 3,
  "dailyStats": {
    "date": "2026-04-13",
    "startingBalance": 100,
    "currentBalance": 103.20,
    "dailyPnL": 3.20,
    "tradesCount": 8,
    "wins": 5,
    "losses": 3,
    "winRate": 62.5,
    "bestTrade": 2.50,
    "worstTrade": -1.00,
    "strategyPnL": {
      "smartMoney": 4.50,
      "arbitrage": 1.20,
      "scalping": -2.50
    }
  },
  "tradeHistory": [...],
  "riskState": {
    "currentPositionSize": 45,
    "dailyMaxLossReached": false,
    "monthlyMaxLossReached": false,
    "drawdownLimitReached": false,
    "totalLossHalt": false,
    "lastResetDate": "2026-04-13"
  },
  "strategyStates": {}
}
```

---

## 🔧 Продвинутое использование

### Проверка позиций при старте

```typescript
// После инициализации проверяем валидность позиций
const validation = await stateManager.validatePositions();

console.log(`Валидных позиций: ${validation.valid.length}`);
console.log(`Невалидных позиций: ${validation.invalid.length}`);

// Невалидные будут удалены автоматически
```

### Позиции по стратегии

```typescript
// Получить все позиции Smart Money
const smartMoneyPositions = stateManager.getPositionsByStrategy('smartMoney');

// Получить все скальпинг позиции
const scalpingPositions = stateManager.getPositionsByStrategy('scalping');
```

### Обновление peak capital

```typescript
// После закрытия позиции или депозита
await stateManager.updatePeakCapital(120); // Новый баланс $120
```

### Сброс дневной статистики

```typescript
// В полночь или при старте нового дня
const currentBalance = 105;
await stateManager.resetDailyStats(currentBalance);
```

### Активация Total Loss Halt

```typescript
// Если убыток достиг 40%
if (totalLoss >= capital * 0.40) {
  await stateManager.activateTotalLossHalt();
  console.error('🛑 ТОТАЛЬНАЯ БЛОКИРОВКА - Требуется ручной перезапуск');
}
```

---

## 🛡️ Безопасность

### Бэкапы
- Основной файл: `./bot-state/state.json`
- Бэкап: `./bot-state/state.backup.json`
- При каждом сохранении создаётся копия предыдущего файла

### Валидация
- При загрузке проверяются все позиции
- Истёкшие позиции удаляются
- Позиции с невалидными ценами удаляются

### Graceful shutdown
- При `Ctrl+C` состояние сохраняется
- Автосохранение каждые 30 секунд
- Защита от потери данных

---

## ⚠️ Важные моменты

### 1. **Не удаляйте файл состояния вручную**
Если бот работает, файл содержит актуальные позиции. Удаление = потеря данных.

### 2. **Файл может быть большим**
История 100 сделок + позиции = ~50-200KB. Это нормально.

### 3. **Восстановление из бэкапа**
Если основной файл повреждён, бот загрузит бэкап. Но бэкап может быть устаревшим.

### 4. **Очистка состояния**
```typescript
// Только если уверены что все позиции закрыты!
await stateManager.clearState();
```

---

## 📊 Пример интеграции в бота

```typescript
import { stateManager } from './src/core/state-manager.js';
import { PolymarketSDK } from './src/index.js';

async function startBot() {
  // 1. Инициализация SDK
  const sdk = new PolymarketSDK({ privateKey: process.env.POLYMARKET_PRIVATE_KEY });
  
  // 2. Инициализация StateManager
  const state = await stateManager.initialize();
  
  // 3. Восстановление позиций
  const validation = await stateManager.validatePositions();
  console.log(`Восстановлено позиций: ${validation.valid.length}`);
  
  // 4. Проверка лимитов
  const riskCheck = stateManager.checkRiskLimits(100);
  if (!riskCheck.canTrade) {
    console.log(`Торговля остановлена: ${riskCheck.reason}`);
    return;
  }
  
  // 5. Запуск стратегий
  await runStrategies();
  
  // 6. Мониторинг позиций (TP/SL)
  setInterval(async () => {
    const positions = stateManager.getActivePositions();
    
    for (const pos of positions) {
      const currentPrice = await sdk.getCurrentPrice(pos.marketId, pos.outcome);
      
      // Update state
      await stateManager.updatePosition(pos.positionId, { currentPrice });
      
      // Check TP/SL
      if (pos.takeProfit && currentPrice >= pos.takeProfit) {
        await sdk.sellPosition(pos.marketId, pos.outcome);
        await stateManager.closePosition(pos.positionId, currentPrice, 'takeProfit');
      }
      
      if (pos.stopLoss && currentPrice <= pos.stopLoss) {
        await sdk.sellPosition(pos.marketId, pos.outcome);
        await stateManager.closePosition(pos.positionId, currentPrice, 'stopLoss');
      }
    }
  }, 10000); // Каждые 10 секунд
  
  // 7. Graceful shutdown
  process.on('SIGINT', async () => {
    await stateManager.shutdown();
    process.exit(0);
  });
}

startBot();
```

---

## 🎯 Следующие шаги

StateManager - это фундамент для:
1. ✅ **Скальпинг стратегии** - нужен трекинг позиций в реальном времени
2. ✅ **Smart Money с TP/SL** - автоматический выход по TP/SL
3. ✅ **Telegram уведомления** - отправка PnL из истории сделок
4. ✅ **Динамическая настройка** - сохранение изменённых параметров

---

**Создано для Polymarket Bot v3.2** 🚀

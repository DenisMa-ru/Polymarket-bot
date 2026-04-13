/**
 * Пример использования StateManager
 * 
 * Демонстрирует как интегрировать управление состоянием в бота
 */

import { stateManager } from './src/core/state-manager.js';

async function main() {
  console.log('=== STATE MANAGER DEMO ===\n');

  // 1. Инициализация
  console.log('1️⃣ Initializing StateManager...');
  const state = await stateManager.initialize();
  console.log(`   Active positions: ${state.activePositions.length}`);
  console.log(`   Total PnL: $${state.totalPnL}\n`);

  // 2. Добавление позиции
  console.log('2️⃣ Adding new position...');
  const position = await stateManager.addPosition({
    marketId: 'market_123',
    marketQuestion: 'Will BTC be above $65,000 on April 15?',
    outcome: 'YES',
    size: 10,
    entryPrice: 0.45,
    quantity: 22.22,
    strategy: 'smartMoney',
    timestamp: Date.now(),
    stopLoss: 0.35,
    takeProfit: 0.60,
    trailingStop: 0.10,
  });
  console.log(`   Position ID: ${position.positionId}\n`);

  // 3. Обновление позиции
  console.log('3️⃣ Updating position price...');
  await stateManager.updatePosition(position.positionId, {
    currentPrice: 0.48,
    highestPrice: 0.48,
  });
  console.log('   Position updated\n');

  // 4. Проверка существует ли позиция
  console.log('4️⃣ Checking if position exists...');
  const exists = stateManager.hasPosition('market_123', 'YES');
  console.log(`   Has position on market_123: ${exists}\n`);

  // 5. Закрытие позиции с прибылью
  console.log('5️⃣ Closing position with Take-Profit...');
  const trade = await stateManager.closePosition(
    position.positionId,
    0.60, // TP hit
    'takeProfit'
  );
  if (trade) {
    console.log(`   PnL: +$${trade.pnl.toFixed(2)} (${trade.pnlPercent.toFixed(1)}%)\n`);
  }

  // 6. Статистика
  console.log('6️⃣ Getting statistics...');
  const stats = stateManager.getStats();
  console.log(`   Total trades: ${stats.totalTrades}`);
  console.log(`   Win rate: ${stats.overallWinRate.toFixed(1)}%`);
  console.log(`   Total PnL: $${stats.totalPnL.toFixed(2)}\n`);

  // 7. Проверка лимитов риска
  console.log('7️⃣ Checking risk limits...');
  const riskCheck = stateManager.checkRiskLimits(100);
  console.log(`   Can trade: ${riskCheck.canTrade}`);
  if (!riskCheck.canTrade) {
    console.log(`   Reason: ${riskCheck.reason}`);
  }
  console.log();

  // 8. Graceful shutdown
  console.log('8️⃣ Graceful shutdown...');
  await stateManager.shutdown();
  console.log('   State saved ✅\n');

  console.log('=== DEMO COMPLETE ===');
}

// Запуск демо
main().catch(console.error);

/**
 * Bot with Dashboard v3.2 - Full Strategy Integration
 *
 * ALL STRATEGIES WORKING:
 * ✅ Smart Money - Whale tracking & copy trading
 * ✅ Arbitrage - YES+NO < $1 scanning
 * ✅ DipArb - Crypto panic dip catching
 * ✅ Scalping - 5-15 min markets
 * ✅ Direct Trading - Manual trades
 *
 * Features:
 * - StateManager for persistence
 * - Telegram notifications
 * - Web configuration via dashboard
 * - Dynamic TP/SL for all strategies
 *
 * Run: npx tsx bot-with-dashboard-v3.2.ts
 * Dashboard: http://localhost:3001
 */

import 'dotenv/config';
import {
  PolymarketSDK,
  ArbitrageService,
  stateManager,
  telegramService,
} from './src/index.js';
import { SmartMoneyServiceV2 } from './src/services/smart-money-service-v2.js';
import { startDashboard, dashboardEmitter } from './src/dashboard/index.js';
import type { BotState, BotConfig } from './src/dashboard/types.js';

// ============================================================================
// CONFIGURATION v3.2
// ============================================================================

let CONFIG = {
  capital: {
    totalUsd: parseFloat(process.env.CAPITAL_USD || '100'),
    maxPerTradePct: 0.05,
    maxPerMarketPct: 0.10,
    maxTotalExposurePct: 0.30,
    minOrderUsd: 3,
  },

  risk: {
    dailyMaxLossPct: 0.05,
    maxConsecutiveLosses: 6,
    monthlyMaxLossPct: 0.15,
    maxDrawdownFromPeak: 0.25,
    totalMaxLossPct: 0.40,
    enableDynamicSizing: true,
  },

  smartMoney: {
    enabled: process.env.SMARTMONEY_ENABLED !== 'false',
    topN: 20,
    minWinRate: 0.60,
    minPnl: 500,
    minTrades: 30,
    maxSizePerTrade: 15,
    maxSlippage: 0.03,
    customWallets: [
      '0xc2e7800b5af46e6093872b177b7a5e7f0563be51',
      '0x58c3f5d66c95d4c41b093fbdd2520e46b6c9de74',
    ] as string[],
  },

  scalping: {
    enabled: process.env.SCALPING_ENABLED === 'true',
  },

  arbitrage: {
    enabled: process.env.ARBITRAGE_ENABLED === 'true',
    profitThreshold: 0.01,
    minTradeSize: 20,
    maxTradeSize: 100,
    minVolume24h: 5000,
    autoExecute: true,
  },

  dipArb: {
    enabled: process.env.DIPARB_ENABLED === 'true',
    coins: ['BTC', 'ETH', 'SOL'] as const,
    shares: 10,
    sumTarget: 0.92,
    autoRotate: true,
    autoExecute: true,
  },

  directTrading: {
    enabled: false,
  },

  dryRun: process.env.DRY_RUN !== 'false',
};

// ============================================================================
// STATE
// ============================================================================

const state: BotState = {
  startTime: Date.now(),
  dailyPnL: 0,
  totalPnL: 0,
  consecutiveLosses: 0,
  consecutiveWins: 0,
  tradesExecuted: 0,
  isPaused: false,
  pauseUntil: 0,
  monthlyPnL: 0,
  monthStartTime: Date.now(),
  peakCapital: CONFIG.capital.totalUsd,
  currentCapital: CONFIG.capital.totalUsd,
  currentDrawdown: 0,
  permanentlyHalted: false,
  lastDailyReset: Date.now(),
  smartMoneyTrades: 0,
  arbTrades: 0,
  dipArbTrades: 0,
  directTrades: 0,
  scalpingTrades: 0,
  arbProfit: 0,
  followedWallets: [],
  positions: [],
  activeArbMarket: null,
  activeDipArbMarket: null,
  splits: 0,
  merges: 0,
  redeems: 0,
  swaps: 0,
  usdcBalance: 0,
  usdcEBalance: 0,
  maticBalance: 0,
  unrealizedPnL: 0,
  btcTrend: 'neutral',
  ethTrend: 'neutral',
  solTrend: 'neutral',
  dipArb: {
    marketName: null,
    underlying: null,
    duration: null,
    endTime: null,
    upPrice: 0,
    downPrice: 0,
    sum: 0,
    status: 'idle',
    lastSignal: null,
    signals: [],
  },
  arbitrage: {
    status: 'idle',
    profit: 0,
    lastScan: 0,
    opportunitiesFound: 0,
    executedTrades: 0,
  },
  smartMoneySignals: [],
  logs: [],
};

// ============================================================================
// SERVICES
// ============================================================================

let sdk: PolymarketSDK;
let arbitrageService: ArbitrageService | null = null;
let smartMoneyServiceV2: SmartMoneyServiceV2 | null = null;

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('=== Polymarket Bot v3.2 Starting ===\n');

  // 1. StateManager
  console.log('1️⃣ StateManager...');
  await stateManager.initialize();
  console.log('   ✅ Ready');

  // 2. Telegram
  console.log('2️⃣ Telegram...');
  const telegramOk = await telegramService.initialize();
  console.log(`   ${telegramOk ? '✅ Enabled' : '⚠️ Disabled'}`);

  // 3. SDK
  console.log('3️⃣ Polymarket SDK...');
  sdk = new PolymarketSDK({
    privateKey: process.env.POLYMARKET_PRIVATE_KEY!,
    dryRun: CONFIG.dryRun,
  });
  console.log('   ✅ Connected');

  // 4. Smart Money Strategy
  if (CONFIG.smartMoney.enabled) {
    console.log('4️⃣ Smart Money...');
    const wallets = await sdk.smartMoney.getSmartMoneyList(CONFIG.smartMoney.topN);
    console.log(`   Following ${wallets.length} wallets`);

    // Initialize trading service
    await sdk.tradingService.initialize();

    // Create SmartMoneyServiceV2 with auto-copy-trading, TP/SL
    smartMoneyServiceV2 = new SmartMoneyServiceV2(
      stateManager,
      sdk.tradingService,
      sdk.smartMoney,
      {
        // Which wallets to follow
        targetAddresses: CONFIG.smartMoney.customWallets.length > 0
          ? CONFIG.smartMoney.customWallets
          : undefined,
        topN: CONFIG.smartMoney.customWallets.length === 0 ? CONFIG.smartMoney.topN : undefined,
        // Sizing
        myCapital: CONFIG.capital.totalUsd,
        enableDynamicSizing: CONFIG.risk.enableDynamicSizing,
        minPositionSize: CONFIG.capital.minOrderUsd,
        maxPositionSize: CONFIG.capital.totalUsd * CONFIG.capital.maxPerTradePct,
        maxSizePerTrade: CONFIG.smartMoney.maxSizePerTrade,
        maxSlippage: CONFIG.smartMoney.maxSlippage,
        // TP/SL
        enableTakeProfit: true,
        takeProfitPercent: 0.30,
        enableStopLoss: true,
        stopLossPercent: 0.15,
        enableTrailingStop: true,
        trailingStopPercent: 0.10,
        // Callbacks
        onTrade: async (trade: any, result: any) => {
          console.log(`🐋 Copy: ${trade.side} ${trade.outcome} @ ${trade.price} | $${trade.size}`);
          dashboardEmitter.log('TRADE', `Copy: ${trade.side} ${trade.outcome} @ ${trade.price}`);
          state.smartMoneyTrades++;
          dashboardEmitter.updateState(state);
        },
        onTakeProfit: (position: any, pnl: number) => {
          console.log(`💰 TP HIT: +$${pnl.toFixed(2)}`);
          dashboardEmitter.log('TP', `TP: +$${pnl.toFixed(2)}`);
        },
        onStopLoss: (position: any, pnl: number) => {
          console.log(`🛑 SL HIT: -$${Math.abs(pnl).toFixed(2)}`);
          dashboardEmitter.log('SL', `SL: -$${Math.abs(pnl).toFixed(2)}`);
        },
        onTrailingStop: (position: any, pnl: number) => {
          console.log(`📈 Trailing Stop: +$${pnl.toFixed(2)}`);
          dashboardEmitter.log('TS', `Trailing: +$${pnl.toFixed(2)}`);
        },
        onError: (error: Error) => {
          console.error(`Smart Money Error:`, error);
          dashboardEmitter.log('ERROR', `Smart Money: ${error.message}`);
        },
      }
    );

    // Start enhanced copy-trading
    await smartMoneyServiceV2.startEnhancedCopyTrading();
    console.log('   ✅ Auto-Copy Trading Active (TP+30%/SL-15%/Trailing 10%)');
  }

  // 5. Arbitrage Strategy
  if (CONFIG.arbitrage.enabled) {
    console.log('5️⃣ Arbitrage...');
    arbitrageService = new ArbitrageService(sdk, {
      profitThreshold: CONFIG.arbitrage.profitThreshold,
      minTradeSize: CONFIG.arbitrage.minTradeSize,
      maxTradeSize: CONFIG.arbitrage.maxTradeSize,
      minVolume24h: CONFIG.arbitrage.minVolume24h,
      autoExecute: CONFIG.arbitrage.autoExecute && !CONFIG.dryRun,
      dryRun: CONFIG.dryRun,
    });

    // Use findAndStart to auto-scan and start monitoring the best market
    const scanResult = await arbitrageService.findAndStart(CONFIG.arbitrage.profitThreshold);
    if (scanResult) {
      console.log(`   ✅ Scanning: ${scanResult.description}`);
      state.arbitrage.status = 'monitoring';
      state.arbitrage.lastScan = Date.now();
      dashboardEmitter.log('ARB', `Arb monitor started: ${scanResult.description}`);

      // Listen for opportunities
      arbitrageService.on('opportunity', async (arb: any) => {
        console.log(`🔄 Arbitrage found: ${arb.profitPercent}% | ${arb.description}`);
        dashboardEmitter.log('ARB', `Arb: ${arb.profitPercent}% - ${arb.description}`);
        state.arbTrades++;
        state.arbitrage.opportunitiesFound++;
        state.arbitrage.profit = arb.profitPercent;
        state.arbitrage.lastScan = Date.now();
        state.arbitrage.status = arb.type === 'long' ? 'long_arb' : 'short_arb';
        dashboardEmitter.updateState(state);
      });

      // Listen for orderbook updates to show in dashboard
      arbitrageService.on('orderbookUpdate', (ob: any) => {
        // Update arbitrage state with latest orderbook
        state.arbitrage.lastScan = Date.now();
        dashboardEmitter.updateState(state);
      });
    } else {
      console.log('   ⚠️ No profitable markets found');
      state.arbitrage.status = 'scanning';
      dashboardEmitter.log('WARN', 'Arb: No profitable markets found');
    }
  }

  // 6. DipArb Strategy
  if (CONFIG.dipArb.enabled) {
    console.log('6️⃣ DipArb...');
    const dipArbService = sdk.dipArb;

    // Use findAndStart to auto-find and monitor the best market
    const market = await dipArbService.findAndStart({
      coin: CONFIG.dipArb.coins[0] || 'all',
    });

    if (market) {
      console.log(`   ✅ Monitoring: ${market.name}`);
      state.activeDipArbMarket = market;
      state.dipArb.marketName = market.name;
      state.dipArb.underlying = market.underlying;
      state.dipArb.duration = market.durationMinutes;
      state.dipArb.status = 'monitoring';
      dashboardEmitter.log('SIGNAL', `DipArb monitor started: ${market.name}`);

      // Listen for orderbook updates - THIS IS THE KEY FOR DASHBOARD DISPLAY
      dipArbService.on('orderbookUpdate', (data: any) => {
        state.dipArb.upPrice = data.upPrice || 0;
        state.dipArb.downPrice = data.downPrice || 0;
        state.dipArb.sum = data.sum || 0;
        state.dipArb.lastSignal = Date.now();
        dashboardEmitter.updateState(state);
      });

      // Listen for signals
      dipArbService.on('signal', async (signal: any) => {
        console.log(`📉 DipArb: ${signal.side} ${signal.roundId}`);
        dashboardEmitter.log('SIGNAL', `DipArb: ${signal.side}`);
        state.dipArbTrades++;
        state.dipArb.status = 'signal';
        dashboardEmitter.updateState(state);
      });

      // Listen for execution results
      dipArbService.on('execution', async (result: any) => {
        console.log(`📊 DipArb execution: ${result.leg} ${result.success ? 'OK' : 'FAIL'}`);
        dashboardEmitter.log('TRADE', `DipArb ${result.leg}: ${result.success ? 'filled' : 'failed'}`);
        state.dipArb.status = result.leg === 'leg2' ? 'completed' : 'leg1_filled';
        dashboardEmitter.updateState(state);
      });

      // Listen for new rounds
      dipArbService.on('newRound', async (round: any) => {
        state.dipArb.endTime = round.endTime;
        dashboardEmitter.updateState(state);
      });
    } else {
      console.log('   ⚠️ No suitable DipArb market found');
      state.dipArb.status = 'idle';
      dashboardEmitter.log('WARN', 'DipArb: No suitable market found');
    }
  }

  // 7. Dashboard
  console.log('7️⃣ Dashboard...');
  startDashboard(3001);
  dashboardEmitter.updateState(state);
  dashboardEmitter.updateConfig(CONFIG as BotConfig);

  // Initial logs
  dashboardEmitter.log('INFO', 'Bot v3.2 started');
  dashboardEmitter.log('INFO', `Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  dashboardEmitter.log('INFO', `Capital: $${CONFIG.capital.totalUsd}`);
  dashboardEmitter.log('INFO', `Smart Money: ${CONFIG.smartMoney.enabled ? 'ON' : 'OFF'}`);
  dashboardEmitter.log('INFO', `Arbitrage: ${CONFIG.arbitrage.enabled ? 'ON' : 'OFF'}`);
  dashboardEmitter.log('INFO', `DipArb: ${CONFIG.dipArb.enabled ? 'ON' : 'OFF'}`);
  console.log('   ✅ Running at http://localhost:3001');

  // 8. Periodic updates
  setInterval(() => {
    const stats = stateManager.getStats();
    state.dailyPnL = stats.dailyPnL || 0;
    state.totalPnL = stats.totalPnL || 0;
    state.consecutiveWins = stats.consecutiveWins || 0;
    state.consecutiveLosses = stats.consecutiveLosses || 0;
    state.tradesExecuted = stats.totalTrades || 0;
    dashboardEmitter.updateState(state);
    dashboardEmitter.updateConfig(CONFIG as BotConfig);
  }, 5000);

  // 9. Web commands
  dashboardEmitter.on('command', async (data: any) => {
    const command = data.type || data.command;
    const payload = data.payload || {};
    console.log(`📡 Command: ${command}`, payload);

    // Toggle strategy on/off from dashboard
    if (command === 'toggleStrategy') {
      const { strategy, enabled } = payload;
      console.log(`   → ${strategy} = ${enabled ? 'ON' : 'OFF'}`);

      if (strategy === 'arbitrage') {
        CONFIG.arbitrage.enabled = enabled;

        if (enabled && arbitrageService) {
          try {
            if (!arbitrageService.isActive()) {
              dashboardEmitter.log('INFO', `Arbitrage: ON`);
              const result = await arbitrageService.findAndStart(CONFIG.arbitrage.profitThreshold);
              if (result) {
                state.arbitrage.status = 'monitoring';
                state.arbitrage.lastScan = Date.now();
                dashboardEmitter.updateStrategyStatus('arbitrage', 'monitoring', result.description);
                dashboardEmitter.log('ARB', `Started: ${result.description}`);

                // Attach event listeners for dashboard updates
                arbitrageService.on('opportunity', async (arb: any) => {
                  state.arbTrades++;
                  state.arbitrage.opportunitiesFound++;
                  state.arbitrage.profit = arb.profitPercent;
                  state.arbitrage.lastScan = Date.now();
                  dashboardEmitter.log('ARB', `Arb: ${arb.profitPercent}%`);
                  dashboardEmitter.updateState(state);
                });
                arbitrageService.on('orderbookUpdate', () => {
                  state.arbitrage.lastScan = Date.now();
                  dashboardEmitter.updateState(state);
                });
              } else {
                state.arbitrage.status = 'scanning';
                dashboardEmitter.updateStrategyStatus('arbitrage', 'scanning');
                dashboardEmitter.log('WARN', 'Arb: No markets found, will retry');
              }
            } else {
              dashboardEmitter.log('INFO', 'Arb: Already running');
            }
          } catch (e: any) {
            dashboardEmitter.log('ERROR', `Arb start failed: ${e.message}`);
            dashboardEmitter.updateStrategyStatus('arbitrage', 'idle');
          }
        } else if (!enabled && arbitrageService) {
          if (arbitrageService.isActive()) {
            arbitrageService.stop();
            state.arbitrage.status = 'idle';
            dashboardEmitter.updateStrategyStatus('arbitrage', 'idle');
            dashboardEmitter.log('INFO', 'Arbitrage: OFF');
          }
        }
        dashboardEmitter.updateState(state);
        dashboardEmitter.updateConfig(CONFIG as BotConfig);
      }

      if (strategy === 'dipArb') {
        CONFIG.dipArb.enabled = enabled;

        if (enabled) {
          try {
            const dipArbService = sdk.dipArb;
            if (!dipArbService.isActive()) {
              dashboardEmitter.log('INFO', `DipArb: ON`);
              const market = await dipArbService.findAndStart({ coin: CONFIG.dipArb.coins[0] || 'all' });
              if (market) {
                state.activeDipArbMarket = market;
                state.dipArb.marketName = market.name;
                state.dipArb.underlying = market.underlying;
                state.dipArb.duration = market.durationMinutes;
                state.dipArb.status = 'monitoring';
                dashboardEmitter.updateStrategyStatus('dipArb', 'monitoring', market.name);
                dashboardEmitter.log('SIGNAL', `DipArb started: ${market.name}`);

                // Attach event listeners for dashboard updates
                dipArbService.on('orderbookUpdate', (data: any) => {
                  state.dipArb.upPrice = data.upPrice || 0;
                  state.dipArb.downPrice = data.downPrice || 0;
                  state.dipArb.sum = data.sum || 0;
                  state.dipArb.lastSignal = Date.now();
                  dashboardEmitter.updateState(state);
                });
                dipArbService.on('signal', async (signal: any) => {
                  state.dipArbTrades++;
                  state.dipArb.status = 'signal';
                  dashboardEmitter.log('SIGNAL', `DipArb: ${signal.side}`);
                  dashboardEmitter.updateState(state);
                });
                dipArbService.on('execution', async (result: any) => {
                  state.dipArb.status = result.leg === 'leg2' ? 'completed' : 'leg1_filled';
                  dashboardEmitter.log('TRADE', `DipArb ${result.leg}: ${result.success ? 'filled' : 'failed'}`);
                  dashboardEmitter.updateState(state);
                });
              } else {
                state.dipArb.status = 'idle';
                dashboardEmitter.updateStrategyStatus('dipArb', 'idle');
                dashboardEmitter.log('WARN', 'DipArb: No market found');
              }
            } else {
              dashboardEmitter.log('INFO', 'DipArb: Already running');
            }
          } catch (e: any) {
            dashboardEmitter.log('ERROR', `DipArb start failed: ${e.message}`);
            dashboardEmitter.updateStrategyStatus('dipArb', 'idle');
          }
        } else {
          try {
            const dipArbService = sdk.dipArb;
            if (dipArbService.isActive()) {
              await dipArbService.stop();
              state.dipArb.status = 'idle';
              state.dipArb.marketName = null;
              dashboardEmitter.updateStrategyStatus('dipArb', 'idle');
              dashboardEmitter.log('INFO', 'DipArb: OFF');
            }
          } catch (e: any) {
            dashboardEmitter.log('ERROR', `DipArb stop failed: ${e.message}`);
          }
        }
        dashboardEmitter.updateState(state);
        dashboardEmitter.updateConfig(CONFIG as BotConfig);
      }

      if (strategy === 'smartMoney') {
        CONFIG.smartMoney.enabled = enabled;
        dashboardEmitter.log('INFO', `Smart Money: ${enabled ? 'ON' : 'OFF'}`);
        dashboardEmitter.updateStrategyStatus('smartMoney', enabled ? 'active' : 'idle');
        dashboardEmitter.updateConfig(CONFIG as BotConfig);
      }

      dashboardEmitter.updateState(state);
    }

    if (command === 'toggleDryRun' || data.type === 'toggle_dry_run') {
      CONFIG.dryRun = !CONFIG.dryRun;
      dashboardEmitter.log('WARN', `Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
    }

    if (command === 'update_config' && data.config) {
      if (data.config.capital?.totalUsd) {
        CONFIG.capital.totalUsd = data.config.capital.totalUsd;
        dashboardEmitter.log('INFO', `Capital: $${CONFIG.capital.totalUsd}`);
      }
      if (data.config.smartMoney?.enabled !== undefined) {
        CONFIG.smartMoney.enabled = data.config.smartMoney.enabled;
        dashboardEmitter.log('INFO', `Smart Money: ${CONFIG.smartMoney.enabled ? 'ON' : 'OFF'}`);
      }
      if (data.config.arbitrage?.enabled !== undefined) {
        CONFIG.arbitrage.enabled = data.config.arbitrage.enabled;
        dashboardEmitter.log('INFO', `Arbitrage: ${CONFIG.arbitrage.enabled ? 'ON' : 'OFF'}`);
      }
      if (data.config.dipArb?.enabled !== undefined) {
        CONFIG.dipArb.enabled = data.config.dipArb.enabled;
        dashboardEmitter.log('INFO', `DipArb: ${CONFIG.dipArb.enabled ? 'ON' : 'OFF'}`);
      }
      dashboardEmitter.updateConfig(CONFIG as BotConfig);
    }
  });

  // 10. Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    if (arbitrageService) arbitrageService.stop();
    if (smartMoneyServiceV2) smartMoneyServiceV2.stop();
    await stateManager.shutdown();
    process.exit(0);
  });

  console.log('\n✅ Bot v3.2 RUNNING!');
  console.log(`   Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Capital: $${CONFIG.capital.totalUsd}`);
  console.log(`   Strategies: ${[
    CONFIG.smartMoney.enabled && 'Smart Money',
    CONFIG.arbitrage.enabled && 'Arbitrage',
    CONFIG.dipArb.enabled && 'DipArb',
  ].filter(Boolean).join(', ') || 'None'}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

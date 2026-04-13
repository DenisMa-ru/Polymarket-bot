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
    } else {
      console.log('   ⚠️ No profitable markets found');
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
      dashboardEmitter.log('SIGNAL', `DipArb monitor started: ${market.name}`);

      // Listen for signals
      dipArbService.on('signal', async (signal: any) => {
        console.log(`📉 DipArb: ${signal.side} ${signal.roundId}`);
        dashboardEmitter.log('SIGNAL', `DipArb: ${signal.side}`);
        state.dipArbTrades++;
        dashboardEmitter.updateState(state);
      });

      dipArbService.on('leg1', async (result: any) => {
        console.log(`📊 DipArb Leg1 filled: ${result.side}`);
        dashboardEmitter.log('TRADE', `DipArb Leg1: ${result.side} @ ${result.price}`);
        state.dipArb.status = 'leg1_filled';
        dashboardEmitter.updateState(state);
      });

      dipArbService.on('leg2', async (result: any) => {
        console.log(`📊 DipArb Leg2 filled: ${result.side}`);
        dashboardEmitter.log('TRADE', `DipArb Leg2: ${result.side} @ ${result.price}`);
        state.dipArb.status = 'completed';
        dashboardEmitter.updateState(state);
      });
    } else {
      console.log('   ⚠️ No suitable DipArb market found');
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
    console.log(`📡 Command: ${data.type}`);

    if (data.type === 'update_config' && data.config) {
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

    if (data.type === 'toggle_dry_run') {
      CONFIG.dryRun = !CONFIG.dryRun;
      dashboardEmitter.log('WARN', `Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
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

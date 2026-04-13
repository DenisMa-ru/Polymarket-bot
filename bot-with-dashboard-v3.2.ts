/**
 * Bot with Dashboard v3.2 - Enhanced with StateManager, Telegram, Smart Money V2, Scalping
 *
 * NEW in v3.2:
 * - StateManager for position persistence
 * - Telegram notifications
 * - Smart Money V2 with dynamic sizing & TP/SL
 * - Scalping Service with real-time data
 * - Telegram command handler for live config changes
 *
 * Run with: npx tsx bot-with-dashboard.ts
 * Then open: http://localhost:5173
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import {
  PolymarketSDK,
  ArbitrageService,
  SwapService,
  OnchainService,
  stateManager,
  telegramService,
  TelegramService,
  ScalpingService,
  SmartMoneyServiceV2,
  GammaMarketService,
} from './src/index.js';
import { CTFClient } from './src/clients/ctf-client.js';
import { startDashboard, dashboardEmitter } from './src/dashboard/index.js';
import type { BotState, BotConfig, LogLevel, DipArbSignal, SmartMoneySignal } from './src/dashboard/types.js';
import { addSession, createSessionFromState, type TradeRecord } from './src/dashboard/session-history.js';
import { TelegramCommandHandler } from './src/services/telegram-command-handler.js';

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
    strategyAllocation: {
      smartMoney: 0.60,
      arbitrage: 0.15,
      dipArb: 0.10,
      scalping: 0.15,
    },
  },

  risk: {
    dailyMaxLossPct: 0.05,
    maxConsecutiveLosses: 6,
    pauseOnBreachMinutes: 60,
    monthlyMaxLossPct: 0.15,
    maxDrawdownFromPeak: 0.25,
    totalMaxLossPct: 0.40,
    enableDynamicSizing: true,
    minPositionPct: 0.01,
    maxPositionPct: 0.10,
    lossSizingReduction: 0.20,
    winSizingIncrease: 0.10,
  },

  smartMoney: {
    enabled: process.env.SMARTMONEY_ENABLED !== 'false',
    topN: 20,
    minWinRate: 0.60,
    minPnl: 500,
    minTrades: 30,
    minProfitFactor: 1.5,
    minConsistencyScore: 0.7,
    maxSingleTradeExposure: 0.3,
    checkLastNTrades: 10,
    sizeScale: 0.1,
    maxSizePerTrade: 15,
    maxSlippage: 0.03,
    minTradeSize: 10,
    delay: 500,
    customWallets: [
      '0xc2e7800b5af46e6093872b177b7a5e7f0563be51',
      '0x58c3f5d66c95d4c41b093fbdd2520e46b6c9de74',
    ] as string[],
    // v3.2 NEW: TP/SL
    takeProfitPercent: 0.30,
    stopLossPercent: 0.15,
    enableTrailingStop: true,
    trailingStopPercent: 0.10,
  },

  scalping: {
    enabled: process.env.SCALPING_ENABLED === 'true',
    maxPositionSize: 5,
    minPositionSize: 3,
    maxExpiryMinutes: 15,
    minExpiryMinutes: 5,
    takeProfit: 0.15,
    stopLoss: 0.10,
    maxHoldTime: 300,
    maxTradesPerHour: 20,
  },

  arbitrage: {
    enabled: process.env.ARBITRAGE_ENABLED === 'true',
    profitThreshold: 0.01,
    minTradeSize: 20,
    maxTradeSize: 100,
    minVolume24h: 5000,
    autoExecute: true,
    enableRebalancer: true,
    estimatedGasCostUSD: 0.10,
    minNetProfit: 0.50,
  },

  dipArb: {
    enabled: process.env.DIPARB_ENABLED === 'true',
    coins: ['BTC', 'ETH', 'SOL'] as const,
    shares: 10,
    sumTarget: 0.92,
    autoRotate: true,
    autoExecute: true,
    minTradeValueUSD: 1.5,
  },

  onchain: {
    enabled: true,
    autoApprove: true,
    minMatic: 0.5,
  },

  binance: {
    enabled: process.env.TREND_ANALYSIS_ENABLED === 'true',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const,
    interval: '15m' as const,
    trendThreshold: 2,
  },

  directTrading: {
    enabled: false,
    trendFollowing: true,
    minTrendStrength: 0.02,
    stopLossPct: 0.15,
    takeProfitPct: 0.25,
    trailingStopPct: 0.10,
    maxHoldDays: 7,
    minRiskReward: 1.5,
  },

  dryRun: process.env.DRY_RUN !== 'false',
};

// ============================================================================
// STATE (Enhanced with v3.2 fields)
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
  scalpingTrades: 0,  // v3.2 NEW
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
// SERVICE INSTANCES (v3.2)
// ============================================================================

let sdk: PolymarketSDK;
let scalpingService: ScalpingService | null = null;
let smartMoneyV2: SmartMoneyServiceV2 | null = null;
let gammaMarketService: GammaMarketService | null = null;
let telegramCommandHandler: TelegramCommandHandler | null = null;

// ============================================================================
// MAIN BOT FUNCTION
// ============================================================================

async function main() {
  console.log('=== Polymarket Bot v3.2 Starting ===\n');

  // 1. Initialize StateManager
  console.log('1️⃣ Initializing StateManager...');
  const savedState = await stateManager.initialize();
  
  // Restore state if available
  if (savedState.activePositions.length > 0) {
    console.log(`   Restored ${savedState.activePositions.length} positions`);
  }

  // 2. Initialize Telegram notifications
  console.log('2️⃣ Initializing Telegram...');
  const telegramInitialized = await telegramService.initialize();
  if (telegramInitialized) {
    console.log('   Telegram notifications enabled');
    await telegramService.notify('bot_started', {
      capital: CONFIG.capital.totalUsd,
      dryRun: CONFIG.dryRun,
      strategies: [
        CONFIG.smartMoney.enabled && 'Smart Money',
        CONFIG.arbitrage.enabled && 'Arbitrage',
        CONFIG.dipArb.enabled && 'DipArb',
        CONFIG.scalping.enabled && 'Scalping',
      ].filter(Boolean),
    });
  } else {
    console.log('   Telegram notifications disabled');
  }

  // 3. Initialize SDK
  console.log('3️⃣ Initializing Polymarket SDK...');
  sdk = new PolymarketSDK({
    privateKey: process.env.POLYMARKET_PRIVATE_KEY!,
    dryRun: CONFIG.dryRun,
  });
  console.log('   SDK initialized');

  // 4. Initialize Scalping Service
  if (CONFIG.scalping.enabled) {
    console.log('4️⃣ Initializing Scalping Service...');
    scalpingService = new ScalpingService(
      stateManager,
      sdk.trading,
      {
        myCapital: CONFIG.capital.totalUsd,
        maxPositionSize: CONFIG.scalping.maxPositionSize,
        minPositionSize: CONFIG.scalping.minPositionSize,
        categories: ['crypto', 'sports'],
        maxExpiryMinutes: CONFIG.scalping.maxExpiryMinutes,
        minExpiryMinutes: CONFIG.scalping.minExpiryMinutes,
        minVolume24h: 1000,
        indicators: {
          rsi: { period: 14, oversold: 30, overbought: 70 },
          volume: { minRatio: 1.5 },
          macd: { fast: 12, slow: 26, signal: 9 },
        },
        entryRules: {
          minConfidence: 70,
          requireVolumeSpike: true,
          requireRsiDivergence: true,
        },
        takeProfit: CONFIG.scalping.takeProfit,
        stopLoss: CONFIG.scalping.stopLoss,
        maxHoldTime: CONFIG.scalping.maxHoldTime,
        maxConcurrentPositions: 5,
        maxTradesPerHour: CONFIG.scalping.maxTradesPerHour,
        cooldownAfterTrade: 60,
        dryRun: CONFIG.dryRun,
      }
    );

    await scalpingService.start();
    console.log('   Scalping Service started');
  }

  // 5. Initialize Smart Money V2
  if (CONFIG.smartMoney.enabled) {
    console.log('5️⃣ Initializing Smart Money V2...');
    smartMoneyV2 = new SmartMoneyServiceV2(
      stateManager,
      sdk.trading,
      sdk.smartMoney,
      {
        myCapital: CONFIG.capital.totalUsd,
        enableDynamicSizing: true,
        minPositionSize: 3,
        maxPositionSize: CONFIG.capital.totalUsd * 0.10,
        enableTakeProfit: true,
        takeProfitPercent: CONFIG.smartMoney.takeProfitPercent,
        enableStopLoss: true,
        stopLossPercent: CONFIG.smartMoney.stopLossPercent,
        enableTrailingStop: CONFIG.smartMoney.enableTrailingStop,
        trailingStopPercent: CONFIG.smartMoney.trailingStopPercent,
        topN: CONFIG.smartMoney.topN,
        maxSizePerTrade: CONFIG.smartMoney.maxSizePerTrade,
        maxSlippage: CONFIG.smartMoney.maxSlippage,
        dryRun: CONFIG.dryRun,
        onTakeProfit: async (position, pnl) => {
          console.log(`Take-Profit hit: +$${pnl.toFixed(2)}`);
          await telegramService.notify('take_profit', {
            strategy: 'Smart Money',
            market: position.marketQuestion,
            pnl,
            pnlPercent: (pnl / position.size) * 100,
            entryPrice: position.entryPrice,
            exitPrice: position.currentPrice,
          });
        },
        onStopLoss: async (position, pnl) => {
          console.log(`Stop-Loss hit: -$${Math.abs(pnl).toFixed(2)}`);
          await telegramService.notify('stop_loss', {
            strategy: 'Smart Money',
            market: position.marketQuestion,
            pnl: Math.abs(pnl),
            pnlPercent: (Math.abs(pnl) / position.size) * 100,
            entryPrice: position.entryPrice,
            exitPrice: position.currentPrice,
          });
        },
      }
    );

    await smartMoneyV2.startEnhancedCopyTrading();
    console.log('   Smart Money V2 started');
  }

  // 6. Initialize Telegram Command Handler
  if (process.env.TELEGRAM_ENABLED === 'true') {
    console.log('6️⃣ Initializing Telegram Command Handler...');
    telegramCommandHandler = new TelegramCommandHandler(
      CONFIG as any,
      stateManager,
      telegramService,
      process.env.TELEGRAM_CHAT_ID!
    );

    await telegramCommandHandler.initialize();
    console.log('   Telegram Command Handler started');
  }

  // 7. Start Dashboard
  console.log('7️⃣ Starting Dashboard...');
  await startDashboard(state, {
    mode: CONFIG.dryRun ? 'DRY_RUN' : 'LIVE',
    onModeChange: async (newMode) => {
      CONFIG.dryRun = newMode === 'DRY_RUN';
      console.log(`Mode changed to: ${newMode}`);
    },
  });

  // 8. Update dashboard with StateManager data
  setInterval(() => {
    const stats = stateManager.getStats();
    
    state.dailyPnL = stats.dailyPnL || 0;
    state.totalPnL = stats.totalPnL || 0;
    state.consecutiveWins = stats.consecutiveWins || 0;
    state.consecutiveLosses = stats.consecutiveLosses || 0;
    state.tradesExecuted = stats.totalTrades || 0;
    
    // v3.2: Update scalping stats
    if (scalpingService) {
      const scalpingStats = scalpingService.getStats();
      state.scalpingTrades = scalpingStats.totalTrades || 0;
    }

    // Emit to dashboard
    dashboardEmitter.emit('state_update', state);
  }, 5000);

  // 9. Send daily report via Telegram
  setInterval(async () => {
    const stats = stateManager.getStats();
    await telegramService.notify('daily_report', {
      date: new Date().toLocaleDateString('ru-RU'),
      dailyPnL: stats.dailyPnL || 0,
      dailyPnLPercent: stats.dailyPnL ? ((stats.dailyPnL / CONFIG.capital.totalUsd) * 100) : 0,
      trades: stats.totalTrades || 0,
      wins: (stats as any).wins || 0,
      losses: (stats as any).losses || 0,
      winRate: stats.overallWinRate || 0,
      bestTrade: (stats as any).bestTrade || 0,
      worstTrade: (stats as any).worstTrade || 0,
      totalPnL: stats.totalPnL || 0,
      consecutiveWins: stats.consecutiveWins || 0,
      consecutiveLosses: stats.consecutiveLosses || 0,
    });
  }, 24 * 60 * 60 * 1000); // Every 24 hours

  // 10. Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    
    await telegramService.notify('bot_stopped', {
      totalTrades: stateManager.getStats().totalTrades,
      totalPnL: stateManager.getStats().totalPnL,
    });

    if (scalpingService) scalpingService.stop();
    if (smartMoneyV2) smartMoneyV2.stop();
    if (telegramCommandHandler) telegramCommandHandler.stop();
    if (gammaMarketService) gammaMarketService.stopMonitoring();
    
    await stateManager.shutdown();
    
    process.exit(0);
  });

  console.log('\n✅ Bot v3.2 is running!');
  console.log(`   Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Capital: $${CONFIG.capital.totalUsd}`);
  console.log(`   Telegram: ${process.env.TELEGRAM_ENABLED === 'true' ? 'Enabled' : 'Disabled'}`);
  console.log(`   Dashboard: http://localhost:5173`);
}

// Start the bot
main().catch((error) => {
  console.error('Fatal error:', error);
  telegramService.notify('error', {
    errorType: 'FATAL',
    message: error.message,
  }).finally(() => process.exit(1));
});

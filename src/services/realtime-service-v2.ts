/**
 * RealtimeService V2
 *
 * Comprehensive real-time data service using the new Polymarket CLOB WebSocket:
 * wss://ws-subscriptions-clob.polymarket.com/ws/market
 *
 * This replaces the deprecated @polymarket/real-time-data-client which
 * connected to ws-live-data.polymarket.com (no longer supports CLOB messages).
 *
 * Supported events:
 * - book: Full orderbook snapshots
 * - price_change: Price updates when orders placed/cancelled
 * - last_trade_price: Executed trades
 * - best_bid_ask: Top of book changes (requires custom_feature_enabled)
 * - tick_size_change: Price increment changes
 * - market_created / market_resolved: Market lifecycle events
 */

import { EventEmitter } from 'events';
import {
  ClobWebSocketClient,
  ClobWSConfig,
  ClobOrderBookEvent,
  ClobPriceChangeEvent,
  ClobLastTradeEvent,
  ClobTickSizeChangeEvent,
  ClobMarketCreatedEvent,
  ClobMarketResolvedEvent,
  ClobBestBidAskEvent,
} from '../clients/clob-websocket-client.js';
import type { PriceUpdate, BookUpdate, Orderbook, OrderbookLevel } from '../core/types.js';

// ============================================================================
// Types
// ============================================================================

export interface RealtimeServiceConfig {
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Ping interval in ms (default: 30000) */
  pingInterval?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

// Market data types
/**
 * Extended orderbook snapshot from WebSocket with additional trading parameters.
 * Extends the base Orderbook type from core/types.ts.
 */
export interface OrderbookSnapshot extends Orderbook {
  /** Token ID (ERC-1155 token identifier, required in WebSocket context) */
  tokenId: string;
  /** @deprecated Use tokenId instead */
  assetId: string;
  /** Market condition ID (required in WebSocket context) */
  market: string;
  /** Tick size for price rounding */
  tickSize: string;
  /** Minimum order size */
  minOrderSize: string;
  /** Hash for change detection (required in WebSocket context) */
  hash: string;
}

export interface LastTradeInfo {
  assetId: string;
  price: number;
  side: 'BUY' | 'SELL';
  size: number;
  timestamp: number;
}

export interface PriceChange {
  assetId: string;
  changes: Array<{ price: string; size: string }>;
  timestamp: number;
}

export interface TickSizeChange {
  assetId: string;
  oldTickSize: string;
  newTickSize: string;
  timestamp: number;
}

export interface MarketEvent {
  conditionId: string;
  type: 'created' | 'resolved';
  data: Record<string, unknown>;
  timestamp: number;
}

// Activity types
/**
 * Activity trade from WebSocket / Data API polling
 *
 * 实测验证 (2025-12-28)：proxyWallet 和 name 是顶层字段，不在 trader 对象里
 */
export interface ActivityTrade {
  /** Token ID (used for ordering) */
  asset: string;
  /** Market condition ID */
  conditionId: string;
  /** Event slug */
  eventSlug: string;
  /** Market slug (可用于过滤) */
  marketSlug: string;
  /** Outcome (Yes/No) */
  outcome: string;
  /** Trade price */
  price: number;
  /** Trade side */
  side: 'BUY' | 'SELL';
  /** Trade size in shares */
  size: number;
  /** Timestamp (Unix seconds) */
  timestamp: number;
  /** Transaction hash */
  transactionHash: string;

  // ========== 交易者信息 ==========

  /**
   * Trader info object - 用于 Copy Trading 过滤目标钱包
   *
   * 注意: 实测验证 (2025-12-28) 数据结构为:
   * {
   *   trader: { name: "username", address: "0x..." }
   * }
   * 而非顶层 proxyWallet
   */
  trader?: {
    /** 交易者用户名 */
    name?: string;
    /** 交易者钱包地址 - Copy Trading 过滤关键字段！ */
    address?: string;
  };
}

export interface ActivityHandlers {
  onTrade?: (trade: ActivityTrade) => void;
  onError?: (error: Error) => void;
}

// User data types (for future CLOB user channel support)
export interface UserOrder {
  orderId: string;
  market: string;
  asset: string;
  side: 'BUY' | 'SELL';
  price: number;
  originalSize: number;
  matchedSize: number;
  eventType: 'PLACEMENT' | 'UPDATE' | 'CANCELLATION';
  timestamp: number;
}

export interface UserTrade {
  tradeId: string;
  market: string;
  outcome: string;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
  status: 'MATCHED' | 'MINED' | 'CONFIRMED' | 'RETRYING' | 'FAILED';
  timestamp: number;
  transactionHash?: string;
}

export interface UserDataHandlers {
  onOrder?: (order: UserOrder) => void;
  onTrade?: (trade: UserTrade) => void;
  onError?: (error: Error) => void;
}

// Comment types
export interface Comment {
  id: string;
  parentEntityId: number;
  parentEntityType: 'Event' | 'Series';
  content?: string;
  author?: string;
  timestamp: number;
}

export interface Reaction {
  id: string;
  commentId: string;
  type: string;
  author?: string;
  timestamp: number;
}

export interface EquityPrice {
  symbol: string;
  price: number;
  timestamp: number;
}

export interface EquityPriceHandlers {
  onPrice?: (price: EquityPrice) => void;
  onError?: (error: Error) => void;
}

// RFQ types
export interface RFQRequest {
  id: string;
  market: string;
  side: 'BUY' | 'SELL';
  size: number;
  status: 'created' | 'edited' | 'canceled' | 'expired';
  timestamp: number;
}

export interface RFQQuote {
  id: string;
  requestId: string;
  price: number;
  size: number;
  status: 'created' | 'edited' | 'canceled' | 'expired';
  timestamp: number;
}

// Subscription types
export interface Subscription {
  id: string;
  topic: string;
  type: string;
  unsubscribe: () => void;
}

export interface MarketSubscription extends Subscription {
  tokenIds: string[];
}

// External price types
export interface CryptoPrice {
  symbol: string;
  price: number;
  timestamp: number;
}

// Event handler types
export interface MarketDataHandlers {
  onOrderbook?: (book: OrderbookSnapshot) => void;
  onPriceChange?: (change: PriceChange) => void;
  onLastTrade?: (trade: LastTradeInfo) => void;
  onTickSizeChange?: (change: TickSizeChange) => void;
  onMarketEvent?: (event: MarketEvent) => void;
  onError?: (error: Error) => void;
}

export interface CryptoPriceHandlers {
  onPrice?: (price: CryptoPrice) => void;
  onError?: (error: Error) => void;
}

// ============================================================================
// RealtimeServiceV2 Implementation
// ============================================================================

export class RealtimeServiceV2 extends EventEmitter {
  private clobWs: ClobWebSocketClient | null = null;
  private config: Required<RealtimeServiceConfig>;
  private subscriptions: Map<string, MarketSubscription> = new Map();
  private subscriptionIdCounter = 0;
  private connected = false;

  // Caches
  private priceCache: Map<string, PriceUpdate> = new Map();
  private bookCache: Map<string, OrderbookSnapshot> = new Map();
  private lastTradeCache: Map<string, LastTradeInfo> = new Map();

  // Handler tracking for unsubscribe
  private handlerRegistry: Map<string, Array<{ event: string; handler: Function }>> = new Map();

  constructor(config: RealtimeServiceConfig = {}) {
    super();
    this.config = {
      autoReconnect: config.autoReconnect ?? true,
      pingInterval: config.pingInterval ?? 30000,
      debug: config.debug ?? false,
    };
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Connect to the CLOB WebSocket server
   */
  connect(): this {
    if (this.clobWs) {
      this.log('Already connected or connecting');
      return this;
    }

    const wsConfig: ClobWSConfig = {
      autoReconnect: this.config.autoReconnect,
      pingInterval: this.config.pingInterval,
      debug: this.config.debug,
    };

    this.clobWs = new ClobWebSocketClient(wsConfig);

    this.clobWs.on('connected', () => {
      this.connected = true;
      this.log('Connected to CLOB WebSocket server');
      this.emit('connected');
    });

    this.clobWs.on('disconnected', () => {
      this.connected = false;
      this.log('Disconnected from CLOB WebSocket server');
      this.emit('disconnected');
    });

    this.clobWs.on('reconnecting', (data: { attempt: number }) => {
      this.log(`Reconnecting... (attempt ${data.attempt})`);
      this.emit('reconnecting', data);
    });

    this.clobWs.on('error', (error: Error) => {
      this.log(`WebSocket error: ${error.message}`);
      this.emit('error', error);
    });

    // Set up event handlers for CLOB WebSocket
    this.setupClobEventHandlers();

    this.clobWs.connect();
    return this;
  }

  /**
   * Disconnect from the CLOB WebSocket server
   */
  disconnect(): void {
    if (this.clobWs) {
      this.clobWs.disconnect();
      this.clobWs = null;
      this.connected = false;
      this.subscriptions.clear();
      this.handlerRegistry.clear();
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // CLOB Event Handlers Setup
  // ============================================================================

  /**
   * Set up handlers for all CLOB WebSocket event types
   */
  private setupClobEventHandlers(): void {
    if (!this.clobWs) return;

    // Orderbook updates
    this.clobWs.on('book', (event: ClobOrderBookEvent) => {
      const book = this.parseOrderbook(event);
      this.bookCache.set(book.assetId, book);
      this.emit('orderbook', book);
    });

    // Price changes
    this.clobWs.on('price_change', (event: ClobPriceChangeEvent) => {
      const change = this.parsePriceChange(event);
      this.emit('priceChange', change);
    });

    // Last trade
    this.clobWs.on('last_trade_price', (event: ClobLastTradeEvent) => {
      const trade = this.parseLastTrade(event);
      this.lastTradeCache.set(trade.assetId, trade);
      this.emit('lastTrade', trade);
    });

    // Best bid/ask
    this.clobWs.on('best_bid_ask', (event: ClobBestBidAskEvent) => {
      this.handleBestBidAsk(event);
    });

    // Tick size changes
    this.clobWs.on('tick_size_change', (event: ClobTickSizeChangeEvent) => {
      const change = this.parseTickSizeChange(event);
      this.emit('tickSizeChange', change);
    });

    // Market created
    this.clobWs.on('market_created', (event: ClobMarketCreatedEvent) => {
      const marketEvent: MarketEvent = {
        conditionId: event.market,
        type: 'created',
        data: event as unknown as Record<string, unknown>,
        timestamp: this.normalizeTimestamp(event.timestamp),
      };
      this.emit('marketEvent', marketEvent);
    });

    // Market resolved
    this.clobWs.on('market_resolved', (event: ClobMarketResolvedEvent) => {
      const marketEvent: MarketEvent = {
        conditionId: event.market,
        type: 'resolved',
        data: event as unknown as Record<string, unknown>,
        timestamp: this.normalizeTimestamp(event.timestamp),
      };
      this.emit('marketEvent', marketEvent);
    });
  }

  // ============================================================================
  // Market Data Subscriptions
  // ============================================================================

  /**
   * Subscribe to market data (orderbook, prices, trades)
   * @param tokenIds - Array of token IDs to subscribe to
   * @param handlers - Event handlers
   */
  subscribeMarkets(tokenIds: string[], handlers: MarketDataHandlers = {}): MarketSubscription {
    const subId = `market_${++this.subscriptionIdCounter}`;

    // Subscribe to assets via CLOB WebSocket
    if (this.clobWs) {
      this.clobWs.subscribeAssets(tokenIds);
    }

    // Register handlers
    const orderbookHandler = (book: OrderbookSnapshot) => {
      if (tokenIds.includes(book.assetId)) {
        handlers.onOrderbook?.(book);
      }
    };

    const priceChangeHandler = (change: PriceChange) => {
      if (tokenIds.includes(change.assetId)) {
        handlers.onPriceChange?.(change);
      }
    };

    const lastTradeHandler = (trade: LastTradeInfo) => {
      if (tokenIds.includes(trade.assetId)) {
        handlers.onLastTrade?.(trade);
      }
    };

    const tickSizeHandler = (change: TickSizeChange) => {
      if (tokenIds.includes(change.assetId)) {
        handlers.onTickSizeChange?.(change);
      }
    };

    this.on('orderbook', orderbookHandler);
    this.on('priceChange', priceChangeHandler);
    this.on('lastTrade', lastTradeHandler);
    this.on('tickSizeChange', tickSizeHandler);

    // Track handlers for unsubscribe
    this.handlerRegistry.set(subId, [
      { event: 'orderbook', handler: orderbookHandler },
      { event: 'priceChange', handler: priceChangeHandler },
      { event: 'lastTrade', handler: lastTradeHandler },
      { event: 'tickSizeChange', handler: tickSizeHandler },
    ]);

    const subscription: MarketSubscription = {
      id: subId,
      topic: 'clob_market',
      type: '*',
      tokenIds,
      unsubscribe: () => {
        this.removeHandlers(subId);
        this.clobWs?.unsubscribeAssets(tokenIds);
        this.subscriptions.delete(subId);
        this.handlerRegistry.delete(subId);
      },
    };

    this.subscriptions.set(subId, subscription);
    return subscription;
  }

  /**
   * Subscribe to a single market (YES + NO tokens)
   * Also emits derived price updates compatible with old API
   */
  subscribeMarket(
    yesTokenId: string,
    noTokenId: string,
    handlers: MarketDataHandlers & {
      onPriceUpdate?: (update: PriceUpdate) => void;
      onBookUpdate?: (update: BookUpdate) => void;
      onPairUpdate?: (update: { yes: PriceUpdate; no: PriceUpdate; spread: number }) => void;
    } = {}
  ): MarketSubscription {
    let lastYesUpdate: PriceUpdate | undefined;
    let lastNoUpdate: PriceUpdate | undefined;

    const checkPairUpdate = () => {
      if (lastYesUpdate && lastNoUpdate && handlers.onPairUpdate) {
        handlers.onPairUpdate({
          yes: lastYesUpdate,
          no: lastNoUpdate,
          spread: lastYesUpdate.price + lastNoUpdate.price,
        });
      }
    };

    return this.subscribeMarkets([yesTokenId, noTokenId], {
      onOrderbook: (book) => {
        handlers.onOrderbook?.(book);

        // Convert to BookUpdate for backward compatibility
        if (handlers.onBookUpdate) {
          const bookUpdate: BookUpdate = {
            assetId: book.assetId,
            bids: book.bids,
            asks: book.asks,
            timestamp: book.timestamp,
          };
          handlers.onBookUpdate(bookUpdate);
        }

        // Calculate derived price (Polymarket display logic)
        const priceUpdate = this.calculateDerivedPrice(book.assetId, book);
        if (priceUpdate) {
          this.priceCache.set(book.assetId, priceUpdate);

          if (book.assetId === yesTokenId) {
            lastYesUpdate = priceUpdate;
          } else if (book.assetId === noTokenId) {
            lastNoUpdate = priceUpdate;
          }

          handlers.onPriceUpdate?.(priceUpdate);
          this.emit('priceUpdate', priceUpdate);
          checkPairUpdate();
        }
      },
      onLastTrade: (trade) => {
        handlers.onLastTrade?.(trade);
        this.lastTradeCache.set(trade.assetId, trade);

        // Recalculate derived price with new last trade
        const book = this.bookCache.get(trade.assetId);
        if (book) {
          const priceUpdate = this.calculateDerivedPrice(trade.assetId, book);
          if (priceUpdate) {
            this.priceCache.set(trade.assetId, priceUpdate);

            if (trade.assetId === yesTokenId) {
              lastYesUpdate = priceUpdate;
            } else if (trade.assetId === noTokenId) {
              lastNoUpdate = priceUpdate;
            }

            handlers.onPriceUpdate?.(priceUpdate);
            this.emit('priceUpdate', priceUpdate);
            checkPairUpdate();
          }
        }
      },
      onPriceChange: handlers.onPriceChange,
      onTickSizeChange: handlers.onTickSizeChange,
      onError: handlers.onError,
    });
  }

  /**
   * Subscribe to market lifecycle events (creation, resolution)
   */
  subscribeMarketEvents(handlers: { onMarketEvent?: (event: MarketEvent) => void }): Subscription {
    const subId = `market_event_${++this.subscriptionIdCounter}`;

    // Market events are automatically received via CLOB WebSocket
    // when subscribed to assets. We just need to register the handler.
    const handler = (event: MarketEvent) => handlers.onMarketEvent?.(event);
    this.on('marketEvent', handler);

    this.handlerRegistry.set(subId, [
      { event: 'marketEvent', handler },
    ]);

    const subscription: Subscription = {
      id: subId,
      topic: 'clob_market',
      type: 'lifecycle',
      unsubscribe: () => {
        this.removeHandlers(subId);
        this.subscriptions.delete(subId);
        this.handlerRegistry.delete(subId);
      },
    };

    this.subscriptions.set(subId, subscription as MarketSubscription);
    return subscription;
  }

  // ============================================================================
  // Crypto Price Subscriptions (via REST polling - not available in CLOB WS)
  // ============================================================================

  /**
   * Subscribe to crypto price updates via CoinGecko REST API polling.
   * The new CLOB WebSocket doesn't support crypto_prices, so we use polling.
   *
   * @param symbols - Array of symbols (e.g., ['BTC', 'ETH', 'SOL'])
   * @param handlers - Event handlers
   */
  subscribeCryptoPrices(symbols: string[], handlers: CryptoPriceHandlers = {}): Subscription {
    const subId = `crypto_${++this.subscriptionIdCounter}`;

    // Map symbols to CoinGecko IDs and back
    const symbolToId: Record<string, string> = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'SOL': 'solana',
    };

    const idToSymbol: Record<string, string> = {
      'bitcoin': 'BTC',
      'ethereum': 'ETH',
      'solana': 'SOL',
    };

    const coinIds = symbols
      .map((s) => symbolToId[s.toUpperCase()] || s.toLowerCase())
      .filter(Boolean);

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd`
        );
        const data = await response.json() as Record<string, { usd: number }>;

        for (const [coinId, priceData] of Object.entries(data)) {
          const normalizedSymbol = idToSymbol[coinId] || coinId.toUpperCase();
          const price: CryptoPrice = {
            symbol: normalizedSymbol,
            price: priceData.usd,
            timestamp: Date.now(),
          };
          handlers.onPrice?.(price);
          this.emit('cryptoPrice', price);
        }
      } catch (error) {
        this.log(`Failed to fetch crypto prices: ${error}`);
      }
    }, 3000); // Poll every 3 seconds

    const subscription: Subscription = {
      id: subId,
      topic: 'crypto_prices',
      type: 'update',
      unsubscribe: () => {
        clearInterval(pollInterval);
        this.subscriptions.delete(subId);
      },
    };

    this.subscriptions.set(subId, subscription as MarketSubscription);
    return subscription;
  }

  /**
   * Subscribe to Chainlink crypto prices.
   * Note: The new CLOB WebSocket doesn't support crypto_prices_chainlink topic.
   * This method delegates to subscribeCryptoPrices for backward compatibility.
   *
   * @param symbols - Array of symbols (e.g., ['ETH/USD', 'BTC/USD'])
   */
  subscribeCryptoChainlinkPrices(symbols: string[], handlers: CryptoPriceHandlers = {}): Subscription {
    // Normalize symbols: 'ETH/USD' -> 'ETH', 'BTC/USD' -> 'BTC'
    const normalizedSymbols = symbols.map((s) => s.replace('/USD', '').toUpperCase());

    return this.subscribeCryptoPrices(normalizedSymbols, {
      onPrice: (price: CryptoPrice) => {
        // Re-emit with /USD suffix for backward compatibility with DipArb
        const chainlinkPrice: CryptoPrice = {
          symbol: `${price.symbol}/USD`,
          price: price.price,
          timestamp: price.timestamp,
        };
        handlers.onPrice?.(chainlinkPrice);
      },
      onError: handlers.onError,
    });
  }

  // ============================================================================
  // Activity Subscriptions (via Data API polling)
  // ============================================================================

  /**
   * Subscribe to ALL trading activity across all markets.
   * Uses Data API /trades endpoint polling since the new CLOB WebSocket
   * doesn't support the activity topic.
   *
   * This is useful for Copy Trading / Smart Money monitoring.
   *
   * @param handlers - Event handlers
   */
  subscribeAllActivity(handlers: ActivityHandlers = {}): Subscription {
    const subId = `activity_${++this.subscriptionIdCounter}`;

    let lastTimestamp = Math.floor(Date.now() / 1000) - 60; // Start 60 seconds ago

    const pollInterval = setInterval(async () => {
      try {
        // Fetch recent trades from Data API
        const response = await fetch(
          `https://data-api.polymarket.com/trades?limit=200&startTimestamp=${lastTimestamp * 1000}`
        );

        if (!response.ok) {
          this.log(`Failed to fetch trades: ${response.status}`);
          return;
        }

        const trades = await response.json() as Array<Record<string, unknown>>;

        for (const rawTrade of trades) {
          const tradeTimestamp = Math.floor(
            this.normalizeTimestamp(rawTrade.timestamp) / 1000
          );

          // Skip old trades (already processed)
          if (tradeTimestamp <= lastTimestamp) continue;

          const activityTrade: ActivityTrade = {
            asset: (rawTrade.token_id as string) || '',
            conditionId: (rawTrade.condition_id as string) || '',
            eventSlug: (rawTrade.event_slug as string) || '',
            marketSlug: (rawTrade.slug as string) || '',
            outcome: (rawTrade.outcome as string) || '',
            price: Number(rawTrade.price) || 0,
            side: (rawTrade.side as 'BUY' | 'SELL') || 'BUY',
            size: Number(rawTrade.size) || 0,
            timestamp: tradeTimestamp,
            transactionHash: (rawTrade.transaction_hash as string) || '',
            trader: {
              name: (rawTrade.name as string) || undefined,
              address: (rawTrade.proxy_wallet as string) || undefined,
            },
          };

          handlers.onTrade?.(activityTrade);
          this.emit('activityTrade', activityTrade);

          lastTimestamp = Math.max(lastTimestamp, tradeTimestamp);
        }
      } catch (error) {
        this.log(`Failed to poll trades: ${error}`);
      }
    }, 5000); // Poll every 5 seconds

    const subscription: Subscription = {
      id: subId,
      topic: 'activity',
      type: '*',
      unsubscribe: () => {
        clearInterval(pollInterval);
        this.subscriptions.delete(subId);
      },
    };

    this.subscriptions.set(subId, subscription as MarketSubscription);
    return subscription;
  }

  // ============================================================================
  // Cache Access
  // ============================================================================

  /**
   * Get cached derived price for an asset
   */
  getPrice(assetId: string): PriceUpdate | undefined {
    return this.priceCache.get(assetId);
  }

  /**
   * Get all cached prices
   */
  getAllPrices(): Map<string, PriceUpdate> {
    return new Map(this.priceCache);
  }

  /**
   * Get cached orderbook for an asset
   */
  getBook(assetId: string): OrderbookSnapshot | undefined {
    return this.bookCache.get(assetId);
  }

  /**
   * Get cached last trade for an asset
   */
  getLastTrade(assetId: string): LastTradeInfo | undefined {
    return this.lastTradeCache.get(assetId);
  }

  // ============================================================================
  // Subscription Management
  // ============================================================================

  /**
   * Get all active subscriptions
   */
  getActiveSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Unsubscribe from all
   */
  unsubscribeAll(): void {
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.subscriptions.clear();
    this.handlerRegistry.clear();
  }

  // ============================================================================
  // Private Methods - Parsers
  // ============================================================================

  private parseOrderbook(event: ClobOrderBookEvent): OrderbookSnapshot {
    const bids = (event.bids || [])
      .map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .sort((a, b) => b.price - a.price);

    const asks = (event.asks || [])
      .map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .sort((a, b) => a.price - b.price);

    return {
      tokenId: event.asset_id,
      assetId: event.asset_id,
      market: event.market,
      bids,
      asks,
      timestamp: this.normalizeTimestamp(event.timestamp),
      tickSize: event.tick_size,
      minOrderSize: event.min_order_size,
      hash: '',
    };
  }

  private parsePriceChange(event: ClobPriceChangeEvent): PriceChange {
    return {
      assetId: event.asset_id,
      changes: [{ price: event.price, size: event.size }],
      timestamp: this.normalizeTimestamp(event.timestamp),
    };
  }

  private parseLastTrade(event: ClobLastTradeEvent): LastTradeInfo {
    return {
      assetId: event.asset_id,
      price: parseFloat(event.price),
      side: event.side,
      size: parseFloat(event.size),
      timestamp: this.normalizeTimestamp(event.timestamp),
    };
  }

  private parseTickSizeChange(event: ClobTickSizeChangeEvent): TickSizeChange {
    return {
      assetId: event.asset_id,
      oldTickSize: event.old_tick_size,
      newTickSize: event.new_tick_size,
      timestamp: this.normalizeTimestamp(event.timestamp),
    };
  }

  private handleBestBidAsk(_event: ClobBestBidAskEvent): void {
    // Best bid/ask is already included in orderbook.
    // Emit as priceChange for compatibility
    // Can be extended if needed
  }

  /**
   * Calculate derived price using Polymarket's display logic:
   * - If spread <= 0.10: use midpoint
   * - If spread > 0.10: use last trade price
   */
  private calculateDerivedPrice(assetId: string, book: OrderbookSnapshot): PriceUpdate | null {
    if (book.bids.length === 0 || book.asks.length === 0) {
      return null;
    }

    const bestBid = book.bids[0].price;
    const bestAsk = book.asks[0].price;
    const spread = bestAsk - bestBid;
    const midpoint = (bestBid + bestAsk) / 2;

    const lastTrade = this.lastTradeCache.get(assetId);
    const lastTradePrice = lastTrade?.price ?? midpoint;

    // Polymarket display logic
    const displayPrice = spread <= 0.10 ? midpoint : lastTradePrice;

    return {
      assetId,
      price: displayPrice,
      midpoint,
      spread,
      timestamp: book.timestamp,
    };
  }

  /**
   * Remove all handlers registered by a subscription
   */
  private removeHandlers(subId: string): void {
    const handlers = this.handlerRegistry.get(subId);
    if (handlers) {
      for (const { event, handler } of handlers) {
        this.off(event, handler as (...args: any[]) => void);
      }
    }
  }

  /**
   * Normalize timestamp to milliseconds
   */
  private normalizeTimestamp(ts: string | number | unknown): number {
    if (typeof ts === 'string') {
      const parsed = parseInt(ts, 10);
      if (isNaN(parsed)) return Date.now();
      // If timestamp is in seconds (< 1e12), convert to milliseconds
      return parsed < 1e12 ? parsed * 1000 : parsed;
    }
    if (typeof ts === 'number') {
      // If timestamp is in seconds (< 1e12), convert to milliseconds
      return ts < 1e12 ? ts * 1000 : ts;
    }
    return Date.now();
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[RealtimeService] ${message}`);
    }
  }
}

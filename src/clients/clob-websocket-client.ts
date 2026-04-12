/**
 * ClobWebSocketClient
 *
 * Native WebSocket client for the new Polymarket CLOB WebSocket endpoint:
 * wss://ws-subscriptions-clob.polymarket.com/ws/market
 *
 * This replaces the deprecated @polymarket/real-time-data-client which
 * connected to ws-live-data.polymarket.com (no longer supports CLOB messages).
 *
 * Protocol:
 * - Connect to wss://ws-subscriptions-clob.polymarket.com/ws/market
 * - Send subscription: { assets_ids: [...], type: "market", custom_feature_enabled: true }
 * - Receive events: book, price_change, last_trade_price, best_bid_ask, tick_size_change,
 *                   market_created, market_resolved
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface ClobWSConfig {
  /** WebSocket URL (default: wss://ws-subscriptions-clob.polymarket.com/ws/market) */
  url?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Ping interval in ms to keep connection alive (default: 30000) */
  pingInterval?: number;
}

// Event types from CLOB WebSocket
export type ClobEventType =
  | 'book'
  | 'price_change'
  | 'last_trade_price'
  | 'best_bid_ask'
  | 'tick_size_change'
  | 'market_created'
  | 'market_resolved';

export interface ClobOrderBookEvent {
  event_type: 'book';
  market: string;
  asset_id: string;
  timestamp: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  min_order_size: string;
  tick_size: string;
  last_trade_price?: string;
}

export interface ClobPriceChangeEvent {
  event_type: 'price_change';
  market: string;
  asset_id: string;
  side: 'BUY' | 'SELL';
  price: string;
  size: string;
  timestamp: string;
}

export interface ClobLastTradeEvent {
  event_type: 'last_trade_price';
  market: string;
  asset_id: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  timestamp: string;
}

export interface ClobBestBidAskEvent {
  event_type: 'best_bid_ask';
  market: string;
  asset_id: string;
  best_bid: string;
  best_ask: string;
  timestamp: string;
}

export interface ClobTickSizeChangeEvent {
  event_type: 'tick_size_change';
  market: string;
  asset_id: string;
  old_tick_size: string;
  new_tick_size: string;
  timestamp: string;
}

export interface ClobMarketCreatedEvent {
  event_type: 'market_created';
  market: string;
  asset_id: string;
  timestamp: string;
}

export interface ClobMarketResolvedEvent {
  event_type: 'market_resolved';
  market: string;
  asset_id: string;
  outcome: string;
  timestamp: string;
}

export type ClobEvent =
  | ClobOrderBookEvent
  | ClobPriceChangeEvent
  | ClobLastTradeEvent
  | ClobBestBidAskEvent
  | ClobTickSizeChangeEvent
  | ClobMarketCreatedEvent
  | ClobMarketResolvedEvent;

// ============================================================================
// ClobWebSocketClient Implementation
// ============================================================================

export class ClobWebSocketClient extends EventEmitter {
  private config: Required<ClobWSConfig>;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private subscribedAssets = new Set<string>();
  private isManualClose = false;

  constructor(config: ClobWSConfig = {}) {
    super();
    this.config = {
      url: config.url ?? 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? Infinity,
      reconnectDelay: config.reconnectDelay ?? 1000,
      maxReconnectDelay: config.maxReconnectDelay ?? 30000,
      debug: config.debug ?? false,
      pingInterval: config.pingInterval ?? 30000,
    };
  }

  /**
   * Connect to the CLOB WebSocket server
   */
  connect(): this {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.log('Already connected or connecting');
      return this;
    }

    this.isManualClose = false;
    this.connectInternal();
    return this;
  }

  /**
   * Internal connect method
   */
  private connectInternal(): void {
    this.log(`Connecting to ${this.config.url}...`);

    try {
      this.ws = new WebSocket(this.config.url);
    } catch (error) {
      this.emit('error', new Error(`Failed to create WebSocket: ${error}`));
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.log('Connected to CLOB WebSocket');
      this.reconnectAttempts = 0;
      this.startPingInterval();

      // Resubscribe to all assets that were previously subscribed
      if (this.subscribedAssets.size > 0) {
        this.resubscribeAll();
      }

      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      const text = data.toString();

      // Handle non-JSON error responses gracefully
      if (!text.startsWith('{')) {
        this.log(`Non-JSON message received: ${text.slice(0, 200)}`);
        return;
      }

      try {
        const message = JSON.parse(text) as ClobEvent;
        this.handleMessage(message);
      } catch (error) {
        this.log(`Failed to parse message: ${text.slice(0, 200)}`);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.log(`Connection closed (code: ${code}, reason: ${reason.toString()})`);
      this.stopPingInterval();

      if (!this.isManualClose) {
        this.emit('disconnected', { code, reason: reason.toString() });
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error: Error) => {
      this.log(`WebSocket error: ${error.message}`);
      this.emit('error', error);
    });
  }

  /**
   * Disconnect from the CLOB WebSocket server
   */
  disconnect(): void {
    this.isManualClose = true;
    this.stopPingInterval();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscribedAssets.clear();
    this.log('Disconnected from CLOB WebSocket');
    this.emit('disconnected');
  }

  /**
   * Subscribe to market data for specific asset IDs
   * @param assetIds - Array of token IDs to subscribe to
   */
  subscribeAssets(assetIds: string[]): void {
    // Add to set for reconnection
    assetIds.forEach((id) => this.subscribedAssets.add(id));

    if (this.ws?.readyState === WebSocket.OPEN) {
      // Send subscription for each asset individually
      for (const assetId of assetIds) {
        const subscriptionMessage = {
          op: 'subscribe',
          args: [{
            topic: 'market',
            asset_ids: [assetId],
            custom_feature_enabled: true,
          }],
        };

        this.ws.send(JSON.stringify(subscriptionMessage));
        this.log(`Subscribed to asset: ${assetId.slice(0, 20)}...`);
      }
    } else {
      this.log('Cannot subscribe: WebSocket not connected. Will subscribe on reconnect.');
    }
  }

  /**
   * Unsubscribe from market data for specific asset IDs
   */
  unsubscribeAssets(assetIds: string[]): void {
    assetIds.forEach((id) => this.subscribedAssets.delete(id));
    this.log(`Unsubscribed from assets: ${assetIds.join(', ')}`);
  }

  /**
   * Get currently subscribed asset IDs
   */
  getSubscribedAssets(): Set<string> {
    return new Set(this.subscribedAssets);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(event: ClobEvent): void {
    switch (event.event_type) {
      case 'book':
        this.emit('book', event as ClobOrderBookEvent);
        break;
      case 'price_change':
        this.emit('price_change', event as ClobPriceChangeEvent);
        break;
      case 'last_trade_price':
        this.emit('last_trade_price', event as ClobLastTradeEvent);
        break;
      case 'best_bid_ask':
        this.emit('best_bid_ask', event as ClobBestBidAskEvent);
        break;
      case 'tick_size_change':
        this.emit('tick_size_change', event as ClobTickSizeChangeEvent);
        break;
      case 'market_created':
        this.emit('market_created', event as ClobMarketCreatedEvent);
        break;
      case 'market_resolved':
        this.emit('market_resolved', event as ClobMarketResolvedEvent);
        break;
      default:
        this.log(`Unknown event type: ${(event as any).event_type}`);
    }

    // Also emit generic 'event' for any message
    this.emit('event', event);
  }

  /**
   * Resubscribe to all assets after reconnection
   */
  private resubscribeAll(): void {
    if (this.subscribedAssets.size === 0) return;

    // Resubscribe each asset individually
    for (const assetId of this.subscribedAssets) {
      const subscriptionMessage = {
        op: 'subscribe',
        args: [{
          topic: 'market',
          asset_ids: [assetId],
          custom_feature_enabled: true,
        }],
      };

      this.ws!.send(JSON.stringify(subscriptionMessage));
    }
    this.log(`Resubscribed to ${this.subscribedAssets.size} assets after reconnect`);
  }

  /**
   * Schedule a reconnect attempt
   */
  private scheduleReconnect(): void {
    if (!this.config.autoReconnect) return;
    if (this.isManualClose) return;
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.emit('error', new Error(`Max reconnect attempts (${this.config.maxReconnectAttempts}) reached`));
      return;
    }

    const delay = Math.min(
      this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    this.reconnectAttempts++;
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.emit('reconnecting', { attempt: this.reconnectAttempts });
      this.connectInternal();
    }, delay);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval();

    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.config.pingInterval);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[ClobWS] ${message}`);
    }
  }
}

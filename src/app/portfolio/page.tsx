'use client';

import { useState } from 'react';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { LoadingPage, ErrorState, EmptyState } from '@/components/ui/Loading';
import { Badge, TrendIndicator } from '@/components/ui/Badge';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { usePortfolio, useOrders, useStockBars } from '@/lib/hooks';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/format';

export default function PortfolioPage() {
  const { data: portfolio, error, loading, refresh } = usePortfolio();
  const { data: orders } = useOrders('all');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const { data: chartData } = useStockBars(selectedSymbol);
  const [showOrderForm, setShowOrderForm] = useState(false);

  if (loading) return <LoadingPage />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!portfolio) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Portfolio</h2>
          <p className="text-sm text-black/45 mt-1">Positions, performance, and orders</p>
        </div>
        <button
          onClick={() => setShowOrderForm(!showOrderForm)}
          className="px-4 py-2 text-sm font-medium text-white bg-accent-blue rounded-xl hover:bg-blue-600 transition-colors shadow-sm"
        >
          {showOrderForm ? 'Close' : 'New Order'}
        </button>
      </div>

      {/* Order Form */}
      {showOrderForm && <OrderForm onClose={() => setShowOrderForm(false)} onSubmit={refresh} />}

      {/* Account Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Portfolio Value"
          value={formatCurrency(portfolio.portfolioValue)}
          change={formatCurrency(portfolio.dayChange)}
          changeLabel="today"
          trend={portfolio.dayChange >= 0 ? 'up' : 'down'}
        />
        <MetricCard
          label="Equity"
          value={formatCurrency(portfolio.equity)}
        />
        <MetricCard
          label="Cash"
          value={formatCurrency(portfolio.cash)}
        />
        <MetricCard
          label="Unrealized P&L"
          value={formatCurrency(portfolio.totalUnrealizedPL)}
          change={formatPercent(portfolio.totalUnrealizedPLPercent)}
          trend={portfolio.totalUnrealizedPL >= 0 ? 'up' : 'down'}
        />
      </div>

      {/* Positions Table */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Positions</CardTitle>
        </div>
        {portfolio.positions.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState
              title="No positions"
              description="Your portfolio is empty. Use the order form to open positions."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-black/[0.06]">
                  {['Symbol', 'Qty', 'Avg Entry', 'Price', 'Mkt Value', 'Weight', 'P&L', 'P&L %', 'Today'].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-black/40 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.map((pos) => (
                  <tr
                    key={pos.symbol}
                    onClick={() => setSelectedSymbol(pos.symbol === selectedSymbol ? null : pos.symbol)}
                    className={`border-b border-black/[0.03] cursor-pointer transition-colors ${
                      selectedSymbol === pos.symbol
                        ? 'bg-accent-blue/[0.04]'
                        : 'hover:bg-black/[0.02]'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-semibold text-sm text-black/85">{pos.symbol}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-black/75 tabular-nums">
                      {formatNumber(pos.qty, { decimals: 0 })}
                    </td>
                    <td className="px-4 py-3 text-sm text-black/75 tabular-nums">
                      {formatCurrency(pos.avgEntry)}
                    </td>
                    <td className="px-4 py-3 text-sm text-black/85 font-medium tabular-nums">
                      {formatCurrency(pos.currentPrice)}
                    </td>
                    <td className="px-4 py-3 text-sm text-black/75 tabular-nums">
                      {formatCurrency(pos.marketValue)}
                    </td>
                    <td className="px-4 py-3 text-sm text-black/55 tabular-nums">
                      {pos.weight.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-sm font-medium tabular-nums ${
                          pos.unrealizedPL >= 0 ? 'text-accent-green' : 'text-accent-red'
                        }`}
                      >
                        {formatCurrency(pos.unrealizedPL)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <TrendIndicator value={pos.unrealizedPLPercent} />
                    </td>
                    <td className="px-4 py-3">
                      <TrendIndicator value={pos.intradayPLPercent} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Selected Position Chart */}
      {selectedSymbol && chartData && (
        <Card>
          <CardTitle>{selectedSymbol} — Daily Price</CardTitle>
          <TimeSeriesChart
            data={chartData.map((d) => ({ date: d.date, value: d.close }))}
            color="auto"
            height={300}
            gradientId={`pos-${selectedSymbol}`}
            valueFormatter={(v) => formatCurrency(v)}
          />
        </Card>
      )}

      {/* Recent Orders */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Recent Orders</CardTitle>
        </div>
        {!orders || orders.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState title="No recent orders" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-black/[0.06]">
                  {['Symbol', 'Side', 'Qty', 'Type', 'Status', 'Price', 'Date'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium text-black/40 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 20).map((order) => (
                  <tr key={order.id} className="border-b border-black/[0.03]">
                    <td className="px-4 py-3 font-semibold text-sm text-black/85">
                      {order.symbol}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={order.side === 'buy' ? 'green' : 'red'}>
                        {order.side.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-black/75 tabular-nums">{order.qty}</td>
                    <td className="px-4 py-3 text-sm text-black/55">{order.type}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          order.status === 'filled'
                            ? 'green'
                            : order.status === 'canceled'
                              ? 'neutral'
                              : order.status === 'rejected'
                                ? 'red'
                                : 'blue'
                        }
                      >
                        {order.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-black/75 tabular-nums">
                      {order.filled_avg_price
                        ? formatCurrency(parseFloat(order.filled_avg_price))
                        : order.limit_price
                          ? formatCurrency(parseFloat(order.limit_price))
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-black/45">
                      {new Date(order.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// Order form component
function OrderForm({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [qty, setQty] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        symbol: symbol.toUpperCase(),
        qty: parseInt(qty),
        side,
        type: orderType,
        time_in_force: 'day',
      };

      if (orderType === 'limit') {
        body.limit_price = parseFloat(limitPrice);
      }

      const res = await fetch('/api/alpaca?action=order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Order failed');
      }

      setSuccess(true);
      setTimeout(() => {
        onSubmit();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardTitle>Place Order</CardTitle>
      {success ? (
        <div className="py-4 text-center">
          <div className="w-12 h-12 rounded-full bg-accent-green/10 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-accent-green">Order submitted successfully</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-black/45 mb-1.5">Symbol</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="AAPL"
                required
                className="w-full px-3 py-2 text-sm bg-black/[0.03] border border-black/[0.06] rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-blue/30 focus:border-accent-blue/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black/45 mb-1.5">Quantity</label>
              <input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="10"
                min="1"
                required
                className="w-full px-3 py-2 text-sm bg-black/[0.03] border border-black/[0.06] rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-blue/30 focus:border-accent-blue/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-black/45 mb-1.5">Side</label>
              <div className="flex rounded-lg overflow-hidden border border-black/[0.06]">
                <button
                  type="button"
                  onClick={() => setSide('buy')}
                  className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                    side === 'buy'
                      ? 'bg-accent-green text-white'
                      : 'bg-black/[0.03] text-black/55 hover:bg-black/[0.06]'
                  }`}
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => setSide('sell')}
                  className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                    side === 'sell'
                      ? 'bg-accent-red text-white'
                      : 'bg-black/[0.03] text-black/55 hover:bg-black/[0.06]'
                  }`}
                >
                  Sell
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-black/45 mb-1.5">Type</label>
              <select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as 'market' | 'limit')}
                className="w-full px-3 py-2 text-sm bg-black/[0.03] border border-black/[0.06] rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
              >
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </select>
            </div>
          </div>

          {orderType === 'limit' && (
            <div className="max-w-xs">
              <label className="block text-xs font-medium text-black/45 mb-1.5">Limit Price</label>
              <input
                type="number"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="150.00"
                step="0.01"
                required
                className="w-full px-3 py-2 text-sm bg-black/[0.03] border border-black/[0.06] rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-accent-red bg-accent-red/5 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 text-sm font-medium text-white bg-accent-blue rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol.toUpperCase() || 'Stock'}`}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium text-black/55 hover:bg-black/[0.04] rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

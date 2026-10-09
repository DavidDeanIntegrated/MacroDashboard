// Actions the public /api/alpaca route may serve. Brokerage account and position
// reads are deliberately absent: the dashboard is public and the UI never calls them.
export const PUBLIC_ALPACA_ACTIONS = ['portfolio', 'portfolio-chart', 'bars', 'watchlist', 'snapshot'] as const;

export type PublicAlpacaAction = (typeof PUBLIC_ALPACA_ACTIONS)[number];

export function isPublicAlpacaAction(action: string | null): action is PublicAlpacaAction {
  return action !== null && (PUBLIC_ALPACA_ACTIONS as readonly string[]).includes(action);
}

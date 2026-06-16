// Macro sensitivity tags — what primarily drives each holding, so a regime shift
// instantly maps to "which names are in the crosshairs." Keyed by symbol with a
// category fallback for anything not explicitly listed.

export type MacroDriver =
  | 'Rates / Risk-on'
  | 'Value / Cyclical'
  | 'Broad Beta'
  | 'Global / USD'
  | 'Real Rates / USD'
  | 'Inflation'
  | 'Front-end Rates'
  | 'Liquidity / Risk-on';

export interface MacroSensitivity {
  driver: MacroDriver;
  badge: 'blue' | 'purple' | 'orange' | 'green' | 'yellow' | 'red' | 'neutral';
  note: string;
}

const DRIVER_META: Record<MacroDriver, { badge: MacroSensitivity['badge']; note: string }> = {
  'Rates / Risk-on':    { badge: 'purple', note: 'Long-duration growth — hurt by rising real rates & tightening liquidity, helped by easing.' },
  'Value / Cyclical':   { badge: 'green',  note: 'Earnings track the cycle; tends to lead in reflation and lag in slowdowns.' },
  'Broad Beta':         { badge: 'blue',   note: 'Moves with the overall market — your core risk exposure.' },
  'Global / USD':       { badge: 'blue',   note: 'Ex-US returns lift when the dollar weakens and global growth firms.' },
  'Real Rates / USD':   { badge: 'yellow', note: 'Gold rises when real yields fall / the dollar weakens — a stagflation & crisis hedge.' },
  'Inflation':          { badge: 'orange', note: 'Commodities beat when inflation runs hot; the purest "buy stuff" hedge.' },
  'Front-end Rates':    { badge: 'neutral',note: 'T-bill yield tracks the Fed path; capital-stable dry powder.' },
  'Liquidity / Risk-on':{ badge: 'red',    note: 'Most sensitive to global liquidity & risk appetite — first to fall in a de-risking.' },
};

const SYMBOL_DRIVER: Record<string, MacroDriver> = {
  // Growth equities / semis / high-conviction → rates & risk appetite
  NVDA: 'Rates / Risk-on', TSM: 'Rates / Risk-on', MSFT: 'Rates / Risk-on',
  PLTR: 'Rates / Risk-on', RKLB: 'Rates / Risk-on', RVI: 'Rates / Risk-on', SPCX: 'Rates / Risk-on',
  // Core / style / international
  VTI: 'Broad Beta', VTV: 'Value / Cyclical', VXUS: 'Global / USD',
  // Real assets
  GLD: 'Real Rates / USD', BCI: 'Inflation',
  // Cash & crypto
  SGOV: 'Front-end Rates', BTC: 'Liquidity / Risk-on',
};

const CATEGORY_DRIVER: Record<string, MacroDriver> = {
  'Broad Market': 'Broad Beta',
  'Value': 'Value / Cyclical',
  'International': 'Global / USD',
  'Quality Compounder': 'Rates / Risk-on',
  'High Conviction': 'Rates / Risk-on',
  'Gold': 'Real Rates / USD',
  'Commodity': 'Inflation',
  'Crypto': 'Liquidity / Risk-on',
  'Dry Powder': 'Front-end Rates',
};

export function macroSensitivity(symbol: string, category?: string): MacroSensitivity {
  const driver = SYMBOL_DRIVER[symbol] ?? (category ? CATEGORY_DRIVER[category] : undefined) ?? 'Broad Beta';
  const meta = DRIVER_META[driver];
  return { driver, badge: meta.badge, note: meta.note };
}

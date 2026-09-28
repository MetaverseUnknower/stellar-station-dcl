// The fuel dispenser's settings, from galaxy-gardeners-landing's src/config.ts (only what the dispenser uses).
// The dispenser itself (fuelPanel.ts, fuelPanelUi.tsx, fuelDrops.ts, payments.ts, playerState.ts, api.ts) is copied
// from that build unchanged but for import paths; vending.ts places the machines here, one in each docking pod.
export const API_BASE = 'https://galaxygardeners.app'
export const VENDING_MODEL = 'assets/models/RetroFuture_VendingMachine_fixed.glb'
// The Quick Top-Up capsule that pops out of the dispense tray on a successful claim
export const CAPSULE_MODEL = 'assets/models/QuickTopUp_3D.glb'
// Wallets (lowercase) that see the dispenser's on/off toggle. The server enforces who may flip the switch
// (POST /api/drops/dispenser/on|off); this list only decides whether the panel shows the button.
export const DISPENSER_OPERATORS = ['0xc2877b05cfe462e585fe3de8046f7528998af6f1', '0x7e567deabffceceea48da456ebb9ef84d159374c']

// Security rules verification spec for Dirty Dozen attack payloads
// Executed conceptually against DRAFT_firestore.rules / firestore.rules

export const DIRTY_DOZEN_CASES = [
  { name: 'Self-promote to admin on user create', path: 'users/attacker', expect: 'PERMISSION_DENIED' },
  { name: 'Self-grant credits on user update', path: 'users/user1', expect: 'PERMISSION_DENIED' },
  { name: 'Ghost field injection isAdmin=true', path: 'users/user1', expect: 'PERMISSION_DENIED' },
  { name: 'Cross-user PII private profile read', path: 'users/victim/private/profile', expect: 'PERMISSION_DENIED' },
  { name: 'Unfiltered list query on transactions', path: 'transactions', expect: 'PERMISSION_DENIED' },
  { name: 'Unverified admin email spoof', path: 'settings/site', expect: 'PERMISSION_DENIED' },
  { name: 'Client timestamp forgery on create', path: 'users/user1', expect: 'PERMISSION_DENIED' },
  { name: 'ID poisoning oversized doc ID', path: 'groups/' + 'x'.repeat(200), expect: 'PERMISSION_DENIED' },
  { name: 'Terminal transaction status reopen', path: 'transactions/txn1', expect: 'PERMISSION_DENIED' },
  { name: 'Unauthorized coupon minting by user', path: 'coupons/FREE-1234-5678', expect: 'PERMISSION_DENIED' },
  { name: 'Non-admin API log creation', path: 'api_logs/log1', expect: 'PERMISSION_DENIED' },
  { name: 'Non-admin site settings mutation', path: 'settings/site', expect: 'PERMISSION_DENIED' },
];

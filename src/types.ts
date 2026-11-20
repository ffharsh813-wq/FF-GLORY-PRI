export interface SiteSettings {
  websiteName: string;
  websiteLogo: string;
  websiteTitle: string;
  websiteDescription: string;
  websiteAnnouncement: string;
  registrationEnabled: boolean;
  maintenanceMode: boolean;
  websiteNotificationsEnabled: boolean;
  updatedAt: string;
  updatedBy?: string;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  basicCredits: number;
  premiumCredits: number;
  walletBalance: number;
  maxGroups: number;
  blocked: boolean;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegionInfo {
  id: string;
  region_name: string;
  region_code: string;
  tier: 'basic' | 'premium';
  enabled: boolean;
}

export interface PricingData {
  basic_credit_usd: number;
  premium_credit_usd: number;
  basic_credit_inr?: number;
  premium_credit_inr?: number;
  regions: RegionInfo[];
  source: 'upstream' | 'fallback';
  fetchedAt: string;
  upstreamError?: string;
}

export interface GroupBotDetail {
  account_id: string;
  nickname: string;
  glory: number;
  level?: number;
  credit_score?: number;
  exp?: number;
  liked?: number;
  avatar?: number;
  banner?: number;
  clan_id?: string;
  credit_default?: boolean;
}

export interface ClanInfoPayload {
  clan_glory?: {
    weekly_glory?: number;
    total_glory?: number;
    season?: number;
  };
  clan_id?: string;
  decoded?: {
    clan_id?: number | string;
    clan_name?: string;
    captain_id?: number | string;
    clan_level?: number;
    capacity?: number;
    member_num?: number;
    slogan?: string;
    region?: string;
  };
  leaderboard?: {
    cutoff_weekly_glory?: number;
    fetched_at?: string;
    in_top?: boolean;
    region?: string;
    season?: number;
    size?: number;
    total_glory?: number;
    weekly_glory?: number;
  };
  week?: {
    week?: number;
    ends_at?: string;
  };
  [key: string]: unknown;
}

export interface GroupRecord {
  group_id: string;
  userId: string;
  username: string;
  clan_id: string;
  region: string;
  region_name: string;
  tier: 'basic' | 'premium';
  status: 'running' | 'stopped' | 'archived' | 'deleted' | 'refunded';
  container_count: number;
  running_count: number;
  glory_farmed: number;
  uptime: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  last_match_at?: string;
  games_played?: number;
  can_extend?: boolean;
  can_replace?: boolean;
  extend_count?: number;
  replace_count?: number;
  max_extends?: number;
  max_replaces?: number;
  extend_price?: number;
  squad_file_enabled?: boolean;
  refunded?: boolean;
  refunded_at?: string;
  refund_requested?: boolean;
  refund_requested_at?: string;
  run_segments?: Array<{
    started_at: string;
    start_glory: number;
    end_glory: number;
    glory_farmed: number;
  }>;
  glory_synced_at?: string;
  glory_details?: GroupBotDetail[];
  glory_snapshots?: Array<{
    captured_at: string;
    total_glory: number;
    uptime_hours: number;
  }>;
  clan_info?: ClanInfoPayload;
}

export interface TransactionRecord {
  id: string;
  order_id: string;
  userId: string;
  username: string;
  type:
    | 'purchase'
    | 'deduction'
    | 'refund'
    | 'coupon_redeem'
    | 'coupon_create'
    | 'coupon_cancel'
    | 'admin_add'
    | 'admin_deduct'
    | 'admin_set'
    | 'deposit'
    | 'wallet_spend';
  basic_credits: number;
  premium_credits: number;
  amount_inr?: number;
  status: 'pending' | 'approved' | 'completed' | 'cancelled' | 'failed';
  details: string;
  performed_by?: string;
  created_at: string;
  updated_at: string;
}

export interface DepositOrderRecord {
  id: string;
  orderId: string;
  userId: string;
  username: string;
  amount: number;
  currency: 'INR';
  status: 'active' | 'paid' | 'expired' | 'failed';
  credited: boolean;
  creditedAt: string | null;
  upiIntent: string;
  paymentUrl: string;
  qrImageUrl: string;
  merchantName: string;
  upiId: string;
  expiresAt: string | null;
  gatewayReference?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddFundsConfigView {
  configured: boolean;
  upiId: string;
  basicCreditInr: number;
  premiumCreditInr: number;
  walletBalance: number;
}

export interface CreditAuditRecord {
  id: string;
  operationId: string;
  adminId: string;
  adminUsername: string;
  targetUserId: string;
  targetUsername: string;
  operation: 'add' | 'deduct' | 'set';
  creditType: 'basic' | 'premium';
  amount: number;
  previousBalance: number;
  newBalance: number;
  reason: string;
  timestamp: string;
}

export interface CouponRecord {
  code: string;
  basic_credits: number;
  premium_credits: number;
  status: 'active' | 'redeemed' | 'cancelled' | 'disabled' | 'expired';
  created_by_uid: string;
  created_by: string;
  is_admin_issued: boolean;
  usage_limit: number;
  used_count: number;
  redeemed_by: Array<{ uid: string; username: string; redeemed_at: string }>;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityLogRecord {
  id: string;
  userId: string;
  username: string;
  group_id?: string;
  clan_id?: string;
  clan_name?: string;
  region?: string;
  glory_farmed?: number;
  action:
    | 'start'
    | 'stop'
    | 'delete'
    | 'restart'
    | 'refund'
    | 'replace'
    | 'extend'
    | 'credit_add'
    | 'credit_deduct'
    | 'credit_set';
  details: string;
  runtime_label?: string;
  timestamp: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface ApiLogRecord {
  id: string;
  endpoint: string;
  method: string;
  statusCode: number;
  success: boolean;
  latencyMs: number;
  message: string;
  responsePreview?: string;
  timestamp: string;
}

export interface YouTubeVideoRecord {
  id: string;
  videoId: string;
  url: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelTitle: string;
  published: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

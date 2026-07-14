export interface InviteCodeDto {
  id: string;
  code: string;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface ReferralDto {
  id: string;
  inviteeId: string;
  inviteeDisplayName: string | null;
  inviteeAvatarUrl: string | null;
  inviteCode: string;
  status: 'active' | 'expired' | 'revoked';
  totalPaid: string;
  windowStart: string;
  windowEnd: string;
  createdAt: string;
}

export interface ReferralPayoutDto {
  id: string;
  referralId: string;
  inviterId: string;
  kind: 'producer_cut' | 'recharge_cut';
  amount: string;
  sourceRef: string;
  state: 'escrow' | 'released' | 'clawed_back';
  releasedAt: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface ReferralPayoutPageDto {
  payouts: ReferralPayoutDto[];
  limit: number;
  offset: number;
  total: number;
}

export interface UserSummaryDto {
  userId: string;
  username: string | null;
  followerCount: number;
  callCount: number;
}

export interface FollowStatusDto {
  publisherUserId: string;
  following: boolean;
  followerCount: number;
}

export interface FollowedUserDto extends UserSummaryDto {
  followedAt: string;
}

export interface FollowingPageDto {
  users: FollowedUserDto[];
  limit: number;
  page: number;
  pageSize: number;
  total: number;
}

export interface RatingStatusDto {
  publisherUserId: string;
  rating: number;
  rated: boolean;
  myRating: number | null;
}

export interface UserDto {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  tier: string;
  consumerBalance: string;
  consumerPendingDelta: string;
  consumerAvailable: string;
  producerBalance: string;
  producerPendingDelta: string;
  producerAvailable: string;
  withdrawableProducerBalance: string;
  escrow: string;
  stake: string;
  reputation: number;
  createdAt: string;
}

export type WithdrawalStatus = 'pending_review' | 'approved' | 'succeeded' | 'cancelled_refunded' | 'rejected_refunded';
export interface WithdrawalDto {
  id: string; requestNo: string; userId: string; amountCredits: string; amountFen: string; amountYuan: string;
  payoutAccountMasked: string; payoutRecipientNameMasked: string; payoutAccount?: string; payoutRecipientName?: string;
  status: WithdrawalStatus; applyDate: string; dailySequence: number; reviewNote: string | null;
  transactionNo: string | null; reviewedAt: string | null; transferredAt: string | null;
  refundedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string;
}
export interface WithdrawalPageDto { page: number; pageSize: number; total: number; data: WithdrawalDto[] }

export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}

export interface WechatLoginSession {
  sessionId: string;
  clientToken: string;
  expiresAt: string;
  inviteCode: string | null;
  next: string;
  authorizeUrl: string;
  wxLogin: {
    appid: string;
    scope: 'snsapi_login';
    redirectUri: string;
    state: string;
    selfRedirect: true;
    stylelite: 1;
    colorScheme: 'auto';
    lang: 'cn' | 'en';
  };
}

export interface WechatLoginResult extends AuthResponse {
  encryptionKey: string;
  isNewUser: boolean;
  inviteApplied: boolean;
  next: string;
}

export interface DeviceLimitResult {
  code: 'DEVICE_LIMIT_EXCEEDED';
  replacementToken: string;
  maxDevices: number;
  devices: Array<{ deviceId: string; nodeId: string; deviceName: string; createdAt: string; lastLoginAt: string; lastSeenAt: string; online: boolean }>;
}

export interface AuthError {
  message: string;
  status: number;
  blockedUntil?: string;
}

export interface ConsumerApiKeyDto {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  frozen: boolean;
  freezeReason: 'inactive' | 'manual' | null;
}

export interface RechargeOrder {
  outTradeNo: string;
  amountYuan: number;
  amountCents: number;
  credits: string;
  status: 'pending' | 'paid' | 'closed' | 'failed';
  codeUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
}

export interface SystemMessageDto {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

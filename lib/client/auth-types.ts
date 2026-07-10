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
  escrow: string;
  stake: string;
  reputation: number;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDto;
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

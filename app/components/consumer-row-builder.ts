import type { FollowedUserDto, RatingStatusDto, UserSummaryDto } from '@/lib/client/auth';
import type { Candidate } from '@/lib/server/types';
import { normalizeSupportedTools } from '@/lib/tool-support';
import { versionPrefixOrDefault } from '@/lib/version-prefix';
import type { ConsumerRow, SearchScope } from './consumer-utils';

export function buildConsumerRows(
  candidates: Candidate[], scope: SearchScope, keyword: string,
  summaries: Map<string, UserSummaryDto>, ratings: Map<string, RatingStatusDto>, followedUsers: FollowedUserDto[],
): ConsumerRow[] {
  const followed = new Map(followedUsers.map((user) => [user.userId, user]));
  const keywordLower = scope === 'all' ? keyword.toLowerCase() : '';
  const grouped = new Map<string, ConsumerRow>();
  for (const candidate of candidates) {
    for (const model of candidate.models) {
      if (keywordLower && model.toLowerCase() !== keywordLower) continue;
      const key = `${candidate.protocol} ${model}`;
      const row = grouped.get(key) ?? { model, protocol: candidate.protocol, nodes: [] };
      if (!row.nodes.some((node) => node.peerId === candidate.peerId)) {
        const summary = summaries.get(candidate.userId); const rating = ratings.get(candidate.userId);
        row.nodes.push({
          peerId: candidate.peerId, rttToServer: candidate.rttToServer, onlineMs: candidate.onlineMs, userId: candidate.userId,
          username: summary?.username ?? null, followerCount: followed.get(candidate.userId)?.followerCount ?? summary?.followerCount ?? 0,
          callCount: summary?.callCount ?? 0, costMultiplier: candidate.costMultipliers?.[model] ?? 1,
          following: scope === 'following' || followed.has(candidate.userId), rating: rating?.rating ?? 0,
          rated: rating?.rated ?? false, myRating: rating?.myRating ?? null,
          supportedTools: normalizeSupportedTools(candidate.supportedTools?.[model], candidate.protocol),
          versionPrefix: versionPrefixOrDefault(candidate.versionPrefixes?.[model], candidate.protocol),
        });
      }
      grouped.set(key, row);
    }
  }
  const rows = [...grouped.values()];
  rows.forEach((row) => row.nodes.sort((a, b) => a.rttToServer - b.rttToServer || b.onlineMs - a.onlineMs));
  return rows.sort((a, b) => a.protocol.localeCompare(b.protocol) || a.model.localeCompare(b.model));
}

import type { ToolId } from './tool-support';

/**
 * Anthropic SDK based adapters append `/v1/messages` themselves. Other
 * supported adapters expect the configured base URL to include the advertised
 * API version prefix.
 */
export function toolBaseUrlIncludesVersionPrefix(tool: ToolId, protocol: string): boolean {
  if (tool === 'claude') return false;
  if (protocol === 'anthropic' && (tool === 'claw' || tool === 'hermes')) return false;
  return true;
}

export function toolEndpoint(
  routeBase: string,
  versionPrefix: string,
  tool: ToolId,
  protocol: string,
): string {
  if (!toolBaseUrlIncludesVersionPrefix(tool, protocol) || versionPrefix === '/') return routeBase;
  return `${routeBase.replace(/\/+$/, '')}${versionPrefix}`;
}

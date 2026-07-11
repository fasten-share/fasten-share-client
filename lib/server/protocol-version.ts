export const API_VERSION = 1;
export const WIRE_VERSION = 1;
export const PRODUCER_WS_PATH = `/ws/v${API_VERSION}/producer`;

export const PRODUCER_CAPABILITIES = [
  'binary-chunks',
  'request-cancellation',
  'capacity-advertisement',
] as const;

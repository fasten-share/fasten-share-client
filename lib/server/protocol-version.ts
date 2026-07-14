// Kept inside the open-source client so client + desktop can be cloned and
// packaged without the private server repository. Incompatible wire changes
// must bump WIRE_VERSION on both sides.
export const API_VERSION = 1;
export const WIRE_VERSION = 1;
export const PRODUCER_WS_PATH = `/ws/v${API_VERSION}/producer`;

export const PRODUCER_CAPABILITIES = [
  'binary-chunks',
  'request-cancellation',
  'capacity-advertisement',
] as const;

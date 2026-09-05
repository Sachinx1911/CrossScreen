/**
 * Connection observability.
 *
 * This is the instrument the Phase 0.5 exit criteria are measured with, and
 * the seed of the stats pipeline in Phase 2. The question it exists to answer
 * is the one that decides future TURN cost: **did this connection go direct,
 * or through a relay?**
 */

export interface ConnectionSnapshot {
  /** 'direct' when both ends are host or server-reflexive; 'relay' via TURN. */
  transport: 'direct' | 'relay' | 'unknown';
  localCandidateType: string | undefined;
  remoteCandidateType: string | undefined;
  roundTripMs: number | undefined;
  availableOutgoingKbps: number | undefined;
  bitrateKbps: number | undefined;
  framesPerSecond: number | undefined;
  resolution: string | undefined;
  codec: string | undefined;
  packetsLost: number | undefined;
}

const EMPTY: ConnectionSnapshot = {
  transport: 'unknown',
  localCandidateType: undefined,
  remoteCandidateType: undefined,
  roundTripMs: undefined,
  availableOutgoingKbps: undefined,
  bitrateKbps: undefined,
  framesPerSecond: undefined,
  resolution: undefined,
  codec: undefined,
  packetsLost: undefined,
};

/**
 * A relayed connection is one where *either* end is a TURN relay candidate.
 * Checking only the local side would misreport half of them.
 */
export function classifyTransport(
  local: string | undefined,
  remote: string | undefined,
): ConnectionSnapshot['transport'] {
  if (local === undefined || remote === undefined) return 'unknown';
  return local === 'relay' || remote === 'relay' ? 'relay' : 'direct';
}

export async function readConnectionSnapshot(pc: RTCPeerConnection): Promise<ConnectionSnapshot> {
  const report = await pc.getStats();
  const byId = new Map<string, RTCStats>();
  report.forEach((stat: RTCStats) => {
    byId.set(stat.id, stat);
  });

  let pair: RTCStats | undefined;
  report.forEach((stat) => {
    // `selected` covers Firefox, which does not always set `nominated`.
    const s = stat as RTCStats & {
      state?: string;
      nominated?: boolean;
      selected?: boolean;
    };
    if (s.type !== 'candidate-pair' || s.state !== 'succeeded') return;
    if (s.nominated === true || s.selected === true || pair === undefined) pair = stat;
  });

  if (pair === undefined) return EMPTY;

  const p = pair as RTCStats & {
    localCandidateId?: string;
    remoteCandidateId?: string;
    currentRoundTripTime?: number;
    availableOutgoingBitrate?: number;
  };

  const candidateType = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    return (byId.get(id) as (RTCStats & { candidateType?: string }) | undefined)?.candidateType;
  };

  const local = candidateType(p.localCandidateId);
  const remote = candidateType(p.remoteCandidateId);

  let outbound: (RTCStats & Record<string, unknown>) | undefined;
  let inbound: (RTCStats & Record<string, unknown>) | undefined;
  report.forEach((stat) => {
    const s = stat as RTCStats & { kind?: string };
    if (s.type === 'outbound-rtp' && s.kind === 'video') outbound = s as never;
    if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s as never;
  });

  const media = outbound ?? inbound;
  const codecId = media?.['codecId'] as string | undefined;
  const codecMime = (byId.get(codecId ?? '') as (RTCStats & { mimeType?: string }) | undefined)
    ?.mimeType;

  const width = media?.['frameWidth'] as number | undefined;
  const height = media?.['frameHeight'] as number | undefined;

  return {
    transport: classifyTransport(local, remote),
    localCandidateType: local,
    remoteCandidateType: remote,
    roundTripMs:
      p.currentRoundTripTime === undefined ? undefined : Math.round(p.currentRoundTripTime * 1000),
    availableOutgoingKbps:
      p.availableOutgoingBitrate === undefined
        ? undefined
        : Math.round(p.availableOutgoingBitrate / 1000),
    bitrateKbps: undefined,
    framesPerSecond: media?.['framesPerSecond'] as number | undefined,
    resolution: width !== undefined && height !== undefined ? `${width}x${height}` : undefined,
    codec: codecMime?.split('/')[1],
    packetsLost: inbound?.['packetsLost'] as number | undefined,
  };
}

/** One readable line per sample. The Phase 0.5 gate is read off these. */
export function formatSnapshot(s: ConnectionSnapshot): string {
  const parts = [
    `transport=${s.transport}`,
    `path=${s.localCandidateType ?? '?'}->${s.remoteCandidateType ?? '?'}`,
    s.roundTripMs === undefined ? null : `rtt=${s.roundTripMs}ms`,
    s.resolution === undefined ? null : `res=${s.resolution}`,
    s.framesPerSecond === undefined ? null : `fps=${Math.round(s.framesPerSecond)}`,
    s.codec === undefined ? null : `codec=${s.codec}`,
    s.availableOutgoingKbps === undefined ? null : `avail=${s.availableOutgoingKbps}kbps`,
  ];
  return parts.filter((p) => p !== null).join(' ');
}

/**
 * Connection observability.
 *
 * This is the instrument the Phase 0.5 exit criteria are measured with, and
 * the seed of the stats pipeline in Phase 2. The question it exists to answer
 * first is the one that decides future TURN cost: **did this connection go
 * direct, or through a relay?** Phase 2.4/2.5 add two more: how bad is it
 * right now, and by how much.
 */

export interface ConnectionSnapshot {
  /** 'direct' when both ends are host or server-reflexive; 'relay' via TURN. */
  transport: 'direct' | 'relay' | 'unknown';
  localCandidateType: string | undefined;
  remoteCandidateType: string | undefined;
  roundTripMs: number | undefined;
  availableOutgoingKbps: number | undefined;
  /** ICE's estimate of receive capacity — the viewer-side counterpart of `availableOutgoingKbps`. Support varies by browser. */
  availableIncomingKbps: number | undefined;
  /** Actual measured throughput, not an estimate. `undefined` on the first sample — a rate needs two points. */
  bitrateKbps: number | undefined;
  /**
   * Share of packets lost, 0-100, over the interval since the previous
   * sample. `undefined` until there is a previous sample to measure the
   * interval against.
   */
  packetLossPct: number | undefined;
  framesPerSecond: number | undefined;
  resolution: string | undefined;
  codec: string | undefined;
  /** Cumulative count since the connection began. Kept alongside `packetLossPct` because a raw count is what a person asks for first when debugging one report. */
  packetsLost: number | undefined;
}

const EMPTY_SNAPSHOT: ConnectionSnapshot = {
  transport: 'unknown',
  localCandidateType: undefined,
  remoteCandidateType: undefined,
  roundTripMs: undefined,
  availableOutgoingKbps: undefined,
  availableIncomingKbps: undefined,
  bitrateKbps: undefined,
  packetLossPct: undefined,
  framesPerSecond: undefined,
  resolution: undefined,
  codec: undefined,
  packetsLost: undefined,
};

/**
 * The cumulative counters a rate is derived from, carried from one sample to
 * the next by whoever calls `readConnectionSnapshot` in a loop. Meaningless
 * read on its own — `deriveBitrateKbps` and `derivePacketLossPct` are what
 * turn two of these, one interval apart, into a number worth reporting.
 */
export interface RawCounters {
  timestampMs: number;
  /** bytesSent (sharer, from its own outbound-rtp) or bytesReceived (viewer, from its own inbound-rtp). */
  bytesTransferred: number | undefined;
  /**
   * Lost, from whichever report actually carries it: the viewer reads its own
   * inbound-rtp directly; the sharer has no inbound stream of its own to read
   * loss from, so it reads remote-inbound-rtp — the loss the far end reported
   * back over RTCP.
   */
  packetsLost: number | undefined;
  /** The "expected total" half of the loss ratio: packetsReceived (viewer) or packetsSent (sharer). */
  packetsTotal: number | undefined;
}

const EMPTY_RAW: RawCounters = {
  timestampMs: 0,
  bytesTransferred: undefined,
  packetsLost: undefined,
  packetsTotal: undefined,
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

/**
 * Actual throughput between two cumulative byte counts, not the ICE-layer
 * *estimate* `availableOutgoingKbps` already carries. `undefined` whenever
 * there is nothing to compare against yet, the clock did not advance, or a
 * renegotiation reset the underlying counter — a negative delta is never a
 * negative bitrate, it is stale state that should be dropped rather than
 * reported as a number.
 */
export function deriveBitrateKbps(
  previous: RawCounters | undefined,
  current: RawCounters,
): number | undefined {
  if (previous?.bytesTransferred === undefined || current.bytesTransferred === undefined) {
    return undefined;
  }
  const deltaMs = current.timestampMs - previous.timestampMs;
  const deltaBytes = current.bytesTransferred - previous.bytesTransferred;
  if (deltaMs <= 0 || deltaBytes < 0) return undefined;
  // bytes * 8 bits/byte, over deltaMs milliseconds, is already kbit/s: no
  // separate /1000 for kilo and *1000 for seconds needed, they cancel.
  return Math.round((deltaBytes * 8) / deltaMs);
}

/**
 * Loss as a percentage of packets *expected* in the interval, not of packets
 * received — the two disagree exactly when it matters, at high loss. Falls
 * back to the cumulative ratio for the first sample only, since reporting
 * nothing at all until the second stats tick would leave the first two
 * seconds of every connection unmeasured for no reason.
 */
export function derivePacketLossPct(
  previous: RawCounters | undefined,
  current: RawCounters,
): number | undefined {
  if (current.packetsLost === undefined || current.packetsTotal === undefined) return undefined;

  if (previous?.packetsLost === undefined || previous.packetsTotal === undefined) {
    const total = current.packetsLost + current.packetsTotal;
    return total <= 0 ? undefined : round1((current.packetsLost / total) * 100);
  }

  const deltaLost = current.packetsLost - previous.packetsLost;
  const deltaTotal = current.packetsTotal - previous.packetsTotal;
  const total = deltaLost + deltaTotal;
  if (deltaLost < 0 || total <= 0) return undefined;
  return round1((deltaLost / total) * 100);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * One read of `getStats()`, turned into the numbers the rest of this project
 * actually asks about. `previous` is this same call's own `raw` result from
 * the last tick — pass it back in for `bitrateKbps` and `packetLossPct` to be
 * anything but `undefined`.
 */
export async function readConnectionSnapshot(
  pc: RTCPeerConnection,
  previous?: RawCounters,
): Promise<{ snapshot: ConnectionSnapshot; raw: RawCounters }> {
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

  if (pair === undefined) return { snapshot: EMPTY_SNAPSHOT, raw: EMPTY_RAW };

  const p = pair as RTCStats & {
    localCandidateId?: string;
    remoteCandidateId?: string;
    currentRoundTripTime?: number;
    availableOutgoingBitrate?: number;
    availableIncomingBitrate?: number;
  };

  const candidateType = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    return (byId.get(id) as (RTCStats & { candidateType?: string }) | undefined)?.candidateType;
  };

  const local = candidateType(p.localCandidateId);
  const remote = candidateType(p.remoteCandidateId);

  let outbound: (RTCStats & Record<string, unknown>) | undefined;
  let inbound: (RTCStats & Record<string, unknown>) | undefined;
  // The sharer has no inbound video stream of its own to read loss from — it
  // reads what the viewer reported back over RTCP instead.
  let remoteInbound: (RTCStats & Record<string, unknown>) | undefined;
  report.forEach((stat) => {
    const s = stat as RTCStats & { kind?: string };
    if (s.type === 'outbound-rtp' && s.kind === 'video') outbound = s as never;
    if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s as never;
    if (s.type === 'remote-inbound-rtp' && s.kind === 'video') remoteInbound = s as never;
  });

  const media = outbound ?? inbound;
  const codecId = media?.['codecId'] as string | undefined;
  const codecMime = (byId.get(codecId ?? '') as (RTCStats & { mimeType?: string }) | undefined)
    ?.mimeType;

  const width = media?.['frameWidth'] as number | undefined;
  const height = media?.['frameHeight'] as number | undefined;

  const raw: RawCounters = {
    timestampMs: media?.['timestamp'] ?? Date.now(),
    bytesTransferred: (outbound?.['bytesSent'] ?? inbound?.['bytesReceived']) as number | undefined,
    packetsLost: (inbound?.['packetsLost'] ?? remoteInbound?.['packetsLost']) as number | undefined,
    packetsTotal: (inbound?.['packetsReceived'] ?? outbound?.['packetsSent']) as number | undefined,
  };

  const snapshot: ConnectionSnapshot = {
    transport: classifyTransport(local, remote),
    localCandidateType: local,
    remoteCandidateType: remote,
    roundTripMs:
      p.currentRoundTripTime === undefined ? undefined : Math.round(p.currentRoundTripTime * 1000),
    availableOutgoingKbps:
      p.availableOutgoingBitrate === undefined
        ? undefined
        : Math.round(p.availableOutgoingBitrate / 1000),
    availableIncomingKbps:
      p.availableIncomingBitrate === undefined
        ? undefined
        : Math.round(p.availableIncomingBitrate / 1000),
    bitrateKbps: deriveBitrateKbps(previous, raw),
    packetLossPct: derivePacketLossPct(previous, raw),
    framesPerSecond: media?.['framesPerSecond'] as number | undefined,
    resolution: width !== undefined && height !== undefined ? `${width}x${height}` : undefined,
    codec: codecMime?.split('/')[1],
    packetsLost: raw.packetsLost,
  };

  return { snapshot, raw };
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
    s.bitrateKbps === undefined ? null : `bitrate=${s.bitrateKbps}kbps`,
    s.packetLossPct === undefined ? null : `loss=${s.packetLossPct}%`,
    s.availableOutgoingKbps === undefined ? null : `avail=${s.availableOutgoingKbps}kbps`,
  ];
  return parts.filter((p) => p !== null).join(' ');
}

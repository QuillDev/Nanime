import { describe, expect, test } from "bun:test";
import {
  absoluteBufferedEnd,
  absolutePlaybackPosition,
  boundedSeekPosition,
  hlsTimelineOffset,
  planHlsSeek,
  sourceMetadataPosition,
  type HlsSeekPlan,
  type TimeRangesLike,
} from "./mediaTimeline.ts";

function mediaRanges(...ranges: readonly [number, number][]): TimeRangesLike {
  return {
    length: ranges.length,
    start: (index) => ranges[index]?.[0] ?? Number.NaN,
    end: (index) => ranges[index]?.[1] ?? Number.NaN,
  };
}

interface StreamingHarnessOptions {
  readonly direct?: boolean;
  readonly paused?: boolean;
  readonly position?: number;
  readonly seekable?: TimeRangesLike;
}

class StreamingHarness {
  readonly direct: boolean;
  readonly restarts: {
    readonly audioTrack: number | null;
    readonly position: number;
    readonly shouldPlay: boolean;
    readonly timelineOffset: number;
  }[] = [];
  paused: boolean;
  localTime: number;
  timelineOffset: number;
  pendingPosition: number | null = null;
  selectedAudio: number | null = null;
  seekable: TimeRangesLike;

  constructor(options: StreamingHarnessOptions = {}) {
    const position = options.position ?? 0;
    this.direct = options.direct ?? false;
    this.paused = options.paused ?? false;
    this.timelineOffset = this.direct ? 0 : hlsTimelineOffset(position);
    this.localTime = position - this.timelineOffset;
    this.seekable = options.seekable ?? mediaRanges();
  }

  get position(): number {
    return absolutePlaybackPosition(
      this.localTime,
      this.timelineOffset,
      this.pendingPosition,
    );
  }

  seek(position: number): HlsSeekPlan {
    if (this.direct) {
      this.localTime = Math.max(0, position);
      return { kind: "local", time: this.localTime };
    }
    const plan = planHlsSeek(position, this.timelineOffset, this.seekable);
    if (plan.kind === "local") {
      this.pendingPosition = null;
      this.localTime = plan.time;
    } else {
      this.restart(position, this.selectedAudio);
    }
    return plan;
  }

  switchAudio(audioTrack: number): void {
    this.restart(this.position, audioTrack);
  }

  loadedMetadata(): void {
    const position = sourceMetadataPosition(this.pendingPosition, this.timelineOffset);
    if (position !== null) {
      this.localTime = position;
    }
  }

  playing(): void {
    this.pendingPosition = null;
  }

  private restart(position: number, audioTrack: number | null): void {
    const timelineOffset = hlsTimelineOffset(position);
    this.pendingPosition = position;
    this.selectedAudio = audioTrack;
    this.timelineOffset = timelineOffset;
    this.restarts.push({ position, audioTrack, timelineOffset, shouldPlay: !this.paused });
  }
}

describe("streaming interaction harness", () => {
  test("tracks absolute time across a segment-aligned HLS resume", () => {
    const stream = new StreamingHarness({ position: 367, seekable: mediaRanges([0, 30]) });

    expect(stream.timelineOffset).toBe(366);
    expect(stream.localTime).toBe(1);
    expect(stream.position).toBe(367);
  });

  test("seeks inside the active HLS window without restarting", () => {
    const stream = new StreamingHarness({ position: 367, seekable: mediaRanges([0, 30]) });

    expect(stream.seek(388)).toEqual({ kind: "local", time: 22 });
    expect(stream.position).toBe(388);
    expect(stream.restarts).toHaveLength(0);
  });

  test("restarts HLS outside the active window and keeps requested time stable", () => {
    const stream = new StreamingHarness({ position: 367, seekable: mediaRanges([0, 30]) });

    expect(stream.seek(901)).toEqual({ kind: "restart" });
    expect(stream.restarts).toEqual([{
      audioTrack: null,
      position: 901,
      shouldPlay: true,
      timelineOffset: 900,
    }]);
    expect(stream.position).toBe(901);

    stream.loadedMetadata();
    expect(stream.localTime).toBe(1);
    expect(stream.position).toBe(901);
    stream.playing();
    expect(stream.position).toBe(901);
  });

  test("preserves pause and audio selection through distant seeks", () => {
    const stream = new StreamingHarness({
      paused: true,
      position: 120,
      seekable: mediaRanges([0, 20]),
    });

    stream.switchAudio(3);
    stream.playing();
    stream.seek(600);

    expect(stream.restarts).toEqual([
      { audioTrack: 3, position: 120, shouldPlay: false, timelineOffset: 120 },
      { audioTrack: 3, position: 600, shouldPlay: false, timelineOffset: 600 },
    ]);
  });

  test("uses direct media time without HLS offsets or restarts", () => {
    const stream = new StreamingHarness({ direct: true, position: 40 });

    expect(stream.seek(500)).toEqual({ kind: "local", time: 500 });
    expect(stream.position).toBe(500);
    expect(stream.restarts).toHaveLength(0);
  });

  test("reports the absolute buffered edge from the range containing playback", () => {
    const buffered = mediaRanges([0, 4], [8, 22], [30, 40]);

    expect(absoluteBufferedEnd(buffered, 10, 610)).toBe(622);
    expect(absoluteBufferedEnd(buffered, 6, 606)).toBe(606);
  });

  test("clamps relative seeks to the playable timeline", () => {
    expect(boundedSeekPosition(5, -10, 100)).toBe(0);
    expect(boundedSeekPosition(95, 10, 100)).toBe(100);
    expect(boundedSeekPosition(50, 10, 100)).toBe(60);
    expect(boundedSeekPosition(50, 10, Number.NaN)).toBe(0);
  });

  test("sanitizes invalid resume positions before segment alignment", () => {
    expect(hlsTimelineOffset(-20)).toBe(0);
    expect(hlsTimelineOffset(Number.POSITIVE_INFINITY)).toBe(0);
    expect(hlsTimelineOffset(9.9)).toBe(8);
  });
});

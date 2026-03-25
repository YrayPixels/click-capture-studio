export type Segment = {
  id: string;
  srcStart: number;
  srcEnd: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getOutputDuration(segments: Segment[]) {
  return segments.reduce((acc, s) => acc + Math.max(0, s.srcEnd - s.srcStart), 0);
}

export function getOutputOffsets(segments: Segment[]) {
  const offsets: number[] = [];
  let sum = 0;
  for (const s of segments) {
    offsets.push(sum);
    sum += Math.max(0, s.srcEnd - s.srcStart);
  }
  return offsets;
}

export function sourceTimeFromOutputTime(segments: Segment[], tOut: number) {
  if (!segments.length) return 0;
  const outputDuration = getOutputDuration(segments);
  const safeOut = clamp(tOut, 0, outputDuration);
  let cumOut = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segDur = Math.max(0, seg.srcEnd - seg.srcStart);
    if (safeOut < cumOut + segDur || i === segments.length - 1) {
      return seg.srcStart + (safeOut - cumOut);
    }
    cumOut += segDur;
  }

  return segments[segments.length - 1].srcEnd;
}

export function segmentIndexFromSourceTime(segments: Segment[], tSrc: number) {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (tSrc >= seg.srcStart && (tSrc < seg.srcEnd || (isLast && tSrc <= seg.srcEnd))) {
      return i;
    }
  }
  return -1;
}

export function splitSegmentAtOutputTime(
  segments: Segment[],
  tOut: number,
  makeId: () => string
) {
  if (!segments.length) return segments;

  const tSrc = sourceTimeFromOutputTime(segments, tOut);
  const idx = segmentIndexFromSourceTime(segments, tSrc);
  if (idx < 0) return segments;

  const seg = segments[idx];
  const boundary = clamp(tSrc, seg.srcStart + 0.02, seg.srcEnd - 0.02);
  if (boundary <= seg.srcStart + 0.01 || boundary >= seg.srcEnd - 0.01) return segments;

  const left = { id: makeId(), srcStart: seg.srcStart, srcEnd: boundary };
  const right = { id: makeId(), srcStart: boundary, srcEnd: seg.srcEnd };
  const next = segments.slice();
  next.splice(idx, 1, left, right);
  return next;
}

export function deleteSegmentById(segments: Segment[], segmentId: string) {
  if (segments.length <= 1) return segments;
  return segments.filter((s) => s.id !== segmentId);
}

export function reorderSegment(
  segments: Segment[],
  dragSegmentId: string,
  insertIndex: number
) {
  const fromIndex = segments.findIndex((s) => s.id === dragSegmentId);
  if (fromIndex < 0) return segments;
  const next = segments.slice();
  const [seg] = next.splice(fromIndex, 1);
  const safeInsertIndex = clamp(insertIndex, 0, next.length);
  next.splice(safeInsertIndex, 0, seg);
  return next;
}

export function trimSegment(
  segment: Segment,
  patch: Partial<Pick<Segment, "srcStart" | "srcEnd">>,
  videoDuration: number
) {
  const minDur = 0.05;
  const nextStart = typeof patch.srcStart === "number" ? patch.srcStart : segment.srcStart;
  const nextEnd = typeof patch.srcEnd === "number" ? patch.srcEnd : segment.srcEnd;
  const clampedStart = clamp(nextStart, 0, Math.max(0, videoDuration - minDur));
  const clampedEnd = clamp(
    nextEnd,
    clampedStart + minDur,
    Math.max(clampedStart + minDur, videoDuration)
  );
  return { ...segment, srcStart: clampedStart, srcEnd: clampedEnd };
}

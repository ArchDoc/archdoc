import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
} from "@xyflow/react";
import type { Box, Point } from "../graph/layout.js";
import { packetTiming, pointAlong, polylineLength, roundedPath } from "../graph/route.js";

export interface RoutedData extends Record<string, unknown> {
  /** The route the layout found, in absolute coordinates. Without one, a smooth step is drawn. */
  points?: Point[] | undefined;
  /** Where along the route the label sits, from 0 to 1. Defaults to the middle. */
  labelAt?: number | undefined;
  /**
   * A message travelling the edge, such as the current journey step's; with
   * `reply`, a request that goes to the target and whose answer comes back.
   */
  packet?: { label: string; missing?: boolean | undefined; reply?: string | undefined } | undefined;
  /**
   * What the use is for, always shown: wrapped lines in the box the layout
   * kept for them beside the line, or, without one, at the label point.
   */
  note?:
    | {
        lines: string[];
        text: string;
        box?: Box | undefined;
        /** Lines drawn faint, like their edge. */
        className?: string | undefined;
        /** Pointing at the label lights its line, so it's clear which line it's for. */
        onHover?: ((on: boolean) => void) | undefined;
      }
    | undefined;
}

export type RoutedEdge = Edge<RoutedData, "routed">;

/** An edge drawn along the layout's orthogonal route, with rounded corners. */
export function Routed(props: EdgeProps<RoutedEdge>) {
  const points = props.data?.points;
  let path: string;
  let at: Point;
  let length: number;
  if (points && points.length >= 2) {
    path = roundedPath(points, 10);
    at = pointAlong(points, props.data?.labelAt ?? 0.5);
    length = polylineLength(points);
  } else {
    const [d, x, y] = getSmoothStepPath({ ...props, borderRadius: 10 });
    path = d;
    at = { x, y };
    // A smooth step goes across and then along: about the two legs.
    length = Math.abs(props.targetX - props.sourceX) + Math.abs(props.targetY - props.sourceY);
  }
  const packet = props.data?.packet;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
        label={props.label}
        labelX={at.x}
        labelY={at.y}
        labelStyle={props.labelStyle}
        labelShowBg={props.labelShowBg}
        labelBgStyle={props.labelBgStyle}
        labelBgPadding={props.labelBgPadding}
        labelBgBorderRadius={props.labelBgBorderRadius}
        interactionWidth={props.interactionWidth}
      />
      {packet ? <Packets path={path} at={at} length={length} {...packet} /> : null}
      {props.data?.note ? <Note {...props.data.note} at={at} /> : null}
    </>
  );
}

/** A use's description, beside its line. */
function Note(props: {
  lines: string[];
  text: string;
  box?: Box | undefined;
  at: Point;
  className?: string | undefined;
  onHover?: ((on: boolean) => void) | undefined;
}) {
  const { box } = props;
  const style: React.CSSProperties = box
    ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, minHeight: box.height }
    : { transform: `translate(-50%, -50%) translate(${props.at.x}px, ${props.at.y}px)` };
  return (
    <EdgeLabelRenderer>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointing at a label only lights its line; the text is the same either way. */}
      <div
        className={["edge-note", props.className].filter(Boolean).join(" ")}
        style={style}
        title={props.lines.join(" ") === props.text ? undefined : props.text}
        onMouseEnter={() => props.onHover?.(true)}
        onMouseLeave={() => props.onHover?.(false)}
      >
        {props.lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of one label, in order.
          <span key={i}>{l}</span>
        ))}
      </div>
    </EdgeLabelRenderer>
  );
}

/** The widest a message chip gets. */
const PACKET_WIDTH = 220;

/**
 * The step's message moving along the edge from source to target, at one
 * speed whatever the line's length. With a reply, the request goes to the
 * target, waits, and the answer comes back to the caller.
 */
function Packets(props: {
  path: string;
  at: Point;
  length: number;
  label: string;
  missing?: boolean | undefined;
  reply?: string | undefined;
}) {
  const still =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (still) {
    const label = props.reply ? `${props.label} ⇄ ${props.reply}` : props.label;
    return (
      <g
        className={`packet${props.missing && !props.reply ? " is-missing" : ""}`}
        transform={`translate(${props.at.x} ${props.at.y - 18})`}
      >
        <Chip label={label} />
      </g>
    );
  }
  const t = packetTiming(props.length, props.reply !== undefined);
  return (
    <>
      <Moving
        path={props.path}
        dur={t.dur}
        motion={t.out}
        className={`packet${props.missing ? " is-missing" : ""}`}
        label={props.label}
      />
      {t.back && props.reply !== undefined ? (
        <Moving
          path={props.path}
          dur={t.dur}
          motion={t.back}
          className="packet is-reply"
          label={props.reply}
        />
      ) : null}
    </>
  );
}

/** One chip on its way, shown only for its part of the loop. */
function Moving(props: {
  path: string;
  dur: number;
  motion: { keyPoints: string; keyTimes: string; shown: [number, number] };
  className: string;
  label: string;
}) {
  const [from, to] = props.motion.shown;
  // Shown from `from` to `to` of each loop, hidden the rest of it.
  const whole = from === 0 && to === 1;
  const values = from === 0 ? "1;0" : "0;1";
  const times = from === 0 ? `0;${to}` : `0;${from}`;
  return (
    <g className={props.className} opacity={whole || from === 0 ? 1 : 0}>
      <animateMotion
        dur={`${props.dur}s`}
        repeatCount="indefinite"
        path={props.path}
        keyPoints={props.motion.keyPoints}
        keyTimes={props.motion.keyTimes}
        calcMode="linear"
      />
      {whole ? null : (
        <animate
          attributeName="opacity"
          dur={`${props.dur}s`}
          repeatCount="indefinite"
          values={values}
          keyTimes={times}
          calcMode="discrete"
        />
      )}
      <g transform="translate(0 -14)">
        <Chip label={props.label} />
      </g>
    </g>
  );
}

/** A chip with the message's name, cut to fit; the full name is its tooltip. */
function Chip({ label }: { label: string }) {
  const fits = Math.floor((PACKET_WIDTH - 22) / 7);
  const text = label.length > fits ? `${label.slice(0, fits - 1).trimEnd()}…` : label;
  const width = Math.min(PACKET_WIDTH, text.length * 7 + 22);
  return (
    <>
      <title>{label}</title>
      <rect x={-width / 2} y={-10} width={width} height={20} rx={10} />
      <text textAnchor="middle" dominantBaseline="central">
        {text}
      </text>
    </>
  );
}

export const edgeTypes = { routed: Routed };

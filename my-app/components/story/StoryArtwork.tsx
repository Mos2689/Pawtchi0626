import React, { useEffect, useMemo } from 'react';
import Reanimated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Text as SvgText,
  type PathProps,
} from 'react-native-svg';

import {
  buildScentContours,
  buildWeatherFlowPaths,
  formatStoryCoordinate,
  projectStoryRoute,
  type StoryPoint,
  type StoryRouteGeometry,
} from '../../lib/walkStoryGeometry';
import type { StoryContext } from './StorySlide';
import { storyColor, storyFont, storyMetric } from './storyTheme';

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

interface ArtworkProps {
  ctx: StoryContext;
  width: number;
  height: number;
}

interface DrawPathProps extends PathProps {
  dashLength?: number;
  delay?: number;
}

function DrawPath({ dashLength = 1600, delay = 80, ...props }: DrawPathProps) {
  const reducedMotion = useReducedMotion();
  const offset = useSharedValue(reducedMotion ? 0 : dashLength);

  useEffect(() => {
    offset.value = reducedMotion
      ? 0
      : withDelay(
          delay,
          withTiming(0, { duration: 900, easing: Easing.out(Easing.cubic) }),
        );
  }, [dashLength, delay, offset, reducedMotion]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }));

  return (
    <AnimatedPath
      {...props}
      animatedProps={animatedProps}
      strokeDasharray={`${dashLength} ${dashLength}`}
    />
  );
}

function ScentMarker({
  point,
  rings = 4,
  radius = storyMetric.markerRadius,
}: {
  point: StoryPoint;
  rings?: number;
  radius?: number;
}) {
  return (
    <G>
      {Array.from({ length: rings }, (_, index) => {
        const ringRadius = radius + 5 + index * 4.2;
        return (
          <Circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={ringRadius}
            fill="none"
            stroke={storyColor.ink}
            strokeWidth={storyMetric.fineLineWidth}
            strokeOpacity={Math.max(0.34, 0.88 - index * 0.08)}
          />
        );
      })}
      <Circle cx={point.x} cy={point.y} r={radius} fill={storyColor.ink} />
    </G>
  );
}

function RouteEnds({
  geometry,
  endFilled = true,
}: {
  geometry: StoryRouteGeometry;
  endFilled?: boolean;
}) {
  return (
    <>
      <Circle
        cx={geometry.start.x}
        cy={geometry.start.y}
        r={7}
        fill={storyColor.canvas}
        stroke={storyColor.route}
        strokeWidth={3}
      />
      <Circle
        cx={geometry.end.x}
        cy={geometry.end.y}
        r={7}
        fill={endFilled ? storyColor.ink : storyColor.canvas}
        stroke={endFilled ? storyColor.route : storyColor.ink}
        strokeWidth={3}
      />
    </>
  );
}

function routeGeometry(
  ctx: StoryContext,
  width: number,
  height: number,
  pad: number,
): StoryRouteGeometry | null {
  return projectStoryRoute(ctx.route, ctx.sniffStops, width, height, pad);
}

function labelForPoint(
  point: StoryPoint,
  label: string,
  width: number,
  verticalOffset: number,
) {
  const onRight = point.x < width * 0.56;
  const x = point.x + (onRight ? 16 : -16);
  return (
    <G>
      <Line
        x1={point.x + (onRight ? 7 : -7)}
        y1={point.y}
        x2={x + (onRight ? -4 : 4)}
        y2={point.y + verticalOffset}
        stroke={storyColor.ink}
        strokeWidth={1.1}
      />
      <SvgText
        x={x}
        y={point.y + verticalOffset - 4}
        fill={storyColor.ink}
        fontFamily={storyFont.mono}
        fontSize={10}
        letterSpacing={0.8}
        textAnchor={onRight ? 'start' : 'end'}
      >
        {label.toUpperCase()}
      </SvgText>
    </G>
  );
}

export function JourneyArtwork({ ctx, width, height }: ArtworkProps) {
  const geometry = useMemo(
    () => routeGeometry(ctx, width, height, Math.max(48, width * 0.15)),
    [ctx, height, width],
  );
  if (!geometry) return <GpsFallbackArtwork ctx={ctx} width={width} height={height} />;

  const start = ctx.route[0];
  const end = ctx.route[ctx.route.length - 1];
  const startLabel = ctx.labels.startLabel?.trim() || 'START';
  const endLabel = ctx.labels.isLoop
    ? 'HOME AGAIN'
    : ctx.labels.endLabel?.trim() || 'END';
  const farthest = geometry.points.reduce((best, point) => {
    const currentDistance = Math.hypot(point.x - geometry.start.x, point.y - geometry.start.y);
    const bestDistance = Math.hypot(best.x - geometry.start.x, best.y - geometry.start.y);
    return currentDistance > bestDistance ? point : best;
  }, geometry.points[0]);
  const farthestLabel = ctx.labels.farthestLabel?.trim()
    ? `FARTHEST · ${ctx.labels.farthestLabel.trim()}`
    : 'THE LONG WAY ROUND';

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <SvgText
        x={12}
        y={18}
        fill={storyColor.ink}
        fontFamily={storyFont.mono}
        fontSize={10}
        letterSpacing={0.8}
      >
        {formatStoryCoordinate(start?.lat, 'lat')}
      </SvgText>
      <SvgText
        x={12}
        y={33}
        fill={storyColor.ink}
        fontFamily={storyFont.mono}
        fontSize={10}
        letterSpacing={0.8}
      >
        {formatStoryCoordinate(start?.lng, 'lng')}
      </SvgText>
      <DrawPath
        d={geometry.path}
        fill="none"
        stroke={storyColor.route}
        strokeWidth={storyMetric.lineWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle
        cx={geometry.start.x}
        cy={geometry.start.y}
        r={8}
        fill={storyColor.canvas}
        stroke={storyColor.ink}
        strokeWidth={3}
      />
      <ScentMarker point={geometry.end} rings={1} radius={6} />
      {geometry.stops.map((stop) => (
        <Circle
          key={`${stop.sourceIndex}-${stop.x}-${stop.y}`}
          cx={stop.x}
          cy={stop.y}
          r={4.5}
          fill={storyColor.ink}
        />
      ))}
      {labelForPoint(geometry.start, `START · ${startLabel}`, width, -25)}
      {labelForPoint(geometry.end, endLabel, width, 33)}
      {labelForPoint(farthest, farthestLabel, width, farthest.y < height * 0.5 ? -24 : 28)}
      <SvgText
        x={width - 12}
        y={height - 18}
        fill={storyColor.ink}
        fontFamily={storyFont.mono}
        fontSize={10}
        letterSpacing={0.8}
        textAnchor="end"
      >
        {formatStoryCoordinate(end?.lat, 'lat')}
      </SvgText>
      <SvgText
        x={width - 12}
        y={height - 3}
        fill={storyColor.ink}
        fontFamily={storyFont.mono}
        fontSize={10}
        letterSpacing={0.8}
        textAnchor="end"
      >
        {formatStoryCoordinate(end?.lng, 'lng')}
      </SvgText>
    </Svg>
  );
}

export function GpsFallbackArtwork({ width, height }: ArtworkProps) {
  const primary = `M${width * 0.07},${height * 0.28} C${width * 0.25},${height * 0.17} ${width * 0.4},${height * 0.38} ${width * 0.53},${height * 0.31} S${width * 0.78},${height * 0.16} ${width * 0.93},${height * 0.28}`;
  const secondary = `M${width * 0.1},${height * 0.58} C${width * 0.26},${height * 0.43} ${width * 0.42},${height * 0.7} ${width * 0.58},${height * 0.56} S${width * 0.84},${height * 0.42} ${width * 0.9},${height * 0.66}`;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Path
        d={primary}
        fill="none"
        stroke={storyColor.ink}
        strokeWidth={1.4}
        strokeDasharray="2 8"
        strokeLinecap="round"
      />
      <Path
        d={secondary}
        fill="none"
        stroke={storyColor.ink}
        strokeWidth={1.4}
        strokeDasharray="2 8"
        strokeLinecap="round"
      />
      <Path
        d={`M${width * 0.39},${height * 0.44} C${width * 0.47},${height * 0.39} ${width * 0.54},${height * 0.52} ${width * 0.62},${height * 0.46}`}
        fill="none"
        stroke={storyColor.route}
        strokeWidth={storyMetric.lineWidth}
        strokeLinecap="round"
      />
      <Circle cx={width * 0.39} cy={height * 0.44} r={6} fill={storyColor.canvas} stroke={storyColor.ink} strokeWidth={2} />
      <Circle cx={width * 0.62} cy={height * 0.46} r={6} fill={storyColor.ink} />
    </Svg>
  );
}

export function SniffArtwork({ ctx, width, height }: ArtworkProps) {
  const geometry = useMemo(
    () => routeGeometry(ctx, width, height, Math.max(26, width * 0.08)),
    [ctx, height, width],
  );
  const longest = [...ctx.sniffStops].sort((a, b) => b.dwellS - a.dwellS)[0];
  const centerX = width * 0.52;
  const centerY = height * 0.48;
  const center = { x: centerX, y: centerY };
  const dwellMinutes = Math.max(1, Math.round((longest?.dwellS ?? 0) / 60));
  const contours = useMemo(
    () =>
      buildScentContours(
        { x: centerX, y: centerY },
        Math.min(width, height) * 0.32,
        longest?.dwellS ?? 0,
        ctx.sessionId,
      ),
    [centerX, centerY, ctx.sessionId, height, longest?.dwellS, width],
  );

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {geometry && (
        <DrawPath
          d={geometry.path}
          fill="none"
          stroke={storyColor.route}
          strokeWidth={storyMetric.lineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {contours.map((path, index) => (
        <Path
          key={index}
          d={path}
          fill="none"
          stroke={storyColor.ink}
          strokeWidth={storyMetric.fineLineWidth}
          strokeOpacity={0.9}
        />
      ))}
      <Circle cx={center.x} cy={center.y - 34} r={9} fill={storyColor.ink} />
      <SvgText
        x={center.x}
        y={center.y + 34}
        fill={storyColor.ink}
        fontFamily={storyFont.display}
        fontSize={72}
        textAnchor="middle"
      >
        {dwellMinutes}
      </SvgText>
      <SvgText
        x={center.x}
        y={center.y + 58}
        fill={storyColor.ink}
        fontFamily={storyFont.mono}
        fontSize={9.5}
        letterSpacing={1}
        textAnchor="middle"
      >
        MIN AT THE BEST ONE
      </SvgText>
      {(geometry?.stops ?? []).map((stop) => (
        <ScentMarker
          key={`${stop.sourceIndex}-${stop.x}-${stop.y}`}
          point={stop}
          rings={3}
          radius={4.5}
        />
      ))}
    </Svg>
  );
}

export function WeatherArtwork({ ctx, width, height }: ArtworkProps) {
  const flows = useMemo(
    () => buildWeatherFlowPaths(width * 0.9, height * 0.72, ctx.sessionId, 6),
    [ctx.sessionId, height, width],
  );
  const narrowWidth = width * 0.36;
  const narrowGeometry = useMemo(
    () => routeGeometry(ctx, narrowWidth, height * 0.86, 18),
    [ctx, height, narrowWidth],
  );
  const translateX = (width - narrowWidth) / 2;
  const center = { x: width * 0.5, y: height * 0.45 };

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <G transform={`translate(${width * 0.05} ${height * 0.1})`}>
        {flows.map((path, index) => (
          <Path
            key={index}
            d={path}
            fill="none"
            stroke={storyColor.ink}
            strokeWidth={index % 2 === 0 ? 1.3 : 1.1}
            strokeDasharray={index % 2 === 0 ? undefined : '2 6'}
            strokeLinecap="round"
          />
        ))}
      </G>
      {narrowGeometry ? (
        <G transform={`translate(${translateX} ${height * 0.06})`}>
          <DrawPath
            d={narrowGeometry.path}
            fill="none"
            stroke={storyColor.route}
            strokeWidth={storyMetric.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <RouteEnds geometry={narrowGeometry} endFilled={false} />
        </G>
      ) : (
        <Path
          d={`M${center.x},${height * 0.08} C${center.x - 25},${height * 0.3} ${center.x + 24},${height * 0.56} ${center.x},${height * 0.9}`}
          fill="none"
          stroke={storyColor.route}
          strokeWidth={storyMetric.lineWidth}
          strokeLinecap="round"
        />
      )}
      <ScentMarker point={center} rings={5} radius={5.5} />
    </Svg>
  );
}

export function GoldenHourArtwork({
  phase,
  width,
  height,
}: {
  phase: 'sunrise' | 'sunset';
  width: number;
  height: number;
}) {
  const rising = phase === 'sunrise';
  const sunX = rising ? width * 0.72 : width * 0.28;
  const sunY = height * 0.43;
  const arc = `M${width * 0.08},${height * 0.72} C${width * 0.24},${height * 0.18} ${width * 0.76},${height * 0.18} ${width * 0.92},${height * 0.72}`;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {[0, 1, 2, 3].map((index) => (
        <Path
          key={index}
          d={`M${width * (0.16 - index * 0.025)},${height * (0.74 + index * 0.045)}
             C${width * 0.3},${height * (0.3 - index * 0.02)}
              ${width * 0.7},${height * (0.3 - index * 0.02)}
              ${width * (0.84 + index * 0.025)},${height * (0.74 + index * 0.045)}`}
          fill="none"
          stroke={storyColor.ink}
          strokeWidth={1.1}
          strokeOpacity={0.82 - index * 0.12}
        />
      ))}
      <DrawPath
        d={arc}
        fill="none"
        stroke={storyColor.route}
        strokeWidth={storyMetric.lineWidth}
        strokeLinecap="round"
      />
      <Circle cx={sunX} cy={sunY} r={21} fill={storyColor.route} stroke={storyColor.ink} strokeWidth={2} />
      <Circle cx={sunX} cy={sunY} r={5} fill={storyColor.ink} />
      <Line
        x1={width * 0.08}
        x2={width * 0.92}
        y1={height * 0.72}
        y2={height * 0.72}
        stroke={storyColor.ink}
        strokeWidth={1.2}
      />
    </Svg>
  );
}

export function CloserArtwork({ ctx, width, height }: ArtworkProps) {
  const geometry = useMemo(
    () => routeGeometry(ctx, width, height, Math.max(34, width * 0.12)),
    [ctx, height, width],
  );
  const fallback = `M${width * 0.27},${height * 0.2}
    C${width * 0.6},${height * 0.05} ${width * 0.86},${height * 0.28} ${width * 0.78},${height * 0.58}
    C${width * 0.69},${height * 0.9} ${width * 0.25},${height * 0.88} ${width * 0.2},${height * 0.56}
    C${width * 0.17},${height * 0.39} ${width * 0.18},${height * 0.28} ${width * 0.27},${height * 0.2} Z`;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <DrawPath
        d={geometry?.path ?? fallback}
        fill="none"
        stroke={storyColor.route}
        strokeWidth={storyMetric.lineWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {(geometry?.stops ?? []).map((stop) => (
        <ScentMarker
          key={`${stop.sourceIndex}-${stop.x}-${stop.y}`}
          point={stop}
          rings={4}
          radius={5}
        />
      ))}
      {geometry && geometry.stops.length === 0 && (
        <>
          <Circle cx={geometry.start.x} cy={geometry.start.y} r={5} fill={storyColor.ink} />
          <Circle cx={geometry.end.x} cy={geometry.end.y} r={5} fill={storyColor.ink} />
        </>
      )}
      <G transform={`translate(${width * 0.39} ${height * 0.45})`}>
        {[0, 1, 2].map((index) => (
          <Path
            key={index}
            d={`M0,${index * 8} C${width * 0.06},${index * 8 - 10} ${width * 0.12},${index * 8 + 10} ${width * 0.18},${index * 8}`}
            fill="none"
            stroke={storyColor.ink}
            strokeWidth={1.25}
            strokeDasharray={index === 2 ? '2 4' : undefined}
            strokeLinecap="round"
          />
        ))}
      </G>
    </Svg>
  );
}

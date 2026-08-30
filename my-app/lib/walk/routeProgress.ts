export type RouteProgressPresentation = {
  title: string;
  subtitle: string;
  accessibilityLabel: string;
};

export function routeProgressPresentation({
  ready,
  destinationName,
  distanceLabel,
  etaLabel,
}: {
  ready: boolean;
  destinationName: string;
  distanceLabel?: string | null;
  etaLabel?: string | null;
}): RouteProgressPresentation {
  if (!ready) {
    return {
      title: 'Finding the best route',
      subtitle: `To ${destinationName} · usually a few seconds`,
      accessibilityLabel: `Finding the best route to ${destinationName}`,
    };
  }

  const details = [destinationName, distanceLabel, etaLabel].filter(Boolean).join(' · ');
  return {
    title: 'Route ready',
    subtitle: details,
    accessibilityLabel: `Route ready to ${details}`,
  };
}

export type GribTimelineRow = {
  label: string;
  valid: string;
  forecast: string;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
  seasFt: number | null;
  swellFt: number | null;
  swellPeriod: number | null;
  pressureHpa: number | null;
  tempC: number | null;
};

export type GribOverlayPoint = {
  lat: number;
  lon: number;
  label: string;
  valid: string;
  windKt: number | null;
  windDir: number | null;
  gustKt: number | null;
  seasFt: number | null;
  swellFt: number | null;
  swellPeriod: number | null;
  routePoint?: string;
  timeline?: GribTimelineRow[];
};

export type RouteForecastPoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  worstWindKt: number | null;
  worstGustKt: number | null;
  worstSeasFt: number | null;
  worstSwellFt: number | null;
  worstSwellPeriod: number | null;
  worstValid: string;
  timeline: GribTimelineRow[];
};

export type RouteForecast = {
  routeName: string;
  sampledPoints: number;
  routePoints: RouteForecastPoint[];
  worstWindPoint: RouteForecastPoint | null;
  worstSeasPoint: RouteForecastPoint | null;
};

export type IsobarGridPoint = {
  lat: number;
  lon: number;
  timeline: GribTimelineRow[];
};

export type GribSummary = {
  fileName: string;
  fileSize: number;
  loadedAt: string;
  status: string;
  summary: string;
  sourceNotes: string;
  inventoryPreview: string;
  timeline: GribTimelineRow[];
  overlayPoints: GribOverlayPoint[];
  routeForecast: RouteForecast | null;
  isobarGrid: IsobarGridPoint[];
};

export type PointForecast = {
  lat: number;
  lon: number;
  label: string;
  row: GribTimelineRow;
};

export type RouteLegForecast = {
  legLabel: string;
  fromName: string;
  toName: string;
  distanceNm: number;
  cumulativeEndNm: number;
  bearingDeg: number;
  etaLabel: string;
  etaZoneLabel?: string;
  weatherTimeLabel: string;
  etaMatched: boolean;
  level: "HIGH" | "CAUTION" | "NORMAL" | "NO DATA";
  color: string;
  row: GribTimelineRow | null;
  sourcePoint: string;
  seasSourcePoint?: string | null;
  risks: RiskFlag[];
};

export type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
};

export type RouteState = {
  routeName: string;
  waypoints: Waypoint[];
  activeWaypointIndex: number;
};

export type OwnShip = {
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  receivedAt: string;
};

export type Projection = {
  lat: number;
  lon: number;
  legIndex: number;
  nextWaypoint: Waypoint;
  distanceToNextNm: number;
  distanceAlongNm: number;
  etaHours: number | null;
  forecastLeadHours: number;
  positionSource: string;
};

export type RiskFlag = {
  label: string;
  level: "HIGH" | "CAUTION" | "NORMAL";
};

export type WxRoutingPanel = "GRIB" | "ROUTE" | "STORM" | "WHAT IF" | "COMPARE" | "LAYERS";
export type ProjectionMode = "off" | "current" | "departure";

export type ScenarioSummary = {
  maxWind: number | null;
  maxSeas: number | null;
  highCount: number;
  cautionCount: number;
  topLevel: RouteLegForecast["level"];
  legCount: number;
};

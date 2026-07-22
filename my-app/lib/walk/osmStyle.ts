/**
 * MapLibre style JSON for a public OpenStreetMap raster basemap.
 * No API key. OSM's tile-usage policy asks for a real UA and attribution —
 * the attribution is rendered by <WalkMap> on the Android bottom card.
 */

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: OSM_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
} as const;

export const OSM_STYLE_URL = JSON.stringify(OSM_STYLE);

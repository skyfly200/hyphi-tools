// Connector catalog. Dimensions in millimeters.
//
// Each entry describes the PCB-side footprint envelope for a connector
// option. The MVP uses body + keepout to reserve net real estate; the
// pad geometry will land when DXF gets per-pad polygons.

export const CONNECTORS = {
  JST_PH_3: {
    id: 'JST_PH_3',
    label: 'JST-PH 3-pin (2.0mm)',
    body: { w: 7.9, h: 5.2 },
    pitch: 2.0,
    pins: 3,
    keepout: 1.0,
  },
  JST_SH_3: {
    id: 'JST_SH_3',
    label: 'JST-SH 3-pin (1.0mm)',
    body: { w: 4.0, h: 2.9 },
    pitch: 1.0,
    pins: 3,
    keepout: 0.5,
  },
  JST_PH_4: {
    id: 'JST_PH_4',
    label: 'JST-PH 4-pin (2.0mm)',
    body: { w: 9.9, h: 5.2 },
    pitch: 2.0,
    pins: 4,
    keepout: 1.0,
  },
  MOLEX_PICO_5: {
    id: 'MOLEX_PICO_5',
    label: 'Molex Pico-EZmate 5-pin (1.2mm)',
    body: { w: 7.5, h: 3.4 },
    pitch: 1.2,
    pins: 5,
    keepout: 0.8,
  },
  PAD_ONLY: {
    id: 'PAD_ONLY',
    label: 'Solder pads only',
    body: { w: 6.0, h: 3.0 },
    pitch: 1.5,
    pins: 4,
    keepout: 0.4,
  },
};

export const CONNECTOR_PLACEMENTS = [
  { id: 'edge',    label: 'Centered on chosen face edge' },
  { id: 'corner',  label: 'Near a face corner' },
  { id: 'center',  label: 'At face center' },
];

export function listConnectors() {
  return Object.values(CONNECTORS).map(c => ({ id: c.id, label: c.label }));
}

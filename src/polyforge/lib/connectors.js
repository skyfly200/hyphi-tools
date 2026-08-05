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

// Connector-tab presets. A tab is a small board that protrudes off the
// chosen face edge carrying the wire-entry connector, so the connector
// lives outside the LED panel instead of stealing panel real estate.
//
// Each preset sizes the tab (tabWMm across the edge × tabLMm outward)
// and the pad row (pins at pitchMm, each padWMm × padHMm). `custom`
// carries editable defaults that the UI overrides.
export const CONNECTOR_TABS = {
  led3: {
    id: 'led3', label: '3-pin LED-strip connector',
    pins: 3, pitchMm: 2.0, padWMm: 1.6, padHMm: 3.0,
    tabWMm: 10, tabLMm: 9, bridgeWidthMm: 6,
  },
  led4: {
    id: 'led4', label: '4-pin LED-strip connector',
    pins: 4, pitchMm: 2.0, padWMm: 1.6, padHMm: 3.0,
    tabWMm: 12, tabLMm: 9, bridgeWidthMm: 6,
  },
  fpc4: {
    id: 'fpc4', label: '4-pin FPC / ZIF (1.0mm)',
    pins: 4, pitchMm: 1.0, padWMm: 0.6, padHMm: 4.0,
    tabWMm: 8, tabLMm: 7, bridgeWidthMm: 5,
  },
  pads: {
    id: 'pads', label: 'Solder pads',
    pins: 4, pitchMm: 2.54, padWMm: 1.6, padHMm: 2.2,
    tabWMm: 12, tabLMm: 8, bridgeWidthMm: 5,
  },
  custom: {
    id: 'custom', label: 'Custom',
    pins: 4, pitchMm: 2.0, padWMm: 1.6, padHMm: 3.0,
    tabWMm: 12, tabLMm: 9, bridgeWidthMm: 6,
  },
};

export function listConnectorTabs() {
  return Object.values(CONNECTOR_TABS).map(c => ({ id: c.id, label: c.label }));
}

// Data-out pass-through signals for a given LED wire count: single-data
// parts return DOUT; clocked parts (4-wire APA102) return COUT + DOUT.
export function outSignalsFor(wireCount) {
  return wireCount === 4 ? ['COUT', 'DOUT'] : ['DOUT'];
}

// Merge a preset with the custom overrides carried on the tab params.
export function resolveTabSpec(tab) {
  const preset = CONNECTOR_TABS[tab?.preset] || CONNECTOR_TABS.pads;
  if (tab?.preset === 'custom') {
    return {
      ...preset,
      pins: tab.pins ?? preset.pins,
      pitchMm: tab.pitchMm ?? preset.pitchMm,
      padWMm: tab.padWMm ?? preset.padWMm,
      padHMm: tab.padHMm ?? preset.padHMm,
      tabWMm: tab.tabWMm ?? preset.tabWMm,
      tabLMm: tab.tabLMm ?? preset.tabLMm,
      bridgeWidthMm: tab.bridgeWidthMm ?? preset.bridgeWidthMm,
    };
  }
  return preset;
}

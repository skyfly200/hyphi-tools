// LED footprint catalog. Dimensions in millimeters.
//
// Each footprint describes the PCB land pattern needed to mount one LED:
// the body bounding box, the keep-out around it, and the pad positions
// for the routed signals. The MVP only uses the body + keepout for net
// preview and DXF cutouts; pad-level placement comes later.

export const LEDS = {
  WS2812B: {
    id: 'WS2812B',
    label: 'WS2812B (5050)',
    body: { w: 5.0, h: 5.0 },
    keepout: 0.5, // mm of clearance around the body for hand-soldering
    pads: 4,
    signals: ['VCC', 'DIN', 'GND', 'DOUT'],
  },
  WS2812B_MINI: {
    id: 'WS2812B_MINI',
    label: 'WS2812B-MINI (3535)',
    body: { w: 3.5, h: 3.5 },
    keepout: 0.4,
    pads: 4,
    signals: ['VCC', 'DIN', 'GND', 'DOUT'],
  },
  SK6812_2020: {
    id: 'SK6812_2020',
    label: 'SK6812 (2020)',
    body: { w: 2.0, h: 2.0 },
    keepout: 0.3,
    pads: 4,
    signals: ['VCC', 'DIN', 'GND', 'DOUT'],
  },
  APA102_5050: {
    id: 'APA102_5050',
    label: 'APA102 (5050)',
    body: { w: 5.0, h: 5.0 },
    keepout: 0.5,
    pads: 6,
    signals: ['VCC', 'GND', 'CIN', 'DIN', 'COUT', 'DOUT'],
  },
};

export function listLEDs() {
  return Object.values(LEDS).map(l => ({ id: l.id, label: l.label }));
}

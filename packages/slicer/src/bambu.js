// Bambu Studio / OrcaSlicer hand-off. The slicers register URL schemes that open a model from a link, which is how the
// "Open in Bambu Studio" buttons on model sites work. The link must be a URL the slicer's computer can fetch (not a blob: or
// data: URL). Direct LAN/cloud printing to a Bambu printer is NOT implemented here.

export const SLICER_SCHEMES = Object.freeze({ bambustudio: 'bambustudio://open?file=', orcaslicer: 'orcaslicer://open?file=', prusaslicer: 'prusaslicer://open?file=' });

export function slicerOpenUrl(fileUrl, app = 'bambustudio') {
  const scheme = SLICER_SCHEMES[app]; if (!scheme) throw new Error(`unknown slicer "${app}"`);
  let u; try { u = new URL(fileUrl); } catch { throw new Error('file URL is not a valid URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('the slicer needs an http(s) link it can download from (not a blob: or data: URL)');
  return scheme + encodeURIComponent(u.href);
}

// Full FoldStudio docs page. Static React component, no shared chrome.
// Linked from FoldStudio's Help modal via target="_blank".

import { Link } from 'react-router-dom'

const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&family=DM+Sans:wght@300;400;500;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0f; --s:#111118; --bd:#2a2a3a; --t:#e8e8f0; --sub:#7a7a9a;
  --ac:#ff6b35; --ac2:#7b5cfa; --acd:rgba(123,92,250,.12);
  --code:#1c1c28;
}
html,body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--t);min-height:100vh;line-height:1.55}
.docs{max-width:880px;margin:0 auto;padding:48px 24px 96px}
.hero{display:flex;flex-direction:column;gap:6px;border-bottom:1px solid var(--bd);padding-bottom:22px;margin-bottom:36px}
.wordmark{font-family:'Bebas Neue',sans-serif;font-size:2.6rem;letter-spacing:.04em;background:linear-gradient(135deg,#ff6b35,#7b5cfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.tag{font-family:'DM Mono',monospace;font-size:.78rem;color:var(--sub)}
.back{font-family:'DM Mono',monospace;font-size:.72rem;color:var(--sub);text-decoration:none;padding:4px 8px;border:1px solid var(--bd);border-radius:6px;align-self:flex-start}
.back:hover{color:var(--t);border-color:var(--ac2)}
.toc{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 14px;padding:14px 18px;background:var(--s);border:1px solid var(--bd);border-radius:8px;margin-bottom:40px;font-family:'DM Mono',monospace;font-size:.74rem}
.toc a{color:var(--ac2);text-decoration:none}
.toc a:hover{color:var(--ac)}
h2{font-size:1.45rem;margin:42px 0 12px;padding-top:14px;border-top:1px solid var(--bd);font-weight:500}
h2:first-of-type{border-top:none;padding-top:0;margin-top:0}
h3{font-size:1rem;font-weight:500;margin:18px 0 6px;color:var(--ac2)}
p,li{font-size:.9rem;color:var(--t)}
ul,ol{padding-left:22px;margin:8px 0}
li{margin-bottom:4px;line-height:1.55}
li code,p code{background:var(--code);border:1px solid var(--bd);border-radius:4px;padding:1px 5px;font:500 .78rem 'DM Mono',monospace;color:#bba4f0}
kbd{background:var(--bg);border:1px solid var(--bd);border-bottom-width:2px;border-radius:4px;padding:1px 6px;font:500 .72rem 'DM Mono',monospace;color:var(--t)}
.callout{background:var(--acd);border-left:3px solid var(--ac2);padding:10px 14px;border-radius:0 6px 6px 0;margin:14px 0;font-size:.85rem;color:var(--sub)}
.callout strong{color:var(--t);font-weight:500}
.cmp{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--bd);border-radius:8px;overflow:hidden;margin:10px 0}
.cmp > div{padding:14px 16px}
.cmp .h{background:var(--s);font:500 .78rem 'DM Mono',monospace;color:var(--ac2);border-bottom:1px solid var(--bd)}
.cmp .h.right{border-left:1px solid var(--bd)}
.cmp .b.right{border-left:1px solid var(--bd)}
.cmp ul{margin:0;padding-left:18px}
.cmp li{font-size:.82rem}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;box-shadow:0 0 0 1px rgba(255,255,255,.35);vertical-align:middle;margin-right:6px}
table.kbd-tbl{width:100%;border-collapse:collapse;margin:8px 0;font-size:.86rem}
table.kbd-tbl td{padding:5px 8px;border-bottom:1px solid var(--bd);vertical-align:top}
table.kbd-tbl td:first-child{white-space:nowrap;color:var(--ac2);font-family:'DM Mono',monospace;font-size:.78rem;width:1%}
a.tool{color:var(--ac2);text-decoration:none;border-bottom:1px dotted var(--ac2)}
.muted{color:var(--sub);font-size:.78rem}
@media (max-width:680px){
  .docs{padding:24px 16px 64px}
  .wordmark{font-size:2rem}
  .cmp{grid-template-columns:1fr}
  .cmp .h.right,.cmp .b.right{border-left:none;border-top:1px solid var(--bd)}
}
`

export default function FoldStudioDocs() {
  return (
    <>
      <style>{css}</style>
      <div className="docs">
        <div className="hero">
          <Link to="/foldstudio" className="back">← Back to FoldStudio</Link>
          <div className="wordmark">FoldStudio Docs</div>
          <div className="tag">// crease patterns, fold angles, and everything you can do with them</div>
        </div>

        <div className="toc">
          <a href="#layout">Layout & navigation</a>
          <a href="#tools">Drawing tools</a>
          <a href="#painting">Paint & crease types</a>
          <a href="#selection">Selection</a>
          <a href="#snapping">Snapping</a>
          <a href="#grid">Grid</a>
          <a href="#symmetry">Auto-symmetry</a>
          <a href="#labels">Labels</a>
          <a href="#fold-angles">Fold angles</a>
          <a href="#validation">Validation</a>
          <a href="#cleanup">Cleanup</a>
          <a href="#projects">Save / Open / Rename</a>
          <a href="#templates">Templates</a>
          <a href="#io">Import / Export</a>
          <a href="#handoff">Open in other tools</a>
          <a href="#theme">Theme</a>
          <a href="#shortcuts">Keyboard shortcuts</a>
          <a href="#mobile">Mobile differences</a>
        </div>

        <h2 id="layout">Layout & navigation</h2>
        <p>FoldStudio has five chrome regions:</p>
        <ul>
          <li><strong>TopBar</strong> — project name, Cleanup, theme toggle, Help, plus mobile drawer toggles.</li>
          <li><strong>Toolbar</strong> — drawing tools, transform tools, the Pick segmented control (when Select is active), the paint selector, undo/redo/all/none/delete/invert, and the global snap toggle.</li>
          <li><strong>Sidebar (left drawer)</strong> — Grid, Snapping targets, Symmetry, Tool options, Labels.</li>
          <li><strong>Canvas</strong> — the paper, the workspace around it, and the SVG render of every crease.</li>
          <li><strong>Inspector (right drawer)</strong> — selection summary, per-edge fold-angle slider, validation report.</li>
          <li><strong>BottomBar</strong> — status line + New / Save / Open / Import / Export / Open-in… actions.</li>
        </ul>
        <div className="callout">On desktop the sidebars are always visible. On mobile (≤900px wide) they collapse into off-canvas drawers; tap the panel-left / panel-right icons in the TopBar to slide them in.</div>

        <h2 id="tools">Drawing tools</h2>
        <h3>Draw <kbd>D</kbd></h3>
        <p>Two-click crease placement. Click an anchor, click a destination, and a line is added in the active paint color. The pointer snaps to grid nodes, existing vertices, and edge midpoints when their toggles are on. New creases automatically split any existing edge they cross — and any existing edge that an endpoint lands on — so the planar graph stays valid for face computation.</p>

        <h3>Select <kbd>S</kbd></h3>
        <p>Pick edges, vertices, or both. The Pick segmented control on the toolbar chooses what's hit-testable:</p>
        <ul>
          <li><strong>Edges</strong> — only edges respond to clicks.</li>
          <li><strong>Vertices</strong> — only vertices.</li>
          <li><strong>Both</strong> — vertices first (smaller hit target), then edges.</li>
        </ul>
        <p>Click empty space and drag to box-select: every vertex (or every edge with both endpoints) inside the rectangle is added to the selection. <kbd>Shift</kbd>-click adds individual targets without replacing the current selection. With nothing selected, clicking on empty space (no drag) clears the selection.</p>

        <h3>Mirror <kbd>M</kbd></h3>
        <p>Reflect selected creases across an axis. The axis option lives in the Tool options drawer:</p>
        <ul>
          <li><strong>Horizontal</strong> — reflect across <code>y = 0.5</code>.</li>
          <li><strong>Vertical</strong> — reflect across <code>x = 0.5</code>.</li>
          <li><strong>Selected edge</strong> — the first edge in your selection becomes the axis; the rest get mirrored across it. The axis edge is highlighted with an orange dashed overlay so you can see which one you've designated.</li>
        </ul>
        <p>In Mirror mode, clicks on edges always toggle into the selection (no shift required) so building the axis + targets list works on touch.</p>
        <p>The optional <strong>Flip M↔V</strong> checkbox swaps Mountain and Valley on the copy — handy for asymmetric folds.</p>

        <h3>Rotate <kbd>R</kbd></h3>
        <p>Repeat selected creases as either:</p>
        <ul>
          <li><strong>Rotational</strong> — N copies around a centre <code>(cx, cy)</code> with a per-step angle (e.g. count 4, angle 90° = quarter-turn fan).</li>
          <li><strong>Translational</strong> — N copies shifted by <code>(dx, dy)</code> per step.</li>
        </ul>

        <h3>Relief <kbd>C</kbd></h3>
        <p>Cut a small boundary polygon around a fold junction to relieve paper tension at the meeting point of many creases. Tap a vertex with two or more incident creases; the tool drops the inner ends of those creases, places polygon vertices along each crease direction at the configured radius, reconnects each crease to its polygon vertex, and links the polygon vertices with <strong>B</strong>-assignment edges as the cutout perimeter.</p>
        <p>The radius slider (Tool options drawer) is in paper-units, capped at 0.15. The action refuses to apply if the radius is larger than any incident crease's length so it can't invert a segment.</p>

        <h3>Angle <kbd>A</kbd></h3>
        <p>Place a crease anchored at one click, extending at a configured angle and length. Length modes:</p>
        <ul>
          <li><strong>Fixed length</strong> — the literal value in paper units.</li>
          <li><strong>Until next fold or paper edge</strong> — extends until the ray hits an existing crease or the paper boundary, whichever comes first.</li>
          <li><strong>Until paper edge</strong> — extends to the boundary regardless.</li>
        </ul>

        <h2 id="painting">Paint & crease types</h2>
        <p>Five assignments. On desktop the toolbar shows them as a row of swatches; on mobile they collapse to a single dropdown trigger that opens below.</p>
        <ul>
          <li><span className="sw" style={{background:'#e23b3b'}}/><strong>M Mountain</strong> — folds away from the viewer. Default fold angle −180°.</li>
          <li><span className="sw" style={{background:'#3a7bd5'}}/><strong>V Valley</strong> — folds toward the viewer. Default +180°.</li>
          <li><span className="sw" style={{background:'#5c6478'}}/><strong>B Border</strong> — paper boundary / cut line. Doesn't fold.</li>
          <li><span className="sw" style={{background:'#9aa0aa'}}/><strong>F Flat</strong> — reference / construction line. Drawn but flat (0°).</li>
          <li><span className="sw" style={{background:'#6e7382'}}/><strong>U Unknown</strong> — unassigned.</li>
        </ul>
        <p>Clicking a paint swatch updates the active paint <em>and</em> reassigns any currently-selected edges. Keyboard shortcuts <kbd>1</kbd>–<kbd>5</kbd> map to M/V/B/F/U respectively.</p>
        <p><strong>Invert</strong> on the toolbar flips M ↔ V across the current selection (or every crease if nothing is selected). Per-edge <code>foldAngle</code> overrides are negated to match.</p>

        <h2 id="selection">Selection</h2>
        <p>Selection state is split between vertices and edges. The Inspector summarises counts and the toolbar's Delete and Invert buttons enable/disable based on whether anything is selected.</p>
        <p><strong>Visual</strong>: selected edges render with a translucent orange halo behind their normal stroke (so the indicator reads the same whatever the edge's M/V/B/F/U color). Selected vertices get an orange ring around the dot.</p>
        <p><strong>Box select</strong>: in the Select tool, dragging from empty canvas draws a purple rubber-band rectangle. On release everything inside is added.</p>
        <p><strong>Delete</strong> (toolbar trash, <kbd>Del</kbd>, <kbd>Backspace</kbd>) removes selected edges plus every edge incident to a selected vertex, then prunes orphan vertices in one pass.</p>

        <h2 id="snapping">Snapping</h2>
        <p>The magnet toggle on the toolbar is a global on/off. The Sidebar's <strong>Snap to</strong> section configures which targets contribute when snap is on:</p>
        <ul>
          <li><strong>Vertices (nodes)</strong> — existing crease vertices.</li>
          <li><strong>Grid points</strong> — every node of every active grid layer (square / triangular / radial — they stack).</li>
          <li><strong>Edge midpoints</strong> — the centre of each existing edge.</li>
        </ul>
        <p>Snap tolerance is set by the grid density — coarser grids snap from farther away. Radial grids contribute extra snap nodes where each ring or spoke crosses the paper boundary.</p>

        <h2 id="grid">Grid</h2>
        <p>Three grid types you can stack independently (Sidebar → Grid → Types):</p>
        <ul>
          <li><strong>Square</strong> — N×N aligned grid.</li>
          <li><strong>Triangular</strong> — 60° lines, good for tessellations.</li>
          <li><strong>Radial</strong> — concentric rings + sectors centred on the paper, reaching to the corners by default.</li>
        </ul>
        <p><strong>Density</strong> defaults to powers of two (2 / 4 / 8 / 16 / 32 / 64) via the <code>×2</code> toggle. Uncheck to pick any integer 2–64.</p>
        <p><strong>Extend grid past paper</strong> renders the grid through the workspace ring around the paper — useful when designing radial patterns where the spokes need to reach outside.</p>

        <h2 id="symmetry">Auto-symmetry</h2>
        <p>The Sidebar's Symmetry row turns every drawn crease into N rotational copies around the paper centre. Values: <strong>Off</strong>, <strong>½</strong>, <strong>¼</strong>, <strong>⅛</strong>, <strong>1⁄16</strong>, <strong>1⁄32</strong>. Applies to both the Draw tool and the Angle tool — including their live ghost previews.</p>

        <h2 id="labels">Labels</h2>
        <p>The Sidebar's Labels section toggles vertex / edge / face ID overlays. Only one type can be enabled at a time. Optionally restrict labels to whatever the pointer is hovering near so the canvas stays uncluttered.</p>
        <p>IDs round-trip in FOLD exports as <code>hyphi:vertex_ids</code>, <code>hyphi:edge_ids</code>, <code>hyphi:face_ids</code> arrays.</p>

        <h2 id="fold-angles">Fold angles</h2>
        <p>Every edge has an effective fold angle — by default M = −180°, V = +180°, F / B / U = 0°. With edges selected, the Inspector's Fold angle slider overrides the value in [−180°, +180°]. Mixed-value selections show a "Mixed" indicator. <strong>Reset to default</strong> reverts to the type's default. Per-edge <code>foldAngle</code> survives FOLD import/export so the simulator handoff carries your partial folds.</p>

        <h2 id="validation">Validation</h2>
        <p>Two flat-foldability checks run on every interior vertex with only M/V creases:</p>
        <ul>
          <li><strong>Maekawa</strong>: <code>|#M − #V| = 2</code>.</li>
          <li><strong>Kawasaki</strong>: alternating angles between consecutive creases sum to 180° each.</li>
        </ul>
        <p>Failures appear as red rings on the offending vertex and a styled card in the Inspector with the specific reason. Hover the card to see the message in the tooltip.</p>
        <p>Toggle <strong>Check flat-foldability</strong> in the Inspector (or Sidebar) to pause the checks while you sketch — issue rings clear and the status line reads "Validation off".</p>

        <h2 id="cleanup">Cleanup</h2>
        <p><strong>Cleanup</strong> (TopBar broom icon) repairs the planar graph: dedupes duplicate edges, prunes orphan vertices, splits T-junctions, and merges any degree-2 vertex whose two incident edges share an assignment and lie ~180° apart. Use it after import or after a lot of redrawing to keep face computation crisp.</p>

        <h2 id="projects">Save / Open / Rename</h2>
        <p>Projects are stored in your browser's localStorage — they don't leave your machine. The BottomBar's actions:</p>
        <ul>
          <li><strong>Save</strong> opens a name prompt; the current name is prefilled for re-saves.</li>
          <li><strong>Open</strong> lists all saved projects with timestamps. Click the name to load. The ✎ button swaps the name for an inline input (Enter / blur commits, Esc cancels). Trash deletes.</li>
        </ul>

        <h2 id="templates">Templates</h2>
        <p><strong>New</strong> opens a modal with starter bases: Blank, Preliminary base, Waterbomb base, Accordion (8), Square twist, Radial star (16).</p>

        <h2 id="io">Import / Export</h2>
        <p><strong>Import</strong> accepts <code>.fold</code> (JSON). <code>edges_foldAngle</code> overrides round-trip.</p>
        <p><strong>Export</strong> is a single button with a format select that defaults to <strong>.fold</strong>. Switch to <strong>.svg</strong> for a stroke-coloured rendering using Origami Simulator's expected colours (pure red M, pure blue V, black B, yellow F, green U). FOLD export includes <code>hyphi:vertex_ids</code> / <code>hyphi:edge_ids</code> / <code>hyphi:face_ids</code> arrays.</p>

        <h2 id="handoff">Open in other tools</h2>
        <p>The <strong>Open in…</strong> dropdown in the BottomBar hands the current pattern off to:</p>
        <ul>
          <li><strong>Origami Simulator</strong> — opens origamisimulator.org in a new tab and posts the FOLD via the <code>{`{ op: 'importFold', fold, filename }`}</code> postMessage their importer.js listens for. If the popup is blocked, falls back to downloading the file with a "drop it in" dialog.</li>
          <li><strong>FoldForm</strong> — stashes the FOLD in sessionStorage and navigates to <Link to="/foldform">/foldform</Link>, which auto-loads it on mount.</li>
          <li><strong>FoldPress</strong> — same handoff, navigates to <Link to="/fold">/fold</Link>.</li>
        </ul>

        <h2 id="theme">Theme</h2>
        <p>The TopBar sun/moon toggle switches between dark and light themes. The canvas, workspace, paper, grid, vertices, and chrome all repaint via CSS variables. Setting is persisted across reloads.</p>

        <h2 id="shortcuts">Keyboard shortcuts</h2>
        <table className="kbd-tbl">
          <tbody>
            <tr><td><kbd>D</kbd></td><td>Draw tool</td></tr>
            <tr><td><kbd>S</kbd></td><td>Select tool</td></tr>
            <tr><td><kbd>M</kbd></td><td>Mirror tool</td></tr>
            <tr><td><kbd>R</kbd></td><td>Rotate tool</td></tr>
            <tr><td><kbd>A</kbd></td><td>Angle tool</td></tr>
            <tr><td><kbd>1</kbd>–<kbd>5</kbd></td><td>Set paint to M / V / B / F / U</td></tr>
            <tr><td><kbd>Shift</kbd>-click</td><td>Add to selection (desktop)</td></tr>
            <tr><td><kbd>Ctrl/⌘</kbd>+<kbd>A</kbd></td><td>Select all edges + vertices</td></tr>
            <tr><td><kbd>Del</kbd> / <kbd>Backspace</kbd></td><td>Delete selection</td></tr>
            <tr><td><kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd></td><td>Undo</td></tr>
            <tr><td><kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td><td>Redo</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Cancel current draw / clear selection</td></tr>
            <tr><td>Wheel</td><td>Zoom centred on the pointer</td></tr>
          </tbody>
        </table>

        <h2 id="mobile">Mobile vs desktop</h2>
        <div className="cmp">
          <div className="h">Desktop (≥901px)</div>
          <div className="h right">Mobile (≤900px)</div>
          <div className="b">
            <ul>
              <li>Sidebar + Inspector always visible alongside the canvas.</li>
              <li>Toolbar shows icon + label for every button.</li>
              <li>Paint selector is a row of five swatch buttons.</li>
              <li>Shift-click to multi-select.</li>
              <li>Mouse wheel zooms.</li>
            </ul>
          </div>
          <div className="b right">
            <ul>
              <li>Sidebar + Inspector slide in over the canvas via the panel-left / panel-right icons in the TopBar.</li>
              <li>Toolbar buttons are icons only; long-press any icon for a label tooltip.</li>
              <li>Paint selector collapses to a single trigger button; tap to open a dropdown of all five.</li>
              <li><strong>Multi-select</strong>: use box-select by dragging from empty canvas, or toggle the additive-select button next to Pick so every tap toggles into the selection.</li>
              <li>Pinch with two fingers to zoom; two-finger drag pans.</li>
              <li>BottomBar status text on its own row, then all action icons together below it.</li>
            </ul>
          </div>
        </div>
        <p className="muted" style={{marginTop:14}}>Every feature available on desktop is reachable on mobile. The only differences are layout and gesture conventions.</p>
      </div>
    </>
  )
}

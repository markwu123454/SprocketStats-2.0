// Generates the design-system pane's foundation cards into ds-bundle/systems/.
// Run after resync.mjs, which recreates ds-bundle: node .design-sync/cards/build-cards.mjs
//
// Cards use --theme-* variables with their own inline CSS rather than Tailwind
// utilities, so they can't render unstyled if a class falls out of the safelist.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../ds-bundle/systems')

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--theme-bg);color:var(--theme-text);font:14px/1.45 "Segoe UI",system-ui,sans-serif;padding:20px}
h1{font-size:24px;margin:0;color:var(--theme-h1-color)}
h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--theme-subtext-color);margin:24px 0 10px}
p{margin:0}
code{font:12px ui-monospace,Consolas,monospace;color:var(--theme-text-contrast)}
.top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px}
.muted{color:var(--theme-subtext-color)}
.cap{font-size:12px;color:var(--theme-subtext-color)}
.seasons{display:flex;gap:4px}
.seasons button{height:32px;padding:0 10px;font-family:inherit;font-size:12px;font-weight:600;background:transparent;color:var(--theme-subtext-color);border:1px solid var(--theme-border);border-radius:8px;cursor:pointer}
.seasons button[aria-pressed=true]{color:var(--theme-bg);background:var(--theme-text-contrast);border-color:var(--theme-text-contrast)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;align-items:start}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.box{border:1px solid var(--theme-border);border-radius:12px;padding:16px}
.stack{display:flex;flex-direction:column;gap:10px}
table{border-collapse:collapse;width:100%}td,th{padding:8px;text-align:left;border-top:1px solid var(--theme-border);font-size:13px}th{color:var(--theme-subtext-color);font-weight:600;border-top:0}
.btn{height:40px;padding:0 16px;border-radius:8px;font-family:inherit;font-size:14px;font-weight:600;border:1px solid transparent;background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}
.btn:focus-visible,input:focus-visible,.handle:focus-visible,.icon:focus-visible{outline:2px solid var(--theme-text-contrast);outline-offset:2px}
.filled{background:var(--theme-text-contrast);color:var(--theme-bg)}
.outlined{background:var(--theme-bg);border-color:var(--theme-outline);color:var(--theme-text-contrast)}
.text{color:var(--theme-subtext-color)}
.danger{color:var(--theme-danger)}
.dis{opacity:.4;cursor:not-allowed}
.icon{width:44px;height:44px;border:0;background:transparent;color:var(--theme-subtext-color);font-size:18px;cursor:pointer;border-radius:8px}
label{display:flex;flex-direction:column;gap:6px;font-weight:600;color:var(--theme-h1-color)}
input{height:44px;width:100%;padding:0 12px;font-family:inherit;font-size:16px;font-weight:400;color:var(--theme-text);background:var(--theme-bg);border:1px solid var(--theme-outline);border-radius:8px}
input::placeholder{color:var(--theme-subtext-color)}
.err{border-color:var(--theme-danger)}
.errtxt{font-size:12px;font-weight:400;color:var(--theme-danger)}
.help{font-size:12px;font-weight:400;color:var(--theme-subtext-color)}
.notice{border:1px solid var(--theme-danger);color:var(--theme-danger);background:color-mix(in oklch,var(--theme-danger) 10%,transparent);border-radius:8px;padding:10px 12px;font-size:13px}
.phone{position:relative;width:300px;height:520px;max-width:100%;border:1px solid var(--theme-outline);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;background:var(--theme-bg)}
.web{position:relative;flex:1;min-width:300px;height:360px;border:1px solid var(--theme-outline);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.scroll{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;scrollbar-width:thin}
.footer{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--theme-border);background:var(--theme-bg)}
.phone .footer .btn{height:48px}
.phone .footer .push{margin-left:0}
.phone .footer .push~.filled{flex:1}
.grow{flex:1}.push{margin-left:auto}.start{margin-right:auto}
.tabs{display:flex;height:64px;border-top:1px solid var(--theme-border);flex:none}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:11px;font-weight:500;opacity:.7}
.tab.on{color:var(--theme-text-contrast);opacity:1}
.scrim{position:absolute;inset:0;background:rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity 200ms}
.open .scrim{opacity:1;pointer-events:auto}
.sheet{position:absolute;left:0;right:0;bottom:0;max-height:92%;display:flex;flex-direction:column;background:var(--theme-bg);border-top:1px solid var(--theme-outline);border-radius:16px 16px 0 0;box-shadow:0 -14px 40px rgba(0,0,0,.45);transform:translateY(105%);transition:transform 200ms cubic-bezier(.4,0,1,1)}
.open .sheet{transform:translateY(0);transition:transform 340ms cubic-bezier(.32,.72,0,1)}
.sheet.drag{transition:none!important}
.handle{height:24px;width:100%;flex:none;display:grid;place-items:center;background:none;border:0;cursor:grab;touch-action:none}
.handle i{display:block;width:32px;height:4px;border-radius:9px;background:var(--theme-subtext-color)}
.shead{display:flex;align-items:center;justify-content:space-between;padding:0 8px 4px 16px;touch-action:none;flex:none}
.shead b{font-size:18px;color:var(--theme-h1-color)}
.mrow{min-height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:none;border:0;width:100%;color:var(--theme-text);font-family:inherit;font-size:14px;cursor:pointer}
.mrow.sel{color:var(--theme-text-contrast);font-weight:600}
.menu{width:220px;border:1px solid var(--theme-border);border-radius:12px;padding:4px 0;box-shadow:0 10px 15px -3px rgba(0,0,0,.3);background:var(--theme-bg)}
.menu .mrow{min-height:40px}
.sk{border-radius:8px;background:color-mix(in oklch,var(--theme-text) 12%,transparent);animation:p 1.6s ease-in-out infinite}
@keyframes p{50%{opacity:.5}}
@media (prefers-reduced-motion:reduce){*{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}}
.sw{height:64px;border-radius:8px;border:1px solid var(--theme-border);display:flex;align-items:flex-end;padding:6px;font-size:11px}
.lane{height:44px;border:1px solid var(--theme-border);border-radius:8px;position:relative;overflow:hidden}
.dot{position:absolute;top:8px;left:8px;width:28px;height:28px;border-radius:50%;background:var(--theme-text-contrast)}
.play .dot{transform:translateX(200px)}
`

const JS = `
const root=document.documentElement;
document.querySelectorAll('.seasons button').forEach(b=>b.onclick=()=>{root.className=b.dataset.s;document.querySelectorAll('.seasons button').forEach(x=>x.setAttribute('aria-pressed',x===b))});
document.querySelectorAll('[data-sheet-host]').forEach(host=>{
  const sheet=host.querySelector('.sheet');let start=null,y=0,lastT=0,lastY=0,v=0,opener=null;
  const open=b=>{opener=b;host.classList.add('open');sheet.style.transform='';sheet.querySelector('.handle').focus({preventScroll:true})};
  const close=()=>{host.classList.remove('open');sheet.style.transform='';opener&&opener.focus()};
  host.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>open(b));
  host.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);
  host.querySelector('.scrim').onclick=close;
  host.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  sheet.querySelector('.handle').onclick=()=>{if(Math.abs(y)<4)close();y=0};
  sheet.querySelectorAll('.handle,.shead').forEach(z=>{
    z.addEventListener('pointerdown',e=>{if(e.target.closest('.icon'))return;start=e.clientY;lastY=e.clientY;lastT=e.timeStamp;y=0;v=0;sheet.classList.add('drag');z.setPointerCapture(e.pointerId)});
    z.addEventListener('pointermove',e=>{if(start===null)return;y=Math.max(0,e.clientY-start);v=(e.clientY-lastY)/Math.max(1,e.timeStamp-lastT);lastY=e.clientY;lastT=e.timeStamp;sheet.style.transform='translateY('+y+'px)'});
    const up=e=>{if(start===null)return;start=null;if(e.timeStamp-lastT>100)v=0;sheet.classList.remove('drag');if(y>sheet.offsetHeight*.25||v>.5)close();else sheet.style.transform=''};
    z.addEventListener('pointerup',up);z.addEventListener('pointercancel',up);
  });
});
document.querySelectorAll('[data-play]').forEach(b=>b.onclick=()=>b.closest('.box').classList.toggle('play'));
`

const page = (name, group, title, sub, body) => `<!-- @dsCard group="${group}" viewport="1000x760" -->
<!doctype html>
<html class="theme-2027" lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="../../styles.css"><style>${CSS}</style></head>
<body>
<div class="top"><div><h1>${title}</h1><p class="muted">${sub}</p></div>
<div class="seasons" role="group" aria-label="Season"><button data-s="theme-2025" aria-pressed="false">2025</button><button data-s="theme-2026" aria-pressed="false">2026</button><button data-s="theme-2027" aria-pressed="true">2027</button></div></div>
${body}
<script>${JS}</script></body></html>
`

const footer = (extra = '') => `<div class="footer">${extra}<button class="btn text ${extra ? '' : 'push'}">Cancel</button><button class="btn filled">Save</button></div>`
const fields = n => Array.from({ length: n }, (_, i) => `<label>Field ${i + 1}<input placeholder="Scroll: the footer stays"></label>`).join('')
const tabs = `<div class="tabs"><div class="tab on">▣<span>Dashboard</span></div><div class="tab">◆<span>Events</span></div><div class="tab">☰<span>Scouting</span></div><div class="tab">✓<span>Tasks</span></div></div>`

const sheet = (title, content, foot = '') => `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${title}">
<button class="handle" aria-label="Close ${title}"><i></i></button>
<div class="shead"><b>${title}</b><button class="icon" data-close aria-label="Close">×</button></div>
<div class="scroll" style="padding-top:4px">${content}</div>${foot}</div>`

const menuRows = `<div style="margin:-4px -16px"><button class="mrow sel">Scouting <span>✓</span></button><button class="mrow">Build</button><button class="mrow">Programming</button><button class="mrow">Drive Team</button></div>`

const SW = [['--theme-bg', 'Surface'], ['--theme-button-bg', 'Raised'], ['--theme-text-contrast', 'Accent'], ['--theme-outline', 'Outline'], ['--theme-border', 'Divider'], ['--theme-danger', 'Danger'], ['--theme-text', 'Text'], ['--theme-subtext-color', 'Muted']]

const cards = {
  color: ['Color', 'Semantic roles. Switch seasons above; every role resolves per season.', `
<h2>Roles</h2><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">${SW.map(([v, l]) => `<div><div class="sw" style="background:var(${v})"></div><div class="cap" style="margin-top:4px">${l}<br><code>${v}</code></div></div>`).join('')}</div>
<h2>Measured contrast</h2><table><tr><th>Pair</th><th>2025</th><th>2026</th><th>2027</th><th>Target</th></tr>
<tr><td>Text on surface</td><td>15.36</td><td>12.52</td><td>13.20</td><td>4.5</td></tr>
<tr><td>Accent on surface</td><td>8.52</td><td>5.27</td><td>9.90</td><td>4.5</td></tr>
<tr><td>Outline on surface (new)</td><td>4.18</td><td>3.32</td><td>4.58</td><td>3.0</td></tr>
<tr><td>Danger on surface (new)</td><td>8.09</td><td>6.02</td><td>7.56</td><td>4.5</td></tr></table>`],
  typography: ['Typography', 'A named scale. Inputs are 16px on mobile to stop iOS focus zoom.', `
<h2>Scale</h2><div class="stack">
<div style="font-size:32px;font-weight:600;letter-spacing:-.01em;color:var(--theme-h1-color)">Sign in <span class="cap">display · auth hero only</span></div>
<div style="font-size:24px;font-weight:700;color:var(--theme-h1-color)">Dashboard <span class="cap">h1 · screen title</span></div>
<div style="font-size:18px;font-weight:600;color:var(--theme-h1-color)">Edit task <span class="cap">title · card, sheet, dialog</span></div>
<div style="font-size:12px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--theme-subtext-color)">Upcoming events <span class="cap" style="text-transform:none;letter-spacing:0">h2 · section label</span></div>
<div>Check in when you arrive at the venue. <span class="cap">body · 14px</span></div>
<div style="font-weight:600;color:var(--theme-h1-color)">Due date <span class="cap" style="font-weight:400">label · 14px semibold</span></div>
<div style="font-size:16px">What needs doing? <span class="cap">input · 16px mobile, 14px web</span></div>
<div class="cap">Helper and error text · caption · 12px</div>
<div style="font:11px ui-monospace,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--theme-text-contrast)">2027 · Canopy <span class="cap" style="font-family:inherit;text-transform:none;letter-spacing:0">badge · 11px mono</span></div></div>`],
  spacing: ['Spacing', '4px steps. 16px gutter on mobile, 24px on web.', `
<h2>Scale</h2><div class="stack">${[['xs', 4, 'Icon to label'], ['sm', 8, 'Between buttons'], ['md', 12, 'Footer padding'], ['base', 16, 'Between fields, mobile gutter'], ['lg', 20, 'Card padding'], ['page', 24, 'Web gutter, sections'], ['xl', 32, 'Major page groups']].map(([n, p, u]) => `<div class="row"><div style="width:${p}px;height:20px;background:var(--theme-text-contrast);border-radius:2px"></div><code>space-${n}</code><span class="cap">${p}px · ${u}</span></div>`).join('')}</div>
<h2>Radius</h2><div class="row">${[['control', 8, 'Inputs, buttons'], ['surface', 12, 'Cards, menus'], ['sheet', 16, 'Sheets, dialogs']].map(([n, r, u]) => `<div class="box" style="border-radius:${r}px;border-color:var(--theme-outline)"><code>radius-${n}</code><div class="cap">${r}px · ${u}</div></div>`).join('')}</div>`],
  buttons: ['Buttons', 'One Filled per surface. Order: destructive, Cancel, primary.', `
<h2>Variants</h2><div class="row"><button class="btn filled">Filled</button><button class="btn outlined">Outlined</button><button class="btn text">Text</button><button class="btn danger">Danger</button><button class="icon" aria-label="Close">×</button></div>
<h2>States</h2><div class="row"><button class="btn filled">Default</button><button class="btn filled" style="opacity:.7">Pressed</button><button class="btn filled" style="outline:2px solid var(--theme-text-contrast);outline-offset:2px">Focused</button><button class="btn filled dis" disabled>Disabled</button><button class="btn filled dis" disabled>Saving…</button></div>
<h2>Sizes</h2><div class="row"><button class="btn filled">Web 40</button><button class="btn filled" style="height:44px">Mobile 44</button><button class="btn filled" style="height:48px">Footer 48</button><button class="btn outlined" style="height:52px;border-radius:12px">Hero 52</button></div>
<h2>Action order</h2><div class="box row"><button class="btn danger start">Delete</button><button class="btn text">Cancel</button><button class="btn filled">Save</button></div>`],
  forms: ['Forms', 'One sticky footer on web and mobile. Scroll either form: Save stays visible.', `
<h2>The same footer</h2><div class="row" style="align-items:flex-start">
<div><div class="phone"><div class="scroll">${fields(7)}</div>${footer()}${tabs}</div><p class="cap" style="margin-top:6px">Mobile: 48px, above the tab bar</p></div>
<div style="flex:1;min-width:300px"><div class="web"><div class="scroll">${fields(6)}</div>${footer('<button class="btn danger start">Delete</button>')}</div><p class="cap" style="margin-top:6px">Web: 40px, same order</p></div></div>
<h2>Field states</h2><div class="grid">
<label>Default<input placeholder="What needs doing?"><span class="help">Helper text</span></label>
<label>Error<input class="err" aria-invalid="true" value="Thu"><span class="errtxt">⚠ Enter a full date</span></label>
<label style="opacity:.6">Disabled<input disabled value="Scouting"></label></div>
<h2>Save failed</h2><div class="notice" role="alert">⚠ Couldn't save the packing list. Try again.</div>`],
  navigation: ['Navigation', 'Mobile menus are drag sheets. Web menus are anchored.', `
<div class="row" style="align-items:flex-start;margin-top:16px">
<div><div class="phone" data-sheet-host><div style="padding:8px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--theme-border)"><b style="color:var(--theme-h1-color)">Tasks</b><button class="icon" data-open aria-label="Open account menu">☰</button></div>
<div class="scroll"><button class="btn outlined" data-open>Open role menu</button><p class="cap">Open a menu, then drag the handle down, tap the scrim, press ×, or press Esc.</p></div>${tabs}${sheet('Your role', menuRows)}</div><p class="cap" style="margin-top:6px">Mobile: drag sheet, 48px rows</p></div>
<div><div class="menu" role="menu"><button class="mrow sel">Scouting <span>✓</span></button><button class="mrow">Build</button><button class="mrow">Programming</button><div style="border-top:1px solid var(--theme-border);margin:4px 0"></div><button class="mrow danger">Sign out</button></div><p class="cap" style="margin-top:6px">Web: anchored menu, 40px rows</p>
<h2>Stays anchored on mobile</h2><p class="cap" style="max-width:260px">Tooltips and input suggestions aren't menus, so they stay attached to their trigger.</p></div></div>`],
  modals: ['Modals', 'Sheet for choosing and editing. Centered dialog for one decision.', `
<div class="row" style="align-items:flex-start;margin-top:16px">
<div><div class="phone" data-sheet-host><div class="scroll"><button class="btn filled" data-open>Open form sheet</button><p class="cap">Only the handle and header drag, so fields scroll safely.</p></div>${tabs}${sheet('Edit task', fields(6), footer())}</div><p class="cap" style="margin-top:6px">Drag sheet with FormFooter</p></div>
<div style="flex:1;min-width:280px" class="stack"><h2 style="margin:0">Alert dialog</h2>
<div class="box" style="max-width:360px;border-radius:16px;box-shadow:0 10px 15px -3px rgba(0,0,0,.3)" role="alertdialog" aria-label="Delete itinerary"><b style="font-size:18px;color:var(--theme-h1-color)">Delete this day's itinerary?</b><p class="muted" style="margin:8px 0 16px">This can't be undone.</p><div class="row" style="justify-content:flex-end"><button class="btn text">Cancel</button><button class="btn danger">Delete</button></div></div>
<h2 style="margin:8px 0 0">Which one?</h2><table><tr><th>Job</th><th>Web</th><th>Mobile</th></tr><tr><td>Choose</td><td>Menu</td><td>Sheet</td></tr><tr><td>Edit</td><td>Dialog</td><td>Sheet</td></tr><tr><td>Confirm</td><td>Alert</td><td>Alert</td></tr></table></div></div>`],
  'empty-error-states': ['Empty and error states', 'Say what happened and what to do next.', `
<h2>Empty</h2><div class="grid"><div class="box stack"><p class="muted">No tasks linked to this event yet.</p><div><button class="btn outlined">Add task</button></div></div>
<div class="box"><p class="muted">No hours logged yet.</p></div>
<div class="box stack" style="align-items:center;text-align:center"><div style="font-size:28px;color:var(--theme-text-contrast)">⌖</div><b style="font-size:18px;color:var(--theme-h1-color)">Page not found</b><p class="muted">This page doesn't exist or may have moved.</p><button class="btn outlined">Back to dashboard</button></div></div>
<h2>Errors</h2><div class="grid"><label>Field<input class="err" aria-invalid="true" value="Thu"><span class="errtxt">⚠ Enter a full date</span></label>
<div class="stack"><div class="notice" role="alert">⚠ Couldn't save the packing list. Try again.</div><p class="cap">Save failed: sits above the footer and keeps input</p></div>
<div class="stack"><div class="notice row" role="alert" style="justify-content:space-between">⚠ Couldn't load tasks. <button class="btn danger" style="height:32px">Try again</button></div><p class="cap">Section failed: a button, not "refresh"</p></div></div>`],
  loading: ['Loading', 'Keep the layout stable and label button progress.', `
<h2>Skeleton</h2><div class="grid"><div class="box stack" aria-busy="true"><div class="sk" style="height:18px;width:60%"></div><div class="sk" style="height:12px"></div><div class="sk" style="height:12px;width:80%"></div></div>
<div class="box stack" aria-busy="true"><div class="row"><div class="sk" style="width:36px;height:36px;border-radius:50%"></div><div class="sk grow" style="height:14px"></div></div><div class="row"><div class="sk" style="width:36px;height:36px;border-radius:50%"></div><div class="sk grow" style="height:14px"></div></div></div></div>
<h2>Button progress</h2><div class="row"><button class="btn filled" style="min-width:96px">Save</button><button class="btn filled dis" style="min-width:96px" disabled>Saving…</button></div><p class="cap" style="margin-top:6px">The width holds steady, so nothing jumps.</p>
<h2>Inline value</h2><p class="muted">Loading…</p>`],
  motion: ['Motion', 'Enter slower than exit. Press Play to compare curves.', `
<div class="box stack" style="margin-top:16px"><div><button class="btn outlined" data-play>Play</button></div>
${[['duration-fast', '150ms', 'cubic-bezier(.4,0,.2,1)'], ['duration-base + ease-exit', '200ms', 'cubic-bezier(.4,0,1,1)'], ['duration-moderate + ease-standard', '220ms', 'cubic-bezier(.4,0,.2,1)'], ['duration-slow + ease-sheet', '340ms', 'cubic-bezier(.32,.72,0,1)']].map(([n, d, e]) => `<div><div class="cap"><code>${n}</code> ${d}</div><div class="lane"><div class="dot" style="transition:transform ${d} ${e}"></div></div></div>`).join('')}</div>
<h2>Reduced motion</h2><p class="muted">Transitions drop to 1ms. Dragging still tracks the finger.</p>`],
  accessibility: ['Accessibility', 'WCAG 2.2 AA in all three seasons.', `
<h2>Targets</h2><div class="row"><div class="box" style="width:44px;height:44px;padding:0;display:grid;place-items:center;border-color:var(--theme-outline)">44</div><span class="cap">Minimum</span><div class="box" style="width:48px;height:48px;padding:0;display:grid;place-items:center;border-color:var(--theme-text-contrast)">48</div><span class="cap">Footer buttons, sheet rows, tabs</span></div>
<h2>Focus</h2><div class="row"><button class="btn filled">Tab to me</button><button class="btn outlined">Then me</button><input style="max-width:200px" aria-label="Example" placeholder="And me"></div>
<h2>Never color alone</h2><div class="row"><span class="errtxt">⚠ Icon and text with error color</span><span class="mrow sel" style="width:auto;min-height:0">✓ Check with accent</span></div>
<h2>Every drag has an alternative</h2><p class="muted">Sheets also close with a button, the scrim, the handle and Esc. Pinch zoom stays on.</p>`],
}

for (const [name, [title, sub, body]] of Object.entries(cards)) {
  const dir = join(OUT, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.html`), page(name, 'systems', title, sub, body))
}
console.log(`${Object.keys(cards).length} cards written to ${OUT}`)

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, BarChart3, Bell, Box, Check, ChevronDown,
  ChevronRight, Database, FileSpreadsheet, FileUp, Home, LayoutGrid,
  Link as LinkIcon, Menu, Search, Settings2, SlidersHorizontal, Upload,
} from "lucide-react";
import "./_group.css";

type Route = "/" | "/price-finder" | "/comparison" | "/mapping-review" | "/load-mrp" | "/import-competitor";
type FlowStep = "import" | "review" | "complete";

const nav: { href: Route; label: string; icon: typeof Box }[] = [
  { href: "/", label: "Catalog", icon: Box },
  { href: "/price-finder", label: "Price Finder", icon: Search },
  { href: "/comparison", label: "Comparison", icon: BarChart3 },
  { href: "/mapping-review", label: "Mapping Review", icon: LinkIcon },
  { href: "/load-mrp", label: "Load MRP", icon: FileSpreadsheet },
  { href: "/import-competitor", label: "Import Competitor", icon: FileUp },
];

function Flow({ step, onChange }: { step: FlowStep; onChange: (s: FlowStep) => void }) {
  const steps: { id: FlowStep; label: string }[] = [
    { id: "import", label: "Import" }, { id: "review", label: "Review" }, { id: "complete", label: "Complete" },
  ];
  return <div className="pnav-flow" aria-label="Import progress">
    {steps.map((item, index) => <div className="pnav-flow-wrap" key={item.id}>
      <button type="button" className={`pnav-flow-step ${step === item.id ? "is-current" : ""} ${steps.findIndex(s => s.id === step) > index ? "is-done" : ""}`} onClick={() => onChange(item.id)} aria-current={step === item.id ? "step" : undefined}>
        <span className="pnav-flow-dot">{steps.findIndex(s => s.id === step) > index ? <Check size={13} /> : index + 1}</span>{item.label}
      </button>
      {index < 2 && <ChevronRight size={14} className="pnav-flow-arrow" />}
    </div>)}
  </div>;
}

function Page({ route, query, setQuery, filter, setFilter, step, setStep }: { route: Route; query: string; setQuery: (v: string) => void; filter: string; setFilter: (v: string) => void; step: FlowStep; setStep: (s: FlowStep) => void }) {
  const titles: Record<Route, [string, string]> = {
    "/": ["Catalog", "All active products with current MRP and stock levels"],
    "/price-finder": ["Price Finder", "Look up current MRP versus competitor pricing"],
    "/comparison": ["Comparison", "Side-by-side price comparison across tracked competitors"],
    "/mapping-review": ["Mapping Review", "Confirm product-to-competitor row mappings"],
    "/load-mrp": ["Load MRP", "Update product MRP in bulk from a spreadsheet"],
    "/import-competitor": ["Import Competitor", "Add a competitor price list to the comparison database"],
  };
  const [title, subtitle] = titles[route];
  const isImport = route === "/import-competitor" || route === "/load-mrp";
  const rows = useMemo(() => [
    ["PRY-001", "Amla Hair Oil 200ml", "Hair Care", "₹ 180.00", "1240"],
    ["PRY-002", "Neem Face Wash 100ml", "Skin Care", "₹ 120.00", "530"],
    ["PRY-003", "Ashwagandha Tablets 60ct", "Wellness", "₹ 350.00", "870"],
    ["PRY-004", "Turmeric Cream 50g", "Skin Care", "₹ 95.00", "320"],
  ].filter(row => row.join(" ").toLowerCase().includes(query.toLowerCase())), [query]);
  return <section className="pnav-content">
    <div className="pnav-breadcrumbs"><button type="button" className="pnav-back" onClick={() => window.history.back()} aria-label="Go back"><ArrowLeft size={15} /> Back</button><ChevronRight size={14} /><button type="button" onClick={() => window.history.pushState({}, "", "/")} >Product Database</button><ChevronRight size={14} /><span>{title}</span></div>
    <div className="pnav-heading-row"><div><p className="pnav-eyebrow">{route === "/" ? "Workspace / Catalog" : `Product Database / ${title}`}</p><h1>{title}</h1><p className="pnav-subtitle">{subtitle}</p></div><div className="pnav-heading-actions">{isImport && <span className="pnav-saved">Autosaved 2 min ago</span>}<button className="pnav-outline" type="button"><Settings2 size={15} /> View settings</button></div></div>
    {isImport && <div className="pnav-import-strip"><div><strong>{route === "/load-mrp" ? "MRP update" : "Competitor price list"}</strong><span>Follow the three-step review path before publishing data.</span></div><Flow step={step} onChange={setStep} /></div>}
    <div className="pnav-toolbar"><label className="pnav-search"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or item code" aria-label="Search products" /></label><label className="pnav-select-label"><SlidersHorizontal size={15} /> View <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter products"><option>All products</option><option>Hair Care</option><option>Skin Care</option><option>Wellness</option></select><ChevronDown size={14} /></label><button className="pnav-primary" type="button" onClick={() => isImport && setStep(step === "import" ? "review" : "complete")} >{isImport ? step === "import" ? "Continue to review" : step === "review" ? "Complete import" : "View results" : "Export view"} <ArrowRight size={15} /></button></div>
    <div className="pnav-metrics"><div><span>Tracked SKUs</span><strong>8</strong></div><div><span>Needs review</span><strong className="pnav-warn">14</strong></div><div><span>Last sync</span><strong>Today, 09:42</strong></div><div><span>Source status</span><strong className="pnav-good"><Check size={14} /> Healthy</strong></div></div>
    <div className="pnav-table-wrap"><table className="pnav-table"><thead><tr><th>Item code</th><th>Product name</th><th>Category</th><th>Current MRP</th><th>Stock</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{rows.map(row => <tr key={row[0]}><td className="pnav-code">{row[0]}</td><td><strong>{row[1]}</strong><small>Prayag Polymers · active</small></td><td><span className="pnav-pill">{row[2]}</span></td><td>{row[3]}</td><td>{row[4]}</td><td><button className="pnav-row-action" type="button" aria-label={`Open ${row[1]}`}><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div>
    <div className="pnav-footnote"><span><Bell size={14} /> Data is current as of 12 Feb 2025, 09:42 IST</span><button type="button">Open Data Health <ArrowRight size={14} /></button></div>
  </section>;
}

export default function Unified() {
  const [route, setRoute] = useState<Route>("/");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All products");
  const [step, setStep] = useState<FlowStep>("import");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { const onPop = () => setRoute((window.location.pathname as Route) || "/"); window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
  const go = (href: Route) => { window.history.pushState({ query, filter }, "", href); setRoute(href); setMenuOpen(false); };
  return <div className="pnav-unified">
    <aside className={`pnav-sidebar pnav-unified-sidebar ${menuOpen ? "is-open" : ""}`}><div className="pnav-logo"><span className="pnav-mark"><LayoutGrid size={17} /></span><div><b>Prayag</b><small>Pricing workspace</small></div></div><div className="pnav-context"><span>Workspace</span><button type="button" onClick={() => go("/")}><Database size={14} /> Product Database <ChevronDown size={14} /></button></div><nav className="pnav-nav" aria-label="Product Database navigation">{nav.map(item => { const Icon = item.icon; return <button type="button" key={item.href} onClick={() => go(item.href)} className={`pnav-item ${route === item.href ? "pnav-item--active" : ""}`} aria-current={route === item.href ? "page" : undefined}><Icon className="pnav-item-icon" />{item.label}{item.href === "/mapping-review" && <span className="pnav-count">14</span>}</button>; })}</nav><div className="pnav-apps"><p>Switch app</p><button type="button" onClick={() => go("/")}><Home size={15} /> Home</button><button type="button" className="pnav-app-active"><BarChart3 size={15} /> Competition Analysis <span>Open</span></button></div><div className="pnav-user"><span className="pnav-avatar">AS</span><div><b>Aarav Sharma</b><small>Catalog reviewer</small></div><button aria-label="Open account menu" type="button"><ChevronDown size={15} /></button></div></aside>
    <main className="pnav-main pnav-unified-main"><header className="pnav-topbar"><button className="pnav-mobile-menu" type="button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Toggle navigation menu"><Menu size={19} /></button><div className="pnav-top-context"><span>PRY / INTERNAL</span><strong>Pricing operations</strong></div><div className="pnav-top-actions"><label className="pnav-global-search"><Search size={15} /><input placeholder="Search workspace" aria-label="Search workspace" /></label><button className="pnav-icon-button" aria-label="Notifications" type="button"><Bell size={17} /><i /></button><span className="pnav-top-user">Aarav Sharma</span></div></header><Page route={route} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} step={step} setStep={setStep} /></main>
  </div>;
}
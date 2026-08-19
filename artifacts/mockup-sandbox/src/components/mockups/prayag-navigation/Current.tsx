import { useState } from "react";
import {
  Box,
  Database,
  FileSpreadsheet,
  LayoutGrid,
  BarChart2,
  Link as LinkIcon,
  FileUp,
  Key,
  LogOut,
  Home,
  TrendingUp,
  Search,
} from "lucide-react";
import "./_group.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RouteKey =
  | "/"
  | "/price-finder"
  | "/comparison"
  | "/mapping-review"
  | "/load-mrp"
  | "/import-competitor"
  | "/data-health"
  | "/api-keys";

interface NavItem {
  href: RouteKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// ---------------------------------------------------------------------------
// Nav definition — exact labels and hrefs from source layout.tsx
// ---------------------------------------------------------------------------

const NAV_ITEMS: NavItem[] = [
  { href: "/",                  label: "Catalog",           icon: Box },
  { href: "/price-finder",      label: "Price Finder",      icon: Search },
  { href: "/comparison",        label: "Comparison",        icon: BarChart2 },
  { href: "/mapping-review",    label: "Mapping Review",    icon: LinkIcon },
  { href: "/load-mrp",          label: "Load MRP",          icon: FileSpreadsheet },
  { href: "/import-competitor", label: "Import Competitor", icon: FileUp },
  { href: "/data-health",       label: "Data Health",       icon: Database },
  { href: "/api-keys",          label: "API Keys",          icon: Key },
];

// ---------------------------------------------------------------------------
// Stub user (replaces useAuth)
// ---------------------------------------------------------------------------

const STUB_USER = { firstName: "Aarav", lastName: "Sharma", email: "aarav@prayag.in" };

function stubLogout() {
  // No-op in isolation
}

// ---------------------------------------------------------------------------
// Page content stubs — realistic enough to judge nav in context
// ---------------------------------------------------------------------------

function CatalogPage() {
  const products = [
    { code: "PRY-001", name: "Amla Hair Oil 200ml",      category: "Hair Care",  mrp: "180.00", stock: 1240 },
    { code: "PRY-002", name: "Neem Face Wash 100ml",     category: "Skin Care",  mrp: "120.00", stock: 530  },
    { code: "PRY-003", name: "Ashwagandha Tablets 60ct", category: "Wellness",   mrp: "350.00", stock: 870  },
    { code: "PRY-004", name: "Turmeric Cream 50g",       category: "Skin Care",  mrp: "95.00",  stock: 320  },
    { code: "PRY-005", name: "Brahmi Capsules 30ct",     category: "Wellness",   mrp: "280.00", stock: 615  },
    { code: "PRY-006", name: "Rose Water 100ml",         category: "Skin Care",  mrp: "65.00",  stock: 2100 },
    { code: "PRY-007", name: "Shikakai Shampoo 300ml",   category: "Hair Care",  mrp: "210.00", stock: 940  },
    { code: "PRY-008", name: "Triphala Powder 100g",     category: "Wellness",   mrp: "160.00", stock: 480  },
  ];

  return (
    <div className="pnav-page">
      <div className="pnav-page-header">
        <h1 className="pnav-page-title">Catalog</h1>
        <p className="pnav-page-subtitle">All active products with current MRP and stock levels</p>
      </div>
      <div className="pnav-stats">
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Total SKUs</div>
          <div className="pnav-stat-value">8</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Categories</div>
          <div className="pnav-stat-value">3</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Total Stock</div>
          <div className="pnav-stat-value">7,095</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Avg MRP</div>
          <div className="pnav-stat-value">182.50</div>
        </div>
      </div>
      <table className="pnav-table">
        <thead>
          <tr>
            <th>Item Code</th>
            <th>Product Name</th>
            <th>Category</th>
            <th style={{ textAlign: "right" }}>MRP</th>
            <th style={{ textAlign: "right" }}>Stock</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.code}>
              <td style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "hsl(220 20% 45%)" }}>{p.code}</td>
              <td style={{ fontWeight: 500 }}>{p.name}</td>
              <td>
                <span className={
                  p.category === "Hair Care" ? "pnav-badge pnav-badge--blue"
                  : p.category === "Skin Care" ? "pnav-badge pnav-badge--green"
                  : "pnav-badge pnav-badge--amber"
                }>{p.category}</span>
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>&#8377; {p.mrp}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.stock.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PriceFinderPage() {
  const results = [
    { code: "PRY-002", name: "Neem Face Wash 100ml",  ourMrp: "120.00", competitorMrp: "115.00", gap: "-4.2%", status: "below" },
    { code: "PRY-001", name: "Amla Hair Oil 200ml",   ourMrp: "180.00", competitorMrp: "175.00", gap: "-2.8%", status: "below" },
    { code: "PRY-003", name: "Ashwagandha 60ct",      ourMrp: "350.00", competitorMrp: "365.00", gap: "+4.3%", status: "above" },
    { code: "PRY-006", name: "Rose Water 100ml",      ourMrp: "65.00",  competitorMrp: "65.00",  gap: "0.0%",  status: "parity" },
  ];

  return (
    <div className="pnav-page">
      <div className="pnav-page-header">
        <h1 className="pnav-page-title">Price Finder</h1>
        <p className="pnav-page-subtitle">Look up any product and see current MRP versus competitor pricing</p>
      </div>
      <div style={{ marginBottom: "1.5rem", display: "flex", gap: "0.5rem" }}>
        <input
          type="search"
          placeholder="Search by name or item code..."
          readOnly
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            border: "1px solid hsl(var(--border, 210 20% 86%))",
            borderRadius: "calc(var(--radius, 0.3rem) - 2px)",
            fontSize: "0.875rem",
            background: "hsl(var(--card, 0 0% 100%))",
            color: "hsl(var(--foreground, 220 40% 10%))",
          }}
        />
        <button style={{
          padding: "0.5rem 1rem",
          borderRadius: "calc(var(--radius, 0.3rem) - 2px)",
          background: "hsl(var(--primary, 220 80% 40%))",
          color: "hsl(var(--primary-foreground, 0 0% 100%))",
          border: "none",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
        }}>Search</button>
      </div>
      <table className="pnav-table">
        <thead>
          <tr>
            <th>Item Code</th>
            <th>Product Name</th>
            <th style={{ textAlign: "right" }}>Our MRP</th>
            <th style={{ textAlign: "right" }}>Competitor MRP</th>
            <th style={{ textAlign: "right" }}>Gap</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.code}>
              <td style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "hsl(220 20% 45%)" }}>{r.code}</td>
              <td style={{ fontWeight: 500 }}>{r.name}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>&#8377; {r.ourMrp}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>&#8377; {r.competitorMrp}</td>
              <td style={{ textAlign: "right" }}>
                <span className={
                  r.status === "below" ? "pnav-badge pnav-badge--red"
                  : r.status === "above" ? "pnav-badge pnav-badge--green"
                  : "pnav-badge pnav-badge--amber"
                }>{r.gap}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonPage() {
  return (
    <div className="pnav-page">
      <div className="pnav-page-header">
        <h1 className="pnav-page-title">Comparison</h1>
        <p className="pnav-page-subtitle">Side-by-side price comparison across all tracked competitors</p>
      </div>
      <div className="pnav-stats">
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Competitors</div>
          <div className="pnav-stat-value">4</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Products compared</div>
          <div className="pnav-stat-value">8</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Below market</div>
          <div className="pnav-stat-value">2</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Above market</div>
          <div className="pnav-stat-value">5</div>
        </div>
      </div>
      <table className="pnav-table">
        <thead>
          <tr>
            <th>Product</th>
            <th style={{ textAlign: "right" }}>Our MRP</th>
            <th style={{ textAlign: "right" }}>Himalaya</th>
            <th style={{ textAlign: "right" }}>Dabur</th>
            <th style={{ textAlign: "right" }}>Patanjali</th>
            <th>Position</th>
          </tr>
        </thead>
        <tbody>
          {[
            { name: "Amla Hair Oil 200ml",  our: "180", h: "175", d: "185", p: "170", pos: "mid"   },
            { name: "Neem Face Wash 100ml", our: "120", h: "115", d: "125", p: "110", pos: "mid"   },
            { name: "Ashwagandha 60ct",     our: "350", h: "365", d: "340", p: "360", pos: "low"   },
            { name: "Turmeric Cream 50g",   our: "95",  h: "90",  d: "100", p: "85",  pos: "mid"   },
            { name: "Rose Water 100ml",     our: "65",  h: "70",  d: "65",  p: "60",  pos: "low"   },
          ].map((r) => (
            <tr key={r.name}>
              <td style={{ fontWeight: 500 }}>{r.name}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>&#8377; {r.our}</td>
              <td style={{ textAlign: "right", color: "hsl(220 20% 45%)" }}>&#8377; {r.h}</td>
              <td style={{ textAlign: "right", color: "hsl(220 20% 45%)" }}>&#8377; {r.d}</td>
              <td style={{ textAlign: "right", color: "hsl(220 20% 45%)" }}>&#8377; {r.p}</td>
              <td>
                <span className={r.pos === "low" ? "pnav-badge pnav-badge--green" : "pnav-badge pnav-badge--amber"}>
                  {r.pos === "low" ? "Competitive" : "Mid-range"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MappingReviewPage() {
  return (
    <div className="pnav-page">
      <div className="pnav-page-header">
        <h1 className="pnav-page-title">Mapping Review</h1>
        <p className="pnav-page-subtitle">Review and confirm product-to-competitor row mappings before they are accepted</p>
      </div>
      <div className="pnav-stats">
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Pending review</div>
          <div className="pnav-stat-value">14</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Auto-accepted</div>
          <div className="pnav-stat-value">62</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Unmatched</div>
          <div className="pnav-stat-value">3</div>
        </div>
      </div>
      <table className="pnav-table">
        <thead>
          <tr>
            <th>Competitor Row</th>
            <th>Matched Product</th>
            <th>Confidence</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {[
            { row: "Amla Oil 200ml",       match: "PRY-001 Amla Hair Oil 200ml",   conf: "High",   status: "amber" },
            { row: "Neem Face Wash 100",   match: "PRY-002 Neem Face Wash 100ml",  conf: "High",   status: "amber" },
            { row: "Ashwagandha Tabs 60",  match: "PRY-003 Ashwagandha Tablets",   conf: "Medium", status: "amber" },
            { row: "Rose Water 100",       match: "PRY-006 Rose Water 100ml",      conf: "High",   status: "green" },
            { row: "Shikakai Shmpoo 300",  match: "PRY-007 Shikakai Shampoo 300ml",conf: "Medium", status: "amber" },
          ].map((r) => (
            <tr key={r.row}>
              <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{r.row}</td>
              <td style={{ fontWeight: 500 }}>{r.match}</td>
              <td>
                <span className={r.status === "green" ? "pnav-badge pnav-badge--green" : "pnav-badge pnav-badge--amber"}>
                  {r.conf}
                </span>
              </td>
              <td style={{ display: "flex", gap: "0.5rem" }}>
                <button style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", border: "1px solid hsl(142 60% 50%)", borderRadius: "4px", background: "hsl(142 60% 90%)", color: "hsl(142 60% 25%)", cursor: "pointer" }}>Accept</button>
                <button style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", border: "1px solid hsl(0 70% 60%)", borderRadius: "4px", background: "hsl(0 70% 94%)", color: "hsl(0 70% 35%)", cursor: "pointer" }}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadMrpPage() {
  return (
    <div className="pnav-page">
      <div className="pnav-page-header">
        <h1 className="pnav-page-title">Load MRP</h1>
        <p className="pnav-page-subtitle">Upload a spreadsheet to update product MRP in bulk</p>
      </div>
      <div style={{
        border: "2px dashed hsl(var(--border, 210 20% 86%))",
        borderRadius: "calc(var(--radius, 0.3rem))",
        padding: "3rem",
        textAlign: "center",
        background: "hsl(var(--muted, 210 20% 90%) / 0.3)",
        marginBottom: "1.5rem",
      }}>
        <FileSpreadsheet style={{ width: "2.5rem", height: "2.5rem", margin: "0 auto 0.75rem", color: "hsl(var(--muted-foreground, 220 20% 40%))" }} />
        <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Drop an XLSX or CSV file here</p>
        <p style={{ fontSize: "0.875rem", color: "hsl(var(--muted-foreground, 220 20% 40%))", margin: "0 0 1rem" }}>or click to browse</p>
        <button style={{
          padding: "0.5rem 1.25rem",
          borderRadius: "calc(var(--radius, 0.3rem) - 2px)",
          background: "hsl(var(--primary, 220 80% 40%))",
          color: "hsl(var(--primary-foreground, 0 0% 100%))",
          border: "none",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
        }}>Choose File</button>
      </div>
      <p style={{ fontSize: "0.875rem", color: "hsl(var(--muted-foreground, 220 20% 40%))" }}>
        Expected columns: <code style={{ background: "hsl(var(--muted, 210 20% 90%))", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>Item Code</code>, <code style={{ background: "hsl(var(--muted, 210 20% 90%))", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>MRP</code>. Extra columns are ignored.
      </p>
    </div>
  );
}

function ImportCompetitorPage() {
  return (
    <div className="pnav-page">
      <div className="pnav-page-header">
        <h1 className="pnav-page-title">Import Competitor</h1>
        <p className="pnav-page-subtitle">Upload a competitor price list to update the comparison database</p>
      </div>
      <div style={{ marginBottom: "1.5rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.375rem" }}>Competitor Brand</label>
          <select style={{
            width: "100%",
            padding: "0.5rem 0.75rem",
            border: "1px solid hsl(var(--border, 210 20% 86%))",
            borderRadius: "calc(var(--radius, 0.3rem) - 2px)",
            fontSize: "0.875rem",
            background: "hsl(var(--card, 0 0% 100%))",
          }}>
            <option>Himalaya</option>
            <option>Dabur</option>
            <option>Patanjali</option>
            <option>Mamaearth</option>
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.375rem" }}>Period</label>
          <select style={{
            width: "100%",
            padding: "0.5rem 0.75rem",
            border: "1px solid hsl(var(--border, 210 20% 86%))",
            borderRadius: "calc(var(--radius, 0.3rem) - 2px)",
            fontSize: "0.875rem",
            background: "hsl(var(--card, 0 0% 100%))",
          }}>
            <option>Jan 2025</option>
            <option>Feb 2025</option>
            <option>Mar 2025</option>
          </select>
        </div>
      </div>
      <div style={{
        border: "2px dashed hsl(var(--border, 210 20% 86%))",
        borderRadius: "calc(var(--radius, 0.3rem))",
        padding: "3rem",
        textAlign: "center",
        background: "hsl(var(--muted, 210 20% 90%) / 0.3)",
      }}>
        <FileUp style={{ width: "2.5rem", height: "2.5rem", margin: "0 auto 0.75rem", color: "hsl(var(--muted-foreground, 220 20% 40%))" }} />
        <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Drop a competitor price list here</p>
        <p style={{ fontSize: "0.875rem", color: "hsl(var(--muted-foreground, 220 20% 40%))", margin: "0 0 1rem" }}>XLSX, CSV, or PDF accepted</p>
        <button style={{
          padding: "0.5rem 1.25rem",
          borderRadius: "calc(var(--radius, 0.3rem) - 2px)",
          background: "hsl(var(--primary, 220 80% 40%))",
          color: "hsl(var(--primary-foreground, 0 0% 100%))",
          border: "none",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
        }}>Upload File</button>
      </div>
    </div>
  );
}

function DataHealthPage() {
  return (
    <div className="pnav-page">
      <div className="pnav-page-header">
        <h1 className="pnav-page-title">Data Health</h1>
        <p className="pnav-page-subtitle">Audit the completeness and freshness of product data across all sources</p>
      </div>
      <div className="pnav-stats">
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Products with MRP</div>
          <div className="pnav-stat-value">8 / 8</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Stale MRP (&gt; 60 days)</div>
          <div className="pnav-stat-value">2</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Unmapped competitor rows</div>
          <div className="pnav-stat-value">3</div>
        </div>
        <div className="pnav-stat-card">
          <div className="pnav-stat-label">Missing categories</div>
          <div className="pnav-stat-value">0</div>
        </div>
      </div>
      <table className="pnav-table">
        <thead>
          <tr>
            <th>Check</th>
            <th>Status</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {[
            { check: "All products have MRP",            status: "pass",   detail: "8 of 8 products have a current MRP"              },
            { check: "MRP freshness",                    status: "warn",   detail: "PRY-004 and PRY-008 not updated in 62 days"       },
            { check: "Competitor coverage",              status: "warn",   detail: "3 rows from Dabur Jan 2025 remain unmatched"      },
            { check: "Duplicate item codes",             status: "pass",   detail: "No duplicates found"                             },
            { check: "Category completeness",            status: "pass",   detail: "All 8 products have a category assigned"         },
            { check: "Orphaned competitor mappings",     status: "pass",   detail: "All mappings reference active products"          },
          ].map((r) => (
            <tr key={r.check}>
              <td style={{ fontWeight: 500 }}>{r.check}</td>
              <td>
                <span className={r.status === "pass" ? "pnav-badge pnav-badge--green" : "pnav-badge pnav-badge--amber"}>
                  {r.status === "pass" ? "Pass" : "Warning"}
                </span>
              </td>
              <td style={{ color: "hsl(220 20% 40%)", fontSize: "0.875rem" }}>{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApiKeysPage() {
  return (
    <div className="pnav-page">
      <div className="pnav-page-header">
        <h1 className="pnav-page-title">API Keys</h1>
        <p className="pnav-page-subtitle">Manage keys used by external services to read product and pricing data</p>
      </div>
      <table className="pnav-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Key (masked)</th>
            <th>Created</th>
            <th>Last used</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {[
            { name: "Analysis Dashboard",   key: "pk_live_••••••••••••Rz9q", created: "12 Jan 2025", last: "2 hours ago",  active: true  },
            { name: "Home Portal",          key: "pk_live_••••••••••••Xt4m", created: "8 Feb 2025",  last: "Yesterday",    active: true  },
            { name: "Legacy ETL",           key: "pk_live_••••••••••••Bv2k", created: "3 Mar 2024",  last: "45 days ago",  active: false },
          ].map((r) => (
            <tr key={r.name}>
              <td style={{ fontWeight: 500 }}>{r.name}</td>
              <td style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "hsl(220 20% 45%)" }}>{r.key}</td>
              <td style={{ color: "hsl(220 20% 40%)", fontSize: "0.875rem" }}>{r.created}</td>
              <td style={{ color: "hsl(220 20% 40%)", fontSize: "0.875rem" }}>{r.last}</td>
              <td>
                <span className={r.active ? "pnav-badge pnav-badge--green" : "pnav-badge pnav-badge--red"}>
                  {r.active ? "Active" : "Revoked"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: "1.25rem" }}>
        <button style={{
          padding: "0.5rem 1.25rem",
          borderRadius: "calc(var(--radius, 0.3rem) - 2px)",
          background: "hsl(var(--primary, 220 80% 40%))",
          color: "hsl(var(--primary-foreground, 0 0% 100%))",
          border: "none",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
        }}>Generate New Key</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page registry
// ---------------------------------------------------------------------------

const PAGE_COMPONENTS: Record<RouteKey, React.ComponentType> = {
  "/":                  CatalogPage,
  "/price-finder":      PriceFinderPage,
  "/comparison":        ComparisonPage,
  "/mapping-review":    MappingReviewPage,
  "/load-mrp":          LoadMrpPage,
  "/import-competitor": ImportCompetitorPage,
  "/data-health":       DataHealthPage,
  "/api-keys":          ApiKeysPage,
};

// ---------------------------------------------------------------------------
// Mockup route-switcher bar (replaces wouter routing in isolation)
// ---------------------------------------------------------------------------

const ROUTE_LABELS: { href: RouteKey; short: string }[] = NAV_ITEMS.map((n) => ({
  href: n.href,
  short: n.label,
}));

// ---------------------------------------------------------------------------
// Main export — the isolated navigation shell
// ---------------------------------------------------------------------------

export default function Current() {
  const [activeRoute, setActiveRoute] = useState<RouteKey>("/");

  const user = STUB_USER;
  const PageContent = PAGE_COMPONENTS[activeRoute];

  return (
    <div className="pnav-root">
      {/* ------------------------------------------------------------------ */}
      {/* Sidebar                                                              */}
      {/* ------------------------------------------------------------------ */}
      <aside className="pnav-sidebar">
        {/* Logo */}
        <div className="pnav-logo">
          <LayoutGrid className="pnav-logo-icon" />
          <span className="pnav-logo-text">Prayag DB</span>
        </div>

        {/* Primary navigation */}
        <nav className="pnav-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeRoute === item.href ||
              (item.href !== "/" && activeRoute.startsWith(item.href));

            return (
              <button
                key={item.href}
                onClick={() => setActiveRoute(item.href)}
                className={`pnav-item${isActive ? " pnav-item--active" : ""}`}
              >
                <Icon className="pnav-item-icon" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Cross-app destinations — real hrefs preserved, open in parent tab */}
        <div className="pnav-section">
          <p className="pnav-section-label">Other Apps</p>
          <a
            href="/"
            target="_top"
            rel="noopener noreferrer"
            className="pnav-item"
          >
            <Home className="pnav-item-icon" />
            Home
          </a>
          <a
            href="/analysis/"
            target="_top"
            rel="noopener noreferrer"
            className="pnav-item"
          >
            <TrendingUp className="pnav-item-icon" />
            Competition Analysis
          </a>
        </div>

        {/* User / logout */}
        <div className="pnav-footer">
          <p className="pnav-username">
            {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}
          </p>
          <button
            onClick={stubLogout}
            className="pnav-item"
          >
            <LogOut className="pnav-item-icon" />
            Log out
          </button>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Main content                                                         */}
      {/* ------------------------------------------------------------------ */}
      <main className="pnav-main">
        {/* Mockup-only route switcher — lets reviewers navigate without wouter */}
        <div style={{ padding: "0.75rem 2rem 0", borderBottom: "none" }}>
          <div className="pnav-route-bar">
            {ROUTE_LABELS.map((r) => (
              <button
                key={r.href}
                className={`pnav-route-btn${activeRoute === r.href ? " pnav-route-btn--active" : ""}`}
                onClick={() => setActiveRoute(r.href)}
              >
                {r.short}
              </button>
            ))}
          </div>
        </div>

        <PageContent />
      </main>
    </div>
  );
}

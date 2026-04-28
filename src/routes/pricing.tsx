import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing")({
  head: () => ({ meta: [{ title: "Pricing — DocuForge" }, { name: "description", content: "PDF editor subscription plans for teams." }] }),
  component: Pricing,
});

function Pricing() {
  const plans = ["Starter", "Pro", "Business"];
  return <main className="min-h-screen bg-workspace px-4 py-12 text-foreground md:px-8"><div className="mx-auto max-w-6xl"><h1 className="text-5xl font-bold tracking-tight">Pricing</h1><p className="mt-4 max-w-2xl text-muted-foreground">Subscription tiers for editing, OCR, AI tools, team storage, and admin controls.</p><div className="mt-8 grid gap-4 md:grid-cols-3">{plans.map((plan, i)=><div key={plan} className="rounded-2xl border border-border bg-panel p-6 shadow-soft"><h2 className="text-2xl font-bold">{plan}</h2><p className="mt-4 text-4xl font-bold">${[19,49,149][i]}<span className="text-sm text-muted-foreground">/mo</span></p><ul className="mt-6 space-y-3 text-sm text-muted-foreground"><li>PDF editing canvas</li><li>Signatures and forms</li><li>{i>0 ? "AI + OCR tools" : "Basic export"}</li><li>{i>1 ? "Admin analytics" : "Secure storage"}</li></ul><Link to="/editor" className="mt-6 inline-flex w-full justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-blue">Start</Link></div>)}</div></div></main>;
}

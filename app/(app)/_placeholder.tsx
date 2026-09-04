// Sprint 1 delivers auth, tenancy, roles and the shell. The screens those
// roles will use arrive in later sprints (blueprint §15). These placeholders
// exist so the navigation is not full of dead links and, more importantly, so
// the permission guard on each route is real and testable now rather than
// bolted on when the screen lands.

export function Placeholder({ title, sprint, blurb }: { title: string; sprint: string; blurb: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{title}</h1>
      <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
        <p className="text-slate-700 dark:text-slate-300">{blurb}</p>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Arrives in {sprint}.</p>
      </div>
    </div>
  );
}

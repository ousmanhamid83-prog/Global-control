/** VIGILAIR est un poste PC : sous 1024 px, on le dit au lieu d'afficher une console illisible. */
export function PostePcRequis() {
  return (
    <div
      role="alert"
      className="fixed inset-0 z-[100] hidden flex-col items-center justify-center gap-3 bg-bg px-8 text-center text-fg max-[1024px]:flex"
    >
      <p className="font-display text-lg font-semibold tracking-tight">VIGILAIR</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Poste de commandement sur ordinateur uniquement. Ouvrez VIGILAIR sur un PC, écran
        d'au moins 1280 px de large.
      </p>
    </div>
  );
}

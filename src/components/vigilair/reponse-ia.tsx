import { cn } from "@/lib/utils";

/**
 * Texte rédigé par l'IA du poste, avec les mentions du garde-fou (ia-garde-fou) détachées et mises
 * en évidence : « ⚠ » une possible invention, « ℹ » un exemple tiré de la notice. Collées au texte,
 * elles se lisaient comme une phrase de plus de la réponse.
 */
export function ReponseIa({ texte, className }: { texte: string; className?: string }) {
  const [corps, ...mentions] = texte.split(/\n\n(?=[⚠ℹ] )/);
  return (
    <div className={cn("space-y-2", className)}>
      <p className="whitespace-pre-wrap leading-relaxed text-fg">{corps}</p>
      {mentions.map((m) => (
        <p
          key={m}
          role="note"
          className={cn(
            "rounded-sm border px-2 py-1.5 leading-relaxed",
            m.startsWith("⚠")
              ? "border-warn/40 bg-warn/10 text-warn"
              : "border-border bg-bg/60 text-muted-foreground",
          )}
        >
          {m}
        </p>
      ))}
    </div>
  );
}

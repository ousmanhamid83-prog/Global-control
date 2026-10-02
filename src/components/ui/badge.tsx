import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase leading-4 tracking-[0.06em]",
  {
    variants: {
      tone: {
        default: "border-border bg-secondary text-muted-foreground",
        ice: "border-primary/35 bg-primary/15 text-primary",
        ok: "border-ok/35 bg-ok/15 text-ok",
        warn: "border-warn/35 bg-warn/15 text-warn",
        crit: "border-crit/40 bg-crit/15 text-crit",
        cn: "border-cn/35 bg-cn/15 text-cn",
        tr: "border-tr/35 bg-tr/15 text-tr",
        ru: "border-ru/35 bg-ru/15 text-ru",
        ir: "border-ir/35 bg-ir/15 text-ir",
        xx: "border-xx/35 bg-xx/15 text-xx",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}

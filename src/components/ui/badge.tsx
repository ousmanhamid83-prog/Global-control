import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide",
  {
    variants: {
      tone: {
        default: "bg-secondary text-muted-foreground",
        ice: "bg-primary/15 text-primary",
        ok: "bg-ok/15 text-ok",
        warn: "bg-warn/15 text-warn",
        crit: "bg-crit/15 text-crit",
        cn: "bg-cn/15 text-cn",
        tr: "bg-tr/15 text-tr",
        ru: "bg-ru/15 text-ru",
        ir: "bg-ir/15 text-ir",
        xx: "bg-xx/15 text-xx",
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

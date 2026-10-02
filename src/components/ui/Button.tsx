import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantStyles: Record<Variant, string> = {
  primary: [
    "bg-primary text-on-primary border border-primary",
    "hover:bg-primary-hover hover:border-primary-hover",
    "focus-visible:ring-2 focus-visible:ring-accent/35",
  ].join(" "),
  secondary: [
    "bg-surface text-text border border-border",
    "hover:bg-surface-muted hover:border-border-strong",
    "focus-visible:ring-2 focus-visible:ring-accent/35",
  ].join(" "),
  ghost: [
    "bg-transparent text-text border border-transparent",
    "hover:bg-surface-muted",
    "focus-visible:ring-2 focus-visible:ring-accent/35",
  ].join(" "),
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-2",
          "px-4 py-2 text-sm font-medium leading-tight",
          "rounded-[var(--radius)] transition-colors duration-150",
          "disabled:opacity-50 disabled:pointer-events-none",
          variantStyles[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
export { Button };
export type { ButtonProps, Variant as ButtonVariant };

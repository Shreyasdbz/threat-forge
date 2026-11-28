import { IconSelector } from "@tabler/icons-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
	return (
		<span className={cn("relative inline-grid min-w-0", className)}>
			<select
				data-slot="native-select"
				className="peer h-8 w-full min-w-0 appearance-none truncate rounded-2xl border border-transparent bg-input/50 pr-9 pl-3 text-sm outline-none transition-[color,box-shadow] duration-200 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
				{...props}
			/>
			<IconSelector
				aria-hidden="true"
				className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
			/>
		</span>
	);
}

import { useRef, useState, useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export default function TypographyTruncate({
  children,
  className,
}: React.ComponentProps<"span">) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowed, setIsOverflowed] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      const isOverflowing = el.scrollWidth > el.clientWidth;
      setIsOverflowed(isOverflowing);
    }
  }, [children]);

  const textElement = (
    <span
      ref={textRef}
      className={cn("truncate inline-block max-w-full", className)}
    >
      {children}
    </span>
  );

  if (!isOverflowed) {
    return textElement;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{textElement}</TooltipTrigger>
      <TooltipContent>
        <p>{children}</p>
      </TooltipContent>
    </Tooltip>
  );
}

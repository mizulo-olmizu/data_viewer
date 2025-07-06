import { useRef, useState, useEffect } from "react";
import { Tooltip, Typography, TypographyProps } from "@mui/material";

interface TypographyTruncateProps extends TypographyProps {
  children: string;
}

export default function TypographyTruncate({
  children,
  ...typographyProps
}: TypographyTruncateProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowed, setIsOverflowed] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      const isOverflowing = el.scrollWidth > el.clientWidth;
      setIsOverflowed(isOverflowing);
    }
  }, [children]);

  return (
    <Tooltip
      title={isOverflowed ? children : ""}
      disableHoverListener={!isOverflowed}
    >
      <Typography
        {...typographyProps}
        ref={textRef}
        sx={{
          ...typographyProps.sx,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "inline-block",
        }}
      >
        {children}
      </Typography>
    </Tooltip>
  );
}

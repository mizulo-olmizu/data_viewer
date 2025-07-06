import AutoGraphIcon from "@mui/icons-material/AutoGraph";
import { Stack, SxProps } from "@mui/material";

export interface EmptyDataProps {
  sx?: SxProps;
}

export default function EmptyData({ sx }: EmptyDataProps) {
  return (
    <Stack
      justifyContent="center"
      alignItems="center"
      gap={1}
      sx={sx}
      data-testid="no-data"
    >
      <AutoGraphIcon
        role="img"
        aria-hidden="false"
        sx={{ fontSize: `${100}px`, color: "#bbb" }}
      />
      <h2
        style={{
          color: "#bbb",
          marginTop: 0,
          fontWeight: "bold",
        }}
      >
        No Data!
      </h2>
      <p
        style={{
          color: "#bbb",
          marginTop: 0,
        }}
      >
        By adding data, you can view its preview and summary.
      </p>
    </Stack>
  );
}

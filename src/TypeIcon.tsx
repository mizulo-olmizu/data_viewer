import ScheduleIcon from "@mui/icons-material/Schedule";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import FontDownloadIcon from "@mui/icons-material/FontDownload";
import HelpCenterIcon from "@mui/icons-material/HelpCenter";
import FlakyIcon from "@mui/icons-material/Flaky";
import DataObjectIcon from "@mui/icons-material/DataObject";
import TimelapseIcon from "@mui/icons-material/Timelapse";
import NumbersIcon from "@mui/icons-material/Numbers";
import { SvgIconProps } from "@mui/material";
import { DtypeGroup } from "./types";
export interface TypeIconProps extends SvgIconProps {
  dtypeGroup: DtypeGroup;
}

export default function TypeIcon(props: TypeIconProps) {
  const { dtypeGroup, ...iconProps } = props;

  switch (dtypeGroup) {
    case "numeric":
      return <NumbersIcon {...iconProps} />;
    case "date":
      return <CalendarMonthIcon {...iconProps} />;
    case "datetime":
      return <CalendarMonthIcon {...iconProps} />;
    case "time":
      return <ScheduleIcon {...iconProps} />;
    case "duration":
      return <TimelapseIcon {...iconProps} />;
    case "string":
      return <FontDownloadIcon {...iconProps} />;
    case "boolean":
      return <FlakyIcon {...iconProps} />;
    case "nested":
      return <DataObjectIcon {...iconProps} />;
    case "other":
      return <HelpCenterIcon {...iconProps} />;
  }
}

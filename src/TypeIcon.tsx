import { GoNumber } from "react-icons/go";
import { MdCalendarMonth } from "react-icons/md";
import { MdOutlineViewTimeline } from "react-icons/md";
import { MdFormatColorText } from "react-icons/md";
import { MdToggleOn } from "react-icons/md";
import { MdDataObject } from "react-icons/md";
import { GoQuestion } from "react-icons/go";
import { IconBaseProps } from "react-icons";
import { DtypeGroup } from "./types";

export interface TypeIconProps extends IconBaseProps {
  dtypeGroup: DtypeGroup;
}

export default function TypeIcon(props: TypeIconProps) {
  const { dtypeGroup, ...iconProps } = props;

  switch (dtypeGroup) {
    case "numeric":
      return <GoNumber {...iconProps} />;
    case "temporal":
      return <MdCalendarMonth {...iconProps} />;
    case "duration":
      return <MdOutlineViewTimeline {...iconProps} />;
    case "string":
      return <MdFormatColorText {...iconProps} />;
    case "boolean":
      return <MdToggleOn {...iconProps} />;
    case "nested":
      return <MdDataObject {...iconProps} />;
    case "other":
      return <GoQuestion {...iconProps} />;
  }
}

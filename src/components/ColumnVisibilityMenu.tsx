import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LuColumns3 } from "react-icons/lu";

export interface ColumnVisibilityMenuColumn {
  id: string;
  label: string;
  visible: boolean;
  disabled?: boolean;
}

export interface ColumnVisibilityMenuProps {
  columns: ColumnVisibilityMenuColumn[];
  onToggle: (id: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

export default function ColumnVisibilityMenu({
  columns,
  onToggle,
  onShowAll,
  onHideAll,
}: ColumnVisibilityMenuProps) {
  const visibleCount = columns.filter((column) => column.visible).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <LuColumns3 />
          Columns
          <span className="text-muted-foreground text-xs">
            {visibleCount}/{columns.length}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onShowAll();
          }}
        >
          Show all
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            onHideAll();
          }}
        >
          Hide all
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.visible}
            disabled={column.disabled}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(column.id)}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

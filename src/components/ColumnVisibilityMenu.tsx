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
          <span
            className="text-muted-foreground inline-block shrink-0 overflow-hidden text-right font-mono text-xs text-nowrap tabular-nums"
            // columns.lengthの桁数を基準に幅を固定し、表示/非表示を切り替えるたびに
            // visibleCountの桁数が変わってボタン幅(右側の見た目の位置)がガタつくのを防ぐ
            style={{ width: `${columns.length.toString().length * 2 + 1}ch` }}
          >
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

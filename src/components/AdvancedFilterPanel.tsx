import { useEffect, useRef, useState } from "react";
import { Schema } from "@/types";
import {
  createEmptyCondition,
  defaultTemporalValue,
  dtypeGroupForColumn,
  conditionsToSql,
  isConditionActive,
  temporalInputKind,
  OPERATORS_BY_DTYPE_GROUP,
  OPERATOR_LABELS,
  type FilterCombinator,
  type FilterCondition,
  type FilterOperator,
} from "@/advancedFilter";
import { Button } from "@/components/ui/button";
import DebouncedInput from "@/components/DebouncedInput";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LuFilter, LuX } from "react-icons/lu";

const NO_VALUE_OPERATORS: FilterOperator[] = ["isNull", "isNotNull"];
const RANGE_OPERATORS: FilterOperator[] = ["between", "notBetween"];

function ConditionRow({
  schema,
  condition,
  onChange,
  onRemove,
}: {
  schema: Schema;
  condition: FilterCondition;
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
}) {
  const dtypeGroup = dtypeGroupForColumn(schema, condition.columnName);
  const operators = OPERATORS_BY_DTYPE_GROUP[dtypeGroup];
  const columnType = schema.find(
    (c) => c.columnName === condition.columnName,
  )?.columnType;
  const pickerKind =
    dtypeGroup === "temporal" && columnType
      ? temporalInputKind(columnType)
      : undefined;

  const handleColumnChange = (newColumnName: string) => {
    const newGroup = dtypeGroupForColumn(schema, newColumnName);
    const newColumnType = schema.find(
      (c) => c.columnName === newColumnName,
    )?.columnType;
    const newPickerKind =
      newGroup === "temporal" && newColumnType
        ? temporalInputKind(newColumnType)
        : undefined;
    const validOps = OPERATORS_BY_DTYPE_GROUP[newGroup];
    // 演算子は新しい列でも有効ならそのまま引き継ぐ(例: 数値列同士ならgreaterThanを維持)。
    // 一方、値は列が変わった時点で常にリセットする。dtypeGroupやpickerKindが偶然一致する
    // ケースを判定して引き継ごうとすると、date/time/datetime-localのように紛らわしい
    // 組み合わせで値がズレたまま残るバグを繰り返し踏むため、単純に「列が変わったら値は
    // 常に空に戻す」というルールに倒す。
    const nextOperator = validOps.includes(condition.operator)
      ? condition.operator
      : validOps[0];

    onChange({
      ...condition,
      columnName: newColumnName,
      operator: nextOperator,
      value:
        nextOperator === "is"
          ? "true"
          : newPickerKind
            ? defaultTemporalValue(newPickerKind)
            : "",
      value2: "",
    });
  };

  const handleOperatorChange = (newOperator: FilterOperator) => {
    const needsValue2 = RANGE_OPERATORS.includes(newOperator);
    onChange({
      ...condition,
      operator: newOperator,
      value:
        newOperator === "is"
          ? "true"
          : pickerKind && condition.value === ""
            ? defaultTemporalValue(pickerKind)
            : condition.value,
      value2:
        needsValue2 && pickerKind && condition.value2 === ""
          ? defaultTemporalValue(pickerKind)
          : condition.value2,
    });
  };

  return (
    <div className="flex items-start gap-1.5">
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex gap-1.5">
          <Select
            value={condition.columnName}
            onValueChange={handleColumnChange}
          >
            <SelectTrigger size="sm" className="flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {schema.map((col) => (
                <SelectItem key={col.columnName} value={col.columnName}>
                  {col.columnName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={condition.operator}
            onValueChange={(v) => handleOperatorChange(v as FilterOperator)}
          >
            <SelectTrigger size="sm" className="flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operators.map((op) => (
                <SelectItem key={op} value={op}>
                  {OPERATOR_LABELS[op]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!NO_VALUE_OPERATORS.includes(condition.operator) &&
          (dtypeGroup === "boolean" ? (
            <Select
              value={condition.value || "true"}
              onValueChange={(v) => onChange({ ...condition, value: v })}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">True</SelectItem>
                <SelectItem value="false">False</SelectItem>
              </SelectContent>
            </Select>
          ) : condition.operator === "isOneOf" ? (
            <DebouncedTextarea
              value={condition.value}
              onChange={(v) => onChange({ ...condition, value: v })}
              placeholder="Comma or newline separated"
            />
          ) : RANGE_OPERATORS.includes(condition.operator) ? (
            <div className="flex gap-1.5">
              <DebouncedInput
                value={condition.value}
                onChange={(v) => onChange({ ...condition, value: v })}
                placeholder="From"
                type={pickerKind}
                step={pickerKind && pickerKind !== "date" ? 1 : undefined}
                className="h-7 flex-1 px-2 text-xs"
              />
              <DebouncedInput
                value={condition.value2}
                onChange={(v) => onChange({ ...condition, value2: v })}
                placeholder="To"
                type={pickerKind}
                step={pickerKind && pickerKind !== "date" ? 1 : undefined}
                className="h-7 flex-1 px-2 text-xs"
              />
            </div>
          ) : (
            <DebouncedInput
              value={condition.value}
              onChange={(v) => onChange({ ...condition, value: v })}
              placeholder="Value"
              type={pickerKind}
              step={pickerKind && pickerKind !== "date" ? 1 : undefined}
              className="h-7 px-2 text-xs"
            />
          ))}
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0 cursor-pointer"
        onClick={onRemove}
      >
        <LuX className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// isOneOf用の複数行入力。textarea.tsxが無いため、Inputと同系統のクラスを当てた素の
// <textarea>にDebouncedInputと同じdebounceロジックをインラインで適用する。
function DebouncedTextarea({
  value: externalValue,
  onChange,
  placeholder,
  debounce = 300,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounce?: number;
}) {
  const [value, setValue] = useState(externalValue);
  const [prevExternalValue, setPrevExternalValue] = useState(externalValue);

  if (externalValue !== prevExternalValue) {
    setPrevExternalValue(externalValue);
    setValue(externalValue);
  }

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const timeout = setTimeout(() => onChangeRef.current(value), debounce);
    return () => clearTimeout(timeout);
  }, [value, debounce]);

  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      rows={2}
      className={cn(
        "border-input placeholder:text-muted-foreground flex w-full min-w-0 rounded-md border bg-transparent px-2 py-1 text-xs shadow-xs transition-[color,box-shadow] outline-none",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
      )}
    />
  );
}

export interface AdvancedFilterPanelProps {
  schema: Schema;
  conditions: FilterCondition[];
  combinator: FilterCombinator;
  onConditionsChange: (conditions: FilterCondition[]) => void;
  onCombinatorChange: (combinator: FilterCombinator) => void;
  onInsertToQuery?: (text: string) => void;
  sqlEditorOpen?: boolean;
}

export default function AdvancedFilterPanel({
  schema,
  conditions,
  combinator,
  onConditionsChange,
  onCombinatorChange,
  onInsertToQuery,
  sqlEditorOpen,
}: AdvancedFilterPanelProps) {
  const activeCount = conditions.filter((c) =>
    isConditionActive(c, schema),
  ).length;
  const sql = conditionsToSql(conditions, combinator, schema);

  const updateCondition = (id: string, next: FilterCondition) => {
    onConditionsChange(conditions.map((c) => (c.id === id ? next : c)));
  };

  const removeCondition = (id: string) => {
    onConditionsChange(conditions.filter((c) => c.id !== id));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <LuFilter />
          Filters
          {activeCount > 0 && (
            <span className="text-muted-foreground text-xs">{activeCount}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[30rem]">
        <div className="flex flex-col gap-3">
          {conditions.length >= 2 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Where</span>
              <div className="flex overflow-hidden rounded-md border">
                <button
                  type="button"
                  onClick={() => onCombinatorChange("and")}
                  className={cn(
                    "cursor-pointer px-2 py-1",
                    combinator === "and"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => onCombinatorChange("or")}
                  className={cn(
                    "cursor-pointer px-2 py-1",
                    combinator === "or"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  Any
                </button>
              </div>
              <span className="text-muted-foreground">
                of the following are true
              </span>
            </div>
          )}
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {conditions.map((condition) => (
              <ConditionRow
                key={condition.id}
                schema={schema}
                condition={condition}
                onChange={(next) => updateCondition(condition.id, next)}
                onRemove={() => removeCondition(condition.id)}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={schema.length === 0}
              onClick={() =>
                onConditionsChange([
                  ...conditions,
                  createEmptyCondition(schema),
                ])
              }
            >
              + Add condition
            </Button>
            {conditions.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onConditionsChange([])}
              >
                Clear all
              </Button>
            )}
            {sqlEditorOpen && (
              <Button
                size="sm"
                variant="ghost"
                disabled={sql === ""}
                onClick={() => onInsertToQuery?.(`WHERE ${sql}`)}
                className="ml-auto"
              >
                Insert to SQL
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

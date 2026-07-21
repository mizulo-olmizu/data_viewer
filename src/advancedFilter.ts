import { DtypeGroup, Row, Schema } from "./types";

export type FilterCombinator = "and" | "or";

export type FilterOperator =
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "between"
  | "notBetween"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "isOneOf"
  | "is"
  | "isNull"
  | "isNotNull";

export interface FilterCondition {
  id: string;
  columnName: string;
  operator: FilterOperator;
  // 常にstring。数値/真偽値としてのパースはevaluateCondition/conditionToSqlClause内でのみ行う。
  value: string;
  // between/notBetweenの2つ目の値としてのみ使用。
  value2: string;
}

const COMPARABLE_OPERATORS: FilterOperator[] = [
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "between",
  "notBetween",
  "isOneOf",
  "isNull",
  "isNotNull",
];

const STRING_OPERATORS: FilterOperator[] = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "isOneOf",
  "isNull",
  "isNotNull",
];

const BOOLEAN_OPERATORS: FilterOperator[] = ["is", "isNull", "isNotNull"];

const NULLABILITY_ONLY_OPERATORS: FilterOperator[] = ["isNull", "isNotNull"];

export const OPERATORS_BY_DTYPE_GROUP: Record<DtypeGroup, FilterOperator[]> = {
  numeric: COMPARABLE_OPERATORS,
  temporal: COMPARABLE_OPERATORS,
  duration: COMPARABLE_OPERATORS,
  string: STRING_OPERATORS,
  boolean: BOOLEAN_OPERATORS,
  nested: NULLABILITY_ONLY_OPERATORS,
  other: NULLABILITY_ONLY_OPERATORS,
};

export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: "Equals",
  notEquals: "Not equals",
  greaterThan: "Greater than",
  greaterThanOrEqual: "Greater or equal",
  lessThan: "Less than",
  lessThanOrEqual: "Less or equal",
  between: "Between",
  notBetween: "Not between",
  contains: "Contains",
  notContains: "Not contains",
  startsWith: "Starts with",
  endsWith: "Ends with",
  isOneOf: "Is one of",
  is: "Is",
  isNull: "Is null",
  isNotNull: "Is not null",
};

// 数値として比較する演算子(=間隔もisOneOfの数値解釈は行わず文字列比較に倒す。SQL生成側も同様)。
const NUMERIC_COMPARISON_OPERATORS: FilterOperator[] = [
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "between",
  "notBetween",
];

function isNumericGroup(dtypeGroup: DtypeGroup): boolean {
  return dtypeGroup === "numeric" || dtypeGroup === "duration";
}

// columnTypeはRust側のDuckDBType enumのバリアント名がそのままJSONにシリアライズされたもの
// (serdeのデフォルトの外部タグ形式)なので、"DATE"ではなく"Date"のようなパスカルケースになる。
// DATE/TIME/TIMESTAMPは、arrow_jsonがシリアライズする値の文字列形式がHTMLのネイティブ
// date/time/datetime-local inputの値形式とそのまま一致するため、変換なしでピッカーに使える。
// TIME(<input type="time">)はTauriのWKWebViewだと(カレンダーのような)ポップアップUIは
// 出ないが、時/分/秒がセグメント分割され矢印キーで操作できる点はDATEと同様にネイティブの
// time inputとして機能しているため、そのまま使う。TimestampWithTimeZoneはUTC正規化+Z付き
// ("...T...Z")でdatetime-localの許容形式外のため、ピッカー非対応としテキスト入力に
// フォールバックする。
export function temporalInputKind(
  columnType: string,
): "date" | "time" | "datetime-local" | undefined {
  switch (columnType) {
    case "Date":
      return "date";
    case "Time":
      return "time";
    case "Timestamp":
      return "datetime-local";
    default:
      return undefined;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// ネイティブのdate/time/datetime-local inputは、値が空文字のままでも「今日の日付」
// 「現在時刻」らしき表示を初期状態として見せることがあり、見た目上は値が入っているように
// 見えるのにstate(condition.value)は空文字のまま、というズレが生じる。条件の新規作成時・
// 列切り替え時にstate側にも同じ値をあらかじめ入れておくことで、表示と実際のactive判定を
// 一致させる。
export function defaultTemporalValue(
  kind: "date" | "time" | "datetime-local",
): string {
  const now = new Date();
  const datePart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timePart = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  switch (kind) {
    case "date":
      return datePart;
    case "time":
      return timePart;
    case "datetime-local":
      return `${datePart}T${timePart}`;
  }
}

export function dtypeGroupForColumn(
  schema: Schema,
  columnName: string,
): DtypeGroup {
  return (
    schema.find((c) => c.columnName === columnName)?.columnDtypeGroup.type ??
    "other"
  );
}

export function parseIsOneOfValues(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function createEmptyCondition(schema: Schema): FilterCondition {
  const columnName = schema[0]?.columnName ?? "";
  const dtypeGroup = dtypeGroupForColumn(schema, columnName);
  const operator = OPERATORS_BY_DTYPE_GROUP[dtypeGroup][0];
  const pickerKind =
    dtypeGroup === "temporal" && schema[0]
      ? temporalInputKind(schema[0].columnType)
      : undefined;
  return {
    id: crypto.randomUUID(),
    columnName,
    operator,
    value:
      operator === "is"
        ? "true"
        : pickerKind
          ? defaultTemporalValue(pickerKind)
          : "",
    value2: "",
  };
}

// 条件が実際にフィルタとして機能する状態かどうか。値未入力の条件は無視する(全行非表示になる
// 誤動作を防ぐため)。
export function isConditionActive(
  condition: FilterCondition,
  schema: Schema,
): boolean {
  if (condition.operator === "isNull" || condition.operator === "isNotNull") {
    return true;
  }

  const dtypeGroup = dtypeGroupForColumn(schema, condition.columnName);

  if (condition.operator === "between" || condition.operator === "notBetween") {
    if (condition.value.trim() === "" || condition.value2.trim() === "") {
      return false;
    }
    if (isNumericGroup(dtypeGroup)) {
      return (
        !Number.isNaN(Number(condition.value)) &&
        !Number.isNaN(Number(condition.value2))
      );
    }
    return true;
  }

  if (condition.operator === "isOneOf") {
    return parseIsOneOfValues(condition.value).length > 0;
  }

  if (condition.value.trim() === "") {
    return false;
  }

  if (
    isNumericGroup(dtypeGroup) &&
    NUMERIC_COMPARISON_OPERATORS.includes(condition.operator)
  ) {
    return !Number.isNaN(Number(condition.value));
  }

  return true;
}

function evaluateCondition(
  row: Row,
  condition: FilterCondition,
  dtypeGroup: DtypeGroup,
): boolean {
  const cellValue = row[condition.columnName];

  if (cellValue === null || cellValue === undefined) {
    return condition.operator === "isNull";
  }
  if (condition.operator === "isNull") {
    return false;
  }
  if (condition.operator === "isNotNull") {
    return true;
  }

  if (condition.operator === "is") {
    const expected = condition.value === "true";
    return Boolean(cellValue) === expected;
  }

  if (isNumericGroup(dtypeGroup)) {
    const cellNum = Number(cellValue);
    switch (condition.operator) {
      case "equals":
        return cellNum === Number(condition.value);
      case "notEquals":
        return cellNum !== Number(condition.value);
      case "greaterThan":
        return cellNum > Number(condition.value);
      case "greaterThanOrEqual":
        return cellNum >= Number(condition.value);
      case "lessThan":
        return cellNum < Number(condition.value);
      case "lessThanOrEqual":
        return cellNum <= Number(condition.value);
      case "between":
        return (
          cellNum >= Number(condition.value) &&
          cellNum <= Number(condition.value2)
        );
      case "notBetween":
        return !(
          cellNum >= Number(condition.value) &&
          cellNum <= Number(condition.value2)
        );
      case "isOneOf":
        return parseIsOneOfValues(condition.value).some(
          (v) => Number(v) === cellNum,
        );
      default:
        return false;
    }
  }

  // temporal/duration(比較演算子のみ、文字列(ISO8601想定)の辞書式比較)・string共通
  const cellStr = String(cellValue);
  const cellLower = cellStr.toLowerCase();

  switch (condition.operator) {
    case "equals":
      return dtypeGroup === "string"
        ? cellLower === condition.value.toLowerCase()
        : cellStr === condition.value;
    case "notEquals":
      return dtypeGroup === "string"
        ? cellLower !== condition.value.toLowerCase()
        : cellStr !== condition.value;
    case "greaterThan":
      return cellStr > condition.value;
    case "greaterThanOrEqual":
      return cellStr >= condition.value;
    case "lessThan":
      return cellStr < condition.value;
    case "lessThanOrEqual":
      return cellStr <= condition.value;
    case "between":
      return cellStr >= condition.value && cellStr <= condition.value2;
    case "notBetween":
      return !(cellStr >= condition.value && cellStr <= condition.value2);
    case "contains":
      return cellLower.includes(condition.value.toLowerCase());
    case "notContains":
      return !cellLower.includes(condition.value.toLowerCase());
    case "startsWith":
      return cellLower.startsWith(condition.value.toLowerCase());
    case "endsWith":
      return cellLower.endsWith(condition.value.toLowerCase());
    case "isOneOf":
      return parseIsOneOfValues(condition.value).some(
        (v) => v.toLowerCase() === cellLower,
      );
    default:
      return false;
  }
}

export function applyAdvancedFilter(
  data: Row[],
  conditions: FilterCondition[],
  combinator: FilterCombinator,
  schema: Schema,
): Row[] {
  const activeConditions = conditions.filter((c) =>
    isConditionActive(c, schema),
  );
  if (activeConditions.length === 0) {
    return data;
  }

  return data.filter((row) => {
    const results = activeConditions.map((condition) =>
      evaluateCondition(
        row,
        condition,
        dtypeGroupForColumn(schema, condition.columnName),
      ),
    );
    return combinator === "and"
      ? results.every(Boolean)
      : results.some(Boolean);
  });
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function conditionToSqlClause(
  condition: FilterCondition,
  dtypeGroup: DtypeGroup,
): string {
  const column = quoteIdentifier(condition.columnName);

  if (condition.operator === "isNull") {
    return `${column} IS NULL`;
  }
  if (condition.operator === "isNotNull") {
    return `${column} IS NOT NULL`;
  }
  if (condition.operator === "is") {
    return `${column} = ${condition.value === "true" ? "TRUE" : "FALSE"}`;
  }

  if (isNumericGroup(dtypeGroup)) {
    const value = condition.value.trim();
    const value2 = condition.value2.trim();
    switch (condition.operator) {
      case "equals":
        return `${column} = ${value}`;
      case "notEquals":
        return `${column} <> ${value}`;
      case "greaterThan":
        return `${column} > ${value}`;
      case "greaterThanOrEqual":
        return `${column} >= ${value}`;
      case "lessThan":
        return `${column} < ${value}`;
      case "lessThanOrEqual":
        return `${column} <= ${value}`;
      case "between":
        return `${column} BETWEEN ${value} AND ${value2}`;
      case "notBetween":
        return `${column} NOT BETWEEN ${value} AND ${value2}`;
      case "isOneOf":
        return `${column} IN (${parseIsOneOfValues(condition.value).join(", ")})`;
      default:
        return "TRUE";
    }
  }

  // temporal/duration/string共通。stringはUI側の大小文字区別なし評価と一貫させるためLOWER()で包む。
  const isString = dtypeGroup === "string";
  const lhs = isString ? `LOWER(${column})` : column;
  const literal = (v: string) =>
    isString ? `LOWER(${sqlStringLiteral(v)})` : sqlStringLiteral(v);

  switch (condition.operator) {
    case "equals":
      return `${lhs} = ${literal(condition.value)}`;
    case "notEquals":
      return `${lhs} <> ${literal(condition.value)}`;
    case "greaterThan":
      return `${lhs} > ${literal(condition.value)}`;
    case "greaterThanOrEqual":
      return `${lhs} >= ${literal(condition.value)}`;
    case "lessThan":
      return `${lhs} < ${literal(condition.value)}`;
    case "lessThanOrEqual":
      return `${lhs} <= ${literal(condition.value)}`;
    case "between":
      return `${lhs} BETWEEN ${literal(condition.value)} AND ${literal(condition.value2)}`;
    case "notBetween":
      return `${lhs} NOT BETWEEN ${literal(condition.value)} AND ${literal(condition.value2)}`;
    case "contains":
      return `${lhs} LIKE ${literal(`%${condition.value}%`)}`;
    case "notContains":
      return `${lhs} NOT LIKE ${literal(`%${condition.value}%`)}`;
    case "startsWith":
      return `${lhs} LIKE ${literal(`${condition.value}%`)}`;
    case "endsWith":
      return `${lhs} LIKE ${literal(`%${condition.value}`)}`;
    case "isOneOf":
      return `${lhs} IN (${parseIsOneOfValues(condition.value)
        .map(literal)
        .join(", ")})`;
    default:
      return "TRUE";
  }
}

// activeな条件が無ければ空文字列を返す(ボタンのdisabled判定にも使う)。
export function conditionsToSql(
  conditions: FilterCondition[],
  combinator: FilterCombinator,
  schema: Schema,
): string {
  const activeConditions = conditions.filter((c) =>
    isConditionActive(c, schema),
  );
  if (activeConditions.length === 0) {
    return "";
  }

  const clauses = activeConditions.map((condition) =>
    conditionToSqlClause(
      condition,
      dtypeGroupForColumn(schema, condition.columnName),
    ),
  );

  if (clauses.length === 1) {
    return clauses[0];
  }

  const joiner = combinator === "and" ? " AND " : " OR ";
  return `(${clauses.join(joiner)})`;
}

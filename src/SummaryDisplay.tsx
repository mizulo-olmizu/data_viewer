import { Summary } from "./types";

export interface SummaryDisplayProps {
  summary: Summary;
}

export default function SummaryDisplay({ summary }: SummaryDisplayProps) {
  return (
    <div>
      {summary.map((item, index) => {
        if (item.type == "numeric") {
          return (
            <div key={index}>
              <h3>Numeric Summary</h3>
              <p>Column Name: {item.columnName}</p>
              <p>Not Null Count: {item.notNullCount ?? "N/A"}</p>
              <p>Null Count: {item.nullCount ?? "N/A"}</p>
              <p>Min: {item.min ?? "N/A"}</p>
              <p>Q1: {item.q1 ?? "N/A"}</p>
              <p>Median: {item.median ?? "N/A"}</p>
              <p>Q3: {item.q3 ?? "N/A"}</p>
              <p>Max: {item.max ?? "N/A"}</p>
              <p>Mean: {item.mean ?? "N/A"}</p>
            </div>
          );
        }

        if (item.type == "categorical") {
          return (
            <div key={index}>
              <h3>Categorical Summary</h3>
              <p>Column Name: {item.columnName}</p>
              <p>Not Null Count: {item.notNullCount ?? "N/A"}</p>
              <p>Null Count: {item.nullCount ?? "N/A"}</p>
              <h4>Value Counts:</h4>
              {item.valueCounts ? (
                <ul>
                  {item.valueCounts.map((vc, vcIndex) => (
                    <li key={vcIndex}>
                      Value: {vc.value}, Count: {vc.count ?? "N/A"}, Prop:{" "}
                      {vc.prop ?? "N/A"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>N/A</p>
              )}
            </div>
          );
        }

        if (item.type == "other") {
          return (
            <div key={index}>
              <h3>Other Summary</h3>
              <p>Column Name: {item.columnName}</p>
              <p>Not Null Count: {item.notNullCount ?? "N/A"}</p>
              <p>Null Count: {item.nullCount ?? "N/A"}</p>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
